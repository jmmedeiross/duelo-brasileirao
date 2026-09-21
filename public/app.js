const metricConfig = [
  { key: "goals", label: "Gols" },
  { key: "assists", label: "Assistências" },
  { key: "passes", label: "Passes" },
  { key: "shots", label: "Finalizações" },
  { key: "tackles", label: "Desarmes" },
  { key: "shotsOnTarget", label: "No alvo" },
];

const detailConfig = [
  ...metricConfig,
  { key: "minutes", label: "Minutos jogados" },
  { key: "yellow", label: "Cartões amarelos", className: "cards-yellow" },
  { key: "red", label: "Cartões vermelhos", className: "cards-red" },
];

const positionLabels = {
  Goalkeeper: "Goleiro",
  Defender: "Defensor",
  Midfielder: "Meio-campista",
  Attacker: "Atacante",
  Unknown: "Posição não informada",
};

const state = {
  teams: [],
  squads: { A: [], B: [] },
  stats: { A: null, B: null },
  chart: null,
  requestVersion: 0,
};

const els = {
  apiStatus: document.querySelector("#apiStatus"),
  message: document.querySelector("#message"),
  positionFilter: document.querySelector("#positionFilter"),
  periodFilter: document.querySelector("#periodFilter"),
  teamASelect: document.querySelector("#teamASelect"),
  teamBSelect: document.querySelector("#teamBSelect"),
  playerASelect: document.querySelector("#playerASelect"),
  playerBSelect: document.querySelector("#playerBSelect"),
  playerAName: document.querySelector("#playerAName"),
  playerBName: document.querySelector("#playerBName"),
  playerAMeta: document.querySelector("#playerAMeta"),
  playerBMeta: document.querySelector("#playerBMeta"),
  playerAAvatar: document.querySelector("#playerAAvatar"),
  playerBAvatar: document.querySelector("#playerBAvatar"),
  legendA: document.querySelector("#legendA"),
  legendB: document.querySelector("#legendB"),
  statsTable: document.querySelector("#statsTable"),
  matchesInfo: document.querySelector("#matchesInfo"),
  seasonHeading: document.querySelector("#seasonHeading"),
  seasonOption: document.querySelector("#seasonOption"),
  recentMatchesPanel: document.querySelector("#recentMatchesPanel"),
  recentAName: document.querySelector("#recentAName"),
  recentBName: document.querySelector("#recentBName"),
  recentAMatches: document.querySelector("#recentAMatches"),
  recentBMatches: document.querySelector("#recentBMatches"),
};

function showMessage(text = "") {
  els.message.textContent = text;
  els.message.classList.toggle("hidden", !text);
}

function setStatus(text, kind = "") {
  els.apiStatus.textContent = text;
  els.apiStatus.className = `status-badge ${kind}`.trim();
}

