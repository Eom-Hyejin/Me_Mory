const express = require('express');
const router = express.Router();
const db = require('../data/db');
const bcrypt = require('bcrypt');
const { s3 } = require('../util/s3')
const { generateToken, verifyToken } = require('../util/jwt'); // alias로 Access 발급
const { randomToken, storeRefreshToken, findActiveRefreshToken, revokeRefreshToken, revokeAllTokensForUser } = require('../util/refresh');
const crypto = require('crypto');

const CURRENT_TOS_VERSION = process.env.TOS_VERSION || '1.0.0';
const CURRENT_PRIVACY_VERSION = process.env.PRIVACY_VERSION || '1.0.0';
const PW_POLICY = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^\w\s]).{8,16}$/;
const USERNAME_POLICY = /^[A-Za-z0-9._-]{4,20}$/;
const EMAIL_POLICY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(res, status, message, detail) {
  return res.status(status).json({ message, detail });
}
function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.ip || '').toString();
}

/** 닉네임 자동 유니크 처리 */
async function insertUserWithUniqueNickname({ email, username, password, baseName, type, img }) {
  let finalName = baseName;
  let suffix = 1;
  let userId;
  while (true) {
    try {
      const [result] = await db.query(
        'INSERT INTO Users (email, username, password, name, type, img) VALUES (?, ?, ?, ?, ?, ?)',
        [email, username, password, finalName, type, img]
      );
      userId = result.insertId;
      break;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        if (err.message.includes('uq_users_name')) {
          finalName = `${baseName}${suffix}`;
          suffix++;
          continue;
        }
        if (err.message.includes('uq_users_username')) throw new Error('이미 존재하는 아이디입니다');
        if ((err.message || '').toLowerCase().includes('email')) throw new Error('이미 존재하는 이메일입니다');
      }
      throw err;
    }
  }
  return { userId, finalName };
}

