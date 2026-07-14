/* ===================================================================
   auth.js
   Todo lo relacionado con la sesión: el modal de re-autenticación
   (401), el login real contra la API, y los botones de demo que
   simulan el 401 y el 404 para la defensa del laboratorio.

   Requisito clave (sección 5.3 del lab): jamás usar
   window.location.reload() para resolver el 401, y mantener visible
   el estado previo (input + equipos comparados) detrás del modal.
=================================================================== */

import { CONFIG, SIMULATED_INVALID_TOKEN, state, els, setToken } from './config.js';

/* ---------------------------------------------------------------
   Foco atrapado dentro del modal mientras está abierto (para que
   Tab no "se escape" hacia el fondo de la página)
--------------------------------------------------------------- */
let lastFocusedBeforeModal = null;

function getFocusableInModal() {
  return Array.from(els.modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.disabled && el.offsetParent !== null);
}

function trapTabKey(e) {
  if (e.key === 'Escape') {
    closeReauthModal();
    return;
  }
  if (e.key !== 'Tab') return;

  const focusables = getFocusableInModal();
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------------------------------------------------------------
   Abrir / cerrar el modal de re-autenticación
--------------------------------------------------------------- */
export function openReauthModal(retryAction) {
  state.pendingRetry = retryAction || null;
  els.loginError.classList.add('hidden');
  els.modal.classList.remove('hidden');

  // El resto de la página deja de ser alcanzable por lectores de
  // pantalla mientras el modal está abierto, y el Tab queda atrapado
  // dentro del modal en vez de "escaparse" hacia el fondo.
  document.getElementById('app-main').setAttribute('aria-hidden', 'true');
  lastFocusedBeforeModal = document.activeElement;
  document.addEventListener('keydown', trapTabKey);
  const firstField = document.getElementById('login-user');
  if (firstField) firstField.focus();
}

export function closeReauthModal() {
  els.modal.classList.add('hidden');
  document.getElementById('app-main').removeAttribute('aria-hidden');
  document.removeEventListener('keydown', trapTabKey);
  if (lastFocusedBeforeModal) lastFocusedBeforeModal.focus();
}

function finishReauth() {
  closeReauthModal();
  // El texto del input y los equipos ya seleccionados siguen intactos
  // porque nunca los tocamos: solo se oculta/muestra el modal.
  if (state.pendingRetry) {
    const retry = state.pendingRetry;
    state.pendingRetry = null;
    retry();
  }
}

/* ---------------------------------------------------------------
   Login real contra la API (POST /auth/authenticate)
--------------------------------------------------------------- */
async function loginRequest(email, password) {
  // Esta ruta específica (/auth/authenticate) sí necesita el proxy,
  // porque es la única que tiene el bug de CORS en la API real.
  const response = await fetch(`${CONFIG.AUTH_BASE_URL}/auth/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error('Credenciales inválidas');
  }
  const data = await response.json();
  return data.token;
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-user').value;
  const password = document.getElementById('login-pass').value;

  try {
    const token = await loginRequest(email, password);
    setToken(token);
    finishReauth();
  } catch (err) {
    // Nota: si esto falla con un error de red genérico (no de
    // credenciales), probablemente sea el bug de CORS de /auth/ —
    // usar el token manual de abajo en ese caso.
    els.loginError.textContent = 'No se pudo iniciar sesión. Verifique sus credenciales (y que el proxy — node proxy.js — esté corriendo).';
    els.loginError.classList.remove('hidden');
  }
});

/* ---------------------------------------------------------------
   Panel de sesión: botones de demo para la defensa
--------------------------------------------------------------- */
els.simulateExpiryBtn.addEventListener('click', () => {
  setToken(SIMULATED_INVALID_TOKEN);
  console.log('[demo 401] Token corrompido intencionalmente. La próxima petición a la API debe recibir 401 y abrir el modal de re-autenticación.');

  // Feedback discreto en el propio panel de sesión (nada dramático:
  // el 401 real solo debe verse cuando de verdad busques o compares).
  els.sessionStatus.textContent = 'Sesión: token INVÁLIDO (forzado) — busca o compara algo para ver el 401';
  const original = els.simulateExpiryBtn.textContent;
  els.simulateExpiryBtn.textContent = '✓ Token invalidado';
  els.simulateExpiryBtn.disabled = true;
  setTimeout(() => {
    els.simulateExpiryBtn.textContent = original;
    els.simulateExpiryBtn.disabled = false;
  }, 1800);
});

// Este botón NO usa ningún token — el 404 no depende de la sesión,
// solo de que el nombre buscado no exista. Escribe algo inexistente
// y dispara el mismo flujo real de búsqueda (debounce incluido).
els.demo404Btn.addEventListener('click', () => {
  const fakeName = 'Zzqxvunlandia';
  els.input.value = fakeName;
  els.input.focus();
  els.input.dispatchEvent(new Event('input', { bubbles: true }));
  console.log('[demo 404] Buscando un nombre que no existe en la lista de equipos, para mostrar el mensaje de "sin resultados".');
});
