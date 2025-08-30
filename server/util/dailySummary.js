const incStatSql = (col) => `
  INSERT INTO Emotion_Stats (userId, \`year_month\`, \`${col}\`)
  VALUES (?, ?, 1)
  ON DUPLICATE KEY UPDATE \`${col}\` = \`${col}\` + 1
`;
const decStatSql = (col) => `
  UPDATE Emotion_Stats
  SET \`${col}\` = GREATEST(\`${col}\` - 1, 0)
  WHERE userId = ? AND \`year_month\` = ?
`;

/**
 * 날짜별 대표 감정(모드) 계산 후 EmotionCalendar/Emotion_Stats 동기화
 * - 모드 산정: emotion_type별 count DESC, 동률이면 최신 created_at 가진 감정을 선택
 * - 존재 기록이 0이면 EmotionCalendar 삭제 및 Emotion_Stats에서 그 날의 기존 대표 감정 -1
 * @param {PoolConnection} conn  // 트랜잭션 내 커넥션
 * @param {number} userId
 * @param {string} dateStr  // 'YYYY-MM-DD'
 */
async function recomputeDailySummary(conn, userId, dateStr) {
  const yearMonth = dateStr.slice(0,7);

  // 기존 대표 감정(있다면)
  const [[existing]] = await conn.query(
    `SELECT emotion_type FROM EmotionCalendar WHERE userId=? AND date=?`,
    [userId, dateStr]
  );

  // 그날의 전체 기록에서 모드 계산
  const [counts] = await conn.query(
    `SELECT emotion_type, COUNT(*) AS cnt, MAX(created_at) AS last_at
       FROM Records
      WHERE userId=? AND DATE(created_at)=?
      GROUP BY emotion_type
      ORDER BY cnt DESC, last_at DESC
      LIMIT 1`,
    [userId, dateStr]
  );

  if (counts.length === 0) {
    // 기록이 하나도 없으면 캘린더 행 삭제 + 통계에서 기존 대표 -1
    if (existing) {
      await conn.query(
        decStatSql(`count_${existing.emotion_type}`),
        [userId, yearMonth]
      );
      await conn.query(
        `DELETE FROM EmotionCalendar WHERE userId=? AND date=?`,
        [userId, dateStr]
      );
    }
    return;
  }

  const newEmotion = counts[0].emotion_type;

  // 대표 감정으로 캘린더 UPSERT (expression_type은 가장 최신 기록의 표현값으로)
  const [[latest]] = await conn.query(
    `SELECT expression_type
       FROM Records
      WHERE userId=? AND DATE(created_at)=? AND emotion_type=?
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [userId, dateStr, newEmotion]
  );
  const newExpr = latest ? latest.expression_type : null;

  await conn.query(
    `INSERT INTO EmotionCalendar (userId, date, emotion_type, expression_type)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       emotion_type=VALUES(emotion_type),
       expression_type=VALUES(expression_type)`,
    [userId, dateStr, newEmotion, newExpr]
  );

  // 통계 조정(월별: 그날 대표가 바뀌었을 때만 이동)
  const beforeEmotion = existing ? existing.emotion_type : null;
  if (!beforeEmotion) {
    await conn.query(incStatSql(`count_${newEmotion}`), [userId, yearMonth]);
  } else if (beforeEmotion !== newEmotion) {
    await conn.query(decStatSql(`count_${beforeEmotion}`), [userId, yearMonth]);
    await conn.query(incStatSql(`count_${newEmotion}`), [userId, yearMonth]);
  }
}

module.exports = { recomputeDailySummary };