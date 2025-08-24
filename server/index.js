const express = require('express');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const authRouter = require('./router/authRouter');
const kakaoAuthRouter = require('./router/kakaoAuthRouter');
const naverAuthRouter = require('./router/naverAuthRouter');
const recordRouter = require('./router/recordRouter');
const emotionRouter = require('./router/emotionRouter');
const recallRouter = require('./router/recallRouter');
const mapRouter = require('./router/mapRouter');

app.use('/auth', authRouter);
app.use('/auth', kakaoAuthRouter);
app.use('/auth/naver', naverAuthRouter);
app.use('/record', recordRouter);
app.use('/emotion', emotionRouter);
app.use('/recall', recallRouter);
app.use('/map', mapRouter);

// 서버 실행
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
