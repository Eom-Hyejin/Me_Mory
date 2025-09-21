// server/index.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true })); // 같은 도메인이면 제거해도 OK
app.use(express.json({ limit: '10mb' }));

/* ================== 라우터 등록 (호환 + /api 프리픽스) ================== */
const mount = (base, router) => {
  app.use(`/${base}`, router);        // 기존 경로 호환:  /auth, /record, ...
  app.use(`/api/${base}`, router);    // 신경로 권장:    /api/auth, /api/record, ...
};

mount('auth',            require('./router/kakaoAuthRouter'));
mount('auth',            require('./router/naverAuthRouter'));
mount('auth',            require('./router/authRouter'));
mount('record',          require('./router/recordRouter'));
mount('record-drafts',   require('./router/recordDraftRouter'));
mount('emotion',         require('./router/emotionRouter'));
mount('recall',          require('./router/recallRouter'));
mount('map',             require('./router/mapRouter'));
mount('bluetooth',       require('./router/bluetoothRouter'));
mount('notices',         require('./router/noticeRouter'));
mount('records',         require('./router/recordCommentRouter'));

// 리콜 알림 스케줄러 등 부수 기능
require('./util/recallNotifier');

// Health for ALB
app.get(['/health', '/api/health'], (req, res) => res.status(200).send('ok'));

/* ================== 정적 파일 서빙 ================== */
const staticDir = path.join(__dirname, '../client/build');
app.use(express.static(staticDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});
/* ================== 서버 시작 ================== */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