async function saveConsentHistory({ userId, consents, req }) {
  const tosVersion = consents?.tosVersion;
  const privacyVersion = consents?.privacyVersion;
  const marketingOptIn = consents?.marketingOptIn ? 1 : 0;
  await db.query(
    `INSERT INTO UserConsents
      (user_id, tos_version, privacy_version, marketing_opt_in, agreed_ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, tosVersion, privacyVersion, marketingOptIn, getClientIp(req), (req.headers['user-agent'] || '').slice(0, 255)]
  );
}

async function isLatestConsented(userId) {
  const [[row]] = await db.query(
    `SELECT tos_version, privacy_version
       FROM UserConsents
      WHERE user_id = ?
   ORDER BY id DESC
      LIMIT 1`,
    [userId]
  );
  if (!row) return false;
  return row.tos_version === CURRENT_TOS_VERSION && row.privacy_version === CURRENT_PRIVACY_VERSION;
}

/* ====== (A) 중복확인 ====== */
router.post('/username', async (req, res) => {
  try {
    const username = (req.body?.username || '').trim();
    if (!username) return fail(res, 400, '아이디는 필수입니다');
    if (!USERNAME_POLICY.test(username)) return fail(res, 400, '아이디 형식이 올바르지 않습니다(영문/숫자/._-, 4~20자)');
    const [rows] = await db.query('SELECT 1 FROM Users WHERE username = ?', [username]);
    if (rows.length > 0) return fail(res, 409, '이미 존재하는 아이디입니다');
    return res.status(200).json({ message: '사용 가능한 아이디입니다' });
  } catch (err) {
    return fail(res, 500, '아이디 확인 실패', err.message);
  }
});
router.post('/email', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim();
    if (!email) return fail(res, 400, '이메일은 필수입니다');
    if (!EMAIL_POLICY.test(email)) return fail(res, 400, '이메일 형식이 올바르지 않습니다');
    const [rows] = await db.query('SELECT 1 FROM Users WHERE email = ?', [email]);
    if (rows.length > 0) return fail(res, 409, '이미 존재하는 이메일입니다');
    return res.status(200).json({ message: '사용 가능한 이메일입니다' });
  } catch (err) {
    return fail(res, 500, '이메일 확인 실패', err.message);
  }
});
router.post('/nickname', async (req, res) => {
  try {
    const nickname = (req.body?.nickname || '').trim();
    if (!nickname) return fail(res, 400, '닉네임은 필수입니다');
    const [rows] = await db.query('SELECT 1 FROM Users WHERE name = ?', [nickname]);
    if (rows.length > 0) return fail(res, 409, '이미 존재하는 닉네임입니다');
    return res.status(200).json({ message: '사용 가능한 닉네임입니다' });
  } catch (err) {
    return fail(res, 500, '닉네임 확인 실패', err.message);
  }
});

/* ====== (B) 웹 회원가입 ====== */
// body: { email, username, password, name, img?, consents{tosVersion, privacyVersion, marketingOptIn?} }
router.post('/', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim();
    const username = (req.body?.username || '').trim();
    const password = req.body?.password || '';
    const name = (req.body?.name || '').trim();
    const type = 'web';
    const img = req.body?.img ?? null;
    const consents = req.body?.consents;

    if (!email || !username || !password || !name) return fail(res, 400, '회원가입 실패: 필수 항목 누락');
    if (!EMAIL_POLICY.test(email)) return fail(res, 400, '이메일 형식이 올바르지 않습니다');
    if (!USERNAME_POLICY.test(username)) return fail(res, 400, '아이디 형식이 올바르지 않습니다(영문/숫자/._-, 4~20자)');
    if (!PW_POLICY.test(password)) return fail(res, 400, '비밀번호 정책 불만족(8~16자, 영문/숫자/특수문자 각 1개 이상)');

    const [[emailDup]] = await db.query('SELECT 1 FROM Users WHERE email = ?', [email]);
    if (emailDup) return fail(res, 409, '이미 존재하는 이메일입니다');
    const [[usernameDup]] = await db.query('SELECT 1 FROM Users WHERE username = ?', [username]);
    if (usernameDup) return fail(res, 409, '이미 존재하는 아이디입니다');

    if (!consents?.tosVersion || !consents?.privacyVersion) return fail(res, 400, '필수 약관 동의가 필요합니다');
    if (consents.tosVersion !== CURRENT_TOS_VERSION || consents.privacyVersion !== CURRENT_PRIVACY_VERSION) {
      return fail(res, 400, '약관 버전 불일치. 앱을 업데이트하거나 화면을 새로고침해주세요.');
    }

    const hashedPw = await bcrypt.hash(password, 12);
    const { userId, finalName } = await insertUserWithUniqueNickname({
      email, username, password: hashedPw, baseName: name, type, img,
    });

    await saveConsentHistory({ userId, consents, req });

    // Access/Refresh 발급
    const token = generateToken({ userId, name: finalName, type });
    const refreshToken = randomToken(64);
    await storeRefreshToken({
      userId,
      tokenPlain: refreshToken,
      deviceId: req.headers['x-device-id'] || null,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
    });

    return res.status(201).json({ userId, email, username, name: finalName, token, refreshToken });
  } catch (err) {
    console.error('[SIGNUP ERROR]', err);
    return fail(res, 400, '회원가입 실패', err.message);
  }
});

/* ====== (C) 웹 로그인 (아이디 또는 이메일) ====== */
// body: { loginId, password }
router.post('/login', async (req, res) => {
  try {
    const loginId = (req.body?.loginId || '').trim();
    const password = req.body?.password || '';
    if (!loginId || !password) return fail(res, 400, '로그인 실패: 아이디/이메일과 비밀번호가 필요합니다');

    const [rows] = await db.query('SELECT * FROM Users WHERE email = ? OR username = ?', [loginId, loginId]);
    if (!rows.length) return fail(res, 400, '아이디/이메일이나 비밀번호가 틀립니다');

    const user = rows[0];
    if (user.type !== 'web') return fail(res, 400, '소셜 계정은 소셜 로그인을 이용해주세요');

    const ok = await bcrypt.compare(password, user.password || '');
    if (!ok) return fail(res, 400, '아이디/이메일이나 비밀번호가 틀립니다');

    const token = generateToken({ userId: user.id, name: user.name, type: user.type });
    const upToDate = await isLatestConsented(user.id);

    const refreshToken = randomToken(64);
    await storeRefreshToken({
      userId: user.id,
      tokenPlain: refreshToken,
      deviceId: req.headers['x-device-id'] || null,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
    });

    return res.status(200).json({
      token,
      refreshToken,
      userdata: {
        userId: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        img: user.img,
        needReconsent: !upToDate,
      },
    });
  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    return fail(res, 500, '로그인 실패', err.message);
  }
});

/* ====== (D) 내 정보 조회 (+ 재동의 필요 여부) ====== */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await db.query('SELECT id AS userId, email, username, name, img, type FROM Users WHERE id = ?', [userId]);
    if (!rows.length) return fail(res, 403, '권한이 없습니다');
    const needReconsent = !(await isLatestConsented(userId));
    return res.status(200).json({ ...rows[0], needReconsent });
  } catch (err) {
    return fail(res, 500, '서버 오류', err.message);
  }
});

/* ====== (E) 소셜 계정 처리 ====== */
// body: { id, name, type, img?, consents? }
router.post('/social', async (req, res) => {
  try {
    const id = (req.body?.id || '').toString().trim();
    const name = (req.body?.name || '').trim();
    const type = (req.body?.type || '').trim(); // 'kakao' | 'naver'
    const img = req.body?.img ?? null;
    const consents = req.body?.consents;
    if (!['kakao','naver'].includes(type)) return fail(res, 400, '지원하지 않는 소셜 타입입니다');
    if (!id || !name || !type) return fail(res, 400, '필수 정보가 누락되었습니다');

    const email = `${type}_${id}@${type}.com`;
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    let userId;
    let finalName = name;
    let finalImg = img;

    if (!rows.length) {
      const created = await insertUserWithUniqueNickname({
        email, username: null, password: null, baseName: name, type, img,
      });
      userId = created.userId;
      finalName = created.finalName;

      if (consents?.tosVersion && consents?.privacyVersion) {
        await saveConsentHistory({ userId, consents, req });
      }
    } else {
      userId = rows[0].id;
      finalName = rows[0].name;
      finalImg = rows[0].img;
    }

    const token = generateToken({ userId, name: finalName, type });
    const refreshToken = randomToken(64);
    await storeRefreshToken({
      userId,
      tokenPlain: refreshToken,
      deviceId: req.headers['x-device-id'] || null,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] || '',
    });

    return res.status(201).json({
      token,
      refreshToken,
      userdata: { userId, email, name: finalName, img: finalImg, type },
    });
  } catch (err) {
    console.error('[SOCIAL ERROR]', err);
    return fail(res, 400, '소셜 회원가입 실패', err.message);
  }
});

/* ====== (F) 비밀번호 변경 ====== */
router.put('/password', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentPassword = req.body?.currentPassword || '';
    const newPassword = req.body?.newPassword || '';
    const newPasswordConfirm = req.body?.newPasswordConfirm || '';

    if (!currentPassword || !newPassword || !newPasswordConfirm) {
      return res.status(400).json({ message: '현재 비밀번호, 새 비밀번호, 새 비밀번호 확인은 모두 필수입니다' });
    }
    if (newPassword !== newPasswordConfirm) {
      return res.status(400).json({ message: '새 비밀번호와 확인 값이 일치하지 않습니다' });
    }
    if (!PW_POLICY.test(newPassword)) {
      return res.status(400).json({ message: '비밀번호 정책 불만족(8~16자, 영문/숫자/특수문자 각 1개 이상)' });
    }

    const [[row]] = await db.query('SELECT password FROM Users WHERE id = ?', [userId]);
    if (!row) return res.status(403).json({ message: '권한이 없습니다' });

    const ok = await bcrypt.compare(currentPassword, row.password || '');
    if (!ok) return res.status(400).json({ message: '현재 비밀번호가 일치하지 않습니다' });

    const same = await bcrypt.compare(newPassword, row.password || '');
    if (same) return res.status(400).json({ message: '현재 비밀번호와 다른 비밀번호를 사용해주세요' });

    const hashed = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE Users SET password = ? WHERE id = ?', [hashed, userId]);

    await revokeAllTokensForUser(userId);

    return res.status(200).json({ message: '비밀번호가 변경되었습니다' });
  } catch (err) {
    console.error('[PASSWORD CHANGE ERROR]', err);
    return res.status(500).json({ message: '비밀번호 변경 실패', detail: err.message });
  }
});

/* ====== (G) 회원 정보 수정(닉네임) ====== */
router.put('/', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const nickname = (req.body?.nickname || '').trim();

  try {
    if (!nickname) return fail(res, 400, '수정할 항목이 없습니다');

    try {
      await db.query('UPDATE Users SET name = ? WHERE id = ?', [nickname, userId]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, '이미 존재하는 닉네임입니다');
      throw e;
    }

    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    const token = generateToken({ userId, name: user.name, type: user.type });

    return res.status(200).json({
      token,
      userdata: { email: user.email, username: user.username, nickname: user.name, img: user.img },
    });
  } catch (err) {
    console.error('[UPDATE ERROR]', err);
    return fail(res, 500, '회원정보 수정 실패', err.message);
  }
});

/* ====== (H) 프로필 이미지 수정 (presigned URL 대응) ====== */
router.put('/img', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const rawUrl = String(req.body?.img || '').trim();
  if (!rawUrl) return fail(res, 400, '이미지 URL이 필요합니다');

  // ENV
  const BUCKET = process.env.AWS_S3_BUCKET_NAME; // 기존 util/s3에서 쓰던 변수명 그대로
  const REGION = process.env.AWS_REGION || process.env.S3_REGION;
  const MAX_BYTES = parseInt(process.env.PROFILE_IMAGE_MAX_BYTES || '5242880', 10); // 5MB
  const ALLOWED_PREFIX = String(process.env.PROFILE_IMAGE_ALLOWED_PREFIX || 'profile/'); // 허용 prefix
  const CDN_BASE = (process.env.CDN_BASE || '').replace(/\/+$/, ''); // 선택: CDN 도메인
  const ALLOWED_CT = ['image/jpeg', 'image/png', 'image/webp'];

  try {
    // 1) URL 파싱/HTTPS 체크
    let u;
    try { u = new URL(rawUrl); } catch { return fail(res, 400, '유효한 URL이 아닙니다'); }
    if (u.protocol !== 'https:') return fail(res, 400, 'HTTPS URL만 허용됩니다');

    // 2) 호스트 허용(옵션)
    const URL_WHITELIST = (process.env.PROFILE_IMAGE_HOST_WHITELIST || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (URL_WHITELIST.length && !URL_WHITELIST.includes(u.hostname)) {
      return fail(res, 400, '허용되지 않은 도메인입니다');
    }

    // 3) S3 형식별로 bucket/key 추출 (virtual-hosted, path-style, CDN)
    let host = u.hostname;
    let keyFromUrl = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    let bucketFromUrl = null;

    const vhPattern = new RegExp(`^(.+)\\.s3\\.${REGION}\\.amazonaws\\.com$`, 'i');
    const pathStyle = new RegExp(`^s3\\.${REGION}\\.amazonaws\\.com$`, 'i');

    if (vhPattern.test(host)) {
      // <bucket>.s3.<region>.amazonaws.com/<key>
      bucketFromUrl = host.replace(vhPattern, '$1');
    } else if (pathStyle.test(host)) {
      // s3.<region>.amazonaws.com/<bucket>/<key>
      const segs = keyFromUrl.split('/');
      if (segs.length < 2) return fail(res, 400, 'S3 경로가 올바르지 않습니다');
      bucketFromUrl = segs.shift();
      keyFromUrl = segs.join('/');
    } else {
      // CDN 등: 호스트는 whitelist로 통과시키고, key는 path 그대로 사용
      bucketFromUrl = BUCKET; // CDN은 원본 S3로 매핑
    }

    const objectKey = keyFromUrl;

    // 4) prefix 제한 + 확장자 1차 필터
    if (!objectKey.startsWith(ALLOWED_PREFIX)) {
      return fail(res, 400, `허용되지 않은 경로입니다(필수 prefix: ${ALLOWED_PREFIX})`);
    }
    if (!/\.(jpg|jpeg|png|webp)$/i.test(objectKey)) {
      return fail(res, 400, '허용되지 않은 이미지 확장자입니다');
    }

    // 5) S3 HeadObject로 MIME/크기 검증 (presigned 만료와 무관)
    let head;
    try {
      head = await s3.headObject({ Bucket: bucketFromUrl || BUCKET, Key: objectKey }).promise();
    } catch (e) {
      console.error('[S3 HeadObject ERROR]', e.code, e.message);
      return fail(res, 400, '이미지 메타데이터 확인 실패');
    }
    const contentType = (head.ContentType || '').toLowerCase();
    const contentLength = Number(head.ContentLength || 0);
    if (!ALLOWED_CT.includes(contentType)) {
      return fail(res, 400, `허용되지 않은 콘텐츠 타입입니다 (${contentType})`);
    }
    if (!contentLength || contentLength > MAX_BYTES) {
      return fail(res, 400, `이미지 최대 크기 초과 (${MAX_BYTES} bytes)`);
    }

    // 6) 저장값 정규화: presigned URL 저장 금지 → 정규 URL(or CDN) 저장
    const normalizedUrl = CDN_BASE
      ? `${CDN_BASE}/${objectKey}`
      : `https://${bucketFromUrl || BUCKET}.s3.${REGION}.amazonaws.com/${encodeURIComponent(objectKey)}`;

    await db.query('UPDATE Users SET img = ? WHERE id = ?', [normalizedUrl, userId]);

    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    const token = generateToken({ userId: user.id, name: user.name, type: user.type });

    return res.status(200).json({
      token,
      userdata: { userId: user.id, email: user.email, username: user.username, name: user.name, img: user.img },
    });
  } catch (err) {
    console.error('[PROFILE IMG UPDATE ERROR]', err);
    return fail(res, 500, '회원정보 수정 실패', err.message);
  }
});

