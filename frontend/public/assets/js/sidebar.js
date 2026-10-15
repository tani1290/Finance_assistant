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
          <i class="ri-logout-box-r-line logout-btn" id="sidebarLogout" title="Logout" style="margin-left:auto;cursor:pointer;" onclick="event.stopPropagation()"></i>
        </div>
      </div>
    </aside>
  `;
}

function initSidebarUser() {
  const user = JSON.parse(localStorage.getItem('jf_user') || '{}');
  const name = (user.firstName || user.username || 'User');
  const fullName = name + (user.lastName ? ' ' + user.lastName : '');
  
  const el = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  const avatarEl = document.getElementById('sidebarAvatar');
  
  if (el) el.textContent = fullName;
  if (roleEl) roleEl.textContent = user.isPremium ? '⭐ Premium' : 'Free User';
  if (avatarEl) avatarEl.textContent = (name[0] || 'U').toUpperCase();
  
  const logoutBtn = document.getElementById('sidebarLogout');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      const rt = localStorage.getItem('jf_refresh_token');
      const at = localStorage.getItem('jf_access_token');
      try {
        await fetch('/api/v1/auth/logout', {
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
  const isCurrentlyDark = document.documentElement.classList.contains('dark-mode') || 
    (!document.documentElement.classList.contains('light-mode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  const willBeDark = !isCurrentlyDark;

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
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved === 'true' || (saved === null && prefersDark);

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

