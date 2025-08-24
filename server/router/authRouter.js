const express = require('express');
const router = express.Router();
const db = require('../data/db');
const bcrypt = require('bcrypt');
const { generateToken, verifyToken } = require('../util/jwt');

/** 약관 현재 버전(서버 권위) */
const CURRENT_TOS_VERSION = process.env.TOS_VERSION || '1.0.0';
const CURRENT_PRIVACY_VERSION = process.env.PRIVACY_VERSION || '1.0.0';

/** 비밀번호 정책: 8~16자, 영문/숫자/특수문자 각각 최소 1개 */
const PW_POLICY = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^\w\s]).{8,16}$/;

/** 공통 에러 응답 */
function fail(res, status, message, detail) {
  return res.status(status).json({ message, detail });
}

/** 닉네임 자동 유니크 처리 (DB UNIQUE 충돌 시 suffix 증가) */
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
        // 닉네임 충돌
        if (err.message.includes('uq_users_name')) {
          finalName = `${baseName}${suffix}`;
          suffix++;
          continue;
        }
        // 아이디 충돌
        if (err.message.includes('uq_users_username')) {
          throw new Error('이미 존재하는 아이디입니다');
        }
        // 이메일 충돌
        if (err.message.toLowerCase().includes('email')) {
          throw new Error('이미 존재하는 이메일입니다');
        }
      }
      throw err;
    }
  }
  return { userId, finalName };
}

