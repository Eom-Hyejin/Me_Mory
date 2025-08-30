const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

/** 지도 마커용 공통 필드: 팝업 표현 위해 title/place 포함 */
const MAP_FIELDS = `
  id AS recordId,
  latitude, longitude,
  emotion_type, expression_type,
  title, place,
  created_at
`;

/** GET /map
 * Optional:
 *  - from, to : YYYY-MM-DD (DATE(created_at) 기준 필터)
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { from, to } = req.query;

    const where = ['userId = ?', 'latitude IS NOT NULL', 'longitude IS NOT NULL'];
    const vals = [userId];

    if (from) { where.push('DATE(created_at) >= ?'); vals.push(from); }
    if (to)   { where.push('DATE(created_at) <= ?'); vals.push(to); }

    const [rows] = await db.query(`
      SELECT ${MAP_FIELDS}
      FROM Records
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
    `, vals);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map]', err);
    res.status(500).json({ message: '지도 데이터 조회 실패', detail: err.message });
  }
});

/** GET /map/today
 * 오늘자 내 기록만 좌표로 반환
 */
router.get('/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await db.query(`
      SELECT ${MAP_FIELDS}
      FROM Records
      WHERE userId = ?
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND DATE(created_at) = CURDATE()
      ORDER BY created_at DESC
    `, [userId]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map/today]', err);
    res.status(500).json({ message: '오늘 지도 데이터 조회 실패', detail: err.message });
  }
});

/** GET /map/week?start=YYYY-MM-DD
 * 'start' 포함 7일 구간(start ~ start+6) 반환
 */
router.get('/week', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { start } = req.query;
    if (!start) {
      return res.status(400).json({ message: 'start 쿼리(YYYY-MM-DD)가 필요합니다' });
    }

    const [rows] = await db.query(`
      SELECT ${MAP_FIELDS}
      FROM Records
      WHERE userId = ?
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND DATE(created_at) BETWEEN ? AND DATE_ADD(?, INTERVAL 6 DAY)
      ORDER BY created_at DESC
    `, [userId, start, start]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map/week]', err);
    res.status(500).json({ message: '주간 지도 데이터 조회 실패', detail: err.message });
  }
});

/** GET /map/area?lat=&lng=&radius=
 * 타 사용자 Today_Emotion 중 (lat,lng)로부터 반경 radius(킬로미터) 내 결과
 * 본인(userId)은 제외
 */
router.get('/area', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { lat, lng, radius } = req.query;

    if (!lat || !lng || !radius) {
      return res.status(400).json({ message: 'lat, lng, radius 쿼리 파라미터가 필요합니다.' });
    }

    const latitude  = parseFloat(lat);
    const longitude = parseFloat(lng);
    const rkm       = parseFloat(radius); // km

    if (
      Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(rkm) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || rkm < 0
    ) {
      return res.status(400).json({ message: '유효한 lat, lng, radius 값이 필요합니다' });
    }

    // 거리 단위: km (지구 반지름 6371km)
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
      ORDER BY distance ASC, updated_at DESC
    `, [latitude, longitude, latitude, userId, rkm]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map/area]', err);
    res.status(500).json({ message: '지역 감정 필터링 실패', detail: err.message });
  }
});

module.exports = router;