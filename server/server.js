require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 라우트 예시
app.get('/', (req, res) => {
  res.send('Emotion Server is running!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
