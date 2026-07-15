
export const CONFIG = {
  BASE_URL: 'https://worldcup26.ir',
  AUTH_BASE_URL: 'http://127.0.0.1:5501',
  TOKEN_KEY: 'wc26_token',
  DEBOUNCE_MS: 400,
};

export const SIMULATED_INVALID_TOKEN = '__WC26_SIMULATED_EXPIRED_TOKEN__';

export const state = {
  searchController: null,   
  searchSeq: 0,              
  compareController: null,   
  selected: [],               
  pendingRetry: null,          
};

export const els = {
  input: document.getElementById('search-input'),
  dropdown: document.getElementById('dropdown'),
  selectedBar: document.getElementById('selected-bar'),
  compareBtn: document.getElementById('compare-btn'),
  emptyState: document.getElementById('empty-state'),
  compareLoading: document.getElementById('compare-loading'),
  compareError: document.getElementById('compare-error'),
  compareColumns: document.getElementById('compare-columns'),
  modal: document.getElementById('reauth-modal'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  simulateExpiryBtn: document.getElementById('simulate-expiry-btn'),
  demo404Btn: document.getElementById('demo-404-btn'),
  sessionStatus: document.getElementById('session-status'),
  srSearchStatus: document.getElementById('sr-search-status'),
  fontIncreaseBtn: document.getElementById('font-increase-btn'),
  fontDecreaseBtn: document.getElementById('font-decrease-btn'),
  fontSizeLabel: document.getElementById('font-size-label'),
  contrastToggleBtn: document.getElementById('contrast-toggle-btn'),
};

export function getToken() {
  return localStorage.getItem(CONFIG.TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(CONFIG.TOKEN_KEY, token);
  updateSessionStatus();
}

export function updateSessionStatus() {
  const token = getToken();
  if (!els.sessionStatus) return;
  els.sessionStatus.textContent = token ? 'Sesión: token activo' : 'Sesión: sin token';
}
