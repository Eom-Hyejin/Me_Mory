const express = require('express');
const router = express.Router();
const { verifyToken } = require('../util/jwt');
const bt = require('../services/bluetooth');

// [웹/앱 공용] 현재 내 BLE 기능 동의/활성화 상태 조회
router.get('/consent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const state = await bt.settingsService.getConsent(userId);
    res.json(state); // { enabled: boolean, last_enabled_at: datetime|null }
  } catch (e) {
    console.error('[GET /bluetooth/consent]', e);
    res.status(500).json({ message: 'BLE 동의 상태 조회 실패', detail: e.message });
  }
});

// [웹/앱 공용] BLE 기능 동의/활성화 on/off
router.post('/consent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { enabled } = req.body; // boolean
    await bt.settingsService.setConsent(userId, !!enabled);
    res.status(204).send();
  } catch (e) {
    console.error('[POST /bluetooth/consent]', e);
    res.status(500).json({ message: 'BLE 동의 설정 실패', detail: e.message });
  }
});

// [웹/앱 공용] 익명 디바이스 토큰 로테이트(앱이 광고에 사용)
router.post('/device-token/rotate', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const token = await bt.tokenService.rotateDeviceToken(userId);
    res.json({ token }); // 32자 hex (서버에선 hash로 저장)
  } catch (e) {
    console.error('[POST /bluetooth/device-token/rotate]', e);
    res.status(500).json({ message: 'BLE 디바이스 토큰 갱신 실패', detail: e.message });
  }
});

// [앱 전용] 스캔 관측 업로드: [{hash, rssi, seenAt}, ...]
router.post('/scan-report', verifyToken, async (req, res) => {
  try {
    const reporterId = req.user.userId;
    const { observations = [] } = req.body;
    await bt.proximityService.ingestScanResults(reporterId, observations);
    res.status(204).send();
  } catch (e) {
    console.error('[POST /bluetooth/scan-report]', e);
    res.status(500).json({ message: 'BLE 스캔 결과 수신 실패', detail: e.message });
  }
});

// [앱/웹] BLE 관측 기반 근접 사용자(최근 N분)
router.get('/nearby', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // ⛳️ 위치 필수
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      Number.isNaN(lat) || Number.isNaN(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) {
      return res.status(400).json({ message: '유효한 lat, lng 쿼리가 필요합니다.' });
    }

    // 정책 고정값
    const windowMin = 5;       // 최근 5분
    const limit     = 7;       // 최대 7명
    const radiusKm  = 0.5;     // 반경 500m
    const mask      = String(req.query.mask || '1') === '1';

    const list = await bt.proximityService.getNearbyByBle(
      userId,
      { windowMin, limit, mask, origin: { lat, lng }, radiusKm }
    );
    res.json(list);
  } catch (e) {
    console.error('[GET /bluetooth/nearby]', e);
    res.status(500).json({ message: 'BLE 근접 조회 실패', detail: e.message });
  }
});

module.exports = router;