/** 동의 이력 저장 */
async function saveConsentHistory({ userId, consents, req }) {
  const tosVersion = consents?.tosVersion;
  const privacyVersion = consents?.privacyVersion;
  const marketingOptIn = consents?.marketingOptIn ? 1 : 0;

  await db.query(
    `INSERT INTO UserConsents
      (user_id, tos_version, privacy_version, marketing_opt_in, agreed_ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      tosVersion,
      privacyVersion,
      marketingOptIn,
      req.ip,
      (req.headers['user-agent'] || '').slice(0, 255),
    ]
  );
}

/** 최신 약관 동의 여부 확인 */
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

/* =========================
 * (A) 중복확인: 아이디/이메일/닉네임
 * ========================= */

// 아이디(Username) 중복확인
// POST /auth/username  { username }
router.post('/username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return fail(res, 400, '아이디는 필수입니다');

    // 정책: 영문/숫자/._- 허용, 길이 4~20
    if (!/^[A-Za-z0-9._-]{4,20}$/.test(username)) {
      return fail(res, 400, '아이디 형식이 올바르지 않습니다(영문/숫자/._-, 4~20자)');
    }

    const [rows] = await db.query('SELECT 1 FROM Users WHERE username = ?', [username]);
    if (rows.length > 0) return fail(res, 409, '이미 존재하는 아이디입니다');

    return res.status(200).json({ message: '사용 가능한 아이디입니다' });
  } catch (err) {
    return fail(res, 500, '아이디 확인 실패', err.message);
  }
});

// 이메일 중복확인
// POST /auth/email  { email }
router.post('/email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return fail(res, 400, '이메일은 필수입니다');

    const [rows] = await db.query('SELECT 1 FROM Users WHERE email = ?', [email]);
    if (rows.length > 0) return fail(res, 409, '이미 존재하는 이메일입니다');

    return res.status(200).json({ message: '사용 가능한 이메일입니다' });
  } catch (err) {
    return fail(res, 500, '이메일 확인 실패', err.message);
  }
});

// 닉네임 중복확인
// POST /auth/nickname  { nickname }
router.post('/nickname', async (req, res) => {
  try {
    const { nickname } = req.body;
    if (!nickname) return fail(res, 400, '닉네임은 필수입니다');

    const [rows] = await db.query('SELECT 1 FROM Users WHERE name = ?', [nickname]);
    if (rows.length > 0) return fail(res, 409, '이미 존재하는 닉네임입니다');

    return res.status(200).json({ message: '사용 가능한 닉네임입니다' });
  } catch (err) {
    return fail(res, 500, '닉네임 확인 실패', err.message);
  }
});

/* =========================
 * (B) 웹 회원가입
 * ========================= */
// POST /auth
// body: { email, username, password, name, img?, consents{tosVersion, privacyVersion, marketingOptIn?} }
router.post('/', async (req, res) => {
  try {
    const { email, username, password, name, type = 'web', img = null, consents } = req.body;

    // 필수 값
    if (!email || !username || !password || !name) {
      return fail(res, 400, '회원가입 실패: 필수 항목 누락');
    }
    // 아이디 형식 검증
    if (!/^[A-Za-z0-9._-]{4,20}$/.test(username)) {
      return fail(res, 400, '아이디 형식이 올바르지 않습니다(영문/숫자/._-, 4~20자)');
    }
    // 비밀번호 정책
    if (!PW_POLICY.test(password)) {
      return fail(res, 400, '비밀번호 정책 불만족(8~16자, 영문/숫자/특수문자 각 1개 이상)');
    }

    // 중복 검사
    const [[emailDup]] = await db.query('SELECT 1 FROM Users WHERE email = ?', [email]);
    if (emailDup) return fail(res, 409, '이미 존재하는 이메일입니다');

    const [[usernameDup]] = await db.query('SELECT 1 FROM Users WHERE username = ?', [username]);
    if (usernameDup) return fail(res, 409, '이미 존재하는 아이디입니다');

    // 약관 동의 검증
    if (!consents?.tosVersion || !consents?.privacyVersion) {
      return fail(res, 400, '필수 약관 동의가 필요합니다');
    }
    if (consents.tosVersion !== CURRENT_TOS_VERSION || consents.privacyVersion !== CURRENT_PRIVACY_VERSION) {
      return fail(res, 400, '약관 버전 불일치. 앱을 업데이트하거나 화면을 새로고침해주세요.');
    }

    const hashedPw = await bcrypt.hash(password, 12);

    // 닉네임 유니크 처리 (대소문자 구분 & UNIQUE(name) 전제)
    const { userId, finalName } = await insertUserWithUniqueNickname({
      email,
      username,
      password: hashedPw,
      baseName: name,
      type,
      img,
    });

    // 동의 이력 저장
    await saveConsentHistory({ userId, consents, req });

    return res.status(201).json({ userId, username, name: finalName });
  } catch (err) {
    console.error('[SIGNUP ERROR]', err);
    return fail(res, 400, '회원가입 실패', err.message);
  }
});

/* =========================
 * (C) 웹 로그인 (아이디 또는 이메일)
 * ========================= */
// POST /auth/login
// body: { loginId, password }  // loginId = username 또는 email
router.post('/login', async (req, res) => {
  try {
    const { loginId, password } = req.body;
    if (!loginId || !password) {
      return fail(res, 400, '로그인 실패: 아이디/이메일과 비밀번호가 필요합니다');
    }

    const [rows] = await db.query(
      'SELECT * FROM Users WHERE email = ? OR username = ?',
      [loginId, loginId]
    );
    if (!rows.length) {
      return fail(res, 400, '아이디/이메일이나 비밀번호가 틀립니다');
    }

    const user = rows[0];

    // 소셜 계정 차단
    if (user.type !== 'web') {
      return fail(res, 400, '소셜 계정은 소셜 로그인을 이용해주세요');
    }

    const ok = await bcrypt.compare(password, user.password || '');
    if (!ok) {
      return fail(res, 400, '아이디/이메일이나 비밀번호가 틀립니다');
    }

    const token = generateToken({ userId: user.id, name: user.name, type: user.type });
    const upToDate = await isLatestConsented(user.id);

    return res.status(200).json({
      token,
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

/* =========================
 * (D) 내 정보 조회 (+ 재동의 필요 여부)
 * ========================= */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await db.query(
      'SELECT id AS userId, email, username, name, img, type FROM Users WHERE id = ?',
      [userId]
    );
    if (!rows.length) return fail(res, 403, '권한이 없습니다');

    const needReconsent = !(await isLatestConsented(userId));
    return res.status(200).json({ ...rows[0], needReconsent });
  } catch (err) {
    return fail(res, 500, '서버 오류', err.message);
  }
});

/* =========================
 * (E) 특정 유저 정보 조회
 * ========================= */
router.get('/:userId', verifyToken, async (req, res) => {
  try {
    const myUserId = req.user.userId;
    const targetUserId = parseInt(req.params.userId);
    if (isNaN(targetUserId)) return fail(res, 400, '잘못된 요청입니다');

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

/* =========================
 * (F) 소셜 계정 처리 (서버 콜백에서만 사용 권장)
 * ========================= */
// POST /auth/social
// body: { id, name, type, img?, consents? }
router.post('/social', async (req, res) => {
  try {
    const { id, name, type, img = null, consents } = req.body;
    if (!id || !name || !type) {
      return fail(res, 400, '필수 정보가 누락되었습니다');
    }

    const email = `${type}_${id}@${type}.com`;
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    let userId;
    let finalName = name;
    let finalImg = img;

    if (!rows.length) {
      // 소셜은 username 불필요 → NULL, password도 NULL
      const { userId: newId, finalName: newName } = await insertUserWithUniqueNickname({
        email,
        username: null,
        password: null,
        baseName: name,
        type,
        img,
      });
      userId = newId;
      finalName = newName;

      // 최초 가입 시 동의 이력 저장(콜백에서 받은 버전 전달 권장)
      if (consents?.tosVersion && consents?.privacyVersion) {
        await saveConsentHistory({ userId, consents, req });
      }
    } else {
      userId = rows[0].id;
      finalName = rows[0].name;
      finalImg = rows[0].img;
    }

    const token = generateToken({ userId, name: finalName, type });
    return res.status(201).json({
      token,
      userdata: { userId, name: finalName, img: finalImg, type },
    });
  } catch (err) {
    console.error('[SOCIAL ERROR]', err);
    return fail(res, 400, '소셜 회원가입 실패', err.message);
  }
});

/* =========================
 * (G) 비밀번호 검증
 * ========================= */
// 비밀번호 변경 (현재 비번 검증 + 새 비번/확인 일치 + 정책 검사)
router.put('/password', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword, newPasswordConfirm } = req.body || {};

    // 1) 입력 검증
    if (!currentPassword || !newPassword || !newPasswordConfirm) {
      return res.status(400).json({ message: '현재 비밀번호, 새 비밀번호, 새 비밀번호 확인은 모두 필수입니다' });
    }
    if (newPassword !== newPasswordConfirm) {
      return res.status(400).json({ message: '새 비밀번호와 확인 값이 일치하지 않습니다' });
    }
    if (!PW_POLICY.test(newPassword)) {
      return res.status(400).json({ message: '비밀번호 정책 불만족(8~16자, 영문/숫자/특수문자 각 1개 이상)' });
    }

    // 2) 현재 비밀번호 검증
    const [[row]] = await db.query('SELECT password FROM Users WHERE id = ?', [userId]);
    if (!row) return res.status(403).json({ message: '권한이 없습니다' });

    const ok = await bcrypt.compare(currentPassword, row.password || '');
    if (!ok) return res.status(400).json({ message: '현재 비밀번호가 일치하지 않습니다' });

    // 3) 새/현재 동일 금지(선택)
    const same = await bcrypt.compare(newPassword, row.password || '');
    if (same) return res.status(400).json({ message: '현재 비밀번호와 다른 비밀번호를 사용해주세요' });

    // 4) 업데이트
    const hashed = await bcrypt.hash(newPassword, 12);
    await db.query('UPDATE Users SET password = ? WHERE id = ?', [hashed, userId]);

    return res.status(200).json({ message: '비밀번호가 변경되었습니다' });
  } catch (err) {
    console.error('[PASSWORD CHANGE ERROR]', err);
    return res.status(500).json({ message: '비밀번호 변경 실패', detail: err.message });
  }
});


/* =========================
 * (H) 회원 정보 수정 (닉네임/비밀번호)
 * ========================= */
router.put('/', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const { nickname, password } = req.body;

  try {
    const updates = [];
    const values = [];

    if (nickname) {
      try {
        await db.query('UPDATE Users SET name = ? WHERE id = ?', [nickname, userId]);
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
          return fail(res, 409, '이미 존재하는 닉네임입니다');
        }
        throw e;
      }
      updates.push('name = ?');
      values.push(nickname);
    }

    if (password) {
      if (!PW_POLICY.test(password)) {
        return fail(res, 400, '비밀번호 정책 불만족(8~16자, 영문/숫자/특수문자 각 1개 이상)');
      }
      const hashedPw = await bcrypt.hash(password, 12);
      updates.push('password = ?');
      values.push(hashedPw);
    }

    if (updates.length === 0) return fail(res, 400, '수정할 항목이 없습니다');

    values.push(userId);
    await db.query(`UPDATE Users SET ${updates.join(', ')} WHERE id = ?`, values);

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

/* =========================
 * (I) 프로필 이미지 수정
 * ========================= */
router.put('/img', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const { img } = req.body;
  if (!img) return fail(res, 400, '이미지 URL이 필요합니다');

  try {
    await db.query('UPDATE Users SET img = ? WHERE id = ?', [img, userId]);
    const [[user]] = await db.query('SELECT * FROM Users WHERE id = ?', [userId]);
    const token = generateToken({ userId: user.id, name: user.name, type: user.type });

    return res.status(200).json({
      token,
      userdata: { userId: user.id, email: user.email, username: user.username, name: user.name, img: user.img },
    });
  } catch (err) {
    return fail(res, 500, '회원정보 수정 실패', err.message);
  }
});

/* =========================
 * (J) 회원 탈퇴
 * ========================= */
router.delete('/', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    await db.query('DELETE FROM Users WHERE id = ?', [userId]);
    return res.status(204).send();
  } catch (err) {
    return fail(res, 500, '회원탈퇴 실패', err.message);
  }
});

/* =========================
 * (K) 재동의 저장 (최신 버전으로 다시 동의)
 * ========================= */
router.post('/consent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { tosVersion, privacyVersion, marketingOptIn } = req.body || {};

    // 서버 권위 버전과 일치하는지 확인
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

module.exports = router;
