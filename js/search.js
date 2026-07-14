/* ===================================================================
   search.js
   Todo lo del buscador: debounce, búsqueda difusa (substring +
   tolerancia a errores de tipeo), autocompletado contra la API,
   render del dropdown, y la selección de hasta 2 equipos (chips).
=================================================================== */

import { CONFIG, state, els } from './config.js';
import { apiFetch } from './api.js';
import { openReauthModal } from './auth.js';
import { loadComparison, resetCompareView } from './compare.js';

/* ---------------------------------------------------------------
   Debounce (implementado a mano, sin librerías)
--------------------------------------------------------------- */
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ---------------------------------------------------------------
   Búsqueda difusa (substring + tolerancia a errores de tipeo)
--------------------------------------------------------------- */

// Quita acentos y pasa a minúsculas, para que "colombia"/"Colombia"/
// "Perú"/"peru" se comparen igual.
function normalizeStr(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Distancia de Levenshtein clásica (número mínimo de inserciones,
// borrados o sustituciones para convertir "a" en "b").
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // borrado
        dp[i][j - 1] + 1,      // inserción
        dp[i - 1][j - 1] + cost // sustitución
      );
    }
  }
  return dp[m][n];
}

// La API solo trae nombres en inglés (name_en) y persa (name_fa).
// Como quien busca escribe en español, mapeamos alias comunes para
// que "corea", "alemania", "españa", etc. también encuentren el
// equipo correspondiente. Ajustar si el name_en real difiere (por
// ejemplo "Czechia" en vez de "Czech Republic").
const SPANISH_ALIASES = {
  argentina: 'argentina', australia: 'australia', austria: 'austria',
  belgica: 'belgium', bosnia: 'bosnia and herzegovina', brasil: 'brazil',
  canada: 'canada', caboverde: 'cape verde', colombia: 'colombia',
  rdcongo: 'congo dr', congo: 'congo dr', croacia: 'croatia',
  curazao: 'curacao', chequia: 'czech republic', republicacheca: 'czech republic',
  ecuador: 'ecuador', egipto: 'egypt', inglaterra: 'england',
  francia: 'france', alemania: 'germany', ghana: 'ghana',
  haiti: 'haiti', iran: 'iran', irak: 'iraq',
  costademarfil: 'ivory coast', japon: 'japan', jordania: 'jordan',
  mexico: 'mexico', marruecos: 'morocco', paisesbajos: 'netherlands',
  holanda: 'netherlands', nuevazelanda: 'new zealand', noruega: 'norway',
  panama: 'panama', paraguay: 'paraguay', portugal: 'portugal',
  catar: 'qatar', qatar: 'qatar', arabiasaudita: 'saudi arabia',
  escocia: 'scotland', senegal: 'senegal', sudafrica: 'south africa',
  coreadelsur: 'south korea', corea: 'south korea', espana: 'spain',
  suecia: 'sweden', suiza: 'switzerland', tunez: 'tunisia',
  turquia: 'turkiye', turkiye: 'turkiye', estadosunidos: 'usa',
  eeuu: 'usa', uruguay: 'uruguay', uzbekistan: 'uzbekistan',
  argelia: 'algeria',
};

// Construye las cadenas contra las que se compara un equipo: su
// nombre en inglés/persa siempre, y su alias en español aparte.
function searchableStringsFor(team) {
  const primary = [normalizeStr(team.name_en), normalizeStr(team.name_fa)].filter(Boolean);

  const aliasStrings = [];
  const alias = SPANISH_ALIASES[normalizeStr(team.name_en).replace(/\s+/g, '')];
  if (alias) aliasStrings.push(normalizeStr(alias));
  // También agrega el propio alias en español "hacia adelante": si
  // el query coincide con una llave (ej. "corea"), la llave misma
  // ya sirve como cadena buscable.
  Object.entries(SPANISH_ALIASES).forEach(([es, en]) => {
    if (normalizeStr(en) === normalizeStr(team.name_en)) aliasStrings.push(es);
  });

  return { primary, aliasStrings: aliasStrings.filter(Boolean) };
}

