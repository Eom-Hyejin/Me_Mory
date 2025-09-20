const express = require('express');
const router = express.Router();
const db = require('../data/db');
const verifyToken = require('../middleware/auth'); // 프로젝트에 맞게 경로 조정
const bt = require('../services/bluetooth'); // { tokenService, settingsService, proximityService, privacyGuard }

// ✅ privacyGuard.apply가 없으면 그냥 통과시키는 미들웨어 사용
const applyPrivacy =
  (bt && bt.privacyGuard && typeof bt.privacyGuard.apply === 'function')
    ? bt.privacyGuard.apply
    : (req, res, next) => next();

/** 내 '오늘' 지배적 감정 계산 (없으면 Today_Emotion 기준) */
async function getMyTodayDominantEmotion(userId) {
  const [[r1]] = await db.query(`
    SELECT emotion_type, COUNT(*) c
      FROM Records
     WHERE userId = ?
       AND DATE(created_at) = CURDATE()
     GROUP BY emotion_type
     ORDER BY c DESC
     LIMIT 1
  `, [userId]);
  if (r1?.emotion_type) return r1.emotion_type;

  const [[r2]] = await db.query(`SELECT emotion_type FROM Today_Emotion WHERE userId=?`, [userId]);
  return r2?.emotion_type || null;
}

/** (A) BLE 동의/상태 조회 */
router.get('/consent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [[row]] = await db.query(
      `SELECT enabled, last_enabled_at FROM UserBleSettings WHERE user_id=?`,
      [userId]
    );
    res.json(row || { enabled: 0, last_enabled_at: null });
  } catch (e) {
    res.status(500).json({ message: '상태 조회 실패', detail: e.message });
  }
});

/** (B) BLE 동의/상태 저장 */
router.post('/consent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const enabled = !!req.body?.enabled;
    await bt.settingsService.setConsent(userId, enabled);
    res.json({ enabled });
  } catch (e) {
    res.status(500).json({ message: '저장 실패', detail: e.message });
  }
});

/** (C) 디바이스 토큰 회전 (앱이 이 값을 BLE로 광고) */
router.post('/device-token/rotate', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const token = await bt.tokenService.rotateDeviceToken(userId);
    // 서버는 hash만 저장하고, 평문 token은 클라에게 전달 → 앱이 해시(sha256)로 광고하는 구조라면 앱에서 해싱
    res.json({ token, ttlDays: 7 });
  } catch (e) {
    res.status(500).json({ message: '토큰 회전 실패', detail: e.message });
  }
});

/** (D) 스캔 결과 업로드: observations: [{hash, rssi, seenAt}] */
router.post('/scan-report', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const observations = Array.isArray(req.body?.observations) ? req.body.observations : [];
    await bt.proximityService.ingestScanResults(userId, observations);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ message: '스캔 업로드 실패', detail: e.message });
  }
});

/** (E) 근처 사용자 목록 (500m 기본) */
router.get('/nearby', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: 'lat/lng가 필요합니다' });
    }
    const radiusKm  = Number(req.query.radiusKm ?? 0.5);
    const windowMin = Number(req.query.windowMin ?? 5);
    const limit     = Number(req.query.limit ?? 7);
    const mask      = req.query.mask !== '0';

    const mine = await getMyTodayDominantEmotion(userId);

    const list = await bt.proximityService.getNearbyByBle(userId, {
      windowMin, limit, mask, origin: { lat, lng }, radiusKm
    });

    // 동일 감정 플래그 (UI가 이 값으로 이모지 오버레이)
    for (const row of list) {
      row.sameEmotionWithMe = mine ? (row.emotion_type === mine) : false;
    }
    res.json({ myEmotion: mine, users: list });
  } catch (e) {
    res.status(500).json({ message: '조회 실패', detail: e.message });
  }
});

/** (F) 사람 클릭: 오늘 감정 + 최신 공개 캡슐(있으면) */
router.get('/person/:userId/today', verifyToken, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: '잘못된 사용자' });

    // 프로필(마스킹은 목록에서만, 상세는 본닉 표시) + 오늘 감정
    const [[user]] = await db.query(`SELECT id AS userId, name, img FROM Users WHERE id=?`, [targetId]);
    if (!user) return res.status(404).json({ message: '사용자 없음' });

    const [[today]] = await db.query(`
      SELECT emotion_type, expression_type, updated_at, latitude, longitude
        FROM Today_Emotion
       WHERE userId = ?
    `, [targetId]);

    // "오늘" 작성된 공개 캡슐(Records) 중 최신 1개
    const [[rec]] = await db.query(`
      SELECT id, title, emotion_type, expression_type, content, img, place, created_at
        FROM Records
       WHERE userId=? 
         AND visibility='public'
         AND DATE(created_at)=CURDATE()
       ORDER BY created_at DESC
       LIMIT 1
    `, [targetId]);

    let images = [];
    if (rec) {
      const [rows] = await db.query(
        `SELECT url FROM RecordImages WHERE recordId=? ORDER BY sort_order ASC, id ASC`,
        [rec.id]
      );
      images = rows.map(r => r.url);
    }

    res.json({
      profile: user,
      todayEmotion: today || null,
      latestPublicRecord: rec ? { ...rec, images } : null
    });
  } catch (e) {
    res.status(500).json({ message: '상세 조회 실패', detail: e.message });
  }
});

module.exports = router;