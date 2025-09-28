const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');
const { recomputeDailySummary } = require('../util/dailySummary');

const EMOTIONS = ['joy','sadness','anger','worry','proud','upset'];

/* =================================================================== */
/* ================== 1) 목록 조회 (필터/페이지네이션) ================== */
/* =================================================================== */
// GET /records?from=&to=&emotion=&visibility=&q=&page=1&pageSize=10
router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const { page = 1, pageSize = 10, from, to, emotion, visibility, q } = req.query;

  const where = ['userId = ?'];
  const vals = [userId];

  if (from) { where.push('DATE(created_at) >= ?'); vals.push(from); }
  if (to)   { where.push('DATE(created_at) <= ?'); vals.push(to); }
  if (emotion && EMOTIONS.includes(emotion)) { where.push('emotion_type = ?'); vals.push(emotion); }
  if (visibility) { where.push('visibility = ?'); vals.push(visibility); }
  if (q) { where.push('(title LIKE ? OR content LIKE ?)'); vals.push(`%${q}%`, `%${q}%`); }

  const limit = Math.min(parseInt(pageSize, 10) || 10, 50);
  const offset = ((parseInt(page, 10) || 1) - 1) * limit;

  try {
    const [[{ cnt }]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM Records WHERE ${where.join(' AND ')}`, vals
    );
    const [rows] = await db.query(
      `SELECT id, title, emotion_type, expression_type, content, img,
              reveal_at, period, latitude, longitude, place, visibility, created_at
         FROM Records
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [...vals, limit, offset]
    );

    res.json({ page: Number(page), pageSize: limit, total: cnt, items: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '기록 목록 조회 실패', detail: err.message });
  }
});

/* ================================================ */
/* ================== 2) 달력 (월별) =============== */
/* ================================================ */
// GET /records/calendar?year=2025&month=09
router.get('/calendar', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ message: 'year, month 쿼리 파라미터가 필요합니다' });
    }
    const m = String(month).padStart(2, '0');

    // 해당 월 범위
    const [[{ first_day }]] = await db.query(
      `SELECT DATE(STR_TO_DATE(CONCAT(?, '-', ?, '-01'), '%Y-%m-%d')) AS first_day`,
      [year, m]
    );
    const [[{ last_day }]] = await db.query(
      `SELECT LAST_DAY(STR_TO_DATE(CONCAT(?, '-', ?, '-01'), '%Y-%m-%d')) AS last_day`,
      [year, m]
    );

    // 날짜별 최신 기록(동일 created_at이면 id가 큰 것 우선)
    const [rows] = await db.query(
      `
      WITH ranked AS (
        SELECT
          DATE(created_at) AS date,
          emotion_type,
          expression_type,
          created_at,
          id,
          ROW_NUMBER() OVER (
            PARTITION BY DATE(created_at)
            ORDER BY created_at DESC, id DESC
          ) AS rn
        FROM Records
        WHERE userId = ?
          AND created_at >= ? AND created_at <= ?
      )
      SELECT date, emotion_type, expression_type
      FROM ranked
      WHERE rn = 1
      ORDER BY date ASC
      `,
      [userId, first_day, last_day]
    );

    return res.json(rows); // [{date:'YYYY-MM-DD', emotion_type, expression_type}]
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '감정 캘린더 조회 실패', detail: err.message });
  }
});

/* ================================================== */
/* ================== 3) 상세 조회 =================== */
/* ================================================== */
// GET /records/:id
router.get('/:id', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id, 10);
  const requesterId = req.user.userId;

  try {
    const [rows] = await db.query(
      `SELECT r.id, r.userId, r.title, r.emotion_type, r.expression_type,
              r.content, r.img, r.reveal_at, r.period,
              r.latitude, r.longitude, r.place, r.visibility, r.created_at,
              u.name AS userName, u.img AS userImg
         FROM Records r
         JOIN Users u ON u.id = r.userId
        WHERE r.id = ?`,
      [recordId]
    );
    if (!rows.length) return res.status(404).json({ message: '감정 기록을 찾을 수 없습니다' });

    const rec = rows[0];
    const isOwner = rec.userId === requesterId;
    const canView = isOwner || rec.visibility === 'public';
    if (!canView) {
      // 존재 여부를 숨겨 정보 노출 방지
      return res.status(404).json({ message: '감정 기록을 찾을 수 없습니다' });
    }

    // 필요하면 민감 필드 마스킹 가능(현재는 content 포함 반환)
    return res.json({
      recordId: rec.id,
      userId: rec.userId,
      userName: rec.userName,
      userImg: rec.userImg,
      title: rec.title,
      emotion_type: rec.emotion_type,
      expression_type: rec.expression_type,
      content: rec.content,
      img: rec.img,
      reveal_at: rec.reveal_at,
      period: rec.period,
      latitude: rec.latitude,
      longitude: rec.longitude,
      place: rec.place,
      visibility: rec.visibility,
      created_at: rec.created_at,
      isOwner,
    });
  } catch (err) {
    console.error('[GET /records/:id]', err);
    res.status(500).json({ message: '상세 조회 실패', detail: err.message });
  }
});

