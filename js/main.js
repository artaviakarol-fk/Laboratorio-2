/* ===================================================================
   main.js
   Punto de entrada. Solo importa cada módulo (cada uno se conecta
   solo a sus botones/eventos al cargar) y hace la inicialización
   final. No debería crecer mucho — si algo nuevo no cabe aquí,
   probablemente merece su propio archivo en /js.

   Módulos:
     config.js         -> CONFIG, estado compartido, referencias DOM, token
     api.js             -> fetch con Authorization + manejo de 401/404
     accessibility.js    -> tamaño de letra + alto contraste
     auth.js              -> modal de re-autenticación, login, demo 401/404
     search.js             -> buscador, debounce, AbortController, chips
     compare.js             -> comparación en paralelo con Promise.all
=================================================================== */

import { updateSessionStatus } from './config.js';
import './accessibility.js';
import './auth.js';
import './compare.js';
import './search.js';

// Estado inicial visible del panel de sesión al cargar la página.
updateSessionStatus();
