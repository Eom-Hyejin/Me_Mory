const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

// ✅ 유저별 감정 회고 리스트 조회
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // 한국 시간 기준으로 오늘 날짜 계산
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    console.log('[RECALL ROUTER]', { userId, todayStr });

    const [rows] = await db.query(`
      SELECT id AS recordId, title, emotion_type, expression_type, reveal_at, created_at
      FROM Records
      WHERE userId = ? AND reveal_at <= ?
      ORDER BY reveal_at DESC
    `, [userId, todayStr]);

    res.status(200).json(rows);
  } catch (err) {
    console.error('[RECALL ERROR]', err);
    res.status(500).json({ message: '감정 회고 조회 실패', detail: err.message });
  }
});

module.exports = router;