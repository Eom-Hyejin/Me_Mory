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

    // 명시적으로 userId 매핑 및 정수형 변환
    req.user = {
      userId: Number(decoded.userId),  // 또는 Number(decoded.id) 로 fallback 가능
    };

    if (isNaN(req.user.userId)) {
      return res.status(403).json({ message: 'userId가 유효하지 않습니다' });
    }

    next();
  } catch (err) {
    return res.status(403).json({ message: '권한이 없습니다 (토큰 검증 실패)', detail: err.message });
  }
};

module.exports = { generateToken, verifyToken };
