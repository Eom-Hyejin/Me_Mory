(function () {
  const API_BASE = '/api';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ====== Auth helpers ======
  function getAccessToken() {
    return localStorage.getItem('accessToken') || '';
  }

  function isLoggedIn() {
    // 서버에서 만료 검증하므로 프론트는 토큰 존재만 체크 (만료 시 API가 401을 돌려줌)
    return !!getAccessToken();
  }

  async function hasBleConsent() {
    const token = getAccessToken();
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE}/bluetooth/consent`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      // { enabled: 0|1, last_enabled_at: ... } 형식 가정
      return !!(data && (data.enabled === 1 || data.enabled === true));
    } catch (e) {
      return false;
    }
  }

  function go(url) {
    window.location.href = url;
  }

  function logout(redirectTo = '/login_01.html') {
    try {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    } catch (e) {}
    go(redirectTo);
  }

  // ====== Nav handler ======
  async function handleNav(e) {
    // a 태그 기본 이동 막고 JS로 라우팅
    e.preventDefault();

    const key = this.getAttribute('data-nav');

    // 로그인/회원가입은 무조건 해당 페이지로
    if (key === 'login')    return go('/login_01.html');
    if (key === 'register') return go('/register_01.html');

    // 비로그인 → 전부 로그인 페이지로
    if (!isLoggedIn()) return go('/login_01.html');

    // 로그인 상태에서 각 메뉴 분기
    switch (key) {
      case 'record':
        return go('/emotion_select_01.html');
      case 'calendar':
        return go('/emotion_calendar.html');
      case 'map':
        return go('/emotion_map.html');
      case 'memory':
        return go('/emotion_memory.html');
      case 'around': {
        const ok = await hasBleConsent();
        return go(ok ? '/emotion_arround_check_01.html' : '/emotion_arround_bluetooth.html');
      }
    }
  }

  // ====== Bind events once DOM is ready ======
  function bindHeaderEvents() {
    // 상단 카테고리/우측 메뉴(모바일) 모두 data-nav 로 통합 제어
    $$( '[data-nav]' ).forEach(a => {
      // 시각적으로도 포인터
      a.style.cursor = 'pointer';
      // 중복 바인딩 방지
      a.removeEventListener('click', handleNav);
      a.addEventListener('click', handleNav);
    });

    // 로고 클릭: 홈으로
    const logoLink = $('.header-logo a');
    if (logoLink) {
      logoLink.addEventListener('click', function (e) {
        // index.html 혹은 intro.html 등, 프로젝트 기준 홈으로 이동
        // 서버에서 기본 라우팅을 intro.html로 잡아놨다면 '/' 로 두면 됩니다.
        e.preventDefault();
        go('/');
      });
    }
  }

  // ====== Public API on window ======
  window.Header = {
    isLoggedIn,
    hasBleConsent,
    go,
    logout,
    getAccessToken,
  };

  // ====== Init ======
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindHeaderEvents);
  } else {
    bindHeaderEvents();
  }
})();