// ===== app.js =====
const API_BASE = '/api';
const TOKEN_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';

// 토큰
const Auth = {
  get(){ return localStorage.getItem(TOKEN_KEY); },
  set(a){ localStorage.setItem(TOKEN_KEY, a); },
  setRefresh(r){ localStorage.setItem(REFRESH_KEY, r || ''); },
  clear(){ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY); },
  loggedIn(){ return !!localStorage.getItem(TOKEN_KEY); }
};

// fetch 래퍼
async function apiFetch(path, opts = {}) {
  const headers = opts.headers || {};
  const token = Auth.get();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!opts.headers) opts.headers = headers;

  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401 || res.status === 403) {
    // 필요 시 refresh 로직: 서버에 /api/auth/refresh 있으면 주석 해제해서 사용
    // const ok = await tryRefresh();
    // if (ok) return apiFetch(path, opts);
    Auth.clear();
    // 로그인 필요 페이지에서는 로그인으로 보냄 (없는 페이지면 주석)
    // location.href = '/login_01.html';
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// (옵션) refresh
async function tryRefresh(){
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const r = await fetch(`${API_BASE}/auth/refresh`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ refreshToken })
    });
    if (!r.ok) return false;
    const j = await r.json();
    Auth.set(j.accessToken);
    if (j.refreshToken) Auth.setRefresh(j.refreshToken);
    return true;
  } catch { return false; }
}

// ---- 페이지별 훅(필요한 것만 동작) ----
document.addEventListener('DOMContentLoaded', () => {
  // 1) 로그인 버튼 (헤더의 "로그인"에 id="btn-login" 달아두면 작동)
  const btnLogin = document.getElementById('btn-login');
  if (btnLogin) btnLogin.addEventListener('click', async (e) => {
    e.preventDefault();
    // 데모: 테스트용 고정 계정 (실제에 맞게 수정)
    const email = document.getElementById('email')?.value || 'test@example.com';
    const password = document.getElementById('password')?.value || 'test1234';
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email, password })
      });
      const j = await res.json();
      if (!res.ok) {
        console.log(j.message || '로그인 실패');
        return;
      }
      Auth.set(j.accessToken);
      if (j.refreshToken) Auth.setRefresh(j.refreshToken);
      console.log('로그인 성공!');
      // 필요 시 이동
      // location.href = '/emotion_calendar.html';
    } catch { 
      console.error('서버 오류'); 
    }
  });

  // 2) 메인 이모지(감정 선택) 핸들링
  document.querySelectorAll('[data-emotion]').forEach(el => {
    el.addEventListener('click', async () => {
      const emotion = el.getAttribute('data-emotion');
      if (!Auth.loggedIn()) { 
        console.log('로그인이 필요합니다'); 
        return; 
      }
      try {
        await apiFetch('/record-drafts', {
          method:'PUT',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ step:'emotion', value: emotion })
        });
        // 필요하다면 다음 페이지 이동:
        // location.href = '/emotion_text.html';
        console.log("선택한 감정:", emotion);
      } catch (e) {
        console.error('기록 저장 실패', e);
      }
    });
  });

  // 3) “감정기록 작성하기” 버튼(id="btn-write")
  const btnWrite = document.getElementById('btn-write');
  if (btnWrite) btnWrite.addEventListener('click', () => {
    if (!Auth.loggedIn()) { 
      console.log('로그인이 필요합니다'); 
      return; 
    }
    location.href = '/emotion_text.html'; // 다음 단계 페이지로 이동
  });

  // 4) 최근 기록/공지 리스트 자동 로드 (특정 영역 존재 시만)
  const recentArea = document.getElementById('recent-emotions');
  if (recentArea && Auth.loggedIn()) {
    apiFetch('/record?mine=true')
      .then(list => {
        if (!Array.isArray(list)) return;
        recentArea.innerHTML = list.slice(0,6).map(r => `
          <li class="recent-item">
            <span>${r.emotion_type || '감정'}</span>
            <span>${(r.created_at||'').slice(0,10)}</span>
          </li>`).join('');
      })
      .catch(()=> recentArea.innerHTML = '<li>불러오기 실패</li>');
  }
});

// 전역 노출(디버깅용)
window.APP = { apiFetch, Auth };