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

/**
 * 내부 유틸: 타깃 유저/가시성 조건 구성
 * - 내가 보면: visibility 필터 없음 (내 모든 기록)
 * - 남의 것 보면: visibility='public' 만
 */
function buildOwnerVisibilityClause(requesterId, targetUserId) {
  const isSelf = Number(targetUserId) === Number(requesterId);
  const clause = ['userId = ?' , 'latitude IS NOT NULL', 'longitude IS NOT NULL'];
  const vals = [targetUserId];

  if (!isSelf) {
    clause.push(`visibility = 'public'`);
  }
  return { clause, vals };
}

/** GET /map
 * Optional:
 *  - from, to : YYYY-MM-DD (DATE(created_at) 기준 필터)
 *  - targetUserId : 조회 대상 유저 (미지정 시 본인)
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const targetUserId = req.query.targetUserId ? Number(req.query.targetUserId) : requesterId;
    if (Number.isNaN(targetUserId)) {
      return res.status(400).json({ message: '유효한 targetUserId가 아닙니다' });
    }

    const { from, to } = req.query;
    const { clause, vals } = buildOwnerVisibilityClause(requesterId, targetUserId);

    if (from) { clause.push('DATE(created_at) >= ?'); vals.push(from); }
    if (to)   { clause.push('DATE(created_at) <= ?'); vals.push(to); }

    const [rows] = await db.query(`
      SELECT ${MAP_FIELDS}
      FROM Records
      WHERE ${clause.join(' AND ')}
      ORDER BY created_at DESC
    `, vals);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map]', err);
    res.status(500).json({ message: '지도 데이터 조회 실패', detail: err.message });
  }
});

/** GET /map/today
 * 오늘자 좌표 기록
 *  - 내 기록: 공개/비공개 모두
 *  - 타인 기록: 공개(public)만
 */
router.get('/today', verifyToken, async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const targetUserId = req.query.targetUserId ? Number(req.query.targetUserId) : requesterId;
    if (Number.isNaN(targetUserId)) {
      return res.status(400).json({ message: '유효한 targetUserId가 아닙니다' });
    }

    const { clause, vals } = buildOwnerVisibilityClause(requesterId, targetUserId);
    clause.push(`DATE(created_at) = CURDATE()`);

    const [rows] = await db.query(`
      SELECT ${MAP_FIELDS}
      FROM Records
      WHERE ${clause.join(' AND ')}
      ORDER BY created_at DESC
    `, vals);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map/today]', err);
    res.status(500).json({ message: '오늘 지도 데이터 조회 실패', detail: err.message });
  }
});

/** GET /map/week?start=YYYY-MM-DD
 * 'start' 포함 7일 구간(start ~ start+6) 반환
 *  - 내 기록: 공개/비공개 모두
 *  - 타인 기록: 공개(public)만
 */
router.get('/week', verifyToken, async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const targetUserId = req.query.targetUserId ? Number(req.query.targetUserId) : requesterId;
    if (Number.isNaN(targetUserId)) {
      return res.status(400).json({ message: '유효한 targetUserId가 아닙니다' });
    }

    const { start } = req.query;
    if (!start) {
      return res.status(400).json({ message: 'start 쿼리(YYYY-MM-DD)가 필요합니다' });
    }

    const { clause, vals } = buildOwnerVisibilityClause(requesterId, targetUserId);
    clause.push(`DATE(created_at) BETWEEN ? AND DATE_ADD(?, INTERVAL 6 DAY)`);
    vals.push(start, start);

    const [rows] = await db.query(`
      SELECT ${MAP_FIELDS}
      FROM Records
      WHERE ${clause.join(' AND ')}
      ORDER BY created_at DESC
    `, vals);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /map/week]', err);
    res.status(500).json({ message: '주간 지도 데이터 조회 실패', detail: err.message });
  }
});

module.exports = router;
