/* ===================================================================
   Buscador y Comparador de Equipos — Mundial 2026
   Laboratorio #2 — ISW-521

   API real usada (confirmada por el profesor):
   https://github.com/rezarahiminia/worldcup2026  →  https://worldcup26.ir

   Endpoints relevantes para este laboratorio:
     POST /auth/authenticate  { email, password } -> { user, token }
     GET  /get/team/?name=... (Authorization: Bearer <token>)
     GET  /get/team/{id}      (Authorization: Bearer <token>)

   Nota: la API usa "team" en SINGULAR para búsqueda por nombre y por
   id (no "teams"). "/get/teams" (plural, sin filtro) trae los 48
   equipos completos. 100% JS/CSS "vanilla": sin frameworks, tal como
   pidió el profesor.
=================================================================== */

const CONFIG = {
  BASE_URL: 'https://worldcup26.ir',
  TOKEN_KEY: 'wc26_token',
  DEBOUNCE_MS: 400,
};

/* ---------------------------------------------------------------
   1. Manejo del token (JWT)
--------------------------------------------------------------- */
function getToken() {
  return localStorage.getItem(CONFIG.TOKEN_KEY);
}
function setToken(token) {
  localStorage.setItem(CONFIG.TOKEN_KEY, token);
}
function clearToken() {
  localStorage.removeItem(CONFIG.TOKEN_KEY);
}

/* ---------------------------------------------------------------
   2. Estado de la aplicación
--------------------------------------------------------------- */
const state = {
  searchController: null,   // AbortController de la búsqueda en vuelo
  searchSeq: 0,              // número de secuencia de la última búsqueda
  compareController: null,   // AbortController de la comparación en vuelo
  selected: [],               // hasta 2 equipos { id, name }
  pendingRetry: null,          // acción a reintentar tras re-autenticarse
};

/* ---------------------------------------------------------------
   3. Referencias al DOM
--------------------------------------------------------------- */
const els = {
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
};

/* ---------------------------------------------------------------
   4. Debounce (implementado a mano, sin librerías)
--------------------------------------------------------------- */
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ---------------------------------------------------------------
   5. Wrapper de fetch con Authorization + manejo de status
--------------------------------------------------------------- */
async function apiFetch(path, { signal } = {}) {
  const token = getToken();
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

/* ---------------------------------------------------------------
   5b. Búsqueda difusa (substring + tolerancia a errores de tipeo)
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
// nombre en inglés, en persa, y su alias en español si existe.
function searchableStringsFor(team) {
  const strings = [normalizeStr(team.name_en), normalizeStr(team.name_fa)];
  const alias = SPANISH_ALIASES[normalizeStr(team.name_en).replace(/\s+/g, '')];
  if (alias) strings.push(normalizeStr(alias));
  // También agrega el propio alias en español "hacia adelante": si
  // el query coincide con una llave (ej. "corea"), la llave misma
  // ya sirve como cadena buscable.
  Object.entries(SPANISH_ALIASES).forEach(([es, en]) => {
    if (normalizeStr(en) === normalizeStr(team.name_en)) strings.push(es);
  });
  return strings.filter(Boolean);
}

// Puntúa un equipo contra el texto buscado. Menor puntaje = mejor
// coincidencia. Devuelve Infinity si no hay coincidencia razonable.
function scoreTeam(query, team) {
  const nq = normalizeStr(query);
  let best = Infinity;

  searchableStringsFor(team).forEach((candidate) => {
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
  });

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
   6. Autocompletado
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

  try {
    const data = await apiFetch(`/get/teams`, { signal: controller.signal });

    // Chequeo extra de secuencia: aunque AbortController ya evita
    // que peticiones obsoletas se procesen, esta guarda protege
    // contra el caso raro de que dos respuestas lleguen casi juntas.
    if (mySeq !== state.searchSeq) return;

    const allTeams = Array.isArray(data) ? data : (data.teams || []);
    const matches = filterTeamsLocally(trimmed, allTeams);

    const normalized = matches.map((t) => ({ id: t.id, name: t.name_en || t.name, raw: t }));
    renderDropdown({ status: normalized.length ? 'ok' : 'no-results', teams: normalized });

  } catch (err) {
    if (err.name === 'AbortError') {
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

/* ---------------------------------------------------------------
   7. Render dinámico del dropdown (sin marcado fijo en HTML)
--------------------------------------------------------------- */
function renderDropdown({ status, teams = [] }) {
  els.dropdown.innerHTML = ''; // se vacía en cada búsqueda nueva

  if (status === 'empty') {
    els.dropdown.classList.add('hidden');
    return;
  }

  if (status === 'no-results') {
    const li = document.createElement('li');
    li.className = 'dropdown-message';
    li.textContent = 'No se encontraron selecciones con ese nombre.';
    els.dropdown.appendChild(li);
    els.dropdown.classList.remove('hidden');
    return;
  }

  if (status === 'error') {
    const li = document.createElement('li');
    li.className = 'dropdown-message error';
    li.textContent = 'No se pudo conectar con el servidor. Intente de nuevo.';
    els.dropdown.appendChild(li);
    els.dropdown.classList.remove('hidden');
    return;
  }

  teams.forEach((team) => {
    const li = document.createElement('li');
    const alreadyPicked = state.selected.some((t) => t.id === team.id);
    const isFull = state.selected.length >= 2;

    li.textContent = team.name;
    if (alreadyPicked || isFull) {
      li.classList.add('disabled');
    } else {
      li.addEventListener('click', () => selectTeam(team));
    }
    els.dropdown.appendChild(li);
  });

  els.dropdown.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) {
    els.dropdown.classList.add('hidden');
  }
});

