const express = require('express');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const authRouter = require('./router/authRouter');
const kakaoAuthRouter = require('./router/kakaoAuthRouter');

app.use('/auth', authRouter);
app.use('/auth', kakaoAuthRouter);

// 서버 실행
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
