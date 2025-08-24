const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../data/db');
const { generateToken } = require('../util/jwt');
const { uploadImageFromUrl } = require('../util/uploadImageFromUrl'); 
require('dotenv').config();

const NAVER_AUTH_URL = 'https://nid.naver.com/oauth2.0';
const NAVER_API_URL = 'https://openapi.naver.com/v1/nid/me';

// 1. 네이버 로그인 URL로 리다이렉트
router.get('/', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const naverLoginUrl = `${NAVER_AUTH_URL}/authorize?response_type=code&client_id=${process.env.NAVER_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.NAVER_REDIRECT_URI)}&state=${state}`;
  return res.redirect(naverLoginUrl);
});

// 2. 콜백 처리
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    // 2-1. 토큰 발급
    const tokenRes = await axios.get(`${NAVER_AUTH_URL}/token`, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.NAVER_CLIENT_ID,
        client_secret: process.env.NAVER_CLIENT_SECRET,
        code,
        state
      }
    });

    const accessToken = tokenRes.data.access_token;

    // 2-2. 사용자 정보 조회
    const profileRes = await axios.get(NAVER_API_URL, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const naverUser = profileRes.data.response;
    const naverId = naverUser.id;
    const nickname = naverUser.nickname || naverUser.name || '네이버사용자';
    const profileImg = naverUser.profile_image;
    const email = `naver_${naverId}@naver.com`;

    // 3. 프로필 이미지 S3 업로드
    const uploadedImgUrl = profileImg
      ? await uploadImageFromUrl(profileImg)
      : null;

    // 4. 사용자 존재 여부 확인
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    let userId;
    let finalNickname = nickname;

    if (rows.length === 0) {
      // 닉네임 중복 방지
      let suffix = 1;
      let [check] = await db.query('SELECT COUNT(*) as count FROM Users WHERE name = ?', [finalNickname]);

      while (check[0].count > 0) {
        finalNickname = `${nickname}${suffix}`;
        [check] = await db.query('SELECT COUNT(*) as count FROM Users WHERE name = ?', [finalNickname]);
        suffix++;
      }

      const [result] = await db.query(
        'INSERT INTO Users (email, password, name, type, img) VALUES (?, ?, ?, ?, ?)',
        [email, '', finalNickname, 'naver', uploadedImgUrl]
      );
      userId = result.insertId;
    } else {
      userId = rows[0].id;
      finalNickname = rows[0].name;
    }

    // 5. JWT 발급
    const token = generateToken({
      userId,
      name: finalNickname,
      type: 'naver',
    });

    return res.json({
      message: '네이버 로그인 성공',
      token,
      userData: {
        userId,
        name: finalNickname,
        img: uploadedImgUrl,
        type: 'naver',
      }
    });

  } catch (err) {
    console.error('[NAVER LOGIN ERROR]', err?.response?.data || err.message);
    return res.status(500).json({ message: '네이버 로그인 실패', detail: err.message });
  }
});

module.exports = router;
