/* ===================================================================
   api.js
   Wrapper único para llamar a la API real (worldcup26.ir): agrega el
   header Authorization si hay token, y traduce los status HTTP a
   errores marcados (401 -> isAuthError, 404 -> isNotFound, etc.) para
   que el resto de la app los distinga sin repetir esta lógica.
=================================================================== */

import { CONFIG, SIMULATED_INVALID_TOKEN, getToken } from './config.js';

export async function apiFetch(path, { signal } = {}) {
  const token = getToken();

  // Simulación del 401 desde el cliente: la API real de worldcup26.ir
  // no valida la firma del JWT en estas rutas (comprobado en Network:
  // un token corrompido igual devuelve 200), así que no podemos
  // confiar en que el servidor rechace un token roto. Para que la
  // demo del punto 5.3 del laboratorio sea reproducible en la
  // defensa, interceptamos aquí mismo antes de mandar nada a la red.
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
