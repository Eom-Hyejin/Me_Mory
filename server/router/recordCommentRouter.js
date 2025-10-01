const express = require('express');
const router = express.Router();
const db = require('../data/db');
const verifyToken = require('../util/jwt').verifyToken;

// 공용: 레코드 읽기 권한 (공개 or 본인)
async function ensureReadable(recordId, requesterId) {
  const [[rec]] = await db.query(
    `SELECT userId, visibility FROM Records WHERE id=?`,
    [recordId]
  );
  if (!rec) return { ok: false, status: 404, message: '게시물 없음' };
  if (rec.visibility === 'public') return { ok: true, ownerId: rec.userId };
  if (rec.userId === requesterId) return { ok: true, ownerId: rec.userId };
  return { ok: false, status: 403, message: '비공개 게시물입니다' };
}

/** 레코드 상세(+대표 이미지/이미지 목록) */
router.get('/:recordId/full', verifyToken, async (req, res) => {
  try {
    const recordId = Number(req.params.recordId);
    if (!Number.isFinite(recordId))
      return res.status(400).json({ message: '잘못된 게시물' });

    const me = req.user.userId;
    const auth = await ensureReadable(recordId, me);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const [[r]] = await db.query(
      `SELECT r.id, r.userId, r.title, r.content, r.emotion_type, r.expression_type,
              r.place, r.img AS representative_img, r.visibility, r.created_at,
              u.name AS userName, u.img AS userImg
         FROM Records r
         JOIN Users u ON u.id = r.userId
        WHERE r.id = ?`,
      [recordId]
    );
    if (!r) return res.status(404).json({ message: '게시물 없음' });

    const [imgs] = await db.query(
      `SELECT url FROM RecordImages WHERE recordId=? ORDER BY sort_order ASC, id ASC`,
      [recordId]
    );
    const images = imgs.map(x => x.url);

    return res.json({ record: r, images });
  } catch (e) {
    console.error('[GET /records/:id/full]', e);
    return res.status(500).json({ message: '상세 조회 실패', detail: e.message });
  }
});

/** 댓글 목록 */
router.get('/:recordId/comments', verifyToken, async (req, res) => {
  try {
    const recordId = Number(req.params.recordId);
    if (!Number.isFinite(recordId))
      return res.status(400).json({ message: '잘못된 게시물' });

    const me = req.user.userId;
    const auth = await ensureReadable(recordId, me);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(50, Math.max(1, Number(req.query.size || 20)));
    const off  = (page - 1) * size;

    const [rows] = await db.query(
      `SELECT c.id, c.content, c.created_at, c.updated_at,
              u.id AS authorId, u.name AS authorName, u.img AS authorImg
         FROM RecordComments c
         JOIN Users u ON u.id = c.author_id
        WHERE c.record_id=? AND c.is_deleted=0
        ORDER BY c.id DESC
        LIMIT ? OFFSET ?`,
      [recordId, size, off]
    );

    return res.json({ page, size, comments: rows });
  } catch (e) {
    console.error('[GET /records/:id/comments]', e);
    return res.status(500).json({ message: '댓글 목록 실패', detail: e.message });
  }
});

/** 댓글 작성 (공개글에만 허용) */
router.post('/:recordId/comments', verifyToken, async (req, res) => {
  try {
    const recordId = Number(req.params.recordId);
    if (!Number.isFinite(recordId))
      return res.status(400).json({ message: '잘못된 게시물' });

    const me = req.user.userId;
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ message: '내용이 필요합니다' });
    if (content.length > 2000)
      return res.status(400).json({ message: '2000자 이내로 작성해주세요' });

    const auth = await ensureReadable(recordId, me);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const [[rec]] = await db.query(
      `SELECT visibility FROM Records WHERE id=?`, [recordId]
    );
    if (!rec) return res.status(404).json({ message: '게시물 없음' });
    if (rec.visibility !== 'public')
      return res.status(403).json({ message: '공개 게시물에만 댓글을 남길 수 있습니다' });

    const [ins] = await db.query(
      `INSERT INTO RecordComments (record_id, author_id, content)
       VALUES (?, ?, ?)`,
      [recordId, me, content]
    );

    const [[row]] = await db.query(
      `SELECT c.id, c.content, c.created_at, c.updated_at,
              u.id AS authorId, u.name AS authorName, u.img AS authorImg
         FROM RecordComments c
         JOIN Users u ON u.id=c.author_id
        WHERE c.id=?`,
      [ins.insertId]
    );

    return res.status(201).json(row);
  } catch (e) {
    console.error('[POST /records/:id/comments]', e);
    return res.status(500).json({ message: '댓글 작성 실패', detail: e.message });
  }
});

/** 댓글 삭제 (작성자 또는 글 작성자) */
router.delete('/comments/:commentId', verifyToken, async (req, res) => {
  try {
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(commentId))
      return res.status(400).json({ message: '잘못된 댓글' });

    const me = req.user.userId;
    const [[c]] = await db.query(
      `SELECT c.author_id, r.userId AS ownerId
         FROM RecordComments c
         JOIN Records r ON r.id = c.record_id
        WHERE c.id=?`,
      [commentId]
    );
    if (!c) return res.status(404).json({ message: '댓글 없음' });
    if (c.author_id !== me && c.ownerId !== me)
      return res.status(403).json({ message: '삭제 권한이 없습니다' });

    await db.query(`UPDATE RecordComments SET is_deleted=1 WHERE id=?`, [commentId]);
    return res.status(204).send();
  } catch (e) {
    console.error('[DELETE /records/comments/:id]', e);
    return res.status(500).json({ message: '댓글 삭제 실패', detail: e.message });
  }
});

/** 댓글 신고 */
router.post('/comments/:commentId/report', verifyToken, async (req, res) => {
  try {
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(commentId))
      return res.status(400).json({ message: '잘못된 댓글' });

    const me = req.user.userId;
    const [[c]] = await db.query(
      `SELECT id, author_id, is_deleted FROM RecordComments WHERE id=?`,
      [commentId]
    );
    if (!c || c.is_deleted) return res.status(404).json({ message: '댓글이 없습니다' });
    if (c.author_id === me) return res.status(400).json({ message: '본인 댓글은 신고할 수 없습니다' });

    const [ins] = await db.query(
      `INSERT IGNORE INTO CommentReports (comment_id, reporter_id) VALUES (?, ?)`,
      [commentId, me]
    );

    const [[cnt]] = await db.query(
      `SELECT COUNT(*) AS count FROM CommentReports WHERE comment_id=?`,
      [commentId]
    );

    return res.status(ins.affectedRows ? 201 : 200).json({
      reported: true,
      alreadyReported: ins.affectedRows === 0,
      count: cnt.count
    });
  } catch (e) {
    console.error('[POST /records/comments/:id/report]', e);
    return res.status(500).json({ message: '신고 실패', detail: e.message });
  }
});

/** 댓글 신고 수 */
router.get('/comments/:commentId/report-count', verifyToken, async (req, res) => {
  try {
    const commentId = Number(req.params.commentId);
    if (!Number.isFinite(commentId))
      return res.status(400).json({ message: '잘못된 댓글' });

    const [[cnt]] = await db.query(
      `SELECT COUNT(*) AS count FROM CommentReports WHERE comment_id=?`,
      [commentId]
    );
    return res.json({ count: cnt.count });
  } catch (e) {
    console.error('[GET /records/comments/:id/report-count]', e);
    return res.status(500).json({ message: '신고 수 조회 실패', detail: e.message });
  }
});

module.exports = router;