/* ====== (I) 회원 탈퇴 ====== */
router.delete('/', verifyToken, async (req, res) => {
  const userId = req.user.userId;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) 토큰 무효화/삭제
    await conn.query(
      'UPDATE RefreshTokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ?',
      [userId]
    );
    await conn.query(
      'DELETE FROM RefreshTokens WHERE user_id = ?',
      [userId]
    );

    // 2) 감정 기록 관련(이미지가 Records에 FK로 묶여있다면 먼저 삭제)
    // RecordImages(recordId) -> Records(id, userId)
    await conn.query(
      `DELETE ri FROM RecordImages ri
        JOIN Records r ON r.id = ri.recordId
       WHERE r.userId = ?`,
      [userId]
    );
    await conn.query('DELETE FROM Records WHERE userId = ?', [userId]);

    // 3) 달력/통계(서비스에 따라 테이블명 다르면 맞춰 변경)
    await conn.query('DELETE FROM EmotionCalendar WHERE userId = ?', [userId]);
    await conn.query('DELETE FROM Emotion_Stats   WHERE userId = ?', [userId]);

    // 4) 동의 이력
    await conn.query('DELETE FROM UserConsents WHERE user_id = ?', [userId]);

    // 5) 마지막으로 사용자 삭제
    await conn.query('DELETE FROM Users WHERE id = ?', [userId]);

    await conn.commit();
    return res.status(204).send();
  } catch (err) {
    await conn.rollback();
    console.error('[DELETE /api/auth] ERROR:', err.code, err.sqlMessage || err.message);
    return res.status(500).json({ message: '회원탈퇴 실패', detail: err.sqlMessage || err.message });
  } finally {
    conn.release();
  }
});

