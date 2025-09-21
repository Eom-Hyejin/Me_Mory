// server/router/naverAuthRouter.js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const db = require('../data/db');
const { generateToken } = require('../util/jwt');
const { uploadImageFromUrl } = require('../util/uploadImageFromUrl');
const { randomToken, storeRefreshToken } = require('../util/refresh');

require('dotenv').config();

const NAVER_AUTH_URL = 'https://nid.naver.com/oauth2.0';
const NAVER_API_URL  = 'https://openapi.naver.com/v1/nid/me';

// 1) 네이버 로그인 URL 리다이렉트
router.get('/naver', (req, res) => {
  const state = Math.random().toString(36).substring(2, 15);
  const url =
    `${NAVER_AUTH_URL}/authorize` +
    `?response_type=code` +
    `&client_id=${process.env.NAVER_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.NAVER_REDIRECT_URI)}` +
    `&state=${state}`;
  return res.redirect(url);
});

// 2) 콜백
router.get('/naver/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    // 2-1) 토큰
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
      return res.status(502).json({ message: '네이버 토큰 발급 실패', detail: e.response?.data || e.message });
    }
    if (!tokenRes.data?.access_token) {
      return res.status(502).json({ message: '네이버 토큰 발급 실패', detail: tokenRes.data });
    }
    const accessToken = tokenRes.data.access_token;

    // 2-2) 프로필
    let profileRes;
    try {
      profileRes = await axios.get(NAVER_API_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (e) {
      return res.status(502).json({ message: '네이버 프로필 조회 실패', detail: e.response?.data || e.message });
    }

    const naverUser = profileRes.data?.response;
    if (!naverUser?.id) return res.status(502).json({ message: '네이버 프로필 응답 형식 오류' });

    const naverId    = naverUser.id;
    const nickname   = naverUser.nickname || naverUser.name || '네이버사용자';
    const profileImg = naverUser.profile_image;
    const email      = `naver_${naverId}@naver.com`;

    // 3) 프로필 이미지 업로드(실패 무시)
    let uploadedImgUrl = null;
    if (profileImg) {
      try { uploadedImgUrl = await uploadImageFromUrl(profileImg); } catch (_) {}
    }

    // 4) 사용자 upsert
    const [rows] = await db.query('SELECT * FROM Users WHERE email = ?', [email]);

    let userId;
    let finalNickname = nickname;

    if (rows.length === 0) {
      let suffix = 1;
      let [check] = await db.query('SELECT COUNT(*) AS count FROM Users WHERE name=?', [finalNickname]);
      while (check[0].count > 0) {
        finalNickname = `${nickname}${suffix++}`;
        [check] = await db.query('SELECT COUNT(*) AS count FROM Users WHERE name=?', [finalNickname]);
      }
      const [result] = await db.query(
        'INSERT INTO Users (email, password, name, type, img) VALUES (?, ?, ?, ?, ?)',
        [email, '', finalNickname, 'naver', uploadedImgUrl]
      );
      userId = result.insertId;
    } else {
      userId = rows[0].id;
      finalNickname = rows[0].name;
      if (!rows[0].img && uploadedImgUrl) {
        await db.query('UPDATE Users SET img=? WHERE id=?', [uploadedImgUrl, userId]);
      }
    }

    // 5) JWT/리프레시 발급 → 성공 페이지 리다이렉트
    const refreshToken = randomToken(64);
    await storeRefreshToken({ userId, tokenPlain: refreshToken, ip: req.ip, userAgent: req.headers['user-agent'] });

    const token = generateToken({ userId, name: finalNickname, type: 'naver' });

    const qs = new URLSearchParams({ token, refreshToken, name: finalNickname }).toString();
    return res.redirect(`/login_success.html?${qs}`);
  } catch (err) {
    return res.status(500).json({ message: '네이버 로그인 실패', detail: err?.response?.data || err.message });
  }
});

module.exports = router;
