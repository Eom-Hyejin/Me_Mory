const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

// ── 간단 관리자 체크: ADMIN_USER_IDS="1,2,3"
const ADMIN_SET = new Set(
  String(process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isInteger(n))
);
function ensureAdmin(req, res, next) {
  const userId = req.user?.userId;
  if (userId && ADMIN_SET.has(Number(userId))) return next();
  return res.status(403).json({ message: '관리자 권한이 필요합니다' });
}

/**
 * 목록 조회 (사용자용)
 * GET /notices?cursor=&limit=10
 *  - 게시 시각(publish_at) 이 현재 이전이고 삭제되지 않은 공지만
 *  - pinned 먼저, 그 다음 최신순
 *  - 커서 기반 페이지네이션(cursor = last_id) 또는 limit만 사용
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;

    const conds = ['is_deleted = 0', 'publish_at <= NOW()'];
    const params = [];
    if (cursor) {
      conds.push('id < ?');
      params.push(cursor);
    }

    const [rows] = await db.query(
      `
      SELECT id, title,
             SUBSTRING(content, 1, 200) AS snippet,
             pinned, publish_at, created_at, updated_at
        FROM Notices
       WHERE ${conds.join(' AND ')}
       ORDER BY pinned DESC, id DESC
       LIMIT ?
      `,
      [...params, limit]
    );

    res.json({
      items: rows,
      nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
    });
  } catch (err) {
    console.error('[GET /notices]', err);
    res.status(500).json({ message: '공지 목록 조회 실패', detail: err.message });
  }
});

/**
 * 상세 조회 (사용자용)
 * GET /notices/:id
 *  - 본문 전체 반환
 *  - 게시 전/삭제된 공지는 비표시(관리자는 별도 엔드포인트)
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const [[row]] = await db.query(
      `
      SELECT id, title, content, pinned, publish_at, created_at, updated_at
        FROM Notices
       WHERE id = ? AND is_deleted = 0 AND publish_at <= NOW()
      `,
      [id]
    );
    if (!row) return res.status(404).json({ message: '공지를 찾을 수 없습니다' });

    res.json(row);
  } catch (err) {
    console.error('[GET /notices/:id]', err);
    res.status(500).json({ message: '공지 상세 조회 실패', detail: err.message });
  }
});

/**
 * 읽음 표시
 * POST /notices/:id/read
 */
router.post('/:id/read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);

    // 노출 가능한 공지만 읽음 처리(보안)
    const [[exists]] = await db.query(
      `SELECT id FROM Notices WHERE id=? AND is_deleted=0 AND publish_at<=NOW()`,
      [id]
    );
    if (!exists) return res.status(404).json({ message: '공지를 찾을 수 없습니다' });

    await db.query(
      `
      INSERT INTO NoticeReads (notice_id, user_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE read_at = NOW()
      `,
      [id, userId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('[POST /notices/:id/read]', err);
    res.status(500).json({ message: '읽음 처리 실패', detail: err.message });
  }
});

/**
 * 미읽음 개수
 * GET /notices/unread-count
 */
router.get('/meta/unread-count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [[row]] = await db.query(
      `
      SELECT COUNT(*) AS cnt
        FROM Notices n
        LEFT JOIN NoticeReads r
          ON r.notice_id = n.id AND r.user_id = ?
       WHERE n.is_deleted = 0
         AND n.publish_at <= NOW()
         AND r.id IS NULL
      `,
      [userId]
    );

    res.json({ unread: Number(row.cnt) || 0 });
  } catch (err) {
    console.error('[GET /notices/unread-count]', err);
    res.status(500).json({ message: '미읽음 카운트 조회 실패', detail: err.message });
  }
});

/* ========================= 관리자 전용 ========================= */

/**
 * 공지 생성
 * POST /notices (admin)
 * body: { title, content, pinned?, publish_at? }
 */
router.post('/', verifyToken, ensureAdmin, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { title, content, pinned = false, publish_at } = req.body;

    if (!title || !content) {
      return res.status(400).json({ message: 'title, content는 필수입니다' });
    }

    const [r] = await db.query(
      `
      INSERT INTO Notices (title, content, pinned, publish_at, created_by)
      VALUES (?, ?, ?, COALESCE(?, NOW()), ?)
      `,
      [title.trim(), content, !!pinned ? 1 : 0, publish_at || null, userId]
    );

    res.status(201).json({ id: r.insertId });
  } catch (err) {
    console.error('[POST /notices]', err);
    res.status(500).json({ message: '공지 생성 실패', detail: err.message });
  }
});

/**
 * 공지 수정
 * PUT /notices/:id (admin)
 * body: { title?, content?, pinned?, publish_at? }
 */
router.put('/:id', verifyToken, ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fields = [];
    const vals = [];

    const allow = ['title', 'content', 'pinned', 'publish_at', 'is_deleted'];
    for (const k of allow) {
      if (req.body[k] !== undefined) {
        fields.push(`${k} = ?`);
        if (k === 'pinned' || k === 'is_deleted') vals.push(req.body[k] ? 1 : 0);
        else vals.push(req.body[k]);
      }
    }
    if (!fields.length) {
      return res.status(400).json({ message: '수정할 항목이 없습니다' });
    }

    vals.push(id);
    await db.query(
      `UPDATE Notices SET ${fields.join(', ')} WHERE id = ?`,
      vals
    );

    res.json({ message: '공지 수정 완료' });
  } catch (err) {
    console.error('[PUT /notices/:id]', err);
    res.status(500).json({ message: '공지 수정 실패', detail: err.message });
  }
});

/**
 * 공지 삭제(소프트)
 * DELETE /notices/:id (admin)
 */
router.delete('/:id', verifyToken, ensureAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.query(`UPDATE Notices SET is_deleted = 1 WHERE id = ?`, [id]);
    res.status(204).send();
  } catch (err) {
    console.error('[DELETE /notices/:id]', err);
    res.status(500).json({ message: '공지 삭제 실패', detail: err.message });
  }
});

/**
 * 관리자 목록(관리 화면)
 * GET /notices/admin/list?query=&limit=20&cursor=
 *  - 삭제/게시전 포함, 제목 키워드 검색
 */
router.get('/admin/list', verifyToken, ensureAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
    const q = (req.query.query || '').trim();

    const conds = [];
    const params = [];
    if (cursor) { conds.push('n.id < ?'); params.push(cursor); }
    if (q) { conds.push('n.title LIKE ?'); params.push(`%${q}%`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [rows] = await db.query(
      `
      SELECT n.id, n.title, n.pinned, n.is_deleted, n.publish_at,
             n.created_at, n.updated_at, u.name AS author
        FROM Notices n
        LEFT JOIN Users u ON u.id = n.created_by
        ${where}
       ORDER BY n.id DESC
       LIMIT ?
      `,
      [...params, limit]
    );

    res.json({
      items: rows,
      nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
    });
  } catch (err) {
    console.error('[GET /notices/admin/list]', err);
    res.status(500).json({ message: '관리자 공지 목록 실패', detail: err.message });
  }
});

module.exports = router;