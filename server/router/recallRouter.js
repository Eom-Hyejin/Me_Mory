const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

/**
 * 전체 목록(미회고)
 * GET /recall/pending
 * response: [{recordId, title, emotion_type, expression_type, img, reveal_at, created_at, content, place, latitude, longitude}]
 */
router.get('/pending', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [rows] = await db.query(
      `
      SELECT
        r.id AS recordId,
        r.title,
        r.emotion_type,
        r.expression_type,
        r.img,
        r.created_at,
        r.reveal_at,
        r.content,
        r.place,
        r.latitude,
        r.longitude
      FROM Records r
      LEFT JOIN Users_Rec ur ON ur.recId = r.id AND ur.userId = ?
      WHERE r.userId = ?
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
 * 특정 개월 전(±3일 버퍼)
 * GET /recall/ago?months=6|12
 * response: { months, items: [...] }
 */
router.get('/ago', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const months = parseInt(req.query.months, 10);
    if (![6, 12].includes(months)) {
      return res.status(400).json({ message: 'months는 6 또는 12여야 합니다' });
    }

    const [rows] = await db.query(
      `
      SELECT
        r.id AS recordId,
        r.title,
        r.emotion_type,
        r.expression_type,
        r.img,
        r.created_at,
        r.reveal_at,
        r.content,
        r.place,
        r.latitude,
        r.longitude
      FROM Records r
      WHERE r.userId = ?
        AND DATE(r.reveal_at) BETWEEN
              DATE(DATE_SUB(CURDATE(), INTERVAL ? MONTH) - INTERVAL 3 DAY)
          AND DATE(DATE_SUB(CURDATE(), INTERVAL ? MONTH) + INTERVAL 3 DAY)
      ORDER BY r.reveal_at DESC, r.id DESC
      `,
      [userId, months, months]
    );

    res.status(200).json({ months, items: rows });
  } catch (err) {
    console.error('[GET /recall/ago]', err);
    res.status(500).json({ message: '특정 개월 전 기록 조회 실패', detail: err.message });
  }
});

/**
 * 오늘 받은 회고 알림(6개월/1년)
 * GET /recall/today
 * response: { sixMonths: [...], oneYear: [...] }
 */
router.get('/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // 필요시 서버가 UTC라면 CONVERT_TZ로 KST 기준으로 맞추세요.
    // const dateExpr = `DATE(CONVERT_TZ(r.reveal_at,'UTC','Asia/Seoul')) = DATE(CONVERT_TZ(NOW(),'UTC','Asia/Seoul'))`;
    const dateExpr = `DATE(r.reveal_at) = CURDATE()`; // 서버 TZ가 KST라면 이거로 충분

    const [rows] = await db.query(
      `
      SELECT
        r.id AS recordId,
        r.title,
        r.emotion_type,
        r.expression_type,
        r.img,
        r.created_at,
        r.reveal_at,
        r.content,
        r.place,
        r.latitude,
        r.longitude
      FROM Records r
      LEFT JOIN Users_Rec ur ON ur.recId = r.id AND ur.userId = ?
      WHERE r.userId = ?
        AND ${dateExpr}
        AND ur.id IS NULL               -- 회고 완료(ACK)한 건 제외
      ORDER BY r.reveal_at DESC, r.id DESC
      `,
      [userId, userId]
    );

    // 프론트 하위호환: 기존 구조 {sixMonths, oneYear}를 기대한다면 sixMonths에 넣어줌
    res.status(200).json({ sixMonths: rows, oneYear: [] });
    // 프론트를 바꿀 수 있다면: res.json({ items: rows });
  } catch (err) {
    console.error('[GET /recall/today]', err);
    res.status(500).json({ message: '오늘 알림 조회 실패', detail: err.message });
  }
});

/**
 * 회고 완료 ACK
 * POST /recall/:recordId/ack
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

    // 도래 전 ACK 방지(선택)
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


/**
 * 이전 알림: period가 있는 모든 내 기록
 * GET /recall/history?page=1&pageSize=50
 * - 회고 여부에 상관없이 포함
 * - 내용/장소도 함께 반환
 */
router.get('/history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 50;
    const offset = (page - 1) * pageSize;

    const [rows] = await db.query(
      `
      SELECT
        r.id AS recordId,
        r.title,
        r.emotion_type,
        r.expression_type,
        r.img,
        r.created_at,
        r.reveal_at,
        r.period,
        r.content,
        r.place,
        r.latitude,
        r.longitude
      FROM Records r
      WHERE r.userId = ?
        AND r.period IS NOT NULL           -- period가 있는 모든 기록
        AND r.period <> ''                 -- (문자 컬럼일 경우 안전장치)
      ORDER BY COALESCE(r.reveal_at, r.created_at) DESC, r.id DESC
      LIMIT ? OFFSET ?
      `,
      [userId, pageSize, offset]
    );

    res.status(200).json({ page, pageSize, items: rows });
  } catch (err) {
    console.error('[GET /recall/history]', err);
    res.status(500).json({ message: '이전 알림 조회 실패', detail: err.message });
  }
});

module.exports = router;