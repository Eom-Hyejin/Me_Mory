const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

// 감정 캘린더 조회
// GET /emotion/calendar?year=2025&month=08
router.get('/calendar', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({ message: 'year, month 쿼리 파라미터가 필요합니다' });
    }

    const m = String(month).padStart(2, '0');
    const start = `${year}-${m}-01`;
    const end   = `${year}-${m}-31`;

    const [rows] = await db.query(`
      SELECT date, emotion_type, expression_type
      FROM EmotionCalendar
      WHERE userId = ? AND date BETWEEN ? AND ?
      ORDER BY date ASC
    `, [userId, start, end]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /emotion/calendar]', err);
    res.status(500).json({ message: '감정 캘린더 조회 실패', detail: err.message });
  }
});

// 감정 월 통계(6종 모두)
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
      SELECT \`year_month\`,
             count_joy, count_sadness, count_anger, count_worry, count_proud, count_upset
      FROM Emotion_Stats
      WHERE userId = ? AND \`year_month\` = ?
    `, [userId, yearMonth]);

    if (rows.length === 0) {
      return res.status(200).json({
        year_month: yearMonth,
        count_joy: 0, count_sadness: 0, count_anger: 0,
        count_worry: 0, count_proud: 0, count_upset: 0,
      });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error('[GET /emotion/stats]', err);
    res.status(500).json({ message: '감정 월 통계 조회 실패', detail: err.message });
  }
});

// 오늘 감정 저장(업서트) - Today_Emotion.updated_at 사용
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

// 오늘 감정 조회 (Today_Emotion.updated_at)
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

// 감정 히스토리(최신순)
router.get('/history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [rows] = await db.query(`
      SELECT id AS recordId, emotion_type, expression_type, title, created_at, latitude, longitude, place
      FROM Records
      WHERE userId = ?
      ORDER BY created_at DESC
    `, [userId]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /emotion/history]', err);
    res.status(500).json({ message: '감정 히스토리 조회 실패', detail: err.message });
  }
});

// 감정 리포트(요일/시간대별 카운트)
router.get('/report', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [rows] = await db.query(`
      SELECT
        emotion_type,
        DAYOFWEEK(created_at) AS weekday,
        HOUR(created_at) AS hour,
        COUNT(*) AS count
      FROM Records
      WHERE userId = ?
      GROUP BY emotion_type, weekday, hour
      ORDER BY emotion_type, weekday, hour
    `, [userId]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /emotion/report]', err);
    res.status(500).json({ message: '감정 리포트 조회 실패', detail: err.message });
  }
});

// ✅ 마이페이지 카드 전용: 내 월별 감정 통계(퍼센트)
// GET /emotion/stats/summary?year=2025&month=08
router.get('/stats/summary', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const year   = String(req.query.year || '').trim();
    const month  = String(req.query.month || '').padStart(2, '0');

    if (!year || !month) {
      return res.status(400).json({ message: 'year, month 쿼리 파라미터가 필요합니다' });
    }

    // 해당 월 1일 ~ 말일 (MySQL에서 안전하게 계산)
    const startExpr = `STR_TO_DATE(CONCAT(?, '-', ?, '-01'), '%Y-%m-%d')`;
    const endExpr   = `LAST_DAY(${startExpr})`;

    // 감정별 개수 (내 기록만, 공개/비공개 모두 포함)
    const [rows] = await db.query(
      `
      SELECT emotion_type, COUNT(*) AS cnt
        FROM Records
       WHERE userId = ?
         AND DATE(created_at) >= ${startExpr}
         AND DATE(created_at) <= ${endExpr}
       GROUP BY emotion_type
      `,
      [userId, year, month, year, month]
    );

    const EMOTIONS = ['joy','sadness','anger','worry','proud','upset'];
    const breakdown = {};
    let total = 0;

    // 0으로 초기화
    for (const e of EMOTIONS) breakdown[e] = { count: 0, percent: 0 };

    // 카운트 채우기 + 총합
    for (const r of rows) {
      breakdown[r.emotion_type].count = Number(r.cnt) || 0;
      total += Number(r.cnt) || 0;
    }

    // 퍼센트 계산(소수점 한 자리 반올림)
    if (total > 0) {
      for (const e of EMOTIONS) {
        const pct = (breakdown[e].count / total) * 100;
        breakdown[e].percent = Math.round(pct * 10) / 10;
      }
    }

    return res.json({
      year_month: `${year}-${month}`,
      total,           // 그 달의 전체 기록 수
      breakdown,       // { joy: {count, percent}, ... }
    });
  } catch (err) {
    console.error('[GET /emotion/stats/summary]', err);
    return res.status(500).json({ message: '월별 통계 조회 실패', detail: err.message });
  }
});

// 감정 핫스팟(내 기록 좌표 집계)
router.get('/hotspots', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [rows] = await db.query(`
      SELECT latitude, longitude, COUNT(*) AS count
      FROM Records
      WHERE userId = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
      GROUP BY latitude, longitude
      HAVING count >= 1
      ORDER BY count DESC
    `, [userId]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /emotion/hotspots]', err);
    res.status(500).json({ message: '감정 핫스팟 조회 실패', detail: err.message });
  }
});

module.exports = router;