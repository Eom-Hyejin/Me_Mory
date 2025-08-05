const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const authRouter = require('./router/authRouter');
app.use('/auth', authRouter);

// 서버 실행
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
