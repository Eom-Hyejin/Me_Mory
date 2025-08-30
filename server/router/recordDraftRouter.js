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
    const start = `${year}-${m}-01`;
    const end   = `${year}-${m}-31`;

    const [rows] = await db.query(
      `SELECT date, emotion_type, expression_type
         FROM EmotionCalendar
        WHERE userId = ? AND date BETWEEN ? AND ?
        ORDER BY date ASC`,
      [userId, start, end]
    );

    res.json(rows);
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
  const userId = req.user.userId;

  try {
    const [rows] = await db.query(
      'SELECT * FROM Records WHERE id = ? AND userId = ?',
      [recordId, userId]
    );
    if (!rows.length) return res.status(404).json({ message: '감정 기록을 찾을 수 없습니다' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '상세 조회 실패', detail: err.message });
  }
});

/* ===================================================== */
/* ========== 4) 기록의 전체 이미지 (썸네일 그리드) ===== */
/* ===================================================== */
// GET /records/:id/images
router.get('/:id/images', verifyToken, async (req, res) => {
  const recordId = parseInt(req.params.id, 10);
  const userId = req.user.userId;
  try {
    const [[own]] = await db.query(`SELECT userId FROM Records WHERE id=?`, [recordId]);
    if (!own) return res.status(404).json({ message: '기록 없음' });
    if (own.userId !== userId) return res.status(403).json({ message: '권한 없음' });

    const [imgs] = await db.query(
      `SELECT url, sort_order FROM RecordImages WHERE recordId=? ORDER BY sort_order ASC, id ASC`,
      [recordId]
    );
    res.json(imgs.map(x => x.url));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '이미지 조회 실패', detail: err.message });
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

    values.push(recordId, userId);
    await conn.query(
      `UPDATE Records SET ${updates.join(', ')} WHERE id=? AND userId=?`,
      values
    );

    // ✅ 모드 재계산 → 캘린더 & 월 통계 자동 동기화
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

    await conn.query(`DELETE FROM RecordImages WHERE recordId=?`, [recordId]);
    await conn.query(`DELETE FROM Records WHERE id=? AND userId=?`, [recordId, userId]);

    // ✅ 모드 재계산 → 캘린더 & 월 통계 자동 동기화
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

module.exports = router;
