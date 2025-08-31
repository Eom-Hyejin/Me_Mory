// server/router/kakaoAuthRouter.js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../data/db');
const { generateToken } = require('../util/jwt');
const { uploadImageFromUrl } = require('../util/uploadImageFromUrl');
const { randomToken, storeRefreshToken, TTL_DAYS } = require('../util/refresh');

require('dotenv').config();

const KAKAO_AUTH_URL = 'https://kauth.kakao.com';
const KAKAO_API_URL = 'https://kapi.kakao.com';

// 1) 카카오 로그인 URL로 리다이렉트
router.get('/kakao', (req, res) => {
  console.log('[KAKAO LOGIN REDIRECT]');
  const state = Math.random().toString(36).substring(2, 15); // 선택: CSRF 방지에 사용하려면 세션에 저장하고 콜백에서 검증
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
    console.log('[KAKAO CALLBACK]', { code, state });

    // 2-1) 토큰 발급 (가드 + 원문 로그)
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
      console.error('[KAKAO TOKEN HTTP ERROR]', e.response?.status, e.response?.data || e.message);
      return res.status(502).json({
        message: '카카오 토큰 발급 실패',
        detail: e.response?.data || e.message,
      });
    }

    if (!tokenRes.data?.access_token) {
      console.error('[KAKAO TOKEN ERROR]', tokenRes.status, tokenRes.data);
      return res.status(502).json({
        message: '카카오 토큰 발급 실패',
        detail: tokenRes.data?.error_description || 'No access_token in response',
      });
    }

    const accessToken = tokenRes.data.access_token;

    // 2-2) 사용자 정보 조회 (가드)
    let userRes;
    try {
      userRes = await axios.get(`${KAKAO_API_URL}/v2/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (e) {
      console.error('[KAKAO PROFILE HTTP ERROR]', e.response?.status, e.response?.data || e.message);
      return res.status(502).json({
        message: '카카오 프로필 조회 실패',
        detail: e.response?.data || e.message,
      });
    }

    const kakaoUser = userRes.data;
    const kakaoId = kakaoUser?.id;
    if (!kakaoId) {
      console.error('[KAKAO PROFILE PARSE ERROR]', userRes.data);
      return res.status(502).json({ message: '카카오 프로필 응답 형식 오류' });
    }

    // 널 세이프 파싱(프로필/닉네임 비공개인 계정 고려)
    const account = kakaoUser.kakao_account || {};
    const profile = account.profile || {};
    const nickname = profile.nickname || `카카오사용자${String(kakaoId).slice(-4)}`;
    const profileImg = profile.profile_image_url || null;
    // 주의: 실제 이메일을 쓰려면 이메일 제공 동의를 받아야 함 (kakao_account.email)
    const email = `kakao_${kakaoId}@kakao.com`;

    // 3) 이미지 S3 업로드 (실패해도 로그인은 진행)
    let uploadedImgUrl = null;
    if (profileImg) {
      try {
        uploadedImgUrl = await uploadImageFromUrl(profileImg);
      } catch (e) {
        console.warn('[PROFILE IMAGE UPLOAD WARN]', e.message || e);
      }
    }

    // 4) 사용자 존재 확인 및 생성/업데이트
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    let userId;
    let finalNickname = nickname;

    if (rows.length === 0) {
      // 닉네임 중복 방지
      let suffix = 1;
      let [check] = await db.query(
        'SELECT COUNT(*) as count FROM Users WHERE name = ?',
        [finalNickname]
      );
      while (check[0].count > 0) {
        finalNickname = `${nickname}${suffix}`;
        [check] = await db.query(
          'SELECT COUNT(*) as count FROM Users WHERE name = ?',
          [finalNickname]
        );
        suffix++;
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
        await db.query('UPDATE Users SET img = ? WHERE id = ?', [uploadedImgUrl, userId]);
      }
    }

    // 5) JWT 발급
    const refreshToken = randomToken(64);
    await storeRefreshToken({ userId, tokenPlain: refreshToken, ip: req.ip, userAgent: req.headers['user-agent'] });

    const token = generateToken({
      userId,
      name: finalNickname,
      type: 'kakao',
    });

    return res.json({
      message: '카카오 로그인 성공',
      token,
      refreshToken,
      userData: {
        userId,
        name: finalNickname,
        img: uploadedImgUrl,
        type: 'kakao',
      },
    });
  } catch (err) {
    console.error('[KAKAO LOGIN ERROR]', err?.response?.data || err.message);
    return res.status(500).json({
      message: '카카오 로그인 실패',
      detail: err?.response?.data || err.message,
    });
  }
});

module.exports = router;
