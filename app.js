// app.js — FragValue Scout Frontend v3

document.getElementById('nickInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchPlayer();
});

let chartKd = null, chartHs = null, chartAdr = null, chartRating = null;

async function searchPlayer() {
  const nickname = document.getElementById('nickInput').value.trim();
  hideError(); hideDashboard();
  if (!nickname) { showError('Entre un pseudo FACEIT.'); return; }
  showLoading(true);
  document.getElementById('searchBtn').disabled = true;
  try {
    const res  = await fetch(`/api/scout?nickname=${encodeURIComponent(nickname)}`);
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Erreur inconnue.'); return; }
    renderDashboard(data);
  } catch { showError('Impossible de contacter le serveur. Vérifie ta connexion.'); }
  finally { showLoading(false); document.getElementById('searchBtn').disabled = false; }
}

function fvRatingClass(r) {
  const v = parseFloat(r);
  if (v >= 1.20) return 'fv-elite';
  if (v >= 1.05) return 'fv-great';
  if (v >= 0.90) return 'fv-good';
  if (v >= 0.75) return 'fv-avg';
  return 'fv-low';
}

function fvRatingLabel(r) {
  const v = parseFloat(r);
  if (v >= 1.20) return 'Élite';
  if (v >= 1.05) return 'Excellent';
  if (v >= 0.90) return 'Bon';
  if (v >= 0.75) return 'Moyen';
  return 'Faible';
}

