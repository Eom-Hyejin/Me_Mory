const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

/**
 * 미회고 목록 (reveal_at <= 오늘, 아직 Users_Rec에 없는 것)
 * GET /recall/pending
 * response: [{recordId, title, emotion_type, expression_type, reveal_at, created_at}]
 */
router.get('/pending', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [rows] = await db.query(
      `
      SELECT r.id AS recordId, r.title, r.emotion_type, r.expression_type, r.reveal_at, r.created_at
      FROM Records r
      LEFT JOIN Users_Rec ur ON ur.recId = r.id AND ur.userId = ?
      WHERE r.userId = ?
        AND r.reveal_at <= NOW()
        AND ur.id IS NULL
      ORDER BY r.reveal_at DESC, r.id DESC
      `,
      [userId, userId]
    );

    res.status(200).json(rows);
  } catch (err) {
    console.error('[GET /recall/pending]', err);
    res.status(500).json({ message: '미회고 목록 조회 실패', detail: err.message });
  }
});

/**
 * 6개월/12개월 전 딱 오늘 날짜의 기록만 조회
 * GET /recall/ago?months=6|12
 *  - months가 6 또는 12만 허용
 */
router.get('/ago', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const months = parseInt(req.query.months, 10);
    if (![6, 12].includes(months)) {
      return res.status(400).json({ message: 'months는 6 또는 12여야 합니다' });
    }

    // KST 기준 오늘-개월수 의 “같은 월/일”
    const [rows] = await db.query(
      `
      SELECT r.id AS recordId, r.title, r.emotion_type, r.expression_type, r.created_at, r.reveal_at
      FROM Records r
      WHERE r.userId = ?
        AND DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL ? MONTH))
      ORDER BY r.created_at DESC, r.id DESC
      `,
      [userId, months]
    );

    res.status(200).json({ months, items: rows });
  } catch (err) {
    console.error('[GET /recall/ago]', err);
    res.status(500).json({ message: '특정 개월 전 기록 조회 실패', detail: err.message });
  }
});

/**
 * 오늘 기준 회고 알림 뭉치 (6개월/1년)
 * GET /recall/today
 * response: { sixMonths: [...], oneYear: [...] }
 */
router.get('/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [[six], [one]] = await Promise.all([
      db.query(
        `
        SELECT r.id AS recordId, r.title, r.emotion_type, r.expression_type, r.created_at, r.reveal_at
        FROM Records r
        WHERE r.userId = ?
          AND DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL 6 MONTH))
        ORDER BY r.created_at DESC, r.id DESC
        `,
        [userId]
      ),
      db.query(
        `
        SELECT r.id AS recordId, r.title, r.emotion_type, r.expression_type, r.created_at, r.reveal_at
        FROM Records r
        WHERE r.userId = ?
          AND DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL 12 MONTH))
        ORDER BY r.created_at DESC, r.id DESC
        `,
        [userId]
      ),
    ]);

    res.status(200).json({ sixMonths: six, oneYear: one });
  } catch (err) {
    console.error('[GET /recall/today]', err);
    res.status(500).json({ message: '오늘 회고 알림 조회 실패', detail: err.message });
  }
});

/**
 * 회고 완료 ACK
 * POST /recall/:recordId/ack
 *  - 본인 레코드인지 확인
 *  - reveal_at <= NOW() 이어야 합당 (도래 전 ack 방지)
 *  - Users_Rec에 (userId, recId) INSERT IGNORE
 */
router.post('/:recordId/ack', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const recordId = parseInt(req.params.recordId, 10);
    if (Number.isNaN(recordId)) {
      return res.status(400).json({ message: '유효한 recordId가 아닙니다' });
    }

    const [[rec]] = await db.query(
      `SELECT id, userId, reveal_at FROM Records WHERE id = ?`,
      [recordId]
    );
    if (!rec) return res.status(404).json({ message: '기록을 찾을 수 없습니다' });
    if (rec.userId !== userId) return res.status(403).json({ message: '권한이 없습니다' });

    // (선택) reveal_at 도래 전 ACK 방지
    const [[ok]] = await db.query(
      `SELECT CASE WHEN ? <= NOW() THEN 1 ELSE 0 END AS due`,
      [rec.reveal_at]
    );
    if (!ok || !ok.due) {
      return res.status(400).json({ message: '아직 회고 시점이 아닙니다' });
    }

    await db.query(
      `INSERT IGNORE INTO Users_Rec (userId, recId) VALUES (?, ?)`,
      [userId, recordId]
    );

    res.status(200).json({ message: '회고 완료로 표시했습니다' });
  } catch (err) {
    console.error('[POST /recall/:recordId/ack]', err);
    res.status(500).json({ message: '회고 완료 처리 실패', detail: err.message });
  }
});

module.exports = router;