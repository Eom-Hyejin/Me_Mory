const express = require('express');
const router = express.Router();
const db = require('../data/db');
const bcrypt = require('bcrypt');
const { generateToken, verifyToken } = require('../util/jwt');

// 🔐 회원가입 (웹 회원가입)
router.post('/', async (req, res) => {
  try {
    const { email, password, name, type = 'web', img = null } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ message: '회원가입 실패: 필수 항목 누락' });
    }

    // 이메일 중복 체크
    const [emailCheck] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);
    if (emailCheck.length > 0) {
      return res.status(409).json({ message: '이미 존재하는 이메일입니다' });
    }

    // 닉네임 중복 체크
    let finalName = name;
    let suffix = 1;
    let [nickCheck] = await db.query('SELECT COUNT(*) as count FROM Users WHERE name = ?', [finalName]);
    while (nickCheck[0].count > 0) {
      finalName = `${name}${suffix}`;
      [nickCheck] = await db.query('SELECT COUNT(*) as count FROM Users WHERE name = ?', [finalName]);
      suffix++;
    }

    const hashedPw = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO Users (email, password, name, type, img) VALUES (?, ?, ?, ?, ?)',
      [email, hashedPw, finalName, type, img]
    );

    return res.status(201).json({ userId: result.insertId });

  } catch (err) {
    console.error(err);
    res.status(400).json({ message: '회원가입 실패', detail: err.message });
  }
});

// 🔐 로그인 (웹 로그인)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(400).json({ message: '이메일이나 비밀번호가 틀립니다' });
    }

    const user = rows[0];
    const pwMatch = await bcrypt.compare(password, user.password);
    if (!pwMatch) {
      return res.status(400).json({ message: '이메일이나 비밀번호가 틀립니다' });
    }

    const token = generateToken({ userId: user.id, name: user.name, type: user.type });

    return res.status(200).json({
      token,
      userdata: {
        userId: user.id,
        email: user.email,
        name: user.name,
        img: user.img,
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '로그인 실패', detail: err.message });
  }
});

// 🙋🏻‍♀️ 내 정보 조회 (토큰 기반)
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await db.query(
      'SELECT id AS userId, name, img, type FROM Users WHERE id = ?', [userId]
    );

    if (rows.length === 0) return res.status(403).json({ message: '권한이 없습니다' });

    res.status(200).json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: '서버 오류', detail: err.message });
  }
});

// 🙋🏻‍♀️ 마이페이지에서 특정 유저 정보 조회
router.get('/:userId', verifyToken, async (req, res) => {
  try {
    const myUserId = req.user.userId;
    const targetUserId = parseInt(req.params.userId);

    if (isNaN(targetUserId)) {
      return res.status(400).json({ message: '잘못된 요청입니다' });
    }

    const [[profileData], [userData]] = await Promise.all([
      db.query('SELECT id AS userId, name, img FROM Users WHERE id = ?', [targetUserId]),
      db.query('SELECT id AS userId, name, img FROM Users WHERE id = ?', [myUserId]),
    ]);

    if (!profileData.length) {
      return res.status(400).json({ message: '잘못된 요청입니다' });
    }

    res.status(200).json({
      profileData: profileData[0],
      userData: userData[0],
    });

  } catch (err) {
    res.status(500).json({ message: '서버 오류', detail: err.message });
  }
});

// 📧 이메일 중복 확인
router.post('/email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: '이메일은 필수입니다' });

  const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);
  if (rows.length > 0) {
    return res.status(409).json({ message: '이미 존재하는 이메일입니다' });
  }

  res.status(200).json({ message: '사용 가능한 이메일입니다' });
});

// 🧑🏻 닉네임 중복 확인
router.post('/nickname', async (req, res) => {
  const { nickname } = req.body;
  if (!nickname) return res.status(400).json({ message: '닉네임은 필수입니다' });

  const [rows] = await db.query('SELECT * FROM Users WHERE name = ?', [nickname]);
  if (rows.length > 0) {
    return res.status(409).json({ message: '이미 존재하는 닉네임입니다' });
  }

  res.status(200).json({ message: '사용 가능한 닉네임입니다' });
});

// 🧾 소셜 회원가입 or 로그인 처리
router.post('/social', async (req, res) => {
  try {
    const { id, name, type } = req.body;

    if (!id || !name || !type) {
      return res.status(400).json({ message: '필수 정보가 누락되었습니다' });
    }

    const email = `${type}_${id}@${type}.com`;
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    let userId;
    let finalName = name;
    let img = null;

    if (rows.length === 0) {
      let suffix = 1;
      let [check] = await db.query('SELECT COUNT(*) as count FROM Users WHERE name = ?', [finalName]);

      while (check[0].count > 0) {
        finalName = `${name}${suffix}`;
        [check] = await db.query('SELECT COUNT(*) as count FROM Users WHERE name = ?', [finalName]);
        suffix++;
      }

      const [result] = await db.query(
        'INSERT INTO Users (email, password, name, type) VALUES (?, ?, ?, ?)',
        [email, '', finalName, type]
      );
      userId = result.insertId;
    } else {
      userId = rows[0].id;
      finalName = rows[0].name;
      img = rows[0].img;
    }

    const token = generateToken({ userId, name: finalName, type });

    return res.status(201).json({
      token,
      userdata: { userId, name: finalName, img, type },
    });

  } catch (err) {
    console.error(err);
    res.status(400).json({ message: '회원가입 실패', detail: err.message });
  }
});

module.exports = router;
