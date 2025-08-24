const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET   = process.env.JWT_SECRET;
const ACCESS_TTL   = process.env.JWT_ACCESS_TTL || '15m'; 
const ALGORITHMS   = ['HS256'];

function generateAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL, algorithm: 'HS256' });
}

/** Authorization 헤더에서 Bearer 토큰 또는 생 토큰 파싱 */
function extractToken(headerValue) {
  if (!headerValue) return null;
  const s = String(headerValue).trim();
  if (s.toLowerCase().startsWith('bearer ')) return s.slice(7).trim();
  return s;
}

/** Access 토큰 검증 미들웨어 */
function verifyToken(req, res, next) {
  const raw = req.headers['authorization'];
  const token = extractToken(raw);
  if (!token) return res.status(403).json({ message: '권한이 없습니다 (토큰 없음)' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ALGORITHMS });

    const userId = Number(decoded.userId);
    if (Number.isNaN(userId)) {
      return res.status(403).json({ message: 'userId가 숫자가 아닙니다', raw: decoded.userId });
    }
    req.user = { ...decoded, userId };
    return next();
  } catch (err) {
    return res.status(403).json({ message: '권한이 없습니다 (토큰 검증 실패)', detail: err.message });
  }
}

// 기존 코드와 호환 위해 alias 유지
const generateToken = generateAccessToken;

module.exports = {
  generateAccessToken,
  generateToken,
  verifyToken,
  extractToken,
};