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
 * - 삭제되지 않은(is_deleted=0), 게시 시각(publish_at) 도달한 공지만 노출
 * - pinned 먼저, 최신순
 * - summary 컬럼이 없으므로 content 일부를 잘라서 summary 별칭으로 내려줌
 * - NoticeReads LEFT JOIN으로 읽음 여부(is_read) 제공
 * - 페이징: ?page=1&pageSize=10
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

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
      `SELECT n.id,
              n.title,
              -- summary 컬럼이 없으므로 content 120자 잘라서 별칭으로 제공
              CASE
                WHEN CHAR_LENGTH(n.content) <= 120 THEN n.content
                ELSE CONCAT(SUBSTRING(n.content, 1, 120), '…')
              END AS summary,
              n.pinned,
              n.publish_at,
              n.created_at,
              n.updated_at,
              (nr.id IS NOT NULL) AS is_read
         FROM Notices n
         LEFT JOIN NoticeReads nr
           ON nr.notice_id = n.id AND nr.user_id = ?
        WHERE n.is_deleted = 0
          AND n.publish_at <= NOW()
        ORDER BY n.pinned DESC, n.publish_at DESC, n.id DESC
        LIMIT ? OFFSET ?`,
      [userId, pageSize, offset]
    );

    res.json({ page, pageSize, total: cnt, items: rows });
  } catch (e) {
    console.error('[GET /notices]', e);
    res.status(500).json({ message: '공지 목록 조회 실패', detail: e.message });
  }
});

/**
 * [로그인 유저 전용] 공지 상세
 * - 게시 가능 상태의 공지만 조회 가능
 * - is_read 포함
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: '잘못된 공지 ID' });

    const [[row]] = await db.query(
      `SELECT n.id, n.title, n.content, n.pinned, n.publish_at, n.created_at, n.updated_at,
              (nr.id IS NOT NULL) AS is_read
         FROM Notices n
         LEFT JOIN NoticeReads nr
           ON nr.notice_id = n.id AND nr.user_id = ?
        WHERE n.id = ? AND n.is_deleted = 0 AND n.publish_at <= NOW()`,
      [userId, id]
    );

    if (!row) return res.status(404).json({ message: '공지사항을 찾을 수 없습니다' });
    res.json(row);
  } catch (e) {
    console.error('[GET /notices/:id]', e);
    res.status(500).json({ message: '공지 상세 조회 실패', detail: e.message });
  }
});

/**
 * [로그인 유저 전용] 공지 읽음 처리
 * - 읽음 기록이 없으면 INSERT
 */
router.post('/:id/read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: '잘못된 공지 ID' });

    // 공지 게시 여부 확인
    const [[notice]] = await db.query(
      `SELECT id FROM Notices WHERE id=? AND is_deleted=0 AND publish_at <= NOW()`,
      [id]
    );
    if (!notice) return res.status(404).json({ message: '공지사항을 찾을 수 없습니다' });

    // 이미 읽음인지 확인
    const [[exists]] = await db.query(
      `SELECT id FROM NoticeReads WHERE notice_id=? AND user_id=?`,
      [id, userId]
    );
    if (!exists) {
      await db.query(
        `INSERT INTO NoticeReads (notice_id, user_id) VALUES (?, ?)`,
        [id, userId]
      );
    }
    res.status(204).send();
  } catch (e) {
    console.error('[POST /notices/:id/read]', e);
    res.status(500).json({ message: '읽음 처리 실패', detail: e.message });
  }
});

/**
 * [관리자] 공지 생성
 * body: { title, content, pinned?, publish_at? }
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!isAdmin(userId)) return res.status(403).json({ message: '관리자만 접근 가능합니다' });

    const { title, content, pinned = false, publish_at = null } = req.body || {};
    if (!title || !content) return res.status(400).json({ message: 'title, content는 필수입니다' });

    const [r] = await db.query(
      `INSERT INTO Notices (title, content, pinned, publish_at, is_deleted, created_by)
       VALUES (?, ?, ?, ?, 0, ?)`,
      [title, content, !!pinned, publish_at, userId]
    );

    res.status(201).json({ id: r.insertId });
  } catch (e) {
    console.error('[POST /notices]', e);
    res.status(500).json({ message: '공지 생성 실패', detail: e.message });
  }
});

/**
 * [관리자] 공지 수정
 * body: { title?, content?, pinned?, publish_at? }
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!isAdmin(userId)) return res.status(403).json({ message: '관리자만 접근 가능합니다' });

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: '잘못된 공지 ID' });

    const fields = [];
    const vals = [];
    const allow = ['title', 'content', 'pinned', 'publish_at'];
    allow.forEach(k => {
      if (req.body[k] !== undefined) {
        fields.push(`${k} = ?`);
        vals.push(req.body[k]);
      }
    });

    if (!fields.length) return res.status(400).json({ message: '수정할 필드가 없습니다' });
    vals.push(id);

    const [r] = await db.query(
      `UPDATE Notices SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = ? AND is_deleted = 0`,
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
      `UPDATE Notices SET is_deleted = 1, updated_at = NOW()
        WHERE id = ? AND is_deleted = 0`,
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