const db = require('../../data/db');
const { apply: applyPrivacy } = require('./privacyGuard');

// 관측 저장: [{hash, rssi, seenAt}]
async function getNearbyByBle(
  userId,
  { windowMin = 5, limit = 7, mask = true, origin, radiusKm = 0.5 }
) {
  // 안전 캡
  windowMin = Math.max(1, Math.min(windowMin, 5));
  limit     = Math.min(Math.max(1, limit), 7);
  radiusKm  = Math.max(0.1, Math.min(radiusKm, 5)); // 100m ~ 5km 사이로만 허용

  if (!origin || typeof origin.lat !== 'number' || typeof origin.lng !== 'number') {
    throw new Error('origin(lat, lng)가 필요합니다.');
  }
  const { lat, lng } = origin;

  // 1) 내가 최근 windowMin분 동안 본 해시들
  const [obs] = await db.query(`
    SELECT observed_hash, MAX(seen_at) AS last_seen, AVG(rssi) AS avg_rssi
    FROM BleObservation
    WHERE reporter_id=? AND seen_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)
    GROUP BY observed_hash
    ORDER BY last_seen DESC
    LIMIT 500
  `, [userId, windowMin]);

  if (obs.length === 0) return [];

  const tokenHashes = obs.map(o => o.observed_hash);

  // 2) 해시 → 사용자 매핑 (활성 토큰만)
  const [tokRows] = await db.query(`
    SELECT user_id, token_hash
    FROM DeviceTokens
    WHERE token_hash IN (?) AND active=1 AND expires_at>NOW()
  `, [tokenHashes]);

  if (tokRows.length === 0) return [];

  // 3) 좌표/동의/오늘 감정 조인 + 거리 계산 + 반경 필터
  //    하버사인: 지구반지름 6371km
  const [rows] = await db.query(`
    SELECT 
      u.id AS userId,
      u.name, u.img,
      te.emotion_type, te.expression_type, te.updated_at,
      te.latitude, te.longitude,
      (6371 * ACOS(
        COS(RADIANS(?)) * COS(RADIANS(te.latitude)) *
        COS(RADIANS(te.longitude) - RADIANS(?)) +
        SIN(RADIANS(?)) * SIN(RADIANS(te.latitude))
      )) AS distance_km
    FROM Users u
    JOIN UserBleSettings s   ON s.user_id = u.id AND s.enabled = 1
    JOIN Today_Emotion te    ON te.userId  = u.id
    JOIN DeviceTokens dt     ON dt.user_id = u.id AND dt.active=1 AND dt.expires_at>NOW()
    WHERE dt.token_hash IN (?)
      AND u.id != ?
      AND te.latitude IS NOT NULL AND te.longitude IS NOT NULL
    HAVING distance_km <= ?
    ORDER BY distance_km ASC, te.updated_at DESC
    LIMIT ?
  `, [lat, lng, lat, tokenHashes, userId, radiusKm, limit]);

  // 4) 응답(마스킹 적용)
  const data = rows.map(r => applyPrivacy({
    userId: r.userId,
    name: r.name,
    img: r.img,
    emotion_type: r.emotion_type,
    expression_type: r.expression_type,
    updated_at: r.updated_at,
    latitude: r.latitude,
    longitude: r.longitude,
    distance_km: Number(r.distance_km),
  }, { mask }));

  return data;
}

async function ingestScanResults(reporterId, observations) {
  if (!Array.isArray(observations) || observations.length === 0) return;

  const values = [];
  for (const obs of observations) {
    if (!obs || !obs.hash) continue;
    const rssi = Number(obs.rssi ?? 0);
    const seenAt = obs.seenAt ? new Date(obs.seenAt) : new Date();
    values.push([reporterId, obs.hash, rssi, seenAt]);
  }
  if (values.length === 0) return;

  await db.query(`
    INSERT INTO BleObservation (reporter_id, observed_hash, rssi, seen_at)
    VALUES ?
  `, [values]);
}

module.exports = { ingestScanResults, getNearbyByBle };