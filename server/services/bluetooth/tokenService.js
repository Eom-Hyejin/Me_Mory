const crypto = require('crypto');
const db = require('../../data/db');

function sha256hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function rotateDeviceToken(userId) {
  const token = crypto.randomBytes(16).toString('hex'); // 32자
  const token_hash = sha256hex(token);
  // 하나만 유효하게(이전 토큰들은 inactive)
  await db.query(`
    INSERT INTO DeviceTokens (user_id, token_hash, rotated_at, expires_at, active)
    VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), 1)
    ON DUPLICATE KEY UPDATE
      token_hash=VALUES(token_hash),
      rotated_at=VALUES(rotated_at),
      expires_at=VALUES(expires_at),
      active=1
  `, [userId, token_hash]);
  return token; // 클라에 평문 토큰 반환(서버는 hash만 보관)
}

async function resolveUserByTokenHash(token_hash) {
  const [rows] = await db.query(
    'SELECT user_id FROM DeviceTokens WHERE token_hash=? AND active=1 AND expires_at>NOW()',
    [token_hash]
  );
  return rows.length ? rows[0].user_id : null;
}

module.exports = { rotateDeviceToken, resolveUserByTokenHash };