/* ===================================================== */
/* ========== 4) 기록의 전체 이미지 (썸네일 그리드) ===== */
/* ===================================================== */
// GET /records/:id/images
router.get('/:id/images', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id, 10);
  const requesterId = req.user.userId;
  try {
    const [[rec]] = await db.query(
      `SELECT userId, visibility FROM Records WHERE id=?`,
      [recordId]
    );
    if (!rec) return res.status(404).json({ message: '기록 없음' });

    const isOwner = rec.userId === requesterId;
    if (!isOwner && rec.visibility !== 'public') {
      return res.status(404).json({ message: '기록 없음' }); // 정보 노출 방지
    }

    const [imgs] = await db.query(
      `SELECT url, sort_order FROM RecordImages WHERE recordId=? ORDER BY sort_order ASC, id ASC`,
      [recordId]
    );
    res.json(imgs.map(x => x.url));
  } catch (err) {
    console.error('[GET /records/:id/images]', err);
    res.status(500).json({ message: '이미지 조회 실패', detail: err.message });
  }
});


// GET /records/:id/full  — 상세 + 이미지 묶음
router.get('/:id/full', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id, 10);
  const requesterId = req.user.userId;

  try {
    const [rows] = await db.query(
      `SELECT r.id, r.userId, r.title, r.emotion_type, r.expression_type,
              r.content, r.img, r.reveal_at, r.period,
              r.latitude, r.longitude, r.place, r.visibility, r.created_at,
              u.name AS userName, u.img AS userImg
         FROM Records r
         JOIN Users u ON u.id = r.userId
        WHERE r.id = ?`,
      [recordId]
    );
    if (!rows.length) return res.status(404).json({ message: '감정 기록을 찾을 수 없습니다' });

    const rec = rows[0];
    const isOwner = rec.userId === requesterId;
    const canView = isOwner || rec.visibility === 'public';
    if (!canView) return res.status(404).json({ message: '감정 기록을 찾을 수 없습니다' });

    const [imgs] = await db.query(
      `SELECT url, sort_order FROM RecordImages WHERE recordId=? ORDER BY sort_order ASC, id ASC`,
      [recordId]
    );

    return res.json({
      record: {
        recordId: rec.id,
        userId: rec.userId,
        userName: rec.userName,
        userImg: rec.userImg,
        title: rec.title,
        emotion_type: rec.emotion_type,
        expression_type: rec.expression_type,
        content: rec.content,
        representative_img: rec.img,
        reveal_at: rec.reveal_at,
        period: rec.period,
        latitude: rec.latitude,
        longitude: rec.longitude,
        place: rec.place,
        visibility: rec.visibility,
        created_at: rec.created_at,
        isOwner,
      },
      images: imgs.map(x => x.url),
    });
  } catch (err) {
    console.error('[GET /records/:id/full]', err);
    res.status(500).json({ message: '상세+이미지 조회 실패', detail: err.message });
  }
});

/* ===================================================== */
/* ========== 5) 대표 이미지 교체 (선택 기능) ========== */
/* ===================================================== */
// PUT /records/:id/representative  body: { url: "https://..." }
router.put('/:id/representative', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id, 10);
  const userId = req.user.userId;
  const { url } = req.body;
  if (!url) return res.status(400).json({ message: 'url 필요' });

  try {
    const [[own]] = await db.query(`SELECT userId FROM Records WHERE id=?`, [recordId]);
    if (!own) return res.status(404).json({ message: '기록 없음' });
    if (own.userId !== userId) return res.status(403).json({ message: '권한 없음' });

    const [[valid]] = await db.query(
      `SELECT id FROM RecordImages WHERE recordId=? AND url=?`, [recordId, url]
    );
    if (!valid) return res.status(400).json({ message: '해당 기록의 이미지가 아님' });

    await db.query(`UPDATE Records SET img=? WHERE id=?`, [url, recordId]);
    res.json({ message: '대표 이미지 업데이트 완료' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '대표 이미지 업데이트 실패', detail: err.message });
  }
});

