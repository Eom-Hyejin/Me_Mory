// server/router/naverAuthRouter.js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../data/db');
const { generateToken } = require('../util/jwt');
const { uploadImageFromUrl } = require('../util/uploadImageFromUrl');
const { randomToken, storeRefreshToken, TTL_DAYS } = require('../util/refresh');

require('dotenv').config();

const NAVER_AUTH_URL = 'https://nid.naver.com/oauth2.0';
const NAVER_API_URL = 'https://openapi.naver.com/v1/nid/me';

// 1) 네이버 로그인 URL로 리다이렉트
router.get('/naver', (req, res) => {
  console.log('[NAVER LOGIN REDIRECT]');
  const state = Math.random().toString(36).substring(2, 15);
  const naverLoginUrl =
    `${NAVER_AUTH_URL}/authorize` +
    `?response_type=code` +
    `&client_id=${process.env.NAVER_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.NAVER_REDIRECT_URI)}` +
    `&state=${state}`;
  return res.redirect(naverLoginUrl);
});

// 2) 콜백 처리
router.get('/naver/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    console.log('[NAVER CALLBACK]', { code, state });

    // 2-1) 토큰 발급 (POST + form-params 권장, 가드 추가)
    let tokenRes;
    try {
      tokenRes = await axios.post(`${NAVER_AUTH_URL}/token`, null, {
        params: {
          grant_type: 'authorization_code',
          client_id: process.env.NAVER_CLIENT_ID,
          client_secret: process.env.NAVER_CLIENT_SECRET,
          code,
          state,
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch (e) {
      console.error('[NAVER TOKEN HTTP ERROR]', e.response?.status, e.response?.data || e.message);
      return res.status(502).json({
        message: '네이버 토큰 발급 실패',
        detail: e.response?.data || e.message,
      });
    }

    if (!tokenRes.data || !tokenRes.data.access_token) {
      console.error('[NAVER TOKEN ERROR]', tokenRes.status, tokenRes.data);
      return res.status(502).json({
        message: '네이버 토큰 발급 실패',
        detail: tokenRes.data?.error_description || 'No access_token in response',
      });
    }

    const accessToken = tokenRes.data.access_token;

    // 2-2) 사용자 정보 조회 (명시적 try/catch)
    let profileRes;
    try {
      profileRes = await axios.get(NAVER_API_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (e) {
      console.error('[NAVER PROFILE ERROR]', e.response?.status, e.response?.data || e.message);
      return res.status(502).json({
        message: '네이버 프로필 조회 실패',
        detail: e.response?.data || e.message,
      });
    }

    const naverUser = profileRes.data?.response;
    if (!naverUser?.id) {
      console.error('[NAVER PROFILE PARSE ERROR]', profileRes.data);
      return res.status(502).json({ message: '네이버 프로필 응답 형식 오류' });
    }

    const naverId = naverUser.id;
    const nickname = naverUser.nickname || naverUser.name || '네이버사용자';
    const profileImg = naverUser.profile_image;
    const email = `naver_${naverId}@naver.com`; // 실제 이메일 제공 동의 스코프 수집 시 교체 가능

    // 3) 프로필 이미지 S3 업로드 (실패해도 로그인은 성공시키도록 격리)
    let uploadedImgUrl = null;
    if (profileImg) {
      try {
        uploadedImgUrl = await uploadImageFromUrl(profileImg);
      } catch (e) {
        console.warn('[PROFILE IMAGE UPLOAD WARN]', e.message || e);
        uploadedImgUrl = null;
      }
    }

    // 4) 사용자 존재 여부 확인
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
        [email, '', finalNickname, 'naver', uploadedImgUrl]
      );
      userId = result.insertId;
    } else {
      userId = rows[0].id;
      finalNickname = rows[0].name;
      // 기존 유저인데 기존 img가 없고 이번에 업로드에 성공했으면 업데이트(선택)
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
      type: 'naver',
    });

    return res.json({
      message: '네이버 로그인 성공',
      token,
      refreshToken,
      userData: {
        userId,
        name: finalNickname,
        img: uploadedImgUrl,
        type: 'naver',
      },
    });
  } catch (err) {
    console.error('[NAVER LOGIN ERROR]', err?.response?.data || err.message);
    return res.status(500).json({
      message: '네이버 로그인 실패',
      detail: err?.response?.data || err.message,
    });
  }
});

module.exports = router;