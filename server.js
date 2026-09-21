const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3001);
const LEAGUE_ID = Number(process.env.FOTMOB_LEAGUE_ID || 268);
const SEASON_YEAR = String(process.env.SEASON || '2026');
const SEASON_INTERNAL_ID = String(process.env.FOTMOB_SEASON_ID || '1000000388');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENABLE_DEBUG_ROUTES = String(process.env.ENABLE_DEBUG_ROUTES || 'false').toLowerCase() === 'true';

// /api/data é a superfície web atualmente usada por clientes FotMob recentes.
// /api fica como fallback porque algumas instalações/regiões ainda respondem por ela.
const API_BASES = [
  process.env.FOTMOB_API_BASE,
  'https://www.fotmob.com/api/data',
  'https://www.fotmob.com/api',
].filter(Boolean);

const memoryCache = new Map();

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function getCached(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(key, value, ttlMs) {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'string') value = value.replace(/[^0-9,.-]/g, '').replace(',', '.');
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = num(value);
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(n)) return n;
  }
  return 0;
}

function emptyStats() {
  return { goals: 0, assists: 0, passes: 0, shots: 0, tackles: 0, shotsOnTarget: 0, yellow: 0, red: 0, minutes: 0 };
}

function addStats(target, source) {
  for (const key of Object.keys(target)) target[key] += num(source?.[key]);
  return target;
}

function teamLogo(id) {
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
}

function playerPhoto(id) {
  return `https://images.fotmob.com/image_resources/playerimages/${id}.png`;
}

function mapPosition(value, groupTitle = '') {
  const text = `${value || ''} ${groupTitle || ''}`.toLowerCase();
  if (/keeper|goalkeeper|goleiro/.test(text)) return 'Goalkeeper';
  if (/defender|defence|defensor|zague|back/.test(text)) return 'Defender';
  if (/midfielder|midfield|meio|volante/.test(text)) return 'Midfielder';
  if (/forward|attacker|striker|winger|ataque|atacante|ponta/.test(text)) return 'Attacker';
  return 'Unknown';
}

function buildUrl(base, endpoint, params = {}) {
  const u = new URL(`${base.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') u.searchParams.set(key, String(value));
  }
  return u;
}

async function fetchJson(endpoint, params = {}, { ttlMs = 0, allow404 = false } = {}) {
  const cacheKey = `json:${endpoint}:${JSON.stringify(params)}`;
  if (ttlMs) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  let lastError = null;
  const attempts = [];

  for (const base of API_BASES) {
    const url = buildUrl(base, endpoint, params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://www.fotmob.com/',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.status === 404 && allow404) return null;
      const text = await response.text();
      const contentType = response.headers.get('content-type') || '';
      let body = null;
      try { body = JSON.parse(text); } catch {}

      attempts.push({ url: url.toString(), status: response.status, contentType });

      if (!response.ok || !body) {
        const preview = text.replace(/\s+/g, ' ').slice(0, 220);
        const err = new Error(`FotMob HTTP ${response.status}: ${body ? JSON.stringify(body).slice(0, 220) : preview}`);
        err.statusCode = response.status === 429 ? 429 : 502;
        err.upstreamStatus = response.status;
        err.url = url.toString();
        lastError = err;
        continue;
      }

      if (ttlMs) setCached(cacheKey, body, ttlMs);
      return body;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      attempts.push({ url: url.toString(), error: error.message });
    }
  }

  const err = new Error(lastError?.name === 'AbortError' ? 'A consulta ao FotMob demorou demais.' : (lastError?.message || 'Não foi possível acessar o FotMob.'));
  err.statusCode = lastError?.statusCode || 502;
  err.attempts = attempts;
  throw err;
}

async function fetchHtml(url, { ttlMs = 0 } = {}) {
  const cacheKey = `html:${url}`;
  if (ttlMs) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const html = await response.text();
    if (!response.ok) {
      const err = new Error(`FotMob página HTTP ${response.status}: ${html.replace(/\s+/g, ' ').slice(0, 180)}`);
      err.statusCode = 502;
      throw err;
    }
    if (ttlMs) setCached(cacheKey, html, ttlMs);
    return html;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

function parseNextData(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function visibleText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' '));
}

function normalizeLabel(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function statMapFromArray(arr) {
  const out = new Map();
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const label = normalizeLabel(item.title || item.label || item.name || item.key);
    const value = item.value?.value ?? item.value?.fallback ?? item.value ?? item.stat?.value ?? item.total;
    if (label && value !== undefined) out.set(label, value);
  }
  return out;
}

function findNumericAfter(text, labels, startAt = 0) {
  const scope = text.slice(startAt);
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s*[:]?\\s*([0-9][0-9.,]*)`, 'i');
    const m = scope.match(re);
    if (m) return num(m[1]);
  }
  return 0;
}

