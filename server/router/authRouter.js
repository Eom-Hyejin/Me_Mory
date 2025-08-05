const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../data/db');
const { generateToken } = require('../util/jwt');
const { uploadImageFromUrl } = require('../util/uploadImageFromUrl'); 
require('dotenv').config();

const KAKAO_AUTH_URL = 'https://kauth.kakao.com';
const KAKAO_API_URL = 'https://kapi.kakao.com';

router.get('/kakao', (req, res) => {
  const redirectUri = process.env.KAKAO_REDIRECT_URI;
  const kakaoAuthUrl = `${KAKAO_AUTH_URL}/oauth/authorize?response_type=code&client_id=${process.env.KAKAO_REST_API_KEY}&redirect_uri=${redirectUri}`;
  return res.redirect(kakaoAuthUrl);
});

router.get('/kakao/callback', async (req, res) => {
  try {
    const code = req.query.code;

    // 1. 카카오 토큰 발급
    const tokenRes = await axios.post(`${KAKAO_AUTH_URL}/oauth/token`, null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.KAKAO_REST_API_KEY,
        redirect_uri: process.env.KAKAO_REDIRECT_URI,
        code,
        client_secret: process.env.KAKAO_CLIENT_SECRET,
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const accessToken = tokenRes.data.access_token;

    // 2. 사용자 정보 조회
    const userRes = await axios.get(`${KAKAO_API_URL}/v2/user/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const kakaoUser = userRes.data;
    const kakaoId = kakaoUser.id;
    const nickname = kakaoUser.kakao_account.profile.nickname;
    const profileImg = kakaoUser.kakao_account.profile.profile_image_url;
    const email = `kakao_${kakaoId}@kakao.com`;

    // 3. 이미지 S3 업로드
    const uploadedImgUrl = await uploadImageFromUrl(profileImg);

    // 4. 사용자 존재 확인
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

      // 신규 사용자 등록
      const [result] = await db.query(
        'INSERT INTO Users (email, password, name, type, img) VALUES (?, ?, ?, ?, ?)',
        [email, '', finalNickname, 'kakao', uploadedImgUrl]
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
      type: 'kakao',
    });

    return res.json({
      message: '카카오 로그인 성공',
      token,
      userData: {
        userId,
        name: finalNickname,
        img: uploadedImgUrl,
        type: 'kakao',
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: '카카오 로그인 실패', detail: err.message });
  }
});

module.exports = router;