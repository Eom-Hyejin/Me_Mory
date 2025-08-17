const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

// 감정 캘린더 조회 API
// GET /emotion/calendar?year=2025&month=08
router.get('/calendar', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ message: 'year, month 쿼리 파라미터가 필요합니다' });
    }

    const monthStr = String(month).padStart(2, '0');
    const start = `${year}-${monthStr}-01`;
    const end = `${year}-${monthStr}-31`;

    const [rows] = await db.query(`
      SELECT date, emotion_type, expression_type
      FROM EmotionCalendar
      WHERE userId = ? AND date BETWEEN ? AND ?
    `, [userId, start, end]);

    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '감정 캘린더 조회 실패', detail: err.message });
  }
});

// 감정 통계 조회 API
// GET /emotion/stats?year=2025&month=08
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ message: 'year, month 쿼리 파라미터가 필요합니다' });
    }

    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;

    const [rows] = await db.query(`
      SELECT \`year_month\`, count_joy, count_sadness, count_anger, count_worry, count_proud
      FROM Emotion_Stats
      WHERE userId = ? AND \`year_month\` = ?
    `, [userId, yearMonth]);

    if (rows.length === 0) {
      return res.status(200).json({
        year_month: yearMonth,
        joy: 0,
        sadness: 0,
        anger: 0,
        worry: 0,
        proud: 0
      });
    }

    const row = rows[0];
    res.status(200).json({
      year_month: row.year_month,
      joy: row.count_joy,
      sadness: row.count_sadness,
      anger: row.count_anger,
      worry: row.count_worry,
      proud: row.count_proud
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '감정 통계 조회 실패', detail: err.message });
  }
});

router.post('/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { emotion_type, expression_type, latitude, longitude } = req.body;

    if (!emotion_type || !expression_type || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: '필수 필드가 누락되었습니다.' });
    }

    await db.query(`
      INSERT INTO Today_Emotion (userId, emotion_type, expression_type, latitude, longitude, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        emotion_type = VALUES(emotion_type),
        expression_type = VALUES(expression_type),
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        updated_at = NOW()
    `, [userId, emotion_type, expression_type, latitude, longitude]);

    res.status(200).json({ message: '오늘의 감정 저장 완료' });
  } catch (err) {
    console.error('[POST /emotion/today]', err);
    res.status(500).json({ message: '오늘의 감정 저장 실패', detail: err.message });
  }
});

router.get('/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [rows] = await db.query(`
      SELECT emotion_type, expression_type, latitude, longitude, updated_at
      FROM Today_Emotion
      WHERE userId = ?
    `, [userId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: '오늘의 감정이 없습니다.' });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error('[GET /emotion/today]', err);
    res.status(500).json({ message: '오늘의 감정 조회 실패', detail: err.message });
  }
});

// 내 모든 감정 기록 (지도용) 조회
router.get('/map', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [rows] = await db.query(`
      SELECT id AS recordId, latitude, longitude, emotion_type, expression_type, created_at
      FROM Records
      WHERE userId = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
    `, [userId]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[MAP ERROR]', err);
    res.status(500).json({ message: '감정 지도 조회 실패', detail: err.message });
  }
});

router.get('/area', verifyToken, async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    const userId = req.user.userId;

    if (!lat || !lng || !radius) {
      return res.status(400).json({ message: 'lat, lng, radius 쿼리 파라미터가 필요합니다.' });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const r = parseFloat(radius);

    // 본인(userId)은 제외하고 거리 계산
    const [rows] = await db.query(`
      SELECT userId, emotion_type, expression_type, latitude, longitude, updated_at,
        (6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(latitude)) *
          COS(RADIANS(longitude) - RADIANS(?)) +
          SIN(RADIANS(?)) * SIN(RADIANS(latitude))
        )) AS distance
      FROM Today_Emotion
      WHERE userId != ?
      HAVING distance <= ?
    `, [latitude, longitude, latitude, userId, r]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /emotion/area]', err);
    res.status(500).json({ message: '지역 감정 필터링 실패', detail: err.message });
  }
});

module.exports = router;
