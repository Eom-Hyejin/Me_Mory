const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');
const { v4: uuidv4 } = require('uuid');
const { recomputeDailySummary } = require('../util/dailySummary');
const multer = require('multer');
const { s3 } = require('../util/s3');
require('dotenv').config();

const upload = multer({ storage: multer.memoryStorage() });

const EMOTIONS = ['joy', 'sadness', 'anger', 'worry', 'proud', 'upset'];
const ALLOWED_IMG = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function ensureMax4(arr) {
  return Array.isArray(arr) ? arr.slice(0, 4) : [];
}

function validLatLng(lat, lng) {
  if (lat === undefined && lng === undefined) return true;
  const L = Number(lat), G = Number(lng);
  return Number.isFinite(L) && Number.isFinite(G) && L >= -90 && L <= 90 && G >= -180 && G <= 180;
}

function nonEmptyString(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

/* ================== S3 Presigned URL ================== */
// GET /record-drafts/upload-url?filename=a.jpg
router.get('/upload-url', verifyToken, async (req, res) => {
  try {
    const { filename } = req.query;
    if (!nonEmptyString(filename) || !filename.includes('.')) {
      return res.status(400).json({ message: '유효한 filename 쿼리 파라미터가 필요합니다' });
    }
    const ext = filename.split('.').pop().toLowerCase();
    const ctype = ALLOWED_IMG[ext];
    if (!ctype) return res.status(400).json({ message: '허용되지 않는 이미지 형식' });

    const key = `records/${req.user.userId}/${uuidv4()}.${ext}`;
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key,
      Expires: 60,
      ContentType: ctype,
      ACL: 'public-read',
    };
    const uploadUrl = s3.getSignedUrl('putObject', params);
    const imageUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    res.json({ uploadUrl, imageUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Presigned URL 생성 실패', detail: err.message });
  }
});

/* ================== 1) 드래프트 생성 ================== */
router.post('/drafts', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const { emotion_type, expression_type, content, place, visibility, images, latitude, longitude } = req.body;

  // 1. emotion_type 유효성 검증
  if (!EMOTIONS.includes(emotion_type)) {
    return res.status(400).json({ message: '지원하지 않는 감정 유형입니다.' });
  }

  // 2. expression_type 유효성 검증
  if (!['positive', 'neutral', 'negative'].includes(expression_type)) {
    return res.status(400).json({ message: '지원하지 않는 표현 유형입니다.' });
  }

  // 3. visibility 유효성 검증
  if (!['public', 'private', 'restricted'].includes(visibility)) {
    return res.status(400).json({ message: '지원하지 않는 가시성 유형입니다.' });
  }

  // 4. place 길이 제한 (255자 이하)
  if (place && place.length > 255) {
    return res.status(400).json({ message: '장소 이름은 255자 이하로 입력해야 합니다.' });
  }

  // 5. content 길이 제한 (1000자 이하)
  if (content && content.length > 1000) {
    return res.status(400).json({ message: '내용은 1000자 이하로 입력해야 합니다.' });
  }

  // 6. 이미지 검증 (형식과 크기 제한)
  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (images && images.length > 0) {
    for (const image of images) {
      if (!allowedImageTypes.includes(image.mimeType)) {
        return res.status(400).json({ message: '허용되지 않는 이미지 형식입니다.' });
      }
      if (image.size > 5 * 1024 * 1024) {  // 5MB 제한
        return res.status(400).json({ message: '이미지 크기는 5MB 이하로 제한됩니다.' });
      }
    }
  }

  // 7. 좌표 유효성 검사
  if (!validLatLng(latitude, longitude)) {
    return res.status(400).json({ message: '유효한 좌표가 아닙니다.' });
  }

  // DB에 저장
  try {
    const [r] = await db.query(
      'INSERT INTO RecordDrafts (userId, emotion_type, expression_type, content, place, visibility, latitude, longitude, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [userId, emotion_type, expression_type, content, place, visibility, latitude, longitude]
    );

    const draftId = r.insertId;

    // 이미지 업로드 및 연결
    if (images && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        await db.query(
          'INSERT INTO RecordImages (draftId, url, sort_order) VALUES (?, ?, ?)',
          [draftId, images[i].url, i]
        );
      }
    }

    return res.status(201).json({ message: '감정 드래프트 저장 완료', draftId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '감정 드래프트 저장 실패', detail: err.message });
  }
});