/* ====== (J) 재동의 저장 ====== */
router.post('/consent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { tosVersion, privacyVersion, marketingOptIn } = req.body || {};
    if (tosVersion !== CURRENT_TOS_VERSION || privacyVersion !== CURRENT_PRIVACY_VERSION) {
      return fail(res, 400, '약관 버전 불일치');
    }
    await saveConsentHistory({
      userId,
      consents: { tosVersion, privacyVersion, marketingOptIn: !!marketingOptIn },
      req,
    });
    return res.status(200).json({ message: '동의가 저장되었습니다' });
  } catch (err) {
    console.error('[CONSENT ERROR]', err);
    return fail(res, 500, '동의 저장 실패', err.message);
  }
});

/* ====== (K) 토큰 갱신 ====== */
// body: { refreshToken }  (웹이면 쿠키에서 읽도록 확장 가능)
router.post('/refresh', async (req, res) => {
  try {
    const incoming = (req.body?.refreshToken || '').trim();
    if (!incoming) return res.status(401).json({ message: '리프레시 토큰이 없습니다' });

    const active = await findActiveRefreshToken(incoming);
    if (!active) return res.status(401).json({ message: '유효하지 않은 리프레시 토큰' });

    const [[user]] = await db.query('SELECT id, name, type FROM Users WHERE id = ?', [active.user_id]);
    if (!user) return res.status(401).json({ message: '유저 없음' });

    // 회전(rotate): 기존 RT 폐기 + 새 RT 발급/저장
    const newRefresh = randomToken(64);
    await revokeRefreshToken({ tokenPlain: incoming, replacedByPlain: newRefresh });
    await storeRefreshToken({
      userId: user.id,
      tokenPlain: newRefresh,
      deviceId: active.device_id,
      ip: active.ip,
      userAgent: active.user_agent,
    });

    const token = generateToken({ userId: user.id, name: user.name, type: user.type });
    return res.status(200).json({ token, refreshToken: newRefresh });
  } catch (err) {
    return res.status(500).json({ message: '토큰 갱신 실패', detail: err.message });
  }
});

