
import { state, els } from './config.js';
import { apiFetch } from './api.js';
import { openReauthModal } from './auth.js';

export async function loadComparison() {
  if (state.compareController) {
    state.compareController.abort();
  }
  const controller = new AbortController();
  state.compareController = controller;


  const timeoutId = setTimeout(() => {
    controller.timedOut = true;
    controller.abort();
  }, 12000);

  const [teamA, teamB] = state.selected;
  showCompareLoading();

  try {
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

      renderCompareError('Tu sesión expiró: no se pudo completar la comparación. Inicia sesión de nuevo para continuar.');
      openReauthModal(() => loadComparison());
      return;
    }
    if (err.isNotFound) {
      renderCompareError('Uno de los equipos seleccionados ya no está disponible.');
      return;
    }
    if (err instanceof TypeError) {
  
      console.error('Fallo de red/CORS en la comparación (posible caída temporal de la API):', err);
      renderCompareError('No se pudo contactar con el servidor de la API en este momento. Puede ser una caída temporal. Intenta de nuevo en unos segundos.');
      return;
    }
    console.error('Error real de red en la comparación:', err);
    renderCompareError('Ocurrió un error al cargar la comparación. Intente de nuevo.');
  }
}

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

function resolveStadiumName(game, stadiums) {
  if (!game) return null;

  if (game.stadium_name) return game.stadium_name;
  if (game.venue_name) return game.venue_name;
  if (typeof game.stadium === 'string') return game.stadium;
  if (typeof game.venue === 'string') return game.venue;

  const stadiumId = game.stadium_id || game.venue_id || (game.stadium && game.stadium.id);
  if (!stadiumId || !Array.isArray(stadiums)) return null;

  const match = stadiums.find((s) => String(s.id) === String(stadiumId));
  return match ? (match.name_en || match.name || match.stadium_name || null) : null;
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

function findTeamMatches(teamId, games, stadiums) {
  const teamGames = games
    .filter((g) => String(g.home_team_id) === String(teamId) || String(g.away_team_id) === String(teamId))
    .sort((a, b) => Number(a.matchday) - Number(b.matchday));

  if (!teamGames.length) return { __lastMatch: null, __nextMatch: null, __goalsScored: null, __matchesPlayed: null };

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
    __matchesPlayed: played.length,
  };
}

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

const HIDDEN_FIELDS = new Set([
  '_id', '__v', 'id', 'name_en', 'groups', 'flag',
  'name_fa', 'fifa_code', 'iso2',
  '__standing', '__nextMatch', '__lastMatch', '__goalsScored', '__matchesPlayed',
]);

function buildTeamColumn(team) {
  const col = document.createElement('div');
  col.className = 'team-column';
  col.tabIndex = 0;
  col.setAttribute('role', 'group');
  col.setAttribute('aria-label', `Comparación de ${team.name_en || team.name || 'equipo'}`);

  if (team.flag) {
    const img = document.createElement('img');
    img.src = team.flag;
    img.alt = `Bandera de ${team.name_en || ''}`;
    img.className = 'team-flag';
    img.addEventListener('error', () => img.remove());
    col.appendChild(img);
  }

  const title = document.createElement('h3');
  title.textContent = team.name_en || team.name || 'Equipo';
  col.appendChild(title);

  const matchesLabel = (team.__matchesPlayed !== null && team.__matchesPlayed !== undefined)
    ? `🏃 ${team.__matchesPlayed} partido${team.__matchesPlayed === 1 ? '' : 's'} jugado${team.__matchesPlayed === 1 ? '' : 's'} en el mundial`
    : '';

  if (team.__standing) {
    const s = team.__standing;
    const standingBox = document.createElement('div');
    standingBox.className = 'standing-box';
    standingBox.innerHTML = `
      <strong>Grupo ${s.group}</strong> · ${s.position}° de ${s.total} · ${s.pts} pts<br>
      ⚽ ${s.gf} goles anotados · ${s.ga} recibidos
      ${matchesLabel ? `<br>${matchesLabel}` : ''}
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
    if (matchesLabel) {
      const matchesLine = document.createElement('div');
      matchesLine.textContent = matchesLabel;
      standingBox.appendChild(matchesLine);
    }
    col.appendChild(standingBox);
  }

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
