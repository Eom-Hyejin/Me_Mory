// server/router/kakaoAuthRouter.js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../data/db');
const { generateToken } = require('../util/jwt');
const { uploadImageFromUrl } = require('../util/uploadImageFromUrl');
const { randomToken, storeRefreshToken } = require('../util/refresh');

require('dotenv').config();

const KAKAO_AUTH_URL = 'https://kauth.kakao.com';
const KAKAO_API_URL  = 'https://kapi.kakao.com';

// 1) 카카오 로그인 URL로 리다이렉트
router.get('/kakao', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15); // (선택) CSRF 방지
  const redirectUri = process.env.KAKAO_REDIRECT_URI;
  const kakaoAuthUrl =
    `${KAKAO_AUTH_URL}/oauth/authorize` +
    `?response_type=code` +
    `&client_id=${process.env.KAKAO_REST_API_KEY}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  return res.redirect(kakaoAuthUrl);
});

// 2) 콜백 처리
router.get('/kakao/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    // 2-1) 토큰 발급
    let tokenRes;
    try {
      tokenRes = await axios.post(`${KAKAO_AUTH_URL}/oauth/token`, null, {
        params: {
          grant_type: 'authorization_code',
          client_id: process.env.KAKAO_REST_API_KEY,
          redirect_uri: process.env.KAKAO_REDIRECT_URI,
          code,
          client_secret: process.env.KAKAO_CLIENT_SECRET, // 콘솔에서 사용 설정 시 필수
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (e) {
      return res.status(502).json({ message: '카카오 토큰 발급 실패', detail: e.response?.data || e.message });
    }
    if (!tokenRes.data?.access_token) {
      return res.status(502).json({ message: '카카오 토큰 발급 실패', detail: tokenRes.data });
    }
    const accessToken = tokenRes.data.access_token;

    // 2-2) 사용자 정보 조회
    let userRes;
    try {
      userRes = await axios.get(`${KAKAO_API_URL}/v2/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (e) {
      return res.status(502).json({ message: '카카오 프로필 조회 실패', detail: e.response?.data || e.message });
    }

    const kakaoUser = userRes.data;
    const kakaoId = kakaoUser?.id;
    if (!kakaoId) return res.status(502).json({ message: '카카오 프로필 응답 형식 오류' });

    const account    = kakaoUser.kakao_account || {};
    const profile    = account.profile || {};
    const nickname   = profile.nickname || `카카오사용자${String(kakaoId).slice(-4)}`;
    const profileImg = profile.profile_image_url || null;
    const email      = `kakao_${kakaoId}@kakao.com`; // 이메일 동의 미수집 가정

    // 3) 프로필 이미지 S3 업로드 (실패 무시)
    let uploadedImgUrl = null;
    if (profileImg) {
      try { uploadedImgUrl = await uploadImageFromUrl(profileImg); } catch (_) {}
    }

    // 4) 사용자 upsert
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    let userId;
    let finalNickname = nickname;

    if (rows.length === 0) {
      // 닉네임 중복 방지
      let suffix = 1;
      let [check] = await db.query('SELECT COUNT(*) AS count FROM Users WHERE name=?', [finalNickname]);
      while (check[0].count > 0) {
        finalNickname = `${nickname}${suffix++}`;
        [check] = await db.query('SELECT COUNT(*) AS count FROM Users WHERE name=?', [finalNickname]);
      }
      const [result] = await db.query(
        'INSERT INTO Users (email, password, name, type, img) VALUES (?, ?, ?, ?, ?)',
        [email, '', finalNickname, 'kakao', uploadedImgUrl]
      );
      userId = result.insertId;
    } else {
      userId = rows[0].id;
      finalNickname = rows[0].name;
      if (!rows[0].img && uploadedImgUrl) {
        await db.query('UPDATE Users SET img=? WHERE id=?', [uploadedImgUrl, userId]);
      }
    }

    // 5) JWT/리프레시 발급 → 성공 페이지로 리다이렉트
    const refreshToken = randomToken(64);
    await storeRefreshToken({ userId, tokenPlain: refreshToken, ip: req.ip, userAgent: req.headers['user-agent'] });

    const token = generateToken({ userId, name: finalNickname, type: 'kakao' });

    const qs = new URLSearchParams({ token, refreshToken, name: finalNickname }).toString();
    return res.redirect(`/login_success.html?${qs}`);
  } catch (err) {
    return res.status(500).json({ message: '카카오 로그인 실패', detail: err?.response?.data || err.message });
  }
});

module.exports = router;
