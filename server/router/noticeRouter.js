const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../util/jwt');

// 환경변수에서 관리자 ID 목록 로드
const ADMIN_USER_IDS = String(process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map(s => parseInt(s.trim(), 10))
  .filter(n => !Number.isNaN(n));

function isAdmin(userId) {
  return ADMIN_USER_IDS.includes(Number(userId));
}

/**
 * [로그인 유저 전용] 공지 목록
 * - 로그인 필수
 * - 삭제되지 않은(is_deleted=0), 게시 시각(publish_at) 도달한 공지만 노출
 * - pinned 먼저, 최신순
 * - 페이징 지원: ?page=1&pageSize=10
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;

    const [[{ cnt }]] = await db.query(
      `SELECT COUNT(*) AS cnt
         FROM Notices
        WHERE is_deleted = 0
          AND publish_at <= NOW()`
    );

    const [rows] = await db.query(
      `SELECT id, title, summary, pinned, publish_at, created_at, updated_at
         FROM Notices
        WHERE is_deleted = 0
          AND publish_at <= NOW()
        ORDER BY pinned DESC, publish_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );

    res.json({ page, pageSize, total: cnt, items: rows });
  } catch (e) {
    console.error('[GET /notices]', e);
    res.status(500).json({ message: '공지 목록 조회 실패', detail: e.message });
  }
});

/**
 * [로그인 유저 전용] 공지 상세
 * - 로그인 필수
 * - 게시 가능 상태의 공지만 조회 가능
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: '잘못된 공지 ID' });

    const [[row]] = await db.query(
      `SELECT id, title, summary, content, pinned, publish_at, created_at, updated_at
         FROM Notices
        WHERE id = ? AND is_deleted = 0 AND publish_at <= NOW()`,
      [id]
    );

    if (!row) return res.status(404).json({ message: '공지사항을 찾을 수 없습니다' });
    res.json(row);
  } catch (e) {
    console.error('[GET /notices/:id]', e);
    res.status(500).json({ message: '공지 상세 조회 실패', detail: e.message });
  }
});

/**
 * [관리자] 공지 생성
 * body: { title, summary?, content, pinned?, publish_at? }
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!isAdmin(userId)) return res.status(403).json({ message: '관리자만 접근 가능합니다' });

    const { title, summary = null, content, pinned = false, publish_at = null } = req.body || {};
    if (!title || !content) return res.status(400).json({ message: 'title, content는 필수입니다' });

    const [r] = await db.query(
      `INSERT INTO Notices (title, summary, content, pinned, publish_at, is_deleted, created_by)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [title, summary, content, !!pinned, publish_at, userId]
    );

    res.status(201).json({ id: r.insertId });
  } catch (e) {
    console.error('[POST /notices]', e);
    res.status(500).json({ message: '공지 생성 실패', detail: e.message });
  }
});

/**
 * [관리자] 공지 수정
 * body: { title?, summary?, content?, pinned?, publish_at? }
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!isAdmin(userId)) return res.status(403).json({ message: '관리자만 접근 가능합니다' });

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: '잘못된 공지 ID' });

    const fields = [];
    const vals = [];
    const allow = ['title', 'summary', 'content', 'pinned', 'publish_at'];
    allow.forEach(k => {
      if (req.body[k] !== undefined) {
        fields.push(`${k} = ?`);
        vals.push(req.body[k]);
      }
    });

    if (!fields.length) return res.status(400).json({ message: '수정할 필드가 없습니다' });
    vals.push(id);

    const [r] = await db.query(
      `UPDATE Notices SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ? AND is_deleted = 0`,
      vals
    );

    if (r.affectedRows === 0) return res.status(404).json({ message: '공지사항을 찾을 수 없습니다' });
    res.json({ message: '공지 수정 완료' });
  } catch (e) {
    console.error('[PUT /notices/:id]', e);
    res.status(500).json({ message: '공지 수정 실패', detail: e.message });
  }
});

/**
 * [관리자] 공지 삭제(soft delete)
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!isAdmin(userId)) return res.status(403).json({ message: '관리자만 접근 가능합니다' });

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: '잘못된 공지 ID' });

    const [r] = await db.query(
      `UPDATE Notices SET is_deleted = 1, updated_at = NOW() WHERE id = ? AND is_deleted = 0`,
      [id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ message: '공지사항을 찾을 수 없습니다' });
    res.status(204).send();
  } catch (e) {
    console.error('[DELETE /notices/:id]', e);
    res.status(500).json({ message: '공지 삭제 실패', detail: e.message });
  }
});

module.exports = router;