/**
 * Jinay Finance AI — Centralized API Client
 * Owner: Jinay Golecha (jinay_golecha)
 * All API calls go to Node.js/Express backend
 */

const API_BASE = window.location.origin.includes(':5001') 
  ? '/api/v1' 
  : 'http://127.0.0.1:5001/api/v1';

// ===== Token Management =====

export const getToken = () => localStorage.getItem('jf_access_token');
export const getRefreshToken = () => localStorage.getItem('jf_refresh_token');

export const setTokens = (accessToken, refreshToken) => {
  localStorage.setItem('jf_access_token', accessToken);
  if (refreshToken) localStorage.setItem('jf_refresh_token', refreshToken);
};

export const clearTokens = () => {
  localStorage.removeItem('jf_access_token');
  localStorage.removeItem('jf_refresh_token');
  localStorage.removeItem('jf_user');
};

export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem('jf_user') || 'null');
  } catch {
    return null;
  }
};

export const setUser = (user) => {
  localStorage.setItem('jf_user', JSON.stringify(user));
};

export const isAuthenticated = () => {
  return !!getToken();
};

// ===== Auto token refresh =====

let refreshPromise = null;

const refreshTokens = async () => {
  if (refreshPromise) return refreshPromise;
  const refresh = getRefreshToken();
  if (!refresh) return null;

  refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        setTokens(data.data.accessToken, data.data.refreshToken);
        return data.data.accessToken;
      }
      clearTokens();
      return null;
    })
    .catch(() => {
      clearTokens();
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
};

// ===== Core fetch wrapper =====

export const apiFetch = async (endpoint, options = {}) => {
  const url = `${API_BASE}${endpoint}`;
  const token = getToken();

  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const config = {
    ...options,
    headers: { ...defaultHeaders, ...(options.headers || {}) },
  };

  let response = await fetch(url, config);

  // Handle 401 — try to refresh token
  if (response.status === 401) {
    const newToken = await refreshTokens();
    if (newToken) {
      config.headers.Authorization = `Bearer ${newToken}`;
      response = await fetch(url, config);
    } else {
      clearTokens();
      window.location.href = '/login.html?session_expired=1';
      return null;
    }
  }

  const data = await response.json().catch(() => ({ success: false, error: { message: 'Invalid server response' } }));

  if (!response.ok && !data.success) {
    throw {
      message: data.error?.message || `Request failed (${response.status})`,
      code: data.error?.code || 'API_ERROR',
      status: response.status,
    };
  }

  return data;
};

// ===== Authenticated File Downloader =====

export const downloadFile = async (endpoint, filename) => {
  const token = getToken();
  const res = await fetch(`${API_BASE}${endpoint}?token=${encodeURIComponent(token || '')}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Download failed');
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

// ===== Auth API =====

export const authAPI = {
  register: (data) => apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  refresh: (refreshToken) => apiFetch('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  logout: (refreshToken) => apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  getMe: () => apiFetch('/auth/me'),
  googleToken: (token) => apiFetch('/auth/google/token', { method: 'POST', body: JSON.stringify({ token }) }),
  googleRedirectUrl: () => `${API_BASE}/auth/google`,
};

// ===== Dashboard API =====

export const dashboardAPI = {
  get: () => apiFetch('/dashboard'),
};

// ===== Onboarding API =====

export const onboardingAPI = {
  submit: (data) => apiFetch('/onboarding', { method: 'POST', body: JSON.stringify(data) }),
  status: () => apiFetch('/onboarding/status'),
};

// ===== Accounts API =====

export const accountsAPI = {
  list: () => apiFetch('/accounts'),
  create: (data) => apiFetch('/accounts', { method: 'POST', body: JSON.stringify(data) }),
  get: (id) => apiFetch(`/accounts/${id}`),
  update: (id, data) => apiFetch(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/accounts/${id}`, { method: 'DELETE' }),
  deposit: (id, data) => apiFetch(`/accounts/${id}/deposit`, { method: 'POST', body: JSON.stringify(data) }),
};

// ===== Transactions API =====

export const transactionsAPI = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/transactions${q ? '?' + q : ''}`);
  },
  create: (data) => apiFetch('/transactions', { method: 'POST', body: JSON.stringify(data) }),
  get: (id) => apiFetch(`/transactions/${id}`),
  update: (id, data) => apiFetch(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/transactions/${id}`, { method: 'DELETE' }),
  parseVoice: (text) => apiFetch('/transactions/voice', { method: 'POST', body: JSON.stringify({ text }) }),
};

