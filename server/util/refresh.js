const crypto = require('crypto');
const db = require('../data/db');

const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d';
const TTL_DAYS = parseInt(String(REFRESH_TTL).replace('d', ''), 10) || 30;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function randomToken(size = 64) {
  return crypto.randomBytes(size).toString('hex'); // 클라이언트에 전달되는 원문
}

async function storeRefreshToken({ userId, tokenPlain, deviceId, ip, userAgent }) {
  const tokenHash = sha256(tokenPlain);
  await db.query(
    `INSERT INTO RefreshTokens
       (user_id, token_hash, device_id, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
    [userId, tokenHash, deviceId || null, ip || null, (userAgent || '').slice(0, 255), TTL_DAYS]
  );
}

async function findActiveRefreshToken(tokenPlain) {
  const tokenHash = sha256(tokenPlain);
  const [[row]] = await db.query(
    `SELECT * FROM RefreshTokens
      WHERE token_hash = ?
        AND revoked_at IS NULL
        AND expires_at > UTC_TIMESTAMP()`,
    [tokenHash]
  );
  return row || null;
}

async function revokeRefreshToken({ tokenPlain, replacedByPlain = null }) {
  const tokenHash = sha256(tokenPlain);
  const replacedByHash = replacedByPlain ? sha256(replacedByPlain) : null;
  await db.query(
    `UPDATE RefreshTokens
       SET revoked_at = UTC_TIMESTAMP(), replaced_by = ?
     WHERE token_hash = ? AND revoked_at IS NULL`,
    [replacedByHash, tokenHash]
  );
}

module.exports = {
  randomToken,
  storeRefreshToken,
  findActiveRefreshToken,
  revokeRefreshToken,
  sha256,
  TTL_DAYS,
};