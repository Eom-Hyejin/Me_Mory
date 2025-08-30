const db = require('../../data/db');

// UserBleSettings(user_id PK, enabled TINYINT, last_enabled_at DATETIME)
async function getConsent(userId) {
  const [rows] = await db.query(
    'SELECT enabled, last_enabled_at FROM UserBleSettings WHERE user_id=?',
    [userId]
  );
  if (rows.length === 0) return { enabled: false, last_enabled_at: null };
  return { enabled: !!rows[0].enabled, last_enabled_at: rows[0].last_enabled_at };
}

async function setConsent(userId, enabled) {
  await db.query(`
    INSERT INTO UserBleSettings (user_id, enabled, last_enabled_at)
    VALUES (?, ?, CASE WHEN ?=1 THEN NOW() ELSE NULL END)
    ON DUPLICATE KEY UPDATE
      enabled=VALUES(enabled),
      last_enabled_at=CASE WHEN VALUES(enabled)=1 THEN NOW() ELSE last_enabled_at END
  `, [userId, enabled ? 1 : 0, enabled ? 1 : 0]);
}

module.exports = { getConsent, setConsent };
