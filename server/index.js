const express = require('express');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const kakaoAuthRouter = require('./router/kakaoAuthRouter');
const naverAuthRouter = require('./router/naverAuthRouter');
const authRouter = require('./router/authRouter');
const recordRouter = require('./router/recordRouter');
const recordDraftRouter = require('./router/recordDraftRouter');
const emotionRouter = require('./router/emotionRouter');
const recallRouter = require('./router/recallRouter');
const mapRouter = require('./router/mapRouter');
const bluetoothRouter = require('./router/bluetoothRouter');

app.use('/auth', kakaoAuthRouter);
app.use('/auth', naverAuthRouter);
app.use('/auth', authRouter);
app.use('/record', recordRouter);
app.use('/record-drafts', recordDraftRouter);
app.use('/emotion', emotionRouter);
app.use('/recall', recallRouter);
app.use('/map', mapRouter);
app.use('/bluetooth', bluetoothRouter);

require('./jobs/recallNotifier');

// 서버 실행
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