// ===== Budgets API =====

export const budgetsAPI = {
  list: (month, year) => apiFetch(`/budgets?month=${month}&year=${year}`),
  create: (data) => apiFetch('/budgets', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => apiFetch(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/budgets/${id}`, { method: 'DELETE' }),
  optimize: (method = '50/30/20') => apiFetch(`/ai/budget-optimize?method=${method}`),
};

// ===== Goals API =====

export const goalsAPI = {
  list: () => apiFetch('/goals'),
  create: (data) => apiFetch('/goals', { method: 'POST', body: JSON.stringify(data) }),
  get: (id) => apiFetch(`/goals/${id}`),
  update: (id, data) => apiFetch(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  contribute: (id, amount) => apiFetch(`/goals/${id}/contribute`, { method: 'PATCH', body: JSON.stringify({ amount }) }),
  delete: (id) => apiFetch(`/goals/${id}`, { method: 'DELETE' }),
  forecast: (id) => apiFetch(`/ai/goals/${id}/forecast`),
};

// ===== Investments & Market API =====

export const investmentsAPI = {
  list: () => apiFetch('/investments'),
  portfolio: () => apiFetch('/investments/portfolio'),
  buy: (data) => apiFetch('/investments/buy', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => apiFetch(`/investments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/investments/${id}`, { method: 'DELETE' }),
  quote: (symbol) => apiFetch(`/market/quote?symbol=${symbol}`),
  history: (symbol, timeframe = '1M') => apiFetch(`/market/history?symbol=${symbol}&timeframe=${timeframe}`),
  search: (q) => apiFetch(`/market/search?q=${encodeURIComponent(q)}`),
  metals: () => apiFetch('/market/metals'),
  gold: () => apiFetch('/market/gold'),
  silver: () => apiFetch('/market/silver'),
  popularStocks: () => apiFetch('/market/popular'),
  watchlist: () => apiFetch('/market/watchlist'),
  addWatch: (data) => apiFetch('/market/watchlist', { method: 'POST', body: JSON.stringify(data) }),
  removeWatch: (symbol) => apiFetch(`/market/watchlist/${symbol}`, { method: 'DELETE' }),
  // Alpha Vantage extended
  dashboard: () => apiFetch('/market/dashboard'),
  technicals: (symbol) => apiFetch(`/market/technicals?symbol=${symbol}`),
  companyOverview: (symbol) => apiFetch(`/market/overview?symbol=${symbol}`),
  earnings: (symbol) => apiFetch(`/market/earnings?symbol=${symbol}`),
  fxRate: (from = 'USD', to = 'INR') => apiFetch(`/market/fx?from=${from}&to=${to}`),
  commodity: (type = 'WTI', interval = 'monthly') => apiFetch(`/market/commodity?type=${type}&interval=${interval}`),
};

// ===== Loans API =====

export const loansAPI = {
  list: () => apiFetch('/loans'),
  create: (data) => apiFetch('/loans', { method: 'POST', body: JSON.stringify(data) }),
  get: (id) => apiFetch(`/loans/${id}`),
  update: (id, data) => apiFetch(`/loans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/loans/${id}`, { method: 'DELETE' }),
  calculateEMI: (data) => apiFetch('/loans/calculate-emi', { method: 'POST', body: JSON.stringify(data) }),
  simulatePrepayment: (data) => apiFetch('/loans/prepayment-simulate', { method: 'POST', body: JSON.stringify(data) }),
};

// ===== Insurance API =====

export const insuranceAPI = {
  list: () => apiFetch('/insurance'),
  create: (data) => apiFetch('/insurance', { method: 'POST', body: JSON.stringify(data) }),
  get: (id) => apiFetch(`/insurance/${id}`),
  update: (id, data) => apiFetch(`/insurance/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/insurance/${id}`, { method: 'DELETE' }),
};

// ===== Subscriptions API =====

export const subscriptionsAPI = {
  list: () => apiFetch('/subscriptions'),
  create: (data) => apiFetch('/subscriptions', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => apiFetch(`/subscriptions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/subscriptions/${id}`, { method: 'DELETE' }),
};

// ===== Analytics & Reports API =====

export const analyticsAPI = {
  get: (period = 'month') => apiFetch(`/analytics?period=${period}`),
  monthlyReport: (month, year) => apiFetch(`/reports/monthly?month=${month || ''}&year=${year || ''}`),
};

// ===== Calendar API =====

export const calendarAPI = {
  events: (month, year) => apiFetch(`/calendar/events?month=${month}&year=${year}`),
  create: (data) => apiFetch('/calendar/events', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => apiFetch(`/calendar/events/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/calendar/events/${id}`, { method: 'DELETE' }),
};

// ===== Notifications API =====

export const notificationsAPI = {
  list: () => apiFetch('/notifications'),
  create: (data) => apiFetch('/notifications', { method: 'POST', body: JSON.stringify(data) }),
  markRead: (id) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => apiFetch('/notifications/read-all', { method: 'POST' }),
  delete: (id) => apiFetch(`/notifications/${id}`, { method: 'DELETE' }),
};

// ===== AI Advisor & Predictive API =====

export const aiAPI = {
  chat: (message) => apiFetch('/ai/chat', { method: 'POST', body: JSON.stringify({ message }) }),
  history: () => apiFetch('/ai/history'),
  clearHistory: () => apiFetch('/ai/history', { method: 'DELETE' }),
  snapshot: () => apiFetch('/ai/snapshot'),
  healthScore: () => apiFetch('/ai/financial-health'),
  creditHealth: () => apiFetch('/ai/credit-health'),
  cashFlow: (days = 30) => apiFetch(`/ai/cash-flow?days=${days}`),
  anomalies: () => apiFetch('/ai/anomalies'),
  submitAnomalyFeedback: (id, feedback) => apiFetch(`/ai/anomalies/${id}/feedback`, { method: 'PATCH', body: JSON.stringify({ feedback }) }),
  budgetOptimize: (method = '50/30/20') => apiFetch(`/ai/budget-optimize?method=${method}`),
  riskRadar: () => apiFetch('/ai/risk-radar'),
  simulate: (data) => apiFetch('/ai/simulate', { method: 'POST', body: JSON.stringify(data) }),
  simulationHistory: () => apiFetch('/ai/simulations/history'),
  retirementPlan: (data) => apiFetch('/ai/retirement-plan', { method: 'POST', body: JSON.stringify(data) }),
  goalForecast: (id) => apiFetch(`/ai/goals/${id}/forecast`),
  investmentAnalysis: () => apiFetch('/ai/investment-analysis'),
  insuranceReview: () => apiFetch('/ai/insurance-review'),
  recommendations: () => apiFetch('/ai/recommendations'),
  submitRecommendationFeedback: (id, data) => apiFetch(`/ai/recommendations/${id}/feedback`, { method: 'POST', body: JSON.stringify(data) }),
  voiceIntent: (speechText) => apiFetch('/ai/voice-intent', { method: 'POST', body: JSON.stringify({ speechText }) }),
};

// ===== Cards API (Phase 26) =====

export const cardsAPI = {
  list: () => apiFetch('/cards'),
  create: (data) => apiFetch('/cards', { method: 'POST', body: JSON.stringify(data) }),
  get: (id) => apiFetch(`/cards/${id}`),
  update: (id, data) => apiFetch(`/cards/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/cards/${id}`, { method: 'DELETE' }),
};

// ===== Financial Tasks API (Phase 29) =====

export const tasksAPI = {
  list: (params = '') => apiFetch(`/tasks${params ? '?' + params : ''}`),
  create: (data) => apiFetch('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => apiFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => apiFetch(`/tasks/${id}`, { method: 'DELETE' }),
};

// ===== Financial News API (Phase 30 & 31) =====

export const newsAPI = {
  get: ({ search = '', category = 'general', symbols = '', limit = 10 } = {}) => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (category) params.append('category', category);
    if (symbols) params.append('symbols', symbols);
    if (limit) params.append('limit', limit);
    return apiFetch(`/news?${params.toString()}`);
  },
};

// ===== Receipts OCR & Bank Statement Import API =====

export const receiptsAPI = {
  scan: (data) => apiFetch('/receipts/scan', { method: 'POST', body: JSON.stringify(data) }),
  confirm: (data) => apiFetch('/receipts/confirm', { method: 'POST', body: JSON.stringify(data) }),
};

export const importAPI = {
  bankStatement: (csvContent) => apiFetch('/import/bank-statement', { method: 'POST', body: JSON.stringify({ csvContent }) }),
  confirm: (data) => apiFetch('/import/confirm', { method: 'POST', body: JSON.stringify(data) }),
};

// ===== Training Data Bot & ML Studio API =====

export const trainingAPI = {
  uploadDataset: (data) => apiFetch('/training/datasets/upload', { method: 'POST', body: JSON.stringify(data) }),
  getDatasets: () => apiFetch('/training/datasets'),
  getDataset: (id) => apiFetch(`/training/datasets/${id}`),
  createVersion: (id, data) => apiFetch(`/training/datasets/${id}/version`, { method: 'POST', body: JSON.stringify(data) }),
  deleteDataset: (id) => apiFetch(`/training/datasets/${id}`, { method: 'DELETE' }),
  trainModel: (data) => apiFetch('/training/train', { method: 'POST', body: JSON.stringify(data) }),
  getRuns: (datasetId) => apiFetch(`/training/runs${datasetId ? '?datasetId=' + datasetId : ''}`),
  predict: (data) => apiFetch('/training/predict', { method: 'POST', body: JSON.stringify(data) }),
  getPredictions: () => apiFetch('/training/predictions'),
};

// ===== Export API =====

export const exportAPI = {
  transactions: () => downloadFile('/export/transactions.csv', 'jinay_finance_transactions.csv'),
  accounts: () => downloadFile('/export/accounts.csv', 'jinay_finance_accounts.csv'),
  budgets: () => downloadFile('/export/budgets.csv', 'jinay_finance_budgets.csv'),
  goals: () => downloadFile('/export/goals.csv', 'jinay_finance_goals.csv'),
  investments: () => downloadFile('/export/investments.csv', 'jinay_finance_investments.csv'),
  loans: () => downloadFile('/export/loans.csv', 'jinay_finance_loans.csv'),
  insurance: () => downloadFile('/export/insurance.csv', 'jinay_finance_insurance.csv'),
  subscriptions: () => downloadFile('/export/subscriptions.csv', 'jinay_finance_subscriptions.csv'),
  summary: () => downloadFile('/export/summary.csv', 'jinay_finance_summary.csv'),
};

// ===== Utility Functions =====

export const formatINR = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(parseFloat(amount) || 0);
};

export const formatINRFull = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseFloat(amount) || 0);
};

export const requireAuth = (redirectTo = '/login.html') => {
  if (!isAuthenticated()) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
};

export const redirectIfAuth = (redirectTo = '/dashboard.html') => {
  if (isAuthenticated()) {
    window.location.href = redirectTo;
    return true;
  }
  return false;
};

export const handleGoogleCallback = () => {
  // Support URL hash fragment (secure) or query params (legacy)
  const hashString = window.location.hash ? window.location.hash.substring(1) : '';
  const searchString = window.location.search ? window.location.search.substring(1) : '';
  const params = new URLSearchParams(hashString || searchString);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken) {
    setTokens(accessToken, refreshToken);
    window.history.replaceState({}, '', window.location.pathname);
    return true;
  }
  return false;
};

// Default export
export default {
  apiFetch,
  downloadFile,
  authAPI,
  dashboardAPI,
  onboardingAPI,
  accountsAPI,
  transactionsAPI,
  budgetsAPI,
  goalsAPI,
  investmentsAPI,
  loansAPI,
  insuranceAPI,
  subscriptionsAPI,
  cardsAPI,
  tasksAPI,
  newsAPI,
  analyticsAPI,
  calendarAPI,
  notificationsAPI,
  aiAPI,
  trainingAPI,
  receiptsAPI,
  importAPI,
  exportAPI,
  formatINR,
  formatINRFull,
  isAuthenticated,
  requireAuth,
  redirectIfAuth,
  getUser,
  setUser,
  setTokens,
  clearTokens,
  handleGoogleCallback,
};
