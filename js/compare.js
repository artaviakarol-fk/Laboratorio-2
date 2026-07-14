/* ===================================================================
   compare.js
   Todo lo de la comparación: la carga en paralelo con Promise.all
   (detalle de cada equipo + su grupo + el calendario + estadios),
   el cálculo de posición/último-próximo partido, y el render de las
   dos columnas.
=================================================================== */

import { state, els } from './config.js';
import { apiFetch } from './api.js';
import { openReauthModal } from './auth.js';

/* ---------------------------------------------------------------
   Comparación en paralelo con Promise.all (sin .then/.catch)
--------------------------------------------------------------- */
export async function loadComparison() {
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

    const [dataA, dataB, standingsA, standingsB, gamesData, stadiumsData] = await Promise.all([
      apiFetch(`/get/team/?name=${encodeURIComponent(teamA.name)}`, { signal: controller.signal }),
      apiFetch(`/get/team/?name=${encodeURIComponent(teamB.name)}`, { signal: controller.signal }),
      groupA ? apiFetch(`/get/group/?name=${encodeURIComponent(groupA)}`, { signal: controller.signal }) : Promise.resolve(null),
      groupB ? apiFetch(`/get/group/?name=${encodeURIComponent(groupB)}`, { signal: controller.signal }) : Promise.resolve(null),
      apiFetch(`/get/games`, { signal: controller.signal }),
      apiFetch(`/get/stadiums`, { signal: controller.signal }),
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
    const stadiums = Array.isArray(stadiumsData) ? stadiumsData : (stadiumsData.stadiums || []);

    renderComparison(
      { ...teamDetailA, __standing: computeStanding(teamDetailA.id, standingsA), ...findTeamMatches(teamDetailA.id, games, stadiums) },
      { ...teamDetailB, __standing: computeStanding(teamDetailB.id, standingsB), ...findTeamMatches(teamDetailB.id, games, stadiums) },
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
      // Se muestra el error de que la comparación no se pudo completar
      // (queda visible detrás del modal), y ADEMÁS se abre el modal
      // pidiendo iniciar sesión de nuevo. Al reautenticarse, se
      // reintenta esta misma comparación automáticamente.
      renderCompareError('Tu sesión expiró: no se pudo completar la comparación. Inicia sesión de nuevo para continuar.');
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
   Helpers: posición en el grupo y fase del torneo
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

// Resuelve el nombre del estadio probando varias formas posibles de
// enlazar partido -> estadio, porque no confirmamos el nombre exacto
// del campo en /get/games (stadium_id, venue_id, stadium_name directo...).
function resolveStadiumName(game, stadiums) {
  if (!game) return null;
  // Si el partido ya trae el nombre directo, se usa tal cual.
  if (game.stadium_name) return game.stadium_name;
  if (game.venue_name) return game.venue_name;
  if (typeof game.stadium === 'string') return game.stadium;
  if (typeof game.venue === 'string') return game.venue;

  const stadiumId = game.stadium_id || game.venue_id || (game.stadium && game.stadium.id);
  if (!stadiumId || !Array.isArray(stadiums)) return null;

  const match = stadiums.find((s) => String(s.id) === String(stadiumId));
  return match ? (match.name || match.stadium_name || null) : null;
}

function buildMatchInfo(target, teamId, stadiums, isUpcoming) {
  const isHome = String(target.home_team_id) === String(teamId);
  const opponent = isHome ? target.away_team_name_en : target.home_team_name_en;
  const opponentLabel = isHome ? target.away_team_label : target.home_team_label;

  return {
    isUpcoming,
    stage: STAGE_LABELS[target.type] || target.type,
    opponent: opponent || opponentLabel || 'Por definir',
    date: target.local_date,
    score: `${target.home_score}-${target.away_score}`,
    homeAway: isHome ? 'Local' : 'Visitante',
    stadium: resolveStadiumName(target, stadiums),
  };
}

// Devuelve el último partido jugado y el próximo pendiente (si existe),
// además del total de goles anotados en los partidos ya jugados.
function findTeamMatches(teamId, games, stadiums) {
  const teamGames = games
    .filter((g) => String(g.home_team_id) === String(teamId) || String(g.away_team_id) === String(teamId))
    .sort((a, b) => Number(a.matchday) - Number(b.matchday));

  if (!teamGames.length) return { __lastMatch: null, __nextMatch: null, __goalsScored: null };

  const played = teamGames.filter((g) => !(g.finished === 'FALSE' || g.finished === false));
  const upcoming = teamGames.find((g) => g.finished === 'FALSE' || g.finished === false);

  const lastPlayed = played.length ? played[played.length - 1] : null;

  const goalsScored = played.reduce((total, g) => {
    const isHome = String(g.home_team_id) === String(teamId);
    const goals = Number(isHome ? g.home_score : g.away_score);
    return total + (Number.isFinite(goals) ? goals : 0);
  }, 0);

  return {
    __lastMatch: lastPlayed ? buildMatchInfo(lastPlayed, teamId, stadiums, false) : null,
    __nextMatch: upcoming ? buildMatchInfo(upcoming, teamId, stadiums, true) : null,
    __goalsScored: played.length ? goalsScored : null,
  };
}

/* ---------------------------------------------------------------
   Render de las vistas de comparación
--------------------------------------------------------------- */
export function resetCompareView() {
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

// Campos que el profesor pidió NO mostrar por ser poco relevantes
// para comparar equipos (nombre en persa, código FIFA, iso2), además
// de los campos internos que ya se muestran aparte (bandera, grupo).
const HIDDEN_FIELDS = new Set([
  '_id', '__v', 'id', 'name_en', 'groups', 'flag',
  'name_fa', 'fifa_code', 'iso2',
  '__standing', '__nextMatch', '__lastMatch', '__goalsScored',
]);

function buildTeamColumn(team) {
  const col = document.createElement('div');
  col.className = 'team-column';
  // Es contenido informativo, no un control, pero el profesor pidió
  // que Tab recorra TODA la página — con esto, un usuario de teclado
  // puede "aterrizar" en cada tarjeta, y un lector de pantalla anuncia
  // el nombre del equipo al enfocarla.
  col.tabIndex = 0;
  col.setAttribute('role', 'group');
  col.setAttribute('aria-label', `Comparación de ${team.name_en || team.name || 'equipo'}`);

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

  // ---- Posición en el grupo + goles anotados ----
  if (team.__standing) {
    const s = team.__standing;
    const standingBox = document.createElement('div');
    standingBox.className = 'standing-box';
    standingBox.innerHTML = `
      <strong>Grupo ${s.group}</strong> · ${s.position}° de ${s.total} · ${s.pts} pts<br>
      ⚽ ${s.gf} goles anotados · ${s.ga} recibidos
    `;
    col.appendChild(standingBox);
  } else if (team.groups) {
    const standingBox = document.createElement('div');
    standingBox.className = 'standing-box';
    let text = `Grupo ${team.groups}`;
    if (team.__goalsScored !== null && team.__goalsScored !== undefined) {
      text += ` · ⚽ ${team.__goalsScored} goles anotados`;
    }
    standingBox.textContent = text;
    col.appendChild(standingBox);
  }

  // ---- Último partido jugado (con estadio) ----
  if (team.__lastMatch) {
    const m = team.__lastMatch;
    const matchBox = document.createElement('div');
    matchBox.className = 'match-box';
    matchBox.innerHTML = `
      <strong>Último partido jugado</strong><br>
      ${m.stage} vs. ${m.opponent}: ${m.score} (${m.homeAway})<br>
      ${m.stadium ? `🏟️ ${m.stadium}<br>` : ''}
      ${m.date || ''}
    `;
    col.appendChild(matchBox);
  }

  // ---- Próximo partido (si todavía tiene uno pendiente) ----
  if (team.__nextMatch) {
    const m = team.__nextMatch;
    const matchBox = document.createElement('div');
    matchBox.className = 'match-box next-match-box';
    matchBox.innerHTML = `
      <strong>Próximo partido</strong><br>
      ${m.stage} vs. ${m.opponent} (${m.homeAway})<br>
      ${m.stadium ? `🏟️ ${m.stadium}<br>` : ''}
      ${m.date || 'Fecha por confirmar'}
    `;
    col.appendChild(matchBox);
  }

  const dl = document.createElement('dl');
  // Se itera sobre las llaves reales que devuelva la API para no
  // asumir una forma fija; cualquier campo nuevo que agreguen se
  // muestra igual, salvo los que el profesor pidió ocultar.
  Object.entries(team).forEach(([key, value]) => {
    if (HIDDEN_FIELDS.has(key)) return;
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = typeof value === 'object' ? JSON.stringify(value) : value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  if (dl.children.length) col.appendChild(dl);

  return col;
}