/* ---------------------------------------------------------------
   8. Selección de equipos (máx. 2) + chips
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

/* ---------------------------------------------------------------
   9. Comparación en paralelo con Promise.all (sin .then/.catch)
--------------------------------------------------------------- */
async function loadComparison() {
  if (state.compareController) {
    state.compareController.abort();
  }
  const controller = new AbortController();
  state.compareController = controller;

  // Si el servidor de la API no responde nada en 12s (como el 504 que
  // vimos antes), abortamos nosotros mismos en vez de dejar "Cargando..."
  // pegado para siempre. Marcamos el controller para distinguir este
  // aborto "por timeout" de un aborto real por selección de otro equipo.
  const timeoutId = setTimeout(() => {
    controller.timedOut = true;
    controller.abort();
  }, 12000);

  const [teamA, teamB] = state.selected;
  showCompareLoading();

  try {
    // Todo se dispara al mismo tiempo con un solo Promise.all: detalle
    // de cada equipo, la tabla de su grupo, y el calendario completo
    // de partidos (para ubicar la fase/próximo partido).
    //
    // IMPORTANTE: la ruta /get/team/{id} (por ID) parece estar rota en
    // el servidor real (nunca respondió, ni siquiera abriéndola directo
    // en el navegador). La ruta /get/team/?name=... sí funciona (la
    // usamos antes y respondió normal), así que pedimos el detalle por
    // nombre en vez de por ID.
    const groupA = teamA.raw && teamA.raw.groups;
    const groupB = teamB.raw && teamB.raw.groups;

    const [dataA, dataB, standingsA, standingsB, gamesData] = await Promise.all([
      apiFetch(`/get/team/?name=${encodeURIComponent(teamA.name)}`, { signal: controller.signal }),
      apiFetch(`/get/team/?name=${encodeURIComponent(teamB.name)}`, { signal: controller.signal }),
      groupA ? apiFetch(`/get/group/?name=${encodeURIComponent(groupA)}`, { signal: controller.signal }) : Promise.resolve(null),
      groupB ? apiFetch(`/get/group/?name=${encodeURIComponent(groupB)}`, { signal: controller.signal }) : Promise.resolve(null),
      apiFetch(`/get/games`, { signal: controller.signal }),
    ]);

    // Algunas rutas de esta API envuelven el resultado en { team: {...} },
    // otras lo devuelven directo, y a veces en un arreglo. Si por algún
    // motivo viene vacío, caemos de vuelta a los datos que ya teníamos
    // guardados de cuando el equipo apareció en el buscador.
    const unwrapTeam = (data, fallback) => {
      if (Array.isArray(data) && data.length) return data[0];
      if (data && data.team && data.team.id) return data.team;
      if (data && data.id) return data;
      return fallback;
    };
    const teamDetailA = unwrapTeam(dataA, teamA.raw);
    const teamDetailB = unwrapTeam(dataB, teamB.raw);

    const games = Array.isArray(gamesData) ? gamesData : (gamesData.games || []);

    renderComparison(
      { ...teamDetailA, __standing: computeStanding(teamDetailA.id, standingsA), __nextMatch: findNextMatch(teamDetailA.id, games) },
      { ...teamDetailB, __standing: computeStanding(teamDetailB.id, standingsB), __nextMatch: findNextMatch(teamDetailB.id, games) },
    );
    clearTimeout(timeoutId);

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      if (controller.timedOut) {
        console.error('[timeout] El servidor no respondió en 12s durante la comparación.');
        renderCompareError('El servidor tardó demasiado en responder (más de 12 segundos). Puede ser una caída temporal de la API.');
        return;
      }
      console.log('[AbortController] Comparación cancelada (se eligió otro equipo antes de terminar).');
      return;
    }
    if (err.isAuthError) {
      openReauthModal(() => loadComparison());
      return;
    }
    if (err.isNotFound) {
      renderCompareError('Uno de los equipos seleccionados ya no está disponible.');
      return;
    }
    if (err instanceof TypeError) {
      // fetch() rechaza con TypeError cuando la petición nunca llegó a
      // tener una respuesta real: caída del servidor, timeout de la
      // pasarela (504), o bloqueo de CORS. No es un 401/404 que la API
      // haya devuelto explícitamente.
      console.error('Fallo de red/CORS en la comparación (posible caída temporal de la API):', err);
      renderCompareError('No se pudo contactar con el servidor de la API en este momento. Puede ser una caída temporal. Intenta de nuevo en unos segundos.');
      return;
    }
    console.error('Error real de red en la comparación:', err);
    renderCompareError('Ocurrió un error al cargar la comparación. Intente de nuevo.');
  }
}