async function getLeaguePayload() {
  const cacheKey = `league:${LEAGUE_ID}:${SEASON_YEAR}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  let body;
  try {
    body = await fetchJson('leagues', { id: LEAGUE_ID, ccode3: 'BRA', season: SEASON_YEAR }, { ttlMs: 15 * 60 * 1000 });
  } catch (firstError) {
    body = await fetchJson('leagues', { id: LEAGUE_ID, ccode3: 'BRA' }, { ttlMs: 15 * 60 * 1000 });
  }
  return setCached(cacheKey, body, 15 * 60 * 1000);
}

function tableRowsFromLeague(body) {
  const rows = [];
  const tables = Array.isArray(body?.table) ? body.table : [body?.table].filter(Boolean);
  for (const block of tables) {
    const all = block?.data?.table?.all || block?.table?.all || block?.data?.all || block?.all;
    if (Array.isArray(all)) rows.push(...all);
  }
  if (!rows.length && Array.isArray(body?.table?.all)) rows.push(...body.table.all);
  return rows;
}

async function getTeams() {
  const cacheKey = `teams:${LEAGUE_ID}:${SEASON_YEAR}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const body = await getLeaguePayload();
  const rows = tableRowsFromLeague(body);
  const seen = new Set();
  const teams = rows
    .filter((row) => row?.id && !seen.has(Number(row.id)) && seen.add(Number(row.id)))
    .map((row) => ({
      id: Number(row.id),
      name: row.name || row.shortName || `Clube ${row.id}`,
      shortName: row.shortName || row.name || '',
      code: row.ccode || '',
      logo: teamLogo(row.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  if (!teams.length) {
    const err = new Error(`O FotMob respondeu, mas a tabela da Série A ${SEASON_YEAR} não trouxe clubes. Abra /api/debug-source.`);
    err.statusCode = 502;
    throw err;
  }
  console.log(`FotMob: ${teams.length} clubes encontrados para ${SEASON_YEAR}.`);
  return setCached(cacheKey, { teams, source: 'FotMob' }, 30 * 60 * 1000);
}

async function getTeamMeta(teamId) {
  try {
    const all = await getTeams();
    const team = all.teams.find((t) => Number(t.id) === Number(teamId));
    if (team) return team;
  } catch {}
  return { id: Number(teamId), name: `Clube ${teamId}`, logo: teamLogo(teamId) };
}

function squadRoots(body) {
  const roots = [
    body?.squad,
    body?.data?.squad,
    body?.team?.squad,
    body?.overview?.squad,
  ].filter(Boolean);
  return roots;
}

function normalizeSquadMember(member, groupTitle, team) {
  if (!member || typeof member !== 'object') return null;
  const raw = member.player || member.member || member;
  const id = Number(
    raw?.id || raw?.playerId || raw?.participantId ||
    member?.id || member?.playerId || member?.participantId ||
    raw?.player?.id
  );
  if (!id) return null;

  const groupText = String(groupTitle || raw?.role || raw?.position || '').toLowerCase();
  if (/coach|manager|staff|treinador|tecnico|técnico/.test(groupText)) return null;

  const name = raw?.name || raw?.playerName || raw?.participantName || raw?.cname || raw?.shortName || `Jogador ${id}`;
  const position = mapPosition(
    raw?.role || raw?.position || raw?.positionName || raw?.positionDescription || raw?.positionId,
    groupTitle
  );

  return {
    id,
    name,
    shortName: raw?.cname || raw?.shortName || name,
    number: raw?.shirtNumber || raw?.jerseyNumber || raw?.number || member?.shirtNumber || null,
    position,
    photo: playerPhoto(id),
    team: { id: Number(team.id), name: team.name, logo: team.logo || teamLogo(team.id) },
  };
}

function playersFromTeamPayload(body, team) {
  const players = [];

  for (const root of squadRoots(body)) {
    if (Array.isArray(root)) {
      // Formato antigo/alternativo: [{ position/title, members: [...] }, ...]
      for (const group of root) {
        if (!group || typeof group !== 'object') continue;
        const title = group.position || group.title || group.name || group.role || '';
        const members = group.members || group.players || group.squad || [];
        if (Array.isArray(members)) {
          for (const member of members) {
            const normalized = normalizeSquadMember(member, title, team);
            if (normalized) players.push(normalized);
          }
        } else {
          const normalized = normalizeSquadMember(group, title, team);
          if (normalized) players.push(normalized);
        }
      }
      continue;
    }

    if (root && typeof root === 'object') {
      // Formato atual observado em clientes FotMob: { keepers: [...], defenders: [...], ... }
      if (Array.isArray(root.members)) {
        for (const member of root.members) {
          const normalized = normalizeSquadMember(member, root.position || root.title || '', team);
          if (normalized) players.push(normalized);
        }
      }

      for (const [groupName, value] of Object.entries(root)) {
        if (Array.isArray(value)) {
          for (const member of value) {
            const normalized = normalizeSquadMember(member, groupName, team);
            if (normalized) players.push(normalized);
          }
        } else if (value && typeof value === 'object' && Array.isArray(value.members)) {
          const title = value.position || value.title || value.name || groupName;
          for (const member of value.members) {
            const normalized = normalizeSquadMember(member, title, team);
            if (normalized) players.push(normalized);
          }
        }
      }
    }
  }

  return [...new Map(players.map((p) => [p.id, p])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function deepStatsRows(body) {
  const candidates = [
    body?.statsData,
    body?.data?.statsData,
    body?.stats?.data,
    body?.players,
    body?.data?.players,
  ];
  return candidates.find(Array.isArray) || [];
}

function playersFromDeepStats(body, team) {
  const rows = deepStatsRows(body);
  const players = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const raw = row.player || row.participant || row;
    const rowTeamId = Number(row.teamId || row.team?.id || raw.teamId || raw.team?.id || 0);
    if (rowTeamId && rowTeamId !== Number(team.id)) continue;
    const id = Number(row.id || row.playerId || row.participantId || raw.id || raw.playerId || raw.participantId);
    if (!id) continue;
    const name = row.name || row.playerName || row.participantName || raw.name || raw.playerName || raw.participantName || `Jogador ${id}`;
    players.push({
      id,
      name,
      shortName: row.shortName || raw.shortName || name,
      number: row.shirtNumber || row.jerseyNumber || raw.shirtNumber || raw.jerseyNumber || null,
      position: mapPosition(row.position || row.role || raw.position || raw.role || row.positionName || raw.positionName, row.positionGroup || ''),
      photo: playerPhoto(id),
      team: { id: Number(team.id), name: team.name, logo: team.logo || teamLogo(team.id) },
    });
  }
  return [...new Map(players.map((p) => [p.id, p])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

async function getSquad(teamId) {
  const cacheKey = `squad:${teamId}:${SEASON_YEAR}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const team = await getTeamMeta(teamId);
  let teamBody = null;
  let teamEndpointError = null;
  let players = [];

  try {
    teamBody = await fetchJson('teams', { id: teamId, ccode3: 'BRA' }, { ttlMs: 60 * 60 * 1000 });
    players = playersFromTeamPayload(teamBody, team);
  } catch (error) {
    teamEndpointError = error;
    console.warn(`FotMob /teams falhou para ${team.name}: ${error.message}`);
  }

  // Fallback especificamente da temporada 2026. Além de contornar mudanças no
  // formato de /teams, evita misturar jogadores que não atuaram no Brasileirão 2026.
  if (!players.length) {
    const statCandidates = ['mins_played', 'goals', 'goal_assist'];
    for (const stat of statCandidates) {
      try {
        const statsBody = await fetchJson('leagueseasondeepstats', {
          id: LEAGUE_ID,
          season: SEASON_INTERNAL_ID,
          type: 'players',
          stat,
          teamId,
        }, { ttlMs: 30 * 60 * 1000 });
        players = playersFromDeepStats(statsBody, team);
        if (players.length) {
          console.log(`FotMob: elenco de ${team.name} carregado via deepstats (${stat}), ${players.length} jogadores.`);
          break;
        }
      } catch (error) {
        console.warn(`FotMob deepstats ${stat} falhou para ${team.name}: ${error.message}`);
      }
    }
  } else {
    console.log(`FotMob: elenco de ${team.name} carregado via /teams, ${players.length} jogadores.`);
  }

  if (!players.length) {
    const err = new Error(`O FotMob respondeu para ${team.name}, mas o formato do elenco não pôde ser lido. Abra /api/debug-team?team=${teamId}.`);
    err.statusCode = 502;
    err.teamEndpointError = teamEndpointError?.message;
    throw err;
  }

  return setCached(cacheKey, { players, source: teamBody ? 'FotMob team/deepstats' : 'FotMob deepstats' }, 60 * 60 * 1000);
}

async function getPlayerPage(playerId) {
  const cacheKey = `player-page:${playerId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const url = `https://www.fotmob.com/players/${playerId}`;
  const html = await fetchHtml(url, { ttlMs: 10 * 60 * 1000 });
  const next = parseNextData(html);
  const pageProps = next?.props?.pageProps || {};
  const data = pageProps?.data || pageProps?.player || pageProps;
  const result = { html, text: visibleText(html), data };
  return setCached(cacheKey, result, 10 * 60 * 1000);
}

async function getPlayerMeta(playerId, teamId) {
  if (teamId) {
    try {
      const squad = await getSquad(teamId);
      const found = squad.players.find((p) => Number(p.id) === Number(playerId));
      if (found) return found;
    } catch {}
  }
  const page = await getPlayerPage(playerId);
  const d = page.data || {};
  const pt = d.primaryTeam || {};
  return {
    id: Number(playerId),
    name: d.name || d.playerName || `Jogador ${playerId}`,
    shortName: d.name || '',
    number: d.shirtNumber || null,
    position: mapPosition(d.position || d.positionRow?.Positions?.[0] || pt.role),
    photo: playerPhoto(playerId),
    team: {
      id: Number(teamId || pt.teamId || 0),
      name: pt.teamName || (teamId ? (await getTeamMeta(teamId)).name : ''),
      logo: teamLogo(teamId || pt.teamId || 0),
    },
  };
}

function mainLeagueStats(data) {
  const league = data?.mainLeague || data?.mainLeagueStats || {};
  const map = statMapFromArray(league?.stats || league?.items || []);
  return { league, map };
}

function mapGetByAliases(map, aliases) {
  for (const alias of aliases) {
    const key = normalizeLabel(alias);
    if (map.has(key)) return num(map.get(key));
  }
  return 0;
}

function seasonStatsFromPlayerPage(page) {
  const { league, map } = mainLeagueStats(page.data || {});
  const text = page.text || '';
  const perfIndex = Math.max(text.toLowerCase().indexOf('season performance'), text.toLowerCase().indexOf('desempenho na temporada'));
  const startAt = perfIndex >= 0 ? perfIndex : 0;

  const stats = emptyStats();
  stats.goals = mapGetByAliases(map, ['Goals', 'Gols']) || findNumericAfter(text, ['Goals', 'Gols'], startAt);
  stats.assists = mapGetByAliases(map, ['Assists', 'Assistências', 'Assistencias']) || findNumericAfter(text, ['Assists', 'Assistências', 'Assistencias'], startAt);
  stats.minutes = mapGetByAliases(map, ['Minutes played', 'Minutos jogados']) || findNumericAfter(text, ['Minutes played', 'Minutos jogados'], startAt);
  stats.yellow = mapGetByAliases(map, ['Yellow cards', 'Cartões amarelos', 'Cartoes amarelos']) || findNumericAfter(text, ['Yellow cards', 'Cartões amarelos', 'Cartoes amarelos'], startAt);
  stats.red = mapGetByAliases(map, ['Red cards', 'Cartões vermelhos', 'Cartoes vermelhos']) || findNumericAfter(text, ['Red cards', 'Cartões vermelhos', 'Cartoes vermelhos'], startAt);

  // O FotMob exibe estes números como totais na seção Season performance.
  stats.shots = findNumericAfter(text, ['Shots', 'Finalizações', 'Finalizacoes'], startAt);
  stats.shotsOnTarget = findNumericAfter(text, ['Shots on target', 'Chutes no alvo'], startAt);
  stats.passes = findNumericAfter(text, ['Successful passes', 'Accurate passes', 'Passes certos', 'Passes precisos'], startAt);
  stats.tackles = findNumericAfter(text, ['Tackles', 'Desarmes'], startAt);

  const matches = mapGetByAliases(map, ['Matches', 'Jogos']) || findNumericAfter(text, ['Matches', 'Jogos'], 0);
  return { stats, matchesCount: matches, appearancesCount: matches, league };
}

async function getSeasonStats(playerId, teamId) {
  const cacheKey = `season:${playerId}:${teamId}:${SEASON_YEAR}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const [player, page] = await Promise.all([getPlayerMeta(playerId, teamId), getPlayerPage(playerId)]);
  const parsed = seasonStatsFromPlayerPage(page);
  const result = {
    player,
    period: 'season',
    matchesCount: parsed.matchesCount,
    appearancesCount: parsed.appearancesCount,
    stats: parsed.stats,
    dataAvailable: Object.values(parsed.stats).some((v) => num(v) > 0),
    source: 'FotMob player page',
  };
  return setCached(cacheKey, result, 10 * 60 * 1000);
}

function isBrasileiraoMatch(match) {
  const leagueId = Number(match?.leagueId || match?.parentLeagueId || match?.tournamentId || 0);
  const leagueName = String(match?.leagueName || match?.tournamentName || match?.competitionName || match?.league || '').toLowerCase();
  if (leagueId) return leagueId === LEAGUE_ID;
  if (leagueName) return /serie a|série a|brasileir/.test(leagueName) && !/ital/.test(leagueName);
  return true; // confirmação final é feita no matchDetails quando houver metadados.
}

function matchIdOf(m) {
  return Number(m?.matchId || m?.id || m?.match?.id || 0);
}

async function getMatchDetails(matchId) {
  const cacheKey = `match:${matchId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const body = await fetchJson('matchDetails', { matchId }, { ttlMs: 24 * 60 * 60 * 1000 });
    return setCached(cacheKey, body, 24 * 60 * 60 * 1000);
  } catch (apiError) {
    // Fallback sem autenticação: algumas partidas estão pré-renderizadas na página.
    const html = await fetchHtml(`https://www.fotmob.com/match/${matchId}`, { ttlMs: 24 * 60 * 60 * 1000 });
    const next = parseNextData(html);
    const pp = next?.props?.pageProps || {};
    const body = pp?.data || pp;
    if (!body?.content && !body?.general) throw apiError;
    return setCached(cacheKey, body, 24 * 60 * 60 * 1000);
  }
}

function playerStatsObject(match, playerId) {
  const content = match?.content || match?.data?.content || {};
  const ps = content?.playerStats || content?.playerstats || {};
  if (ps && !Array.isArray(ps)) return ps[String(playerId)] || ps[Number(playerId)] || null;
  if (Array.isArray(ps)) return ps.find((p) => Number(p?.id || p?.playerId) === Number(playerId)) || null;
  return null;
}

function collectMatchStatEntries(obj) {
  const entries = [];
  const visit = (node, label = '') => {
    if (!node || typeof node !== 'object') return;
    if (node.stat && typeof node.stat === 'object' && node.stat.value !== undefined) {
      entries.push({ label, key: node.key || node.stat.key || '', value: node.stat.value, total: node.stat.total });
    } else if (node.value !== undefined && (typeof node.value === 'number' || typeof node.value === 'string')) {
      entries.push({ label, key: node.key || '', value: node.value, total: node.total });
    }
    if (Array.isArray(node)) node.forEach((x) => visit(x, label));
    else for (const [k, v] of Object.entries(node)) if (!['stat', 'value', 'total'].includes(k)) visit(v, k);
  };
  visit(obj);
  return entries;
}

function pickMatchStat(entries, aliases, { useTotal = false } = {}) {
  const wanted = aliases.map(normalizeLabel);
  for (const e of entries) {
    const hay = `${normalizeLabel(e.label)} ${normalizeLabel(e.key)}`;
    if (wanted.some((w) => hay === w || hay.includes(w))) {
      if (useTotal && e.total !== undefined) return num(e.total);
      return num(e.value);
    }
  }
  return 0;
}

function normalizeMatchPlayerStats(raw) {
  if (!raw) return null;
  const entries = collectMatchStatEntries(raw?.stats || raw);
  return {
    goals: pickMatchStat(entries, ['Goals', 'goal']),
    assists: pickMatchStat(entries, ['Assists', 'assist']),
    passes: pickMatchStat(entries, ['Accurate passes', 'Successful passes', 'accurate_passes']),
    shots: pickMatchStat(entries, ['Total shots', 'Shots', 'total_shots']),
    tackles: pickMatchStat(entries, ['Tackles', 'total tackles']),
    shotsOnTarget: pickMatchStat(entries, ['Shots on target', 'shots_on_target']),
    yellow: pickMatchStat(entries, ['Yellow cards', 'yellow card']),
    red: pickMatchStat(entries, ['Red cards', 'red card']),
    minutes: pickMatchStat(entries, ['Minutes played', 'minutes']),
  };
}

function leagueMatchesFromRecent(pageData) {
  const list = pageData?.recentMatches || pageData?.matches || [];
  return Array.isArray(list) ? list.filter((m) => matchIdOf(m) && isBrasileiraoMatch(m)) : [];
}

function teamFromMatch(value) {
  if (!value) return { id: 0, name: '' };
  if (typeof value === 'string') return { id: 0, name: value };
  return {
    id: Number(value.id || value.teamId || 0),
    name: value.name || value.teamName || value.shortName || '',
    score: value.score ?? value.goals ?? null,
  };
}

function matchSummary(candidate, detail, teamId, stats) {
  const general = detail?.general || detail?.data?.general || {};
  const header = detail?.header || detail?.data?.header || {};
  const headerTeams = Array.isArray(header?.teams) ? header.teams : [];

  const home = teamFromMatch(
    general.homeTeam || headerTeams[0] || candidate?.home || candidate?.homeTeam
  );
  const away = teamFromMatch(
    general.awayTeam || headerTeams[1] || candidate?.away || candidate?.awayTeam
  );

  const status = header?.status || candidate?.status || {};
  let score = status.scoreStr || candidate?.scoreStr || candidate?.score || '';
  if (!score && home.score !== null && away.score !== null) score = `${home.score} - ${away.score}`;

  const rawDate =
    general.matchTimeUTC || general.matchTimeUtc || general.utcTime ||
    status.utcTime || candidate?.status?.utcTime || candidate?.startDate ||
    candidate?.utcTime || candidate?.date || candidate?.timeTS || null;

  let date = null;
  if (rawDate) {
    const d = typeof rawDate === 'number'
      ? new Date(rawDate > 10_000_000_000 ? rawDate : rawDate * 1000)
      : new Date(rawDate);
    if (!Number.isNaN(d.getTime())) date = d.toISOString();
  }

  const isHome = Number(home.id) === Number(teamId);
  const isAway = Number(away.id) === Number(teamId);
  const opponent = isHome ? away : isAway ? home : { id: 0, name: '' };

  return {
    id: matchIdOf(candidate) || Number(general.matchId || 0),
    date,
    home,
    away,
    score: String(score || '—'),
    opponent: opponent.name || '',
    venue: isHome ? 'Casa' : isAway ? 'Fora' : '',
    minutes: num(stats?.minutes),
    goals: num(stats?.goals),
    assists: num(stats?.assists),
  };
}

async function getRecentStats(playerId, teamId, count) {
  const cacheKey = `recent:${playerId}:${teamId}:${count}:${SEASON_YEAR}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const [player, page] = await Promise.all([getPlayerMeta(playerId, teamId), getPlayerPage(playerId)]);
  const candidates = leagueMatchesFromRecent(page.data).slice(0, Math.max(count + 8, 18));
  if (!candidates.length) {
    const err = new Error('O FotMob não trouxe partidas recentes desse jogador no HTML da página.');
    err.statusCode = 404;
    throw err;
  }

  const aggregate = emptyStats();
  const matchesUsed = [];
  let leagueMatches = 0;
  let appearances = 0;

  // "Últimos jogos do jogador" = últimas aparições confirmadas na Série A.
  // Assim a interface consegue mostrar exatamente quais partidas entraram na soma.
  for (const m of candidates) {
    if (appearances >= count) break;
    const id = matchIdOf(m);
    try {
      const detail = await getMatchDetails(id);
      const general = detail?.general || detail?.data?.general || {};
      const leagueId = Number(general?.leagueId || general?.parentLeagueId || detail?.leagueId || 0);
      const leagueName = String(general?.leagueName || detail?.leagueName || '').toLowerCase();
      if (leagueId && leagueId !== LEAGUE_ID) continue;
      if (!leagueId && leagueName && !/serie a|série a|brasileir/.test(leagueName)) continue;

      const raw = playerStatsObject(detail, playerId);
      const s = normalizeMatchPlayerStats(raw);
      if (!raw || !s) continue;

      appearances++;
      leagueMatches++;
      addStats(aggregate, s);
      matchesUsed.push(matchSummary(m, detail, teamId, s));
    } catch (error) {
      console.warn(`FotMob: falha ao ler partida ${id}: ${error.message}`);
    }
  }

  if (!leagueMatches) {
    const err = new Error(`Não foi possível confirmar partidas recentes da Série A ${SEASON_YEAR} para esse jogador.`);
    err.statusCode = 404;
    throw err;
  }

  const result = {
    player,
    period: `last${count}`,
    matchesCount: leagueMatches,
    appearancesCount: appearances,
    stats: aggregate,
    dataAvailable: appearances > 0,
    matchesUsed,
    source: 'FotMob match details',
  };
  return setCached(cacheKey, result, 5 * 60 * 1000);
}

async function getTeamDebug(teamId) {
  const team = await getTeamMeta(teamId);
  const result = { provider: 'FotMob', team, teamId: Number(teamId), season: SEASON_YEAR, seasonInternalId: SEASON_INTERNAL_ID };
  try {
    const body = await fetchJson('teams', { id: teamId, ccode3: 'BRA' }, { ttlMs: 0 });
    result.teamEndpoint = {
      ok: true,
      topLevelKeys: body && typeof body === 'object' ? Object.keys(body) : [],
      squadType: Array.isArray(body?.squad) ? 'array' : typeof body?.squad,
      squadKeys: body?.squad && !Array.isArray(body.squad) && typeof body.squad === 'object' ? Object.keys(body.squad) : [],
      parsedPlayers: playersFromTeamPayload(body, team).length,
    };
  } catch (error) {
    result.teamEndpoint = { ok: false, error: error.message, attempts: error.attempts };
  }
  try {
    const deep = await fetchJson('leagueseasondeepstats', { id: LEAGUE_ID, season: SEASON_INTERNAL_ID, type: 'players', stat: 'mins_played', teamId }, { ttlMs: 0 });
    const rows = deepStatsRows(deep);
    result.deepStats = {
      ok: true,
      topLevelKeys: deep && typeof deep === 'object' ? Object.keys(deep) : [],
      rows: rows.length,
      rowKeys: rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [],
      sample: rows[0] || null,
      parsedPlayers: playersFromDeepStats(deep, team).length,
    };
  } catch (error) {
    result.deepStats = { ok: false, error: error.message, attempts: error.attempts };
  }
  return result;
}

async function getSourceDebug() {
  const checks = [];
  for (const base of API_BASES) {
    const url = buildUrl(base, 'leagues', { id: LEAGUE_ID, ccode3: 'BRA', season: SEASON_YEAR });
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/plain,*/*', 'Referer': 'https://www.fotmob.com/' } });
      const text = await response.text();
      let body = null; try { body = JSON.parse(text); } catch {}
      checks.push({ base, url: url.toString(), ok: response.ok && Boolean(body), status: response.status, contentType: response.headers.get('content-type'), rows: body ? tableRowsFromLeague(body).length : 0, preview: body ? undefined : text.replace(/\s+/g, ' ').slice(0, 160) });
    } catch (error) {
      checks.push({ base, url: url.toString(), ok: false, error: error.message });
    }
  }

  let playerPageCheck;
  try {
    const r = await fetch('https://www.fotmob.com/players/750067', { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } });
    const html = await r.text();
    const next = parseNextData(html);
    playerPageCheck = { ok: r.ok, status: r.status, nextData: Boolean(next), bytes: html.length };
  } catch (error) {
    playerPageCheck = { ok: false, error: error.message };
  }

  return { provider: 'FotMob', leagueId: LEAGUE_ID, season: SEASON_YEAR, seasonInternalId: SEASON_INTERNAL_ID, port: PORT, checks, playerPageCheck };
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, provider: 'FotMob', leagueId: LEAGUE_ID, season: SEASON_YEAR, seasonInternalId: SEASON_INTERNAL_ID, apiKeyRequired: false, port: PORT });
  if (url.pathname === '/api/debug-source') {
    if (!ENABLE_DEBUG_ROUTES) return json(res, 404, { error: 'Rotas de diagnóstico desabilitadas.' });
    return json(res, 200, await getSourceDebug());
  }
  if (url.pathname === '/api/debug-team') {
    if (!ENABLE_DEBUG_ROUTES) return json(res, 404, { error: 'Rotas de diagnóstico desabilitadas.' });
    const teamId = Number(url.searchParams.get('team'));
    if (!teamId) return json(res, 400, { error: 'Informe o parâmetro team.' });
    return json(res, 200, await getTeamDebug(teamId));
  }
  if (url.pathname === '/api/teams') return json(res, 200, await getTeams());
  if (url.pathname === '/api/squad') {
    const teamId = Number(url.searchParams.get('team'));
    if (!teamId) return json(res, 400, { error: 'Informe o parâmetro team.' });
    return json(res, 200, await getSquad(teamId));
  }
  if (url.pathname === '/api/player-stats') {
    const playerId = Number(url.searchParams.get('player'));
    const teamId = Number(url.searchParams.get('team'));
    const period = url.searchParams.get('period') || 'season';
    if (!playerId || !teamId) return json(res, 400, { error: 'Informe player e team.' });
    if (period === 'season') return json(res, 200, await getSeasonStats(playerId, teamId));
    if (period === 'last5' || period === 'last10') return json(res, 200, await getRecentStats(playerId, teamId, period === 'last5' ? 5 : 10));
    return json(res, 400, { error: 'Período inválido.' });
  }
  return json(res, 404, { error: 'Endpoint não encontrado.' });
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const candidate = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!candidate.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(candidate, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(candidate).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache', 'Expires': '0' });
    fs.createReadStream(candidate).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return json(res, error.statusCode || 500, { error: error.message || 'Erro interno.', provider: 'FotMob', attempts: error.attempts || undefined });
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nA porta ${PORT} já está em uso. Rode: $env:PORT=3002; npm.cmd start\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`Duelo Brasileirão 2026: http://localhost:${PORT}`);
  console.log(`Fonte: FotMob | liga ${LEAGUE_ID} | temporada ${SEASON_YEAR} | seasonId ${SEASON_INTERNAL_ID}.`);
  console.log('Nenhuma API key é necessária.');
  console.log(`Diagnóstico: ${ENABLE_DEBUG_ROUTES ? 'ativado' : 'desativado'} (ENABLE_DEBUG_ROUTES).`);
});
