const express = require('express');
const router = express.Router();
const db = require('../data/db');
const { verifyToken } = require('../middleware/auth');

// 레코드 읽기 권한 체크: 공개면 모두, 비공개면 작성자만
async function ensureReadable(recordId, requesterId) {
  const [[rec]] = await db.query(`SELECT userId, visibility FROM Records WHERE id=?`, [recordId]);
  if (!rec) return { ok: false, status: 404, message: '게시물 없음' };
  if (rec.visibility === 'public') return { ok: true, ownerId: rec.userId };
  if (rec.userId === requesterId) return { ok: true, ownerId: rec.userId };
  return { ok: false, status: 403, message: '비공개 게시물입니다' };
}

router.get('/:recordId/comments', verifyToken, async (req, res) => {
  try {
    const recordId = parseInt(req.params.recordId, 10);
    const me = req.user.userId;
    const auth = await ensureReadable(recordId, me);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const size = Math.min(50, Math.max(1, parseInt(req.query.size || '20', 10)));
    const off  = (page - 1) * size;

    const [rows] = await db.query(`
      SELECT c.id, c.content, c.created_at, c.updated_at,
             u.id AS authorId, u.name AS authorName, u.img AS authorImg
        FROM RecordComments c
        JOIN Users u ON u.id = c.author_id
       WHERE c.record_id=? AND c.is_deleted=0
       ORDER BY c.id DESC
       LIMIT ? OFFSET ?
    `, [recordId, size, off]);

    res.json({ page, size, comments: rows });
  } catch (e) {
    res.status(500).json({ message: '댓글 목록 실패', detail: e.message });
  }
});

// 작성
router.post('/:recordId/comments', verifyToken, async (req, res) => {
  try {
    const recordId = parseInt(req.params.recordId, 10);
    const me = req.user.userId;
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ message: '내용이 필요합니다' });
    if (content.length > 2000) return res.status(400).json({ message: '2000자 이내로 작성해주세요' });

    const auth = await ensureReadable(recordId, me);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });
    // 비공개 글에는 댓글 금지: 공개만 허용
    const [[rec]] = await db.query(`SELECT visibility FROM Records WHERE id=?`, [recordId]);
    if (rec.visibility !== 'public') return res.status(403).json({ message: '공개 게시물에만 댓글을 남길 수 있습니다' });

    const [result] = await db.query(
      `INSERT INTO RecordComments (record_id, author_id, content) VALUES (?, ?, ?)`,
      [recordId, me, content]
    );
    const [[row]] = await db.query(`
      SELECT c.id, c.content, c.created_at, c.updated_at,
             u.id AS authorId, u.name AS authorName, u.img AS authorImg
        FROM RecordComments c JOIN Users u ON u.id=c.author_id
       WHERE c.id = ?
    `, [result.insertId]);

    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ message: '댓글 작성 실패', detail: e.message });
  }
});

// 삭제(작성자 또는 게시물 작성자가 삭제 가능)
router.delete('/comments/:commentId', verifyToken, async (req, res) => {
  try {
    const commentId = parseInt(req.params.commentId, 10);
    const me = req.user.userId;
    const [[c]] = await db.query(
      `SELECT c.author_id, r.userId AS ownerId
         FROM RecordComments c
         JOIN Records r ON r.id = c.record_id
        WHERE c.id=?`, [commentId]
    );
    if (!c) return res.status(404).json({ message: '댓글 없음' });
    if (c.author_id !== me && c.ownerId !== me) {
      return res.status(403).json({ message: '삭제 권한이 없습니다' });
    }
    await db.query(`UPDATE RecordComments SET is_deleted=1 WHERE id=?`, [commentId]);
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ message: '댓글 삭제 실패', detail: e.message });
  }
});

module.exports = router;