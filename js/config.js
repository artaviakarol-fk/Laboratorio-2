/* ===================================================================
   config.js
   Configuración global, estado compartido de la app, referencias al
   DOM, y manejo del token JWT. Todo lo demás importa de aquí.
=================================================================== */

export const CONFIG = {
  // Las rutas /get/* (búsqueda, comparación) SÍ tienen CORS bien
  // configurado en la API real, así que van DIRECTO a worldcup26.ir,
  // sin depender del proxy. Solo /auth/* (login real) tiene el bug de
  // CORS, así que ESA ruta específica pasa por el proxy local
  // (proxy.js, http://127.0.0.1:5501). Así, si alguien no corre el
  // proxy, toda la app sigue funcionando (buscar, comparar, simular
  // 401/404) — solo el login real con correo/contraseña necesitaría
  // el proxy corriendo.
  BASE_URL: 'https://worldcup26.ir',
  AUTH_BASE_URL: 'http://127.0.0.1:5501',
  TOKEN_KEY: 'wc26_token',
  DEBOUNCE_MS: 400,
};

// La API real (worldcup26.ir) no siempre rechaza un token corrompido:
// en pruebas, mandar cualquier texto como Authorization igual devolvió
// 200 con datos normales — el servidor no valida la firma del JWT en
// estas rutas de lectura. Para poder demostrar el manejo del 401 de
// forma confiable en la defensa (sin depender de que el servidor real
// coopere), usamos este valor especial: si el token guardado es
// exactamente este, apiFetch() simula el 401 él mismo, sin red.
export const SIMULATED_INVALID_TOKEN = '__WC26_SIMULATED_EXPIRED_TOKEN__';

/* ---------------------------------------------------------------
   Estado de la aplicación (compartido entre módulos)
--------------------------------------------------------------- */
export const state = {
  searchController: null,   // AbortController de la búsqueda en vuelo
  searchSeq: 0,              // número de secuencia de la última búsqueda
  compareController: null,   // AbortController de la comparación en vuelo
  selected: [],               // hasta 2 equipos { id, name }
  pendingRetry: null,          // acción a reintentar tras re-autenticarse
};

/* ---------------------------------------------------------------
   Referencias al DOM (se buscan una sola vez al cargar el módulo)
--------------------------------------------------------------- */
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

/* ---------------------------------------------------------------
   Manejo del token (JWT)
--------------------------------------------------------------- */
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
