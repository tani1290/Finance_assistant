/**
 * FinPro — Shared Sidebar Component (Pure Vanilla JS)
 * FinPro — Personal Finance & Investment Decision Support Platform
 * Works in both standard <script> and ES module contexts.
 */

function renderSidebar(activePage = '') {
  const nav = [
    { section: 'Core', items: [
      { href: 'dashboard', icon: 'ri-dashboard-3-line', label: 'Dashboard' },
      { href: 'transactions', icon: 'ri-exchange-dollar-line', label: 'Transactions' },
      { href: 'budget', icon: 'ri-pie-chart-line', label: 'Budgets' },
      { href: 'goals', icon: 'ri-flag-line', label: 'Goals' },
    ]},
    { section: 'Wealth & Protection', items: [
      { href: 'market', icon: 'ri-candlestick-chart-line', label: 'Live Market Dashboard' },
      { href: 'investments', icon: 'ri-line-chart-line', label: 'Investments & Metals' },
      { href: 'loans', icon: 'ri-bank-card-line', label: 'Loans & EMI' },
      { href: 'insurance', icon: 'ri-shield-check-line', label: 'Insurance & Subs' },
    ]},
    { section: 'Intelligence & Tools', items: [
      { href: 'ai-advisor', icon: 'ri-robot-2-line', label: 'AI Advisor & Simulator' },
      { href: 'training', icon: 'ri-brain-line', label: 'AI Training & ML Studio' },
      { href: 'analytics', icon: 'ri-bar-chart-box-line', label: 'Analytics & Reports' },
      { href: 'calendar', icon: 'ri-calendar-event-line', label: 'Financial Calendar' },
      { href: 'status', icon: 'ri-cloud-line', label: 'Cloud Status' },
      { href: 'profile', icon: 'ri-user-settings-line', label: 'Profile & Account' },
    ]},
  ];

  const navHTML = nav.map(sec => `
    <div class="nav-section">
      <div class="nav-label">${sec.section}</div>
      ${sec.items.map(item => `
        <a href="/${item.href}.html" class="nav-item${activePage === item.href ? ' active' : ''}">
          <i class="${item.icon}"></i>${item.label}
        </a>
      `).join('')}
    </div>
  `).join('');

  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-icon"><i class="ri-funds-box-fill"></i></div>
        <div>
          <div class="brand-text">FinPro</div>
          <div class="brand-sub">Decision Support Platform</div>
        </div>
      </div>
      ${navHTML}
      <div class="sidebar-footer">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px 10px;margin-bottom:8px;">
          <span style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;">Theme</span>
          <button class="dark-mode-toggle" id="darkModeToggle" title="Toggle Dark Mode" onclick="toggleDarkMode()">
            <i class="ri-moon-line" id="darkModeIcon"></i>
          </button>
        </div>
        <div class="user-info" id="sidebarUserCard" style="cursor:pointer;" title="View Profile" onclick="window.location.href='/profile.html'">
          <div class="avatar" id="sidebarAvatar">J</div>
          <div>
            <div class="user-name" id="sidebarUserName">Loading...</div>
            <div class="user-role" id="sidebarUserRole">User</div>
          </div>
          <i class="ri-logout-box-r-line logout-btn" id="sidebarLogout" title="Logout" style="margin-left:auto;cursor:pointer;"></i>
        </div>
      </div>
    </aside>
  `;
}

// Same-origin when served by the API (port 5001 or a real host), otherwise the
// local dev API. Mirrors the API_BASE logic in assets/js/api.js.
const SIDEBAR_API_BASE =
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
  !window.location.origin.includes(':5001')
    ? 'http://127.0.0.1:5001/api/v1'
    : '/api/v1';

function renderSidebarUser(user) {
  user = user || {};
  const name = (user.firstName || user.username || user.email || 'User');
  const fullName = name + (user.lastName ? ' ' + user.lastName : '');

  const el = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  const avatarEl = document.getElementById('sidebarAvatar');

  if (el) el.textContent = fullName;
  if (roleEl) roleEl.textContent = user.isPremium ? '⭐ Premium' : 'Free User';
  if (avatarEl) avatarEl.textContent = (name[0] || 'U').toUpperCase();
}

async function initSidebarUser() {
  let user = {};
  try {
    user = JSON.parse(localStorage.getItem('jf_user') || '{}') || {};
  } catch {
    user = {};
  }

  // The cached user object is written at login; when it is missing (or was
  // cleared) resolve the real user from the API so the sidebar never falls
  // back to a placeholder name.
  if (!user.firstName && !user.username && !user.email) {
    const token = localStorage.getItem('jf_access_token');
    if (token) {
      try {
        const res = await fetch(`${SIDEBAR_API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          const fresh = json && (json.data || json.user);
          if (fresh && (fresh.firstName || fresh.username || fresh.email)) {
            user = fresh;
            try { localStorage.setItem('jf_user', JSON.stringify(fresh)); } catch {}
          }
        }
      } catch {}
    }
  }

  renderSidebarUser(user);

  const logoutBtn = document.getElementById('sidebarLogout');
  if (logoutBtn) {
    logoutBtn.onclick = async (event) => {
      // Stop the click bubbling to the parent user card, whose handler
      // navigates to /profile.html — that would abort this async logout and
      // leave the session alive.
      if (event && event.stopPropagation) event.stopPropagation();
      const rt = localStorage.getItem('jf_refresh_token');
      const at = localStorage.getItem('jf_access_token');
      try {
        await fetch(`${SIDEBAR_API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${at}` },
          body: JSON.stringify({ refreshToken: rt }),
        });
      } catch {}
      localStorage.clear();
      window.location.href = '/login.html';
    };
  }
}

// Attach to window
if (typeof window !== 'undefined') {
  window.renderSidebar = renderSidebar;
  window.getSidebar = renderSidebar;
  window.initSidebarUser = initSidebarUser;
  window.toggleDarkMode = toggleDarkMode;
  window.initDarkMode = initDarkMode;

  // Auto-init dark mode on page load
  initDarkMode();
}

function toggleDarkMode() {
  // Dark is the default, so "not light" means currently dark.
  const willBeDark = document.documentElement.classList.contains('light-mode');

  if (willBeDark) {
    document.documentElement.classList.add('dark-mode');
    document.documentElement.classList.remove('light-mode');
    localStorage.setItem('jf_dark_mode', 'true');
  } else {
    document.documentElement.classList.remove('dark-mode');
    document.documentElement.classList.add('light-mode');
    localStorage.setItem('jf_dark_mode', 'false');
  }

  updateDarkModeIcon(willBeDark);
}

function initDarkMode() {
  const saved = localStorage.getItem('jf_dark_mode');
  // Dark mode is the default experience; users opt out by choosing light.
  const isDark = saved !== 'false';

  if (isDark) {
    document.documentElement.classList.add('dark-mode');
    document.documentElement.classList.remove('light-mode');
  } else {
    document.documentElement.classList.remove('dark-mode');
    document.documentElement.classList.add('light-mode');
  }

  // Defer icon update to after sidebar is rendered
  requestAnimationFrame(() => updateDarkModeIcon(isDark));
}

function updateDarkModeIcon(isDark) {
  document.querySelectorAll('#darkModeIcon, .dark-mode-icon').forEach(iconEl => {
    iconEl.className = isDark ? 'ri-sun-line' : 'ri-moon-line';
  });
  document.querySelectorAll('#darkModeToggle, .dark-mode-toggle').forEach(btn => {
    btn.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  });
}

