const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }); // 7일 유효
};

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ message: '권한이 없습니다 (토큰 없음)' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const userId = Number(decoded.userId);
    if (isNaN(userId)) {
      return res.status(403).json({ message: 'userId가 숫자가 아닙니다', raw: decoded.userId });
    }

    req.user = { userId };
    next();
  } catch (err) {
    return res.status(403).json({ message: '권한이 없습니다 (토큰 검증 실패)', detail: err.message });
  }
};

module.exports = { generateToken, verifyToken };