function renderDashboard(data) {
  const { player, cs2, lifetime, recent, mapStats, teams } = data;

  // ── Profil ───────────────────────────────────────────────────────────────
  if (player.avatar) {
    const img = document.createElement('img');
    img.className = 'profile-avatar'; img.src = player.avatar; img.alt = player.nickname;
    document.getElementById('profileAvatar').replaceWith(img);
  }
  document.getElementById('profileName').textContent    = player.nickname;
  document.getElementById('profileCountry').textContent = player.country ? `🌍 ${player.country.toUpperCase()}` : '';

  // FV Rating badge
  const fvBadge = document.getElementById('fvBadge');
  fvBadge.textContent  = `FV ${recent.fvRating} — ${fvRatingLabel(recent.fvRating)}`;
  fvBadge.className    = `fv-rating-badge ${fvRatingClass(recent.fvRating)}`;

  const lvl = cs2.level || 1;
  const levelBadge = document.getElementById('levelBadge');
  levelBadge.textContent = `LEVEL ${lvl}`;
  levelBadge.className   = `level-badge lvl-${lvl}`;
  document.getElementById('eloVal').textContent = cs2.elo.toLocaleString();

  if (teams.length > 0) document.getElementById('profileTeam').textContent = `Équipe : ${teams[0].name}`;

  const resultsRow = document.getElementById('resultsRow');
  resultsRow.innerHTML = '';
  (lifetime.recentResults || []).slice(0, 10).forEach(r => {
    const dot = document.createElement('div');
    dot.className = `res-dot ${r === '1' ? 'res-w' : 'res-l'}`;
    resultsRow.appendChild(dot);
  });

  // ── Scout Score ──────────────────────────────────────────────────────────
  const kdScore  = Math.min(parseFloat(recent.avgKd)  / 2.5 * 100, 100);
  const hsScore  = Math.min(parseFloat(recent.avgHs)  / 70  * 100, 100);
  const eloScore = Math.min(cs2.elo / 3000 * 100, 100);
  const wrScore  = Math.min(parseFloat(recent.winRate), 100);
  const fvScore  = Math.min(parseFloat(recent.fvRating) / 1.5 * 100, 100);
  const totalScore = Math.round((fvScore * .35) + (eloScore * .30) + (wrScore * .15) + (hsScore * .10) + (kdScore * .10));

  document.getElementById('scoutScore').textContent = totalScore;
  document.getElementById('scoutDesc').textContent  = scoreLabel(totalScore);

  const barsData = [
    { label: 'FV Rating',   val: fvScore,  display: recent.fvRating },
    { label: 'ELO FACEIT',  val: eloScore, display: cs2.elo.toLocaleString() },
    { label: 'Win rate',    val: wrScore,  display: `${recent.winRate}%` },
    { label: 'K/D moyen',   val: kdScore,  display: recent.avgKd },
    { label: 'Headshot %',  val: hsScore,  display: `${recent.avgHs}%` },
    { label: 'ADR moyen',   val: Math.min(parseFloat(recent.avgAdr) / 120 * 100, 100), display: recent.avgAdr },
  ];
  const barsEl = document.getElementById('scoutBars');
  barsEl.innerHTML = '';
  barsData.forEach(b => {
    barsEl.innerHTML += `
      <div class="scout-bar-item">
        <div class="scout-bar-label"><span>${b.label}</span><span>${b.display}</span></div>
        <div class="scout-bar-track"><div class="scout-bar-fill" style="width:${Math.max(0, b.val).toFixed(0)}%"></div></div>
      </div>`;
  });

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpiGrid = document.getElementById('kpiGrid');
  kpiGrid.innerHTML = '';
  const kd = parseFloat(recent.avgKd);
  const kpis = [
    { label: 'FV Rating 2.1',   value: recent.fvRating, cls: fvRatingClass(recent.fvRating).replace('fv-','').replace('elite','hot').replace('great','warn').replace('good','good').replace('avg','accent').replace('low','muted'), sub: fvRatingLabel(recent.fvRating) },
    { label: 'K/D moyen',       value: recent.avgKd,    cls: kd >= 1.3 ? 'good' : kd >= 1 ? 'warn' : 'hot', sub: '20 derniers matchs' },
    { label: 'HS moyen',        value: `${recent.avgHs}%`, cls: parseFloat(recent.avgHs) >= 45 ? 'good' : 'accent', sub: 'headshot rate' },
    { label: 'ADR moyen',       value: recent.avgAdr,   cls: parseFloat(recent.avgAdr) >= 80 ? 'good' : 'warn', sub: 'avg damage / round' },
    { label: 'KAST moyen',      value: `${recent.avgKast}%`, cls: parseFloat(recent.avgKast) >= 70 ? 'good' : 'accent', sub: 'kill/assist/surv/traded' },
    { label: 'Win rate',        value: `${recent.winRate}%`, cls: parseFloat(recent.winRate) >= 55 ? 'good' : 'warn', sub: '20 derniers matchs' },
    { label: 'ELO FACEIT',      value: cs2.elo.toLocaleString(), cls: 'hot', sub: `Niveau ${lvl}/10` },
    { label: 'Matchs (life)',   value: lifetime.matches.toLocaleString(), cls: 'accent', sub: `${lifetime.wins} victoires` },
    { label: 'Meilleure série', value: lifetime.longestStreak, cls: 'good', sub: 'wins consécutives' },
    { label: 'Série actuelle',  value: lifetime.currentStreak || 0, cls: (lifetime.currentStreak || 0) >= 3 ? 'good' : 'accent', sub: 'en cours' },
    { label: 'Opening ratio',   value: recent.openingRatio, cls: parseFloat(recent.openingRatio) >= 1 ? 'good' : 'hot', sub: `${recent.totalFirstKills}K / ${recent.totalFirstDeaths}D` },
    { label: 'K/R moyen',       value: recent.avgKr, cls: 'accent', sub: 'kills per round' },
  ];
  kpis.forEach((k, i) => {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.style.animationDelay = `${i * .04}s`;
    card.innerHTML = `<div class="kpi-label">${k.label}</div><div class="kpi-value ${k.cls}">${k.value}</div><div class="kpi-sub">${k.sub}</div>`;
    kpiGrid.appendChild(card);
  });

  // ── Graphiques ────────────────────────────────────────────────────────────
  const matches = recent.matches || [];
  const labels  = matches.map((_, i) => `M${i + 1}`);

  const chartOpts = (color) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#4A6580', font: { family: 'DM Mono', size: 10 } }, grid: { color: '#1C2A3A' } },
      y: { ticks: { color: '#4A6580', font: { family: 'DM Mono', size: 10 } }, grid: { color: '#1C2A3A' } },
    }
  });

  if (chartKd) chartKd.destroy();
  chartKd = new Chart(document.getElementById('chartKd'), {
    type: 'line',
    data: { labels, datasets: [{ data: matches.map(m => m.kd), fill: true, backgroundColor: 'rgba(255,85,0,.1)', borderColor: '#FF5500', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#FF5500', tension: .3 }] },
    options: { ...chartOpts(), scales: { ...chartOpts().scales, y: { ...chartOpts().scales.y, suggestedMin: 0 } } }
  });

  if (chartHs) chartHs.destroy();
  const hsVals = matches.map(m => m.hsPct);
  chartHs = new Chart(document.getElementById('chartHs'), {
    type: 'bar',
    data: { labels, datasets: [{ data: hsVals, backgroundColor: hsVals.map(v => v >= 50 ? 'rgba(57,255,138,.4)' : 'rgba(0,229,255,.2)'), borderColor: hsVals.map(v => v >= 50 ? '#39FF8A' : '#00E5FF'), borderWidth: 1, borderRadius: 3 }] },
    options: chartOpts()
  });

  if (chartAdr) chartAdr.destroy();
  chartAdr = new Chart(document.getElementById('chartAdr'), {
    type: 'line',
    data: { labels, datasets: [{ data: matches.map(m => m.adr), fill: true, backgroundColor: 'rgba(255,184,0,.1)', borderColor: '#FFB800', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#FFB800', tension: .3 }] },
    options: { ...chartOpts(), scales: { ...chartOpts().scales, y: { ...chartOpts().scales.y, suggestedMin: 0 } } }
  });

  if (chartRating) chartRating.destroy();
  const ratingVals = matches.map(m => m.fvRating);
  chartRating = new Chart(document.getElementById('chartRating'), {
    type: 'line',
    data: { labels, datasets: [{ data: ratingVals, fill: true, backgroundColor: 'rgba(57,255,138,.08)', borderColor: '#39FF8A', borderWidth: 2, pointRadius: 3, pointBackgroundColor: ratingVals.map(v => v >= 1.05 ? '#39FF8A' : v >= 0.9 ? '#FFB800' : '#FF4560'), tension: .3 }] },
    options: { ...chartOpts(), scales: { ...chartOpts().scales, y: { ...chartOpts().scales.y, suggestedMin: 0.4 } } }
  });

  // ── Multi-kills ───────────────────────────────────────────────────────────
  const mkCards = document.getElementById('multiKillCards');
  mkCards.innerHTML = '';
  [
    { val: recent.totalDoubles, label: '2K — Doubles' },
    { val: recent.totalTriples, label: '3K — Triples' },
    { val: recent.totalQuads,   label: '4K — Quadros' },
    { val: recent.totalAces,    label: '5K — Aces' },
  ].forEach(s => {
    mkCards.innerHTML += `<div class="stat-mini"><div class="stat-mini-val">${s.val}</div><div class="stat-mini-label">${s.label}</div></div>`;
  });

  // ── Clutches + Opening ────────────────────────────────────────────────────
  const clCards = document.getElementById('clutchCards');
  clCards.innerHTML = '';
  [
    { val: recent.totalClutch1v1, label: 'Clutches 1v1' },
    { val: recent.totalClutch1v2, label: 'Clutches 1v2' },
    { val: recent.totalFirstKills,  label: 'Opening kills' },
    { val: recent.totalFirstDeaths, label: 'Opening deaths' },
    { val: recent.openingRatio, label: 'Opening ratio' },
  ].forEach(s => {
    clCards.innerHTML += `<div class="stat-mini"><div class="stat-mini-val">${s.val}</div><div class="stat-mini-label">${s.label}</div></div>`;
  });

  // ── Map stats ─────────────────────────────────────────────────────────────
  const mapBody = document.getElementById('mapTable');
  mapBody.innerHTML = '';
  (mapStats || []).forEach(m => {
    const wrNum = parseFloat(m.winRate);
    const cls   = wrNum >= 55 ? 'td-result-w' : wrNum >= 45 ? '' : 'td-result-l';
    mapBody.innerHTML += `
      <tr>
        <td class="td-map">${m.map}</td>
        <td>${m.matches}</td>
        <td class="${cls}">${m.winRate}%</td>
        <td class="${parseFloat(m.kd) >= 1.3 ? 'td-kd-good' : parseFloat(m.kd) >= 1 ? 'td-kd-ok' : 'td-kd-bad'}">${m.kd}</td>
      </tr>`;
  });

  // ── Tableau matchs détaillé ───────────────────────────────────────────────
  const tbody = document.getElementById('matchTable');
  tbody.innerHTML = '';
  matches.forEach(m => {
    const won  = m.result === 1;
    const kdCl = m.kd >= 1.3 ? 'td-kd-good' : m.kd >= 1 ? 'td-kd-ok' : 'td-kd-bad';
    const frCl = m.fvRating >= 1.05 ? 'td-kd-good' : m.fvRating >= 0.9 ? 'td-kd-ok' : 'td-kd-bad';
    tbody.innerHTML += `
      <tr>
        <td class="${won ? 'td-result-w' : 'td-result-l'}">${won ? 'VICTOIRE' : 'DÉFAITE'}</td>
        <td class="td-map">${m.map}</td>
        <td>${m.score}</td>
        <td class="${kdCl}">${m.kd.toFixed(2)}</td>
        <td>${m.kills}</td><td>${m.deaths}</td>
        <td>${m.hsPct.toFixed(0)}%</td>
        <td>${m.adr > 0 ? m.adr.toFixed(0) : '—'}</td>
        <td>${m.kast > 0 ? m.kast.toFixed(0)+'%' : '—'}</td>
        <td>${m.mvp}</td>
        <td class="${frCl}">${m.fvRating.toFixed(2)}</td>
      </tr>`;
  });

  showDashboard(player.nickname);
}

function scoreLabel(s) {
  if (s >= 85) return 'Talent exceptionnel — à recruter immédiatement';
  if (s >= 70) return 'Très bon joueur — fort potentiel';
  if (s >= 55) return 'Joueur solide — à suivre';
  if (s >= 40) return 'Niveau correct — progression possible';
  return 'Niveau débutant / intermédiaire';
}

function showLoading(s) { document.getElementById('loading').style.display = s ? 'block' : 'none'; }

function showDashboard(nickname) {
  document.getElementById('hero').style.display      = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('topbar').style.display    = 'flex';
  document.getElementById('topbarNick').textContent  = `Analyse : ${nickname}`;
  document.getElementById('topbarInput').value       = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideDashboard() {
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('topbar').style.display    = 'none';
  document.getElementById('hero').style.display      = 'block';
}

function newSearch() {
  const nick = document.getElementById('topbarInput').value.trim();
  if (!nick) return;
  document.getElementById('nickInput').value = nick;
  searchPlayer();
}

document.addEventListener('DOMContentLoaded', () => {
  const t = document.getElementById('topbarInput');
  if (t) t.addEventListener('keydown', e => { if (e.key === 'Enter') newSearch(); });
});

function showError(msg) { const el = document.getElementById('errorMsg'); el.textContent = msg; el.style.display = 'block'; }
function hideError()    { document.getElementById('errorMsg').style.display = 'none'; }
