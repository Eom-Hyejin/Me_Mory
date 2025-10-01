const express = require('express');
const router = express.Router();
const db = require('../data/db');
const verifyToken = require('../util/jwt').verifyToken;

/** 내 '오늘' 지배적 감정 (Records 오늘자 최빈 → 없으면 Today_Emotion) */
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

  const [[r2]] = await db.query(
    `SELECT emotion_type FROM Today_Emotion WHERE userId=?`,
    [userId]
  );
  return r2?.emotion_type || null;
}

/** (E) 근처 사용자 목록: 위치 기반(반경 300m, 최근 5분, 최신순 10명) */
router.get('/nearby', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: 'lat/lng가 필요합니다' });
    }

    const radiusKm  = Number.isFinite(Number(req.query.radiusKm)) ? Number(req.query.radiusKm) : 0.3; // 300m
    const windowMin = Number.isFinite(Number(req.query.windowMin)) ? Number(req.query.windowMin) : 5;
    const limit     = Math.min(Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 10, 10);

    // ----- 바운딩 박스(인덱스 타기 위함) -----
    // 위도 1도 ≈ 110.574km, 경도 1도 ≈ 111.320*cos(lat) km
    const latDelta = radiusKm / 110.574;
    const lngDelta = radiusKm / (111.320 * Math.cos(lat * Math.PI / 180));

    const latMin = lat - latDelta;
    const latMax = lat + latDelta;
    const lngMin = lng - lngDelta;
    const lngMax = lng + lngDelta;

    // ----- 먼저 시간 + 바운딩박스로 좁히고, 마지막에 구면거리로 정밀 필터링 -----
    const [rows] = await db.query(`
      SELECT
        u.id AS userId, u.name, u.img,
        t.emotion_type, t.expression_type, t.updated_at,
        t.latitude, t.longitude
      FROM Today_Emotion t
      JOIN Users u ON u.id = t.userId
      WHERE t.userId <> ?
        AND t.updated_at >= NOW() - INTERVAL ? MINUTE
        AND t.latitude  BETWEEN ? AND ?
        AND t.longitude BETWEEN ? AND ?
        AND ST_Distance_Sphere(POINT(t.longitude, t.latitude), POINT(?, ?)) <= ? * 1000
      ORDER BY t.updated_at DESC
      LIMIT ?
    `, [userId, windowMin, latMin, latMax, lngMin, lngMax, lng, lat, radiusKm, limit]);

    const mine = await getMyTodayDominantEmotion(userId);
    for (const r of rows) r.sameEmotionWithMe = mine ? (r.emotion_type === mine) : false;

    res.json({ myEmotion: mine, users: rows });
  } catch (e) {
    console.error('[GET /nearby]', e);
    res.status(500).json({ message: '조회 실패', detail: e.message });
  }
});


/** (F) 사람 클릭: 오늘 감정 + 최신 공개 캡슐 + (비공개 여부 판별용) 메타 */
router.get('/person/:userId/today', verifyToken, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(targetId)) return res.status(400).json({ message: '잘못된 사용자' });

    const [[user]] = await db.query(
      `SELECT id AS userId, name, img FROM Users WHERE id=?`,
      [targetId]
    );
    if (!user) return res.status(404).json({ message: '사용자 없음' });

    const [[today]] = await db.query(`
      SELECT emotion_type, expression_type, updated_at, latitude, longitude
        FROM Today_Emotion
       WHERE userId = ?
    `, [targetId]);

    // ✅ 오늘 최신 "공개" 글 (있으면 full로 보여줄 대상)
    const [[recPublic]] = await db.query(`
      SELECT id, title, emotion_type, expression_type, content, img, place, created_at
        FROM Records
       WHERE userId=? AND visibility='public' AND DATE(created_at)=CURDATE()
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `, [targetId]);

    // ✅ 오늘 최신 글 (공개/비공개 무관) — 비공개 안내 여부 판별용 메타
    const [[recAny]] = await db.query(`
      SELECT id, visibility, created_at
        FROM Records
       WHERE userId=? AND DATE(created_at)=CURDATE()
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `, [targetId]);

    let images = [];
    if (recPublic) {
      const [rows] = await db.query(
        `SELECT url FROM RecordImages WHERE recordId=? ORDER BY sort_order ASC, id ASC`,
        [recPublic.id]
      );
      images = rows.map(r => r.url);
    }

    res.json({
      profile: user,
      todayEmotion: today || null,
      latestPublicRecord: recPublic ? { ...recPublic, images } : null,
      // 🔽 공개/비공개 판별용 메타. content 같은 민감정보는 포함하지 않음
      latestAnyRecord: recAny ? { recordId: recAny.id, visibility: recAny.visibility } : null
    });
  } catch (e) {
    console.error('[GET /person/:userId/today]', e);
    res.status(500).json({ message: '상세 조회 실패', detail: e.message });
  }
});

// (G) 오늘 위치 + 최신 감정 → Today_Emotion upsert
router.post('/today', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let { latitude, longitude } = req.body;

    latitude  = Number(latitude);
    longitude = Number(longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: '위치(lat,lng)가 필요합니다' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ message: '위치 범위가 올바르지 않습니다' });
    }
    latitude  = Number(latitude.toFixed(7));
    longitude = Number(longitude.toFixed(7));

    const [[latest]] = await db.query(`
      SELECT emotion_type, expression_type
        FROM Records
       WHERE userId = ?
         AND DATE(created_at) = CURDATE()
       ORDER BY created_at DESC
       LIMIT 1
    `, [userId]);

    if (latest) {
      // 오늘 기록이 있으면: 위치 + 감정값 업서트
      await db.query(`
        INSERT INTO Today_Emotion (userId, latitude, longitude, emotion_type, expression_type, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          latitude = VALUES(latitude),
          longitude = VALUES(longitude),
          emotion_type = VALUES(emotion_type),
          expression_type = VALUES(expression_type),
          updated_at = NOW()
      `, [userId, latitude, longitude, latest.emotion_type, latest.expression_type]);

      return res.json({
        message: 'Today_Emotion 저장 완료',
        emotion_type: latest.emotion_type,
        expression_type: latest.expression_type,
        latitude, longitude
      });
    }

    // 오늘 기록이 없으면: 위치만 업서트 + 감정값은 명시적으로 NULL로 리셋
    await db.query(`
      INSERT INTO Today_Emotion (userId, latitude, longitude, emotion_type, expression_type, updated_at)
      VALUES (?, ?, ?, NULL, NULL, NOW())
      ON DUPLICATE KEY UPDATE
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        emotion_type = NULL,
        expression_type = NULL,
        updated_at = NOW()
    `, [userId, latitude, longitude]);

    return res.json({
      message: '오늘 기록 없음 → 위치만 저장(감정값 NULL 초기화)',
      latitude, longitude
    });
  } catch (e) {
    console.error('[POST /today]', e);
    res.status(500).json({ message: 'Today_Emotion 저장 실패', detail: e.message });
  }
});


module.exports = router;