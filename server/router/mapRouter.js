// server/router/mapRouter.js
const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

/** 공통 필드 (팝업/리스트에 title/place가 필요) */
const MAP_FIELDS = `
  r.id AS recordId,
  r.userId,
  r.latitude, r.longitude,
  r.emotion_type, r.expression_type,
  r.title, r.place, r.visibility,
  r.created_at
`;

/** 유틸: 형식/좌표 검증 */
const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isFiniteNum = (x) => Number.isFinite(Number(x));
function assertLatLng(lat, lng) {
  const L = Number(lat), G = Number(lng);
  return Number.isFinite(L) && Number.isFinite(G) && L >= -90 && L <= 90 && G >= -180 && G <= 180;
}

/** ================================
 *  (1) 오늘: 내 기록 전부 (공개/비공개 포함)
 *  GET /map/me/today
 *  ================================ */
router.get('/me/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [rows] = await db.query(`
      SELECT ${MAP_FIELDS}
      FROM Records r
      WHERE r.userId = ?
        AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
        AND DATE(r.created_at) = CURDATE()
      ORDER BY r.created_at DESC
    `, [userId]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map/me/today]', err);
    res.status(500).json({ message: '오늘 지도 데이터 조회 실패', detail: err.message });
  }
});

/** =========================================
 *  (2) 주간: 내 기록 전부 (공개/비공개 포함)
 *  GET /map/me/week?start=YYYY-MM-DD
 *  ========================================= */
router.get('/me/week', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { start } = req.query;
    if (!isValidDate(start)) {
      return res.status(400).json({ message: 'start는 YYYY-MM-DD 형식이어야 합니다' });
    }

    const [rows] = await db.query(`
      SELECT ${MAP_FIELDS}
      FROM Records r
      WHERE r.userId = ?
        AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
        AND DATE(r.created_at) BETWEEN ? AND DATE_ADD(?, INTERVAL 6 DAY)
      ORDER BY r.created_at DESC
    `, [userId, start, start]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map/me/week]', err);
    res.status(500).json({ message: '주간 지도 데이터 조회 실패', detail: err.message });
  }
});

/** ==========================================================
 *  (3) 클릭 지점 기준:
 *   - my: 클릭 지점 "정확 동일 좌표"의 내 기록(공개/비공개 모두)
 *   - others: 클릭 지점 반경 500m 이내의 타인 공개 기록만
 *  GET /map/place-click?lat=&lng=&from=&to=&self_decimals=
 *    - lat,lng: 필수
 *    - from,to: YYYY-MM-DD (선택)
 *    - self_decimals: 내 정확 좌표 매칭 반올림 자릿수(기본 6; 6≈0.11m)
 * ========================================================== */
router.get('/place-click', verifyToken, async (req, res) => {
  try {
    const myId = req.user.userId;
    const { lat, lng, from, to } = req.query;

    if (!assertLatLng(lat, lng)) {
      return res.status(400).json({ message: '유효한 lat,lng가 필요합니다' });
    }
    if (from && !isValidDate(from)) return res.status(400).json({ message: 'from은 YYYY-MM-DD 형식이어야 합니다' });
    if (to   && !isValidDate(to))   return res.status(400).json({ message: 'to는 YYYY-MM-DD 형식이어야 합니다' });

    // 내 기록: 정확 좌표 매칭(부동소수 오차 완화 위해 반올림 비교)
    const selfDecimals = req.query.self_decimals === undefined
      ? 6
      : Math.max(0, Math.min(10, parseInt(req.query.self_decimals, 10) || 6));

    // 타인 공개 기록: 반경 500m
    const othersRadiusKm = 0.5;

    // 날짜 범위 WHERE (선택)
    const dateWhere = [];
    const dateVals = [];
    if (from) { dateWhere.push('DATE(r.created_at) >= ?'); dateVals.push(from); }
    if (to)   { dateWhere.push('DATE(r.created_at) <= ?'); dateVals.push(to); }
    const dateClause = dateWhere.length ? ` AND ${dateWhere.join(' AND ')}` : '';

    // ===== 내 기록: 정확히 같은 좌표(반올림 비교)만 =====
    const [myRows] = await db.query(`
      SELECT
        r.id AS recordId, r.userId,
        r.latitude, r.longitude,
        r.emotion_type, r.expression_type,
        r.title, r.place, r.visibility,
        r.created_at
      FROM Records r
      WHERE r.userId = ?
        AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
        AND ROUND(r.latitude, ?)  = ROUND(?, ?)
        AND ROUND(r.longitude, ?) = ROUND(?, ?)
        ${dateClause}
      ORDER BY r.created_at DESC
    `, [myId,
        selfDecimals, Number(lat), selfDecimals,
        selfDecimals, Number(lng), selfDecimals,
        ...dateVals]);

    // ===== 타인 공개 기록: 반경 500m =====
    const [othersRows] = await db.query(`
      SELECT
        ${MAP_FIELDS},
        u.name AS userName, u.img AS userImg,
        (6371 * ACOS(
          COS(RADIANS(?)) * COS(RADIANS(r.latitude)) *
          COS(RADIANS(r.longitude) - RADIANS(?)) +
          SIN(RADIANS(?)) * SIN(RADIANS(r.latitude))
        )) AS distance_km
      FROM Records r
      JOIN Users u ON u.id = r.userId
      WHERE r.userId <> ?
        AND r.visibility = 'public'
        AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
        ${dateClause}
      HAVING distance_km <= ?
      ORDER BY r.created_at DESC
    `, [Number(lat), Number(lng), Number(lat), myId, ...dateVals, othersRadiusKm]);

    return res.status(200).json({
      center: { lat: Number(lat), lng: Number(lng) },
      my: myRows,         // 정확 좌표 일치 + 내 기록(공개/비공개)
      others: othersRows, // 반경 500m + 타인 공개
    });
  } catch (err) {
    console.error('[GET /map/place-click]', err);
    res.status(500).json({ message: '클릭 위치 감정 기록 조회 실패', detail: err.message });
  }
});

module.exports = router;