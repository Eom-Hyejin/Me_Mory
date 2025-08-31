const cron = require('node-cron');
const db = require('../data/db');

async function sendRecallNotification({ userId, records6, records12 }) {
  // TODO: 푸시나 앱내 알림으로 보내기
  // 예: console.log(`[NOTIFY] user=${userId} 6M=${records6.length} 12M=${records12.length}`);
}

async function runOnce() {
  // 오늘 날짜 기준으로 6개월/1년 전 “딱 오늘 날짜에 작성된” 본인 기록
  // + 아직 회고하지 않은 것만 알림(선호) — 필요 없으면 ur 조건 제거
  const [due] = await db.query(
    `
    SELECT r.userId,
           SUM(CASE WHEN DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL 6 MONTH)) THEN 1 ELSE 0 END) AS c6,
           SUM(CASE WHEN DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL 12 MONTH)) THEN 1 ELSE 0 END) AS c12
    FROM Records r
    LEFT JOIN Users_Rec ur ON ur.recId = r.id AND ur.userId = r.userId
    WHERE ur.id IS NULL  -- 미회고만 알림 (정책에 따라 제거해도 됨)
      AND (
            DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL 6 MONTH))
         OR DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL 12 MONTH))
      )
    GROUP BY r.userId
    HAVING c6 > 0 OR c12 > 0
    `
  );

  for (const row of due) {
    const userId = row.userId;

    const [[sixRows], [oneRows]] = await Promise.all([
      db.query(
        `
        SELECT r.id AS recordId, r.title, r.created_at
        FROM Records r
        LEFT JOIN Users_Rec ur ON ur.recId = r.id AND ur.userId = r.userId
        WHERE r.userId = ?
          AND ur.id IS NULL
          AND DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL 6 MONTH))
        ORDER BY r.created_at DESC
        `,
        [userId]
      ),
      db.query(
        `
        SELECT r.id AS recordId, r.title, r.created_at
        FROM Records r
        LEFT JOIN Users_Rec ur ON ur.recId = r.id AND ur.userId = r.userId
        WHERE r.userId = ?
          AND ur.id IS NULL
          AND DATE(r.created_at) = DATE(DATE_SUB(CURDATE(), INTERVAL 12 MONTH))
        ORDER BY r.created_at DESC
        `,
        [userId]
      ),
    ]);

    await sendRecallNotification({
      userId,
      records6: sixRows,
      records12: oneRows,
    });
  }
}

// 매일 09:00 Asia/Seoul
cron.schedule('0 9 * * *', () => {
  runOnce().catch((e) => console.error('[recallNotifier cron error]', e));
}, { timezone: 'Asia/Seoul' });

// 즉시 1회 실행하고 싶으면 아래 주석 해제
// runOnce().catch(console.error);

module.exports = { runOnce };