async function api(path) {
  const response = await fetch(path);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Resposta inválida do servidor (${response.status}).`);
  }
  if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data;
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function setAvatar(element, player, fallback) {
  element.style.backgroundImage = player?.photo ? `url("${player.photo}")` : "";
  element.textContent = player?.photo ? "" : initials(player?.name) || fallback;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMatchDate(value) {
  if (!value) return "Data não informada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data não informada";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function matchCard(match) {
  const home = escapeHtml(match?.home?.name || "Mandante");
  const away = escapeHtml(match?.away?.name || "Visitante");
  const score = escapeHtml(match?.score || "—");
  const date = escapeHtml(formatMatchDate(match?.date));
  const venue = escapeHtml(match?.venue || "");
  const details = [
    match?.minutes ? `${formatNumber(match.minutes)} min` : "Aparição confirmada",
    match?.goals ? `${formatNumber(match.goals)} gol${Number(match.goals) === 1 ? "" : "s"}` : "",
    match?.assists ? `${formatNumber(match.assists)} assistência${Number(match.assists) === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  const body = `
    <div class="recent-match-top"><span>${date}</span><span>${venue}</span></div>
    <div class="recent-match-score"><span>${home}</span><strong>${score}</strong><span>${away}</span></div>
    <div class="recent-match-player">${escapeHtml(details)}</div>
  `;
  if (match?.id) {
    return `<a class="recent-match" href="https://www.fotmob.com/match/${Number(match.id)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
  }
  return `<div class="recent-match">${body}</div>`;
}

function renderRecentMatches(resultA, resultB) {
  const isSeason = els.periodFilter.value === "season";
  els.recentMatchesPanel.classList.toggle("hidden", isSeason);
  if (isSeason) return;

  els.recentAName.textContent = resultA.player?.name || "Jogador A";
  els.recentBName.textContent = resultB.player?.name || "Jogador B";

  const renderList = (matches = []) => matches.length
    ? matches.map(matchCard).join("")
    : `<div class="recent-empty">Nenhuma partida pôde ser identificada.</div>`;

  els.recentAMatches.innerHTML = renderList(resultA.matchesUsed || []);
  els.recentBMatches.innerHTML = renderList(resultB.matchesUsed || []);
}

function filteredSquad(side) {
  const position = els.positionFilter.value;
  const squad = state.squads[side] || [];
  return position === "Todos" ? squad : squad.filter((player) => player.position === position);
}

function selectedPlayer(side) {
  const select = side === "A" ? els.playerASelect : els.playerBSelect;
  const id = Number(select.value);
  return state.squads[side].find((player) => Number(player.id) === id);
}

function selectedTeamId(side) {
  return Number((side === "A" ? els.teamASelect : els.teamBSelect).value);
}

function fillTeamSelect(select) {
  select.innerHTML = state.teams.map((team) => `<option value="${team.id}">${team.name}</option>`).join("");
}

function fillPlayerSelect(side, preferredId = null) {
  const select = side === "A" ? els.playerASelect : els.playerBSelect;
  const players = filteredSquad(side);
  if (!players.length) {
    select.innerHTML = `<option value="">Nenhum jogador nessa posição</option>`;
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = players.map((player) =>
    `<option value="${player.id}">${player.name}${player.number ? ` · #${player.number}` : ""}</option>`
  ).join("");
  if (preferredId && players.some((p) => Number(p.id) === Number(preferredId))) select.value = preferredId;
}

function updateIdentity(side, player) {
  const isA = side === "A";
  const nameEl = isA ? els.playerAName : els.playerBName;
  const metaEl = isA ? els.playerAMeta : els.playerBMeta;
  const avatarEl = isA ? els.playerAAvatar : els.playerBAvatar;
  const legendEl = isA ? els.legendA : els.legendB;

  if (!player) {
    nameEl.textContent = "Sem jogador";
    metaEl.textContent = "Ajuste os filtros";
    setAvatar(avatarEl, null, side);
    legendEl.textContent = `Jogador ${side}`;
    return;
  }

  nameEl.textContent = player.name;
  metaEl.textContent = `${player.team?.name || ""} • ${positionLabels[player.position] || player.position}`;
  setAvatar(avatarEl, player, side);
  legendEl.textContent = player.name;
}

function normalizePair(statsA, statsB) {
  const normalizedA = [];
  const normalizedB = [];
  metricConfig.forEach((metric) => {
    const a = Number(statsA[metric.key] || 0);
    const b = Number(statsB[metric.key] || 0);
    const max = Math.max(a, b, 1);
    normalizedA.push(Math.round((a / max) * 100));
    normalizedB.push(Math.round((b / max) * 100));
  });
  return { normalizedA, normalizedB };
}

function buildChart(resultA, resultB) {
  const statsA = resultA.stats;
  const statsB = resultB.stats;
  const { normalizedA, normalizedB } = normalizePair(statsA, statsB);

  const data = {
    labels: metricConfig.map((metric) => metric.label),
    datasets: [
      {
        label: resultA.player.name,
        data: normalizedA,
        borderColor: "#63f59a",
        backgroundColor: "rgba(99, 245, 154, 0.16)",
        pointBackgroundColor: "#63f59a",
        pointBorderColor: "#63f59a",
        pointRadius: 4,
        borderWidth: 2,
      },
      {
        label: resultB.player.name,
        data: normalizedB,
        borderColor: "#7c8cff",
        backgroundColor: "rgba(124, 140, 255, 0.16)",
        pointBackgroundColor: "#7c8cff",
        pointBorderColor: "#7c8cff",
        pointRadius: 4,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 350 },
    scales: {
      r: {
        min: 0,
        max: 100,
        beginAtZero: true,
        ticks: { display: false, stepSize: 20 },
        angleLines: { color: "rgba(255,255,255,.10)" },
        grid: { color: "rgba(255,255,255,.10)" },
        pointLabels: { color: "#c6ced9", font: { family: "Inter", size: 12, weight: "700" } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label(context) {
            const metric = metricConfig[context.dataIndex];
            const raw = context.datasetIndex === 0 ? statsA[metric.key] : statsB[metric.key];
            return `${context.dataset.label}: ${formatNumber(raw)}`;
          },
        },
      },
    },
  };

  if (state.chart) {
    state.chart.data = data;
    state.chart.options = options;
    state.chart.update();
  } else {
    state.chart = new Chart(document.querySelector("#comparisonChart"), { type: "radar", data, options });
  }
}

function renderStats(resultA, resultB) {
  els.statsTable.innerHTML = detailConfig.map((metric) => `
    <div class="stat-row ${metric.className || ""}">
      <div class="value-a">${formatNumber(resultA.stats[metric.key])}</div>
      <div class="stat-label">${metric.label}</div>
      <div class="value-b">${formatNumber(resultB.stats[metric.key])}</div>
    </div>
  `).join("");

  if (els.periodFilter.value === "season") {
    els.matchesInfo.textContent = `${resultA.matchesCount || 0} aparições • ${resultB.matchesCount || 0} aparições`;
  } else {
    els.matchesInfo.textContent =
      `${resultA.matchesCount || 0} jogos / ${resultA.appearancesCount || 0} aparições • ` +
      `${resultB.matchesCount || 0} jogos / ${resultB.appearancesCount || 0} aparições`;
  }
}

async function loadSquad(side, preferredPlayerId = null) {
  const teamId = selectedTeamId(side);
  const playerSelect = side === "A" ? els.playerASelect : els.playerBSelect;
  playerSelect.disabled = true;
  playerSelect.innerHTML = `<option>Carregando elenco…</option>`;
  const data = await api(`/api/squad?team=${teamId}`);
  state.squads[side] = data.players || [];
  fillPlayerSelect(side, preferredPlayerId);
  updateIdentity(side, selectedPlayer(side));
}

async function loadComparison() {
  const playerA = selectedPlayer("A");
  const playerB = selectedPlayer("B");
  updateIdentity("A", playerA);
  updateIdentity("B", playerB);

  if (!playerA || !playerB) {
    els.recentMatchesPanel.classList.add("hidden");
    showMessage("Não há dois jogadores disponíveis com os filtros atuais.");
    return;
  }

  const version = ++state.requestVersion;
  showMessage("");
  setStatus("Carregando dados…");
  const period = els.periodFilter.value;

  try {
    const [resultA, resultB] = await Promise.all([
      api(`/api/player-stats?player=${playerA.id}&team=${playerA.team.id}&period=${period}`),
      api(`/api/player-stats?player=${playerB.id}&team=${playerB.team.id}&period=${period}`),
    ]);
    if (version !== state.requestVersion) return;

    state.stats.A = resultA;
    state.stats.B = resultB;
    buildChart(resultA, resultB);
    renderStats(resultA, resultB);
    renderRecentMatches(resultA, resultB);

    const unavailable = [resultA, resultB].filter((r) => !r.dataAvailable).map((r) => r.player?.name).filter(Boolean);
    if (unavailable.length) {
      showMessage(`Sem estatísticas disponíveis neste período para: ${unavailable.join(", ")}. Os campos aparecem como 0.`);
    }
    setStatus("FotMob conectado", "ok");
  } catch (error) {
    if (version !== state.requestVersion) return;
    els.recentMatchesPanel.classList.add("hidden");
    setStatus("Erro na fonte", "error");
    showMessage(error.message);
  }
}

async function changeTeam(side) {
  try {
    showMessage("");
    await loadSquad(side);
    await loadComparison();
  } catch (error) {
    setStatus("Erro na fonte", "error");
    showMessage(error.message);
  }
}

async function init() {
  try {
    const health = await api("/api/health");
    els.seasonHeading.textContent = `DUELO BRASILEIRÃO SÉRIE A / ${health.season}`;
    els.seasonOption.textContent = `Temporada ${health.season}`;
    setStatus("Buscando clubes…");

    const data = await api("/api/teams");
    state.teams = data.teams || [];
    if (state.teams.length < 2) throw new Error(`Não foram encontrados clubes suficientes para a Série A ${health.season}.`);

    fillTeamSelect(els.teamASelect);
    fillTeamSelect(els.teamBSelect);
    els.teamASelect.value = state.teams[0].id;
    els.teamBSelect.value = state.teams[1].id;

    await Promise.all([loadSquad("A"), loadSquad("B")]);
    await loadComparison();
  } catch (error) {
    setStatus("Erro na fonte", "error");
    showMessage(error.message);
  }
}

els.teamASelect.addEventListener("change", () => changeTeam("A"));
els.teamBSelect.addEventListener("change", () => changeTeam("B"));
els.playerASelect.addEventListener("change", loadComparison);
els.playerBSelect.addEventListener("change", loadComparison);
els.periodFilter.addEventListener("change", loadComparison);
els.positionFilter.addEventListener("change", async () => {
  const currentA = Number(els.playerASelect.value);
  const currentB = Number(els.playerBSelect.value);
  fillPlayerSelect("A", currentA);
  fillPlayerSelect("B", currentB);
  await loadComparison();
});

init();