/* ===================================================== */
/* ========== 6) 수정: 모드 재계산(달력/통계) ========== */
/* ===================================================== */
// PUT /records/:id
router.put('/:id', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id, 10);
  const userId = req.user.userId;

  const ALLOWED = ['title','emotion_type','expression_type','content','img',
                   'reveal_at','period','latitude','longitude','place','visibility'];

  // 입력 필터링 + 간단 검증
  const updates = [];
  const values  = [];
  for (const f of ALLOWED) {
    if (req.body[f] !== undefined) {
      if (f === 'emotion_type' && !EMOTIONS.includes(req.body[f])) {
        return res.status(400).json({ message: '지원하지 않는 emotion_type' });
      }
      if (f === 'title' && String(req.body[f]).length > 100) {
        return res.status(400).json({ message: 'title 길이 초과(<=100)' });
      }
      if (f === 'place' && String(req.body[f]).length > 255) {
        return res.status(400).json({ message: 'place 길이 초과(<=255)' });
      }
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (!updates.length) return res.status(400).json({ message: '수정할 필드가 없습니다' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[origin]] = await conn.query(
      `SELECT created_at FROM Records WHERE id=? AND userId=? FOR UPDATE`,
      [recordId, userId]
    );
    if (!origin) {
      await conn.rollback();
      return res.status(404).json({ message: '기록이 존재하지 않습니다' });
    }
    const dateStr = new Date(origin.created_at).toISOString().slice(0, 10);

    // 실제 업데이트
    values.push(recordId, userId);
    await conn.query(
      `UPDATE Records SET ${updates.join(', ')} WHERE id=? AND userId=?`,
      values
    );

    // ✅ 그날 대표 감정(모드) 재계산 → EmotionCalendar/Emotion_Stats 동기화
    await recomputeDailySummary(conn, userId, dateStr);

    await conn.commit();
    res.json({ message: '감정 기록 수정 완료' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: '감정 기록 수정 실패', detail: err.message });
  } finally {
    conn.release();
  }
});

/* ===================================================== */
/* ========== 7) 삭제: 모드 재계산(달력/통계) ========== */
/* ===================================================== */
// DELETE /records/:id
router.delete('/:id', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id, 10);
  const userId = req.user.userId;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[origin]] = await conn.query(
      `SELECT created_at FROM Records WHERE id=? AND userId=? FOR UPDATE`,
      [recordId, userId]
    );
    if (!origin) {
      await conn.rollback();
      return res.status(404).json({ message: '기록이 존재하지 않습니다' });
    }
    const dateStr = new Date(origin.created_at).toISOString().slice(0, 10);

    // 이미지 정리(로컬 DB) — S3 삭제는 별도 배치 권장
    await conn.query(`DELETE FROM RecordImages WHERE recordId=?`, [recordId]);

    // 레코드 삭제
    await conn.query(`DELETE FROM Records WHERE id=? AND userId=?`, [recordId, userId]);

    // ✅ 그날 대표 감정(모드) 재계산 → EmotionCalendar/Emotion_Stats 동기화
    await recomputeDailySummary(conn, userId, dateStr);

    await conn.commit();
    return res.status(204).send();
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: '감정 기록 삭제 실패', detail: err.message });
  } finally {
    conn.release();
  }
});

// ===== 오늘(세션 타임존=Asia/Seoul) 최신 감정 하나 반환 =====
// GET /record/today/latest
router.get('/today/latest', verifyToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const [rows] = await db.query(
      `
      SELECT id AS recordId, emotion_type, expression_type, created_at
        FROM Records
       WHERE userId = ?
         AND DATE(created_at) = CURDATE()   -- 세션 time_zone(Asia/Seoul) 기준의 "오늘"
       ORDER BY created_at DESC, id DESC
       LIMIT 1
      `,
      [userId]
    );

    if (!rows.length) return res.status(204).send(); // 오늘 기록 없음
    return res.status(200).json(rows[0]);            // {recordId, emotion_type, expression_type, created_at}
  } catch (err) {
    console.error('[GET /record/today/latest]', err);
    return res.status(500).json({ message: '오늘 최신 감정 조회 실패', detail: err.message });
  }
});


module.exports = router;