// Puntúa un equipo contra el texto buscado. Menor puntaje = mejor
// coincidencia. Devuelve Infinity si no hay coincidencia razonable.
function scoreTeam(query, team) {
  const nq = normalizeStr(query);
  let best = Infinity;
  const { primary, aliasStrings } = searchableStringsFor(team);

  const checkCandidate = (candidate) => {
    if (!candidate) return;
    if (candidate.startsWith(nq)) { best = Math.min(best, 0); return; }
    if (candidate.includes(nq)) { best = Math.min(best, 1); return; }
    // Tolerancia a errores de tipeo: solo aplica si la consulta ya
    // tiene un tamaño razonable, para no generar ruido con 1-2 letras.
    if (nq.length >= 3) {
      const words = candidate.split(' ');
      words.forEach((word) => {
        const distance = levenshtein(nq, word);
        const threshold = nq.length <= 4 ? 1 : 2;
        if (distance <= threshold) best = Math.min(best, 2 + distance);
      });
    }
  };

  // El nombre real (en inglés/persa) siempre se compara.
  primary.forEach(checkCandidate);

  // El alias en español SOLO se compara con consultas de 4+ letras.
  // Con 1-3 letras, casi cualquier alias contiene esa combinación
  // (ej. "ar" aparece dentro de "argelia", "marruecos", "arabia
  // saudita"...) y termina mostrando equipos que en pantalla (donde
  // se ve el nombre en inglés) no tienen ninguna relación visible
  // con lo que la persona escribió.
  if (nq.length >= 4) {
    aliasStrings.forEach(checkCandidate);
  }

  return best;
}

function filterTeamsLocally(query, teams) {
  return teams
    .map((team) => ({ team, score: scoreTeam(query, team) }))
    .filter((entry) => entry.score < Infinity)
    .sort((a, b) => a.score - b.score || normalizeStr(a.team.name_en).localeCompare(normalizeStr(b.team.name_en)))
    .slice(0, 8)
    .map((entry) => entry.team);
}

/* ---------------------------------------------------------------
   Autocompletado
   La ruta filtrada /get/team/?name= solo hace match EXACTO (lo
   confirmamos en consola: buscar "argentin" devolvía {team: null}
   aunque "Argentina" sí existe). Para lograr sugerencias parciales
   ("c" -> Colombia, Croacia, Curazao...) y tolerar errores de tipeo,
   traemos la lista completa (GET /get/teams, ya la sugería el propio
   enunciado como alternativa: "obteniendo el listado y filtrando los
   IDs internamente") y filtramos nosotros mismos. El debounce y el
   AbortController siguen aplicando sobre esta petición real.
--------------------------------------------------------------- */
async function performSearch(query) {
  // Cancela cualquier búsqueda anterior que siga en vuelo.
  // Esta es la pieza que resuelve la condición de carrera:
  // aunque la respuesta de una tecla anterior llegue tarde, nunca
  // se renderiza, porque su petición fue abortada.
  if (state.searchController) {
    state.searchController.abort();
  }

  const controller = new AbortController();
  state.searchController = controller;
  const mySeq = ++state.searchSeq;

  const trimmed = query.trim();
  if (!trimmed) {
    renderDropdown({ status: 'empty' });
    return;
  }

  // Si el servidor no responde nada en 10s (como el 504 que ya vimos
  // antes con esta API), abortamos nosotros mismos en vez de dejar la
  // búsqueda esperando para siempre sin mostrar nada. Se marca el
  // controller para distinguir este aborto "por timeout" de uno real
  // por escribir una tecla más.
  const timeoutId = setTimeout(() => {
    controller.timedOut = true;
    controller.abort();
  }, 10000);

  try {
    const data = await apiFetch(`/get/teams`, { signal: controller.signal });
    clearTimeout(timeoutId);

    // Chequeo extra de secuencia: aunque AbortController ya evita
    // que peticiones obsoletas se procesen, esta guarda protege
    // contra el caso raro de que dos respuestas lleguen casi juntas.
    if (mySeq !== state.searchSeq) return;

    const allTeams = Array.isArray(data) ? data : (data.teams || []);
    const matches = filterTeamsLocally(trimmed, allTeams);

    const normalized = matches.map((t) => ({ id: t.id, name: t.name_en || t.name, raw: t }));
    renderDropdown({ status: normalized.length ? 'ok' : 'no-results', teams: normalized });

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      if (controller.timedOut) {
        console.error(`[timeout] El servidor no respondió en 10s al buscar "${trimmed}".`);
        if (mySeq === state.searchSeq) {
          renderDropdown({ status: 'error', message: 'El servidor tardó demasiado en responder. Intenta de nuevo.' });
        }
        return;
      }
      // Cancelación intencional provocada por nosotros mismos.
      // NUNCA se muestra al usuario como error.
      console.log(`[AbortController] Búsqueda "${trimmed}" cancelada (superada por otra más reciente).`);
      return;
    }
    if (mySeq !== state.searchSeq) return;

    if (err.isNotFound) {
      renderDropdown({ status: 'no-results' });
      return;
    }
    if (err.isAuthError) {
      console.log('[auth] La búsqueda recibió 401. Abriendo modal de re-autenticación.');
      renderDropdown({ status: 'error', message: 'Tu sesión expiró: no se pudo completar la búsqueda.' });
      openReauthModal(() => performSearch(query));
      return;
    }
    // Error real de red o de servidor (distinto de un AbortError).
    console.error('Error real de red en autocompletado:', err);
    renderDropdown({ status: 'error' });
  }
}

