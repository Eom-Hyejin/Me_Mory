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

module.exports = router;
