
import { CONFIG, state, els } from './config.js';
import { apiFetch } from './api.js';
import { openReauthModal } from './auth.js';
import { loadComparison, resetCompareView } from './compare.js';

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function normalizeStr(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

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

function searchableStringsFor(team) {
  const primary = [normalizeStr(team.name_en), normalizeStr(team.name_fa)].filter(Boolean);

  const aliasStrings = [];
  const alias = SPANISH_ALIASES[normalizeStr(team.name_en).replace(/\s+/g, '')];
  if (alias) aliasStrings.push(normalizeStr(alias));

  Object.entries(SPANISH_ALIASES).forEach(([es, en]) => {
    if (normalizeStr(en) === normalizeStr(team.name_en)) aliasStrings.push(es);
  });

  return { primary, aliasStrings: aliasStrings.filter(Boolean) };
}

function scoreTeam(query, team) {
  const nq = normalizeStr(query);
  let best = Infinity;
  const { primary, aliasStrings } = searchableStringsFor(team);

  const checkCandidate = (candidate) => {
    if (!candidate) return;
    if (candidate.startsWith(nq)) { best = Math.min(best, 0); return; }
    if (candidate.includes(nq)) { best = Math.min(best, 1); return; }

    if (nq.length >= 3) {
      const words = candidate.split(' ');
      words.forEach((word) => {
        const distance = levenshtein(nq, word);
        const threshold = nq.length <= 4 ? 1 : 2;
        if (distance <= threshold) best = Math.min(best, 2 + distance);
      });
    }
  };

  primary.forEach(checkCandidate);
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

async function performSearch(query) {

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

  const timeoutId = setTimeout(() => {
    controller.timedOut = true;
    controller.abort();
  }, 10000);

  try {
    const data = await apiFetch(`/get/teams`, { signal: controller.signal });
    clearTimeout(timeoutId);

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
    console.error('Error real de red en autocompletado:', err);
    renderDropdown({ status: 'error' });
  }
}

const debouncedSearch = debounce(performSearch, CONFIG.DEBOUNCE_MS);

els.input.addEventListener('input', (e) => {
  debouncedSearch(e.target.value);
});

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


function selectTeam(team) {
  if (state.selected.length >= 2) return;
  state.selected.push(team);
  renderSelectedBar();
  els.input.value = '';
  els.dropdown.classList.add('hidden');
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

  els.compareBtn.classList.toggle('hidden', state.selected.length === 0);
  els.compareBtn.disabled = state.selected.length !== 2;
  els.compareBtn.textContent = state.selected.length === 2
    ? 'Comparar equipos'
    : 'Selecciona un equipo más';
}

els.compareBtn.addEventListener('click', () => {
  if (state.selected.length === 2) loadComparison();
});