const debouncedSearch = debounce(performSearch, CONFIG.DEBOUNCE_MS);

els.input.addEventListener('input', (e) => {
  debouncedSearch(e.target.value);
});

// Flecha abajo desde el input: salta directo a la primera sugerencia
// habilitada, como en cualquier buscador con teclado.
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    const firstOption = els.dropdown.querySelector('li[tabindex="0"]');
    if (firstOption) {
      e.preventDefault();
      firstOption.focus();
    }
  } else if (e.key === 'Escape') {
    els.dropdown.classList.add('hidden');
  }
});

/* ---------------------------------------------------------------
   Render dinámico del dropdown (sin marcado fijo en HTML)
--------------------------------------------------------------- */
function renderDropdown({ status, teams = [], message }) {
  els.dropdown.innerHTML = ''; // se vacía en cada búsqueda nueva

  if (status === 'empty') {
    els.dropdown.classList.add('hidden');
    els.srSearchStatus.textContent = '';
    return;
  }

  if (status === 'no-results') {
    const li = document.createElement('li');
    li.className = 'dropdown-message';
    li.textContent = 'No se encontraron selecciones con ese nombre.';
    els.dropdown.appendChild(li);
    els.dropdown.classList.remove('hidden');
    els.srSearchStatus.textContent = 'No se encontraron equipos con ese nombre.';
    return;
  }

  if (status === 'error') {
    const li = document.createElement('li');
    li.className = 'dropdown-message error';
    li.textContent = message || 'No se pudo conectar con el servidor. Intente de nuevo.';
    els.dropdown.appendChild(li);
    els.dropdown.classList.remove('hidden');
    els.srSearchStatus.textContent = 'Ocurrió un error al buscar. Intente de nuevo.';
    return;
  }

  teams.forEach((team) => {
    const li = document.createElement('li');
    const alreadyPicked = state.selected.some((t) => t.id === team.id);
    const isFull = state.selected.length >= 2;
    const disabled = alreadyPicked || isFull;

    li.textContent = team.name;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.setAttribute('aria-disabled', String(disabled));

    if (disabled) {
      li.classList.add('disabled');
    } else {
      // Accesible tanto por mouse como por teclado: Tab/flechas para
      // moverse, Enter/Espacio para elegir, Escape para cerrar y
      // volver al input. El patrón estándar de cualquier buscador.
      li.tabIndex = 0;
      li.addEventListener('click', () => selectTeam(team));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectTeam(team);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = li.nextElementSibling;
          if (next && next.tabIndex === 0) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = li.previousElementSibling;
          if (prev && prev.tabIndex === 0) prev.focus();
          else els.input.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          els.dropdown.classList.add('hidden');
          els.input.focus();
        }
      });
    }
    els.dropdown.appendChild(li);
  });

  els.dropdown.classList.remove('hidden');
  els.srSearchStatus.textContent = `${teams.length} equipo${teams.length === 1 ? '' : 's'} encontrado${teams.length === 1 ? '' : 's'}.`;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) {
    els.dropdown.classList.add('hidden');
  }
});

/* ---------------------------------------------------------------
   Selección de equipos (máx. 2) + chips
--------------------------------------------------------------- */
function selectTeam(team) {
  if (state.selected.length >= 2) return;
  state.selected.push(team);
  renderSelectedBar();
  els.input.value = '';
  els.dropdown.classList.add('hidden');
  // Ya no se dispara sola: el usuario decide cuándo comparar con el botón.
}

function removeTeam(id) {
  state.selected = state.selected.filter((t) => t.id !== id);
  renderSelectedBar();
  resetCompareView();
}

function renderSelectedBar() {
  els.selectedBar.innerHTML = '';
  state.selected.forEach((team) => {
    const chip = document.createElement('div');
    chip.className = 'chip';

    const label = document.createElement('span');
    label.textContent = team.name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', `Quitar ${team.name}`);
    removeBtn.addEventListener('click', () => removeTeam(team.id));

    chip.appendChild(label);
    chip.appendChild(removeBtn);
    els.selectedBar.appendChild(chip);
  });

  // El botón solo aparece cuando ya hay al menos un equipo elegido,
  // y solo se habilita cuando hay exactamente 2.
  els.compareBtn.classList.toggle('hidden', state.selected.length === 0);
  els.compareBtn.disabled = state.selected.length !== 2;
  els.compareBtn.textContent = state.selected.length === 2
    ? 'Comparar equipos'
    : 'Selecciona un equipo más';
}

els.compareBtn.addEventListener('click', () => {
  if (state.selected.length === 2) loadComparison();
});