/* ================== 2) 드래프트 업데이트 ================== */
router.patch('/drafts/:id', verifyToken, async (req, res) => {
  const draftId = parseInt(req.params.id, 10);
  const userId = req.user.userId;

  const {
    title, emotion_type, expression_type, content,
    latitude, longitude, place, visibility, period, reveal_at, step, images,
  } = req.body;

  // 1. emotion_type 유효성 검증
  if (emotion_type && !EMOTIONS.includes(emotion_type)) {
    return res.status(400).json({ message: '지원하지 않는 감정 유형입니다.' });
  }

  // 2. 좌표 유효성 검증
  if ((latitude !== undefined || longitude !== undefined) && !validLatLng(latitude, longitude)) {
    return res.status(400).json({ message: '잘못된 좌표' });
  }

  // 3. place 길이 제한
  if (place && String(place).length > 255) {
    return res.status(400).json({ message: '장소 이름은 255자 이하로 입력해야 합니다.' });
  }

  // 4. title 길이 제한
  if (title && String(title).length > 100) {
    return res.status(400).json({ message: '제목 길이 초과(<=100)' });
  }

  // 5. 이미지 갯수 제한
  if (images && (!Array.isArray(images) || images.length > 4)) {
    return res.status(400).json({ message: '이미지는 최대 4장까지만 업로드 가능합니다.' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 6. 드래프트 상태 체크
    const [[d]] = await conn.query(
      `SELECT id, status FROM RecordDrafts WHERE id=? AND userId=?`, [draftId, userId]
    );
    if (!d) {
      await conn.rollback();
      return res.status(404).json({ message: 'Draft 없음' });
    }
    if (d.status === 'confirmed') {
      await conn.rollback();
      return res.status(409).json({ message: '이미 확정된 드래프트입니다' });
    }

    const updates = [];
    const vals = [];
    const allowed = {
      title, emotion_type, expression_type, content,
      latitude, longitude, place, visibility, period, reveal_at, step,
    };
    Object.keys(allowed).forEach((k) => {
      if (allowed[k] !== undefined) {
        updates.push(`${k}=?`);
        vals.push(allowed[k]);
      }
    });

    if (updates.length) {
      vals.push(draftId, userId);
      await conn.query(
        `UPDATE RecordDrafts SET ${updates.join(', ')}, updated_at=NOW() WHERE id=? AND userId=?`,
        vals
      );
    }

    // 7. 이미지 갱신 (기존 이미지 삭제 후 새 이미지 추가)
    if (images) {
      await conn.query(`DELETE FROM RecordImages WHERE draftId=?`, [draftId]);
      const list = ensureMax4(images);
      for (let i = 0; i < list.length; i++) {
        await conn.query(
          `INSERT INTO RecordImages (draftId, url, sort_order) VALUES (?, ?, ?)`,
          [draftId, list[i], i]
        );
      }
    }

    await conn.commit();
    res.json({ message: 'Draft 업데이트 완료' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Draft 업데이트 실패', detail: err.message });
  } finally {
    conn.release();
  }
});

/* ================== 3) 드래프트 조회 ================== */
router.get('/drafts/:id', verifyToken, async (req, res) => {
  const draftId = parseInt(req.params.id, 10);
  const userId = req.user.userId;
  try {
    const [[draft]] = await db.query(
      `SELECT * FROM RecordDrafts WHERE id=? AND userId=?`, [draftId, userId]
    );
    if (!draft) return res.status(404).json({ message: 'Draft 없음' });

    const [imgs] = await db.query(
      `SELECT url, sort_order FROM RecordImages WHERE draftId=? ORDER BY sort_order ASC, id ASC`,
      [draftId]
    );
    res.json({ ...draft, images: imgs.map((x) => x.url) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Draft 조회 실패', detail: err.message });
  }
});

/* ================== 4) 드래프트 확정 ================== */
// - Records INSERT(대표 이미지=첫 장)
// - RecordImages 이동
// - Today_Emotion UPSERT
// - Daily Summary 재계산 (EmotionCalendar & Emotion_Stats)
// - Draft 정리
router.post('/drafts/:id/confirm', verifyToken, async (req, res) => {
  const draftId = parseInt(req.params.id, 10);
  const userId = req.user.userId;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[draft]] = await conn.query(
      `SELECT * FROM RecordDrafts WHERE id=? AND userId=? FOR UPDATE`, [draftId, userId]
    );
    if (!draft) {
      await conn.rollback();
      return res.status(404).json({ message: 'Draft 없음' });
    }
    if (draft.status === 'confirmed') {
      await conn.rollback();
      return res.status(409).json({ message: '이미 확정된 드래프트입니다' });
    }
    if (!draft.emotion_type) return res.status(400).json({ message: 'emotion_type 필요' });
    if (!draft.visibility)   return res.status(400).json({ message: 'visibility 필요' });

    // 이미지(대표 포함)
    const [imgs] = await conn.query(
      `SELECT url, sort_order FROM RecordImages WHERE draftId=? ORDER BY sort_order ASC, id ASC`,
      [draftId]
    );
    const top4 = ensureMax4(imgs);
    const repImage = top4.length ? top4[0].url : null;

    // reveal_at 계산
    let revealAt = draft.reveal_at;
    if (!revealAt) {
      if (draft.period === '6' || draft.period === '12') {
        const months = parseInt(draft.period, 10);
        const [[calc]] = await conn.query(
          `SELECT DATE_ADD(?, INTERVAL ? MONTH) as ra`,
          [draft.created_at, months]
        );
        revealAt = calc.ra;
      } else {
        revealAt = draft.created_at;
      }
    }

    // Records INSERT
    const [rec] = await conn.query(
      `INSERT INTO Records
       (userId, title, emotion_type, expression_type, content, img, created_at, reveal_at, period,
        latitude, longitude, place, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        draft.title || null,
        draft.emotion_type,
        draft.expression_type || null,
        draft.content || null,
        repImage,
        draft.created_at,
        revealAt,
        draft.period || null,
        draft.latitude || null,
        draft.longitude || null,
        draft.place || null,
        draft.visibility,
      ]
    );
    const recordId = rec.insertId;

    // 이미지 이동
    for (const it of top4) {
      await conn.query(
        `INSERT INTO RecordImages (recordId, url, sort_order) VALUES (?, ?, ?)`,
        [recordId, it.url, it.sort_order]
      );
    }
    await conn.query(`DELETE FROM RecordImages WHERE draftId=?`, [draftId]);

    // 날짜 문자열
    const [[dt]] = await conn.query(
      `SELECT DATE(created_at) as d FROM Records WHERE id=?`,
      [recordId]
    );
    const dateStr = dt.d; // YYYY-MM-DD

    // ✅ 그날 대표 감정(모드) 재계산 → EmotionCalendar/Emotion_Stats 일관 반영
    await recomputeDailySummary(conn, userId, dateStr);

    // Today_Emotion UPSERT (최근 위치/감정 상태)
    await conn.query(
      `INSERT INTO Today_Emotion (userId, latitude, longitude, emotion_type, expression_type, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         latitude=VALUES(latitude), longitude=VALUES(longitude),
         emotion_type=VALUES(emotion_type), expression_type=VALUES(expression_type),
         updated_at=NOW()`,
      [
        userId,
        draft.latitude || null,
        draft.longitude || null,
        draft.emotion_type,
        draft.expression_type || null,
      ]
    );

    // Draft 정리
    await conn.query(`UPDATE RecordDrafts SET status='confirmed' WHERE id=?`, [draftId]);
    await conn.query(`DELETE FROM RecordDrafts WHERE id=?`, [draftId]);

    await conn.commit();
    res.json({ message: '기록 확정 완료', recordId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: '기록 확정 실패', detail: err.message });
  } finally {
    conn.release();
  }
});

/* ================== 5) 드래프트 삭제(취소) ================== */
router.delete('/drafts/:id', verifyToken, async (req, res) => {
  const draftId = parseInt(req.params.id, 10);
  const userId = req.user.userId;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[d]] = await conn.query(
      `SELECT id, status FROM RecordDrafts WHERE id=? AND userId=?`,
      [draftId, userId]
    );
    if (!d) {
      await conn.rollback();
      return res.status(404).json({ message: 'Draft 없음' });
    }
    if (d.status === 'confirmed') {
      await conn.rollback();
      return res.status(409).json({ message: '이미 확정된 드래프트는 삭제할 수 없습니다' });
    }

    await conn.query(`DELETE FROM RecordImages WHERE draftId=?`, [draftId]);
    await conn.query(`DELETE FROM RecordDrafts WHERE id=?`, [draftId]);

    await conn.commit();
    res.status(204).send();
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ message: 'Draft 삭제 실패', detail: e.message });
  } finally {
    conn.release();
  }
});

/* ================== (NEW) 드래프트 이미지 업로드 ================== */
// 단일 파일 업로드 (FormData 키: 'file')
router.post('/drafts/:id/images', verifyToken, upload.single('file'), async (req, res) => {
  try {
    const draftId = parseInt(req.params.id, 10);
    const userId = req.user.userId;

    // 드래프트 소유/상태 확인
    const [[d]] = await db.query(
      `SELECT id, status FROM RecordDrafts WHERE id=? AND userId=?`,
      [draftId, userId]
    );
    if (!d) return res.status(404).json({ message: 'Draft 없음' });
    if (d.status === 'confirmed') {
      return res.status(409).json({ message: '이미 확정된 드래프트에는 업로드할 수 없습니다' });
    }

    // 파일 검증
    if (!req.file) return res.status(400).json({ message: 'file 필드가 필요합니다' });
    const file = req.file;

    const MAX_BYTES = 15 * 1024 * 1024; // 15MB
    if (file.size > MAX_BYTES) return res.status(400).json({ message: '파일 용량 초과(<=15MB)' });

    // MIME 타입 허용
    const ALLOWED_IMG = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = ALLOWED_IMG[file.mimetype];
    if (!ext) return res.status(400).json({ message: '허용되지 않는 이미지 형식' });

    // S3 업로드
    const key = `records/${userId}/${uuidv4()}.${ext}`;
    await s3
      .putObject({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      })
      .promise();

    const url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    // 바로 DB에 넣지는 않고(정렬/삭제 편의), 프론트가 PATCH /drafts/:id 로
    // images 배열과 대표 img를 갱신하도록 응답만 반환
    return res.json({ url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '이미지 업로드 실패', detail: err.message });
  }
});

module.exports = router;
