
import { CONFIG, SIMULATED_INVALID_TOKEN, getToken } from './config.js';

export async function apiFetch(path, { signal } = {}) {
  const token = getToken();

  if (token === SIMULATED_INVALID_TOKEN) {
    console.log(`[demo 401] Simulando 401 del lado del cliente para ${path} (el servidor real no rechaza tokens inválidos en esta ruta).`);
    const err = new Error('No autorizado (simulado)');
    err.isAuthError = true;
    throw err;
  }

  const response = await fetch(`${CONFIG.BASE_URL}${path}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal,
  });

  if (response.status === 401) {
    const err = new Error('No autorizado');
    err.isAuthError = true;
    throw err;
  }
  if (response.status === 404) {
    const err = new Error('Sin resultados');
    err.isNotFound = true;
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`Error de servidor (${response.status})`);
    err.isServerError = true;
    throw err;
  }
  return response.json();
}