/* ---------------------------------------------------------------
   9b. Helpers: posición en el grupo y fase del torneo
--------------------------------------------------------------- */
const STAGE_LABELS = {
  group: 'Fase de grupos',
  r32: 'Ronda de 32',
  r16: 'Octavos de final',
  qf: 'Cuartos de final',
  sf: 'Semifinal',
  third: 'Partido por el tercer lugar',
  final: 'Final',
};

function computeStanding(teamId, groupData) {
  if (!groupData) return null;
  // La API puede envolver la tabla como { group, teams } o devolverla directo.
  const table = groupData.teams || (groupData.group && groupData.group.teams) || null;
  if (!Array.isArray(table)) return null;

  const groupLetter = groupData.group && typeof groupData.group === 'string'
    ? groupData.group
    : (groupData.group && groupData.group.group) || groupData.groupName || '';

  const sorted = [...table].sort((a, b) => {
    const ptsDiff = Number(b.pts) - Number(a.pts);
    if (ptsDiff !== 0) return ptsDiff;
    const gdA = Number(a.gf) - Number(a.ga);
    const gdB = Number(b.gf) - Number(b.ga);
    return gdB - gdA;
  });

  const index = sorted.findIndex((row) => String(row.team_id) === String(teamId));
  if (index === -1) return null;

  const row = sorted[index];
  return {
    group: groupLetter,
    position: index + 1,
    total: sorted.length,
    pts: row.pts,
    gf: row.gf,
    ga: row.ga,
  };
}

function findNextMatch(teamId, games) {
  const teamGames = games
    .filter((g) => String(g.home_team_id) === String(teamId) || String(g.away_team_id) === String(teamId))
    .sort((a, b) => Number(a.matchday) - Number(b.matchday));

  if (!teamGames.length) return null;

  // Prioriza el primer partido no jugado; si todos están jugados,
  // muestra el más reciente como "último resultado".
  const upcoming = teamGames.find((g) => g.finished === 'FALSE' || g.finished === false);
  const target = upcoming || teamGames[teamGames.length - 1];

  const isHome = String(target.home_team_id) === String(teamId);
  const opponent = isHome ? target.away_team_name_en : target.home_team_name_en;
  const opponentLabel = isHome ? target.away_team_label : target.home_team_label;

  return {
    isUpcoming: Boolean(upcoming),
    stage: STAGE_LABELS[target.type] || target.type,
    opponent: opponent || opponentLabel || 'Por definir',
    date: target.local_date,
    score: `${target.home_score}-${target.away_score}`,
    homeAway: isHome ? 'Local' : 'Visitante',
  };
}


function resetCompareView() {
  els.compareColumns.classList.add('hidden');
  els.compareColumns.innerHTML = '';
  els.compareError.classList.add('hidden');
  els.compareLoading.classList.add('hidden');
  els.emptyState.classList.toggle('hidden', state.selected.length > 0);
}

function showCompareLoading() {
  els.emptyState.classList.add('hidden');
  els.compareError.classList.add('hidden');
  els.compareColumns.classList.add('hidden');
  els.compareLoading.classList.remove('hidden');
}

