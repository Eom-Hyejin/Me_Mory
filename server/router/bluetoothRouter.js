const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');
const {
  proximityService,
  tokenService,
  settingsService,
} = require('../services/bluetooth'); // services 인덱스 사용

/* ========== A) BLE 사용 동의 on/off & 조회 ========== */
// GET /ble/settings
router.get('/settings', verifyToken, async (req, res) => {
  try {
    const data = await settingsService.getConsent(req.user.userId);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ message: '설정 조회 실패', detail: e.message });
  }
});

// POST /ble/settings { enabled: boolean }
router.post('/settings', verifyToken, async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    await settingsService.setConsent(req.user.userId, enabled);
    return res.status(200).json({ enabled });
  } catch (e) {
    return res.status(500).json({ message: '설정 저장 실패', detail: e.message });
  }
});

/* ========== B) 기기 토큰 회전(클라에 평문 전달) ========== */
// POST /ble/token/rotate -> { token }
router.post('/token/rotate', verifyToken, async (req, res) => {
  try {
    const token = await tokenService.rotateDeviceToken(req.user.userId);
    return res.status(201).json({ token });
  } catch (e) {
    return res.status(500).json({ message: '토큰 발급 실패', detail: e.message });
  }
});

/* ========== C) 스캔 리포트 적재 ========== */
// POST /ble/scan-report { observations: [{hash, rssi, seenAt?}] }
router.post('/scan-report', verifyToken, async (req, res) => {
  const items = Array.isArray(req.body?.observations) ? req.body.observations : [];
  if (!items.length) return res.status(400).json({ message: 'observations 배열이 필요합니다' });

  try {
    await proximityService.ingestScanResults(req.user.userId, items);
    return res.status(201).json({ saved: items.length });
  } catch (e) {
    return res.status(500).json({ message: '스캔 저장 실패', detail: e.message });
  }
});

/* ========== D) 근처 사람 조회 ========== */
// GET /ble/nearby?lat=..&lng=..&radiusKm=0.5&windowMin=5&limit=7&mask=true
router.get('/nearby', verifyToken, async (req, res) => {
  const q = req.query;
  const origin = { lat: Number(q.lat), lng: Number(q.lng) };
  const radiusKm = q.radiusKm ? Number(q.radiusKm) : 0.5;
  const windowMin = q.windowMin ? Number(q.windowMin) : 5;
  const limit = q.limit ? Number(q.limit) : 7;
  const mask = q.mask !== 'false';

  try {
    const users = await proximityService.getNearbyByBle(req.user.userId, {
      windowMin, limit, mask, origin, radiusKm,
    });
    return res.status(200).json({ users });
  } catch (e) {
    return res.status(400).json({ message: e.message || '근처 사용자 조회 실패' });
  }
});

/* ========== E) 사용자 클릭 → 오늘 감정캡슐(공개만) + 이미지 + 댓글 ========== */
// GET /ble/user/:userId/capsule
router.get('/user/:userId/capsule', verifyToken, async (req, res) => {
  const targetId = parseInt(req.params.userId, 10);
  if (Number.isNaN(targetId)) return res.status(400).json({ message: '잘못된 사용자' });

  try {
    const [[rec]] = await db.query(
      `SELECT r.id, r.userId, r.title, r.emotion_type, r.expression_type, r.content,
              r.img, r.created_at, r.reveal_at, r.visibility, u.name, u.img AS userImg
         FROM Records r
         JOIN Users u ON u.id = r.userId
        WHERE r.userId = ?
          AND r.visibility = 'public'
          AND DATE(r.created_at) = DATE(UTC_TIMESTAMP())
          AND r.reveal_at <= UTC_TIMESTAMP()
        ORDER BY r.created_at DESC
        LIMIT 1`,
      [targetId]
    );
    if (!rec) return res.status(404).json({ message: '오늘 공개된 감정캡슐이 없습니다' });

    const [imgs] = await db.query(
      `SELECT id, url, sort_order FROM RecordImages WHERE recordId=? ORDER BY sort_order ASC, id ASC`,
      [rec.id]
    );
    const [comments] = await db.query(
      `SELECT rc.id, rc.userId, u.name, u.img, rc.content, rc.created_at
         FROM RecordComments rc
         JOIN Users u ON u.id = rc.userId
        WHERE rc.recordId=?
        ORDER BY rc.created_at ASC, rc.id ASC`,
      [rec.id]
    );

    return res.status(200).json({
      record: {
        id: rec.id,
        userId: rec.userId,
        userName: rec.name,
        userImg: rec.userImg,
        title: rec.title,
        emotionType: rec.emotion_type,
        expressionType: rec.expression_type,
        content: rec.content,
        img: rec.img,
        createdAt: rec.created_at,
        revealAt: rec.reveal_at,
      },
      images: imgs,
      comments,
    });
  } catch (e) {
    return res.status(500).json({ message: '감정캡슐 조회 실패', detail: e.message });
  }
});

/* ========== F) 댓글 작성(공개 레코드만 허용) ========== */
// POST /ble/records/:recordId/comments { content }
router.post('/records/:recordId/comments', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.recordId, 10);
  const content = String(req.body?.content || '').trim();
  if (Number.isNaN(recordId)) return res.status(400).json({ message: '잘못된 레코드' });
  if (!content) return res.status(400).json({ message: '내용이 비었습니다' });

  try {
    const [[ok]] = await db.query(
      `SELECT id FROM Records
        WHERE id=? AND visibility='public' AND reveal_at <= UTC_TIMESTAMP()`,
      [recordId]
    );
    if (!ok) return res.status(403).json({ message: '비공개거나 아직 공개되지 않았습니다' });

    const [r] = await db.query(
      `INSERT INTO RecordComments (recordId, userId, content) VALUES (?, ?, ?)`,
      [recordId, req.user.userId, content]
    );
    const [[comment]] = await db.query(
      `SELECT rc.id, rc.userId, u.name, u.img, rc.content, rc.created_at
         FROM RecordComments rc
         JOIN Users u ON u.id = rc.userId
        WHERE rc.id=?`,
      [r.insertId]
    );
    return res.status(201).json({ comment });
  } catch (e) {
    return res.status(500).json({ message: '댓글 작성 실패', detail: e.message });
  }
});

module.exports = router;