/* ====== (L) 로그아웃 ====== */
// body: { refreshToken }  (웹이면 쿠키 삭제로 확장)
router.post('/logout', async (req, res) => {
  try {
    const incoming = (req.body?.refreshToken || '').trim();
    if (incoming) await revokeRefreshToken({ tokenPlain: incoming });
    return res.status(200).json({ message: '로그아웃 되었습니다' });
  } catch (err) {
    return res.status(500).json({ message: '로그아웃 실패', detail: err.message });
  }
});

/* ====== (M) 특정 유저 정보 조회 ====== */
router.get('/user/:userId', verifyToken, async (req, res) => {
  try {
    const myUserId = req.user.userId;
    const targetUserId = parseInt(req.params.userId, 10);
    if (Number.isNaN(targetUserId)) return fail(res, 400, '잘못된 요청입니다');

    const [[profileData], [userData]] = await Promise.all([
      db.query('SELECT id AS userId, name, img FROM Users WHERE id = ?', [targetUserId]),
      db.query('SELECT id AS userId, name, img FROM Users WHERE id = ?', [myUserId]),
    ]);
    if (!profileData.length) return fail(res, 400, '잘못된 요청입니다');

    return res.status(200).json({ profileData: profileData[0], userData: userData[0] });
  } catch (err) {
    return fail(res, 500, '서버 오류', err.message);
  }
});