function renderCompareError(message) {
  els.compareLoading.classList.add('hidden');
  els.compareColumns.classList.add('hidden');
  els.compareError.innerHTML = '';

  const text = document.createElement('p');
  text.textContent = message;
  els.compareError.appendChild(text);

  if (state.selected.length === 2) {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = 'Reintentar';
    retryBtn.addEventListener('click', () => loadComparison());
    els.compareError.appendChild(retryBtn);
  }

  els.compareError.classList.remove('hidden');
}

function renderComparison(teamA, teamB) {
  els.compareLoading.classList.add('hidden');
  els.compareError.classList.add('hidden');
  els.emptyState.classList.add('hidden');
  els.compareColumns.innerHTML = '';

  [teamA, teamB].forEach((team) => {
    els.compareColumns.appendChild(buildTeamColumn(team));
  });

  els.compareColumns.classList.remove('hidden');
}

// Etiquetas legibles para los campos reales que devuelve la API
// (name_en, name_fa, fifa_code, groups, flag, _id...).
const FIELD_LABELS = {
  name_fa: 'Nombre (persa)',
  fifa_code: 'Código FIFA',
};
const HIDDEN_FIELDS = new Set(['_id', '__v', 'id', 'name_en', 'groups', 'flag', '__standing', '__nextMatch']);

function buildTeamColumn(team) {
  const col = document.createElement('div');
  col.className = 'team-column';

  if (team.flag) {
    const img = document.createElement('img');
    img.src = team.flag;
    img.alt = `Bandera de ${team.name_en || ''}`;
    img.className = 'team-flag';
    // Si la URL de bandera falla, la ocultamos en vez de dejar un
    // ícono de imagen rota.
    img.addEventListener('error', () => img.remove());
    col.appendChild(img);
  }

  const title = document.createElement('h3');
  title.textContent = team.name_en || team.name || 'Equipo';
  col.appendChild(title);

  // ---- Posición en el grupo ----
  if (team.__standing) {
    const s = team.__standing;
    const standingBox = document.createElement('div');
    standingBox.className = 'standing-box';
    standingBox.innerHTML = `
      <strong>Grupo ${s.group}</strong> · ${s.position}° de ${s.total}<br>
      ${s.pts} pts · GF ${s.gf} · GA ${s.ga}
    `;
    col.appendChild(standingBox);
  } else if (team.groups) {
    const standingBox = document.createElement('div');
    standingBox.className = 'standing-box';
    standingBox.textContent = `Grupo ${team.groups}`;
    col.appendChild(standingBox);
  }

  // ---- Próximo partido / último resultado ----
  if (team.__nextMatch) {
    const m = team.__nextMatch;
    const matchBox = document.createElement('div');
    matchBox.className = 'match-box';
    if (m.isUpcoming) {
      matchBox.innerHTML = `
        <strong>Próximo partido</strong><br>
        ${m.stage} vs. ${m.opponent} (${m.homeAway})<br>
        ${m.date || 'Fecha por confirmar'}
      `;
    } else {
      matchBox.innerHTML = `
        <strong>Último resultado</strong><br>
        ${m.stage} vs. ${m.opponent}: ${m.score}
      `;
    }
    col.appendChild(matchBox);
  }

  const dl = document.createElement('dl');
  // Se itera sobre las llaves reales que devuelva la API para no
  // asumir una forma fija; cualquier campo nuevo que agreguen se
  // muestra igual, con una etiqueta genérica si no está mapeada.
  Object.entries(team).forEach(([key, value]) => {
    if (HIDDEN_FIELDS.has(key)) return;
    const dt = document.createElement('dt');
    dt.textContent = FIELD_LABELS[key] || key;
    const dd = document.createElement('dd');
    dd.textContent = typeof value === 'object' ? JSON.stringify(value) : value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  col.appendChild(dl);

  return col;
}


/* ---------------------------------------------------------------
   11. Modal de re-autenticación (401) — sin reload jamás
--------------------------------------------------------------- */
function openReauthModal(retryAction) {
  state.pendingRetry = retryAction || null;
  els.loginError.classList.add('hidden');
  els.modal.classList.remove('hidden');
}

function closeReauthModal() {
  els.modal.classList.add('hidden');
}

async function loginRequest(email, password) {
  // Ruta real confirmada: POST /auth/authenticate { email, password }
  // -> { user, token }
  const response = await fetch(`${CONFIG.BASE_URL}/auth/authenticate`, {
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
    els.loginError.textContent = 'No se pudo iniciar sesión. Verifique sus credenciales.';
    els.loginError.classList.remove('hidden');
  }
});

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
