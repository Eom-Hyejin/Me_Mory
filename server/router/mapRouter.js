const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

// 내 모든 감정 기록 (지도용) 조회
router.get('/', verifyToken, async (req, res) => {
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