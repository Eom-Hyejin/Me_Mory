const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
require('dotenv').config();

// S3 설정
const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
});

// 감정 기록 작성
router.post('/', verifyToken, async (req, res) => {
  const {
    title, emotion_type, expression_type, content, img,
    reveal_at, period, latitude, longitude, place, visibility
  } = req.body;

  const userId = req.user.userId;
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.query(`
      INSERT INTO Records (userId, title, emotion_type, expression_type, content, img,
        reveal_at, period, latitude, longitude, place, visibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, title, emotion_type, expression_type, content, img,
       reveal_at, period, latitude, longitude, place, visibility]
    );

    const createdDate = new Date();
    const dateStr = createdDate.toISOString().slice(0, 10);
    const yearMonth = createdDate.toISOString().slice(0, 7);

    await conn.query(`
      INSERT INTO EmotionCalendar (userId, date, emotion_type, expression_type)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE emotion_type = VALUES(emotion_type), expression_type = VALUES(expression_type)
    `, [userId, dateStr, emotion_type, expression_type]);

    await conn.query(`
      INSERT INTO Emotion_Stats (userId, year_month, count_${emotion_type})
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE count_${emotion_type} = count_${emotion_type} + 1
    `, [userId, yearMonth]);

    await conn.query(`
      INSERT INTO Today_Emotion (userId, latitude, longitude, emotion_type, expression_type, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE emotion_type = VALUES(emotion_type),
                              expression_type = VALUES(expression_type),
                              updated_at = NOW()
    `, [userId, latitude, longitude, emotion_type, expression_type]);

    await conn.commit();
    res.status(201).json({ recordId: result.insertId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: '감정 기록 생성 실패', detail: err.message });
  } finally {
    conn.release();
  }
});

// 감정 상세 조회
router.get('/:id', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id);
  const userId = req.user.userId;

  const [rows] = await db.query(
    'SELECT * FROM Records WHERE id = ? AND userId = ?', [recordId, userId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ message: '감정 기록을 찾을 수 없습니다' });
  }

  res.status(200).json(rows[0]);
});

// 감정 수정
router.put('/:id', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id);
  const userId = req.user.userId;

  const [rows] = await db.query('SELECT * FROM Records WHERE id = ? AND userId = ?', [recordId, userId]);
  if (rows.length === 0) return res.status(404).json({ message: '기록이 존재하지 않습니다' });

  const fields = ['title', 'emotion_type', 'expression_type', 'content', 'img',
                  'reveal_at', 'period', 'latitude', 'longitude', 'place', 'visibility'];

  const updates = [];
  const values = [];

  fields.forEach(field => {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  });

  if (updates.length === 0) {
    return res.status(400).json({ message: '수정할 필드가 없습니다' });
  }

  values.push(recordId, userId);

  await db.query(`UPDATE Records SET ${updates.join(', ')} WHERE id = ? AND userId = ?`, values);

  res.status(200).json({ message: '감정 기록 수정 완료' });
});

// 감정 삭제
router.delete('/:id', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id);
  const userId = req.user.userId;

  const [rows] = await db.query('SELECT * FROM Records WHERE id = ? AND userId = ?', [recordId, userId]);
  if (rows.length === 0) return res.status(404).json({ message: '기록이 존재하지 않습니다' });

  await db.query('DELETE FROM Records WHERE id = ? AND userId = ?', [recordId, userId]);
  return res.status(204).send();
});

// S3 이미지 Presigned URL 발급
router.get('/upload-url', verifyToken, async (req, res) => {
  const { filename } = req.query;
  const ext = filename.split('.').pop();
  const key = `records/${uuidv4()}.${ext}`;

  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Expires: 60,
    ContentType: `image/${ext}`,
  };

  const url = s3.getSignedUrl('putObject', params);
  res.json({
    uploadUrl: url,
    imageUrl: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
  });
});

// 감정 캘린더 (월별 조회)
router.get('/calendar', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ message: 'year, month 쿼리 파라미터가 필요합니다' });
  }

  const start = `${year}-${month.padStart(2, '0')}-01`;
  const end = `${year}-${month.padStart(2, '0')}-31`;

  const [rows] = await db.query(`
    SELECT date, emotion_type, expression_type
    FROM EmotionCalendar
    WHERE userId = ? AND date BETWEEN ? AND ?
  `, [userId, start, end]);

  res.status(200).json(rows);
});

module.exports = router;