/* ====== (N) 아이디 찾기 ====== */
// body: { name, email }
router.post('/find-id', async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    const email = (req.body?.email || '').trim();
    if (!name || !email) return fail(res, 400, '이름과 이메일은 필수입니다');

    const [rows] = await db.query(
      'SELECT username FROM Users WHERE name = ? AND email = ?',
      [name, email]
    );
    if (!rows.length) return fail(res, 404, '해당 정보로 가입된 아이디가 없습니다');

    return res.status(200).json({ username: rows[0].username });
  } catch (err) {
    return fail(res, 500, '아이디 찾기 실패', err.message);
  }
});

/* ====== (O) 비밀번호 찾기 ====== */
// body: { username, name, email }
router.post('/find-pw', async (req, res) => {
  try {
    const username = (req.body?.username || '').trim();
    const name = (req.body?.name || '').trim();
    const email = (req.body?.email || '').trim();
    if (!username || !name || !email) {
      return fail(res, 400, '아이디, 이름, 이메일은 필수입니다');
    }

    const [rows] = await db.query(
      'SELECT id FROM Users WHERE username = ? AND name = ? AND email = ?',
      [username, name, email]
    );
    if (!rows.length) return fail(res, 404, '해당 정보로 가입된 계정이 없습니다');

    // 임시 비밀번호 생성
    const tempPw = Math.random().toString(36).slice(-10) + '!';

    // DB 업데이트
    const hashed = await bcrypt.hash(tempPw, 12);
    await db.query('UPDATE Users SET password = ? WHERE id = ?', [hashed, rows[0].id]);

    // 이메일 발송 대신 → JSON 응답에 포함
    return res.status(200).json({ tempPassword: tempPw });
  } catch (err) {
    return fail(res, 500, '비밀번호 찾기 실패', err.message);
  }
});

