/**
 * Jinay Finance AI — Shared App Utilities
 * Owner: Jinay Golecha (jinay_golecha)
 * All frontend pages include this file.
 */

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = (!isLocal || window.location.origin.includes(':5001'))
  ? '/api/v1' 
  : 'http://127.0.0.1:5001/api/v1';

// ============ TOKEN MANAGEMENT ============
export const getToken = () => localStorage.getItem('jf_access_token');
export const getRefreshToken = () => localStorage.getItem('jf_refresh_token');
export const setTokens = (at, rt) => {
  localStorage.setItem('jf_access_token', at);
  if (rt) localStorage.setItem('jf_refresh_token', rt);
};
export const clearAuth = () => {
  localStorage.removeItem('jf_access_token');
  localStorage.removeItem('jf_refresh_token');
  localStorage.removeItem('jf_user');
};
export const isAuthenticated = () => !!getToken();
export const getUser = () => {
  try { return JSON.parse(localStorage.getItem('jf_user') || 'null'); } catch { return null; }
};
export const setUser = (u) => localStorage.setItem('jf_user', JSON.stringify(u));

// ============ REQUIRE AUTH ============
export const requireAuth = () => {
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
};

// ============ TOKEN REFRESH ============
let _refreshing = null;
const refreshTokens = async () => {
  if (_refreshing) return _refreshing;
  const rt = getRefreshToken();
  if (!rt) { clearAuth(); return null; }
  _refreshing = fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  }).then(r => r.json()).then(d => {
    if (d.success) { setTokens(d.data.accessToken, d.data.refreshToken); return d.data.accessToken; }
    clearAuth(); return null;
  }).catch(() => { clearAuth(); return null; }).finally(() => { _refreshing = null; });
  return _refreshing;
};

// ============ CORE API FETCH ============
export const apiFetch = async (endpoint, options = {}) => {
  const url = `${API_BASE}${endpoint}`;
  let token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  let res = await fetch(url, { ...options, headers }).catch(() => null);
  if (!res) throw { message: 'Cannot connect to server. Is the backend running on port 5001?', code: 'NETWORK_ERROR' };
  if (res.status === 401) {
    const newToken = await refreshTokens();
    if (newToken) {
      headers.Authorization = `Bearer ${newToken}`;
      res = await fetch(url, { ...options, headers });
    } else {
      clearAuth();
      window.location.href = '/login.html?session_expired=1';
      return null;
    }
  }
  const data = await res.json().catch(() => ({ success: false, error: { message: 'Invalid server response' } }));
  if (!res.ok && !data.success) {
    throw { message: data.error?.message || `Request failed (${res.status})`, code: data.error?.code || 'API_ERROR', status: res.status };
  }
  return data;
};

// ============ FORMATTING ============
export const fmt = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(parseFloat(amount) || 0);
export const fmtFull = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(parseFloat(amount) || 0);
export const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

// ============ SHOW TOAST ============
export const toast = (message, type = 'success') => {
  const existing = document.getElementById('jf-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'jf-toast';
  t.style.cssText = `position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:500;font-family:Inter,sans-serif;z-index:9999;display:flex;align-items:center;gap:8px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.4);animation:slideIn .3s ease;`;
  if (type === 'success') t.style.cssText += 'background:#065f46;border:1px solid #10b981;color:#6ee7b7;';
  else if (type === 'error') t.style.cssText += 'background:#7f1d1d;border:1px solid #ef4444;color:#fca5a5;';
  else t.style.cssText += 'background:#1e1b4b;border:1px solid #6366f1;color:#a5b4fc;';
  t.innerHTML = `<i class="ri-${type === 'success' ? 'checkbox-circle' : type === 'error' ? 'error-warning' : 'information'}-line"></i>${message}`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
};

// ============ LOGOUT ============
export const logout = async () => {
  const rt = getRefreshToken();
  const token = getToken();
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ refreshToken: rt }),
    });
  } catch {}
  clearAuth();
  window.location.href = '/login.html';
};

// ============ SIDEBAR INIT ============
export const initSidebar = (activePage) => {
  const user = getUser();
  const nameEl = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  const avatarEl = document.getElementById('sidebarAvatar');
  if (nameEl && user) nameEl.textContent = (user.firstName || user.username || 'User') + (user.lastName ? ' ' + user.lastName : '');
  if (roleEl && user) roleEl.textContent = user.isPremium ? '⭐ Premium' : 'Free User';
  if (avatarEl && user) avatarEl.textContent = (user.firstName || user.username || 'U')[0].toUpperCase();
  
  document.querySelectorAll('.nav-item').forEach(el => {
    if (el.getAttribute('href') === `/${activePage}.html`) el.classList.add('active');
    else el.classList.remove('active');
  });

  const logoutBtn = document.getElementById('sidebarLogout');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
};

// Global slideIn animation
const style = document.createElement('style');
style.textContent = `@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}`;
document.head.appendChild(style);

export default { apiFetch, fmt, fmtFull, fmtDate, toast, logout, requireAuth, isAuthenticated, getUser, setUser, setTokens, clearAuth, initSidebar, API_BASE };