/* ====== (H-1) 프로필 이미지 업로드용 Presign (PUT) ====== */
// POST /api/auth/img/presign   body: { contentType, ext?, filename? }
// 응답: { uploadUrl, objectUrl, publicUrl, key }
router.post('/img/presign', verifyToken, async (req, res) => {
  try {
    // ===== 환경 변수 =====
    const BUCKET    = process.env.AWS_S3_BUCKET_NAME;
    const REGION    = process.env.AWS_REGION || process.env.S3_REGION;
    const EXPIRES   = parseInt(process.env.S3_PRESIGN_EXPIRES || '300', 10); // 5분
    const PREFIX    = String(process.env.PROFILE_IMAGE_ALLOWED_PREFIX || 'profile/'); // 기존 /auth/img 와 동일
    const CDN_BASE  = (process.env.CDN_BASE || '').replace(/\/+$/, '');

    // ===== 입력 =====
    const { contentType, ext, filename } = req.body || {};
    if (!contentType) return res.status(400).json({ message: 'contentType가 필요합니다' });

    // 허용 타입 (authRouter /img 와 맞춤)
    const ALLOWED_CT = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_CT.includes(String(contentType).toLowerCase())) {
      return res.status(400).json({ message: '허용되지 않은 콘텐츠 타입입니다' });
    }

    // 확장자 매핑
    const ct = contentType.toLowerCase();
    let _ext = ext;
    if (!_ext) {
      if (ct === 'image/jpeg') _ext = 'jpg';
      else if (ct === 'image/png') _ext = 'png';
      else if (ct === 'image/webp') _ext = 'webp';
      else _ext = 'bin';
    }
    _ext = _ext.replace(/^\./, '');

    // 키 생성(유저별/날짜폴더/랜덤)
    const uid = req.user.userId;
    const stamp = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0,14);
    const rand = crypto.randomBytes(8).toString('hex');
    const safeName = (filename || '').replace(/[^\w.-]/g, '').slice(0,60) || `profile_${stamp}`;
    const key = `${PREFIX}${uid}/${stamp}_${rand}_${safeName}.${_ext}`;

    // presign (PUT)
    const params = {
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      Expires: EXPIRES,
    };
    const uploadUrl = await s3.getSignedUrlPromise('putObject', params);

    // 업로드 후 접근 가능한 URL들
    const objectUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${encodeURIComponent(key)}`;
    const publicUrl = CDN_BASE ? `${CDN_BASE}/${key}` : objectUrl;

    return res.json({ uploadUrl, objectUrl, publicUrl, key });
  } catch (err) {
    console.error('[IMG PRESIGN ERROR]', err);
    return res.status(500).json({ message: '업로드 주소 발급 실패', detail: err.message });
  }
});

module.exports = router;