// app.js — FragValue Scout v4

document.getElementById('nickInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchPlayer();
});

let charts = {};

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
  finally   { showLoading(false); document.getElementById('searchBtn').disabled = false; }
}

// ── FV Rating helpers ──────────────────────────────────────────────────────
function fvClass(r) {
  const v = parseFloat(r);
  if (v >= 1.20) return 'fv-elite';
  if (v >= 1.05) return 'fv-great';
  if (v >= 0.90) return 'fv-good';
  if (v >= 0.75) return 'fv-avg';
  return 'fv-low';
}
function fvLabel(r) {
  const v = parseFloat(r);
  if (v >= 1.20) return 'Élite';
  if (v >= 1.05) return 'Excellent';
  if (v >= 0.90) return 'Bon';
  if (v >= 0.75) return 'Moyen';
  return 'Faible';
}
function fvColor(r) {
  const v = parseFloat(r);
  if (v >= 1.20) return '#ff1a5e';
  if (v >= 1.05) return '#FFB800';
  if (v >= 0.90) return '#39FF8A';
  if (v >= 0.75) return '#00E5FF';
  return '#4A6580';
}

// ── KPI card builder ───────────────────────────────────────────────────────
function makeKpi(label, value, cls, sub, delay = 0) {
  return `<div class="kpi-card" style="animation-delay:${delay}s">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value ${cls}">${value}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}

// ── Stat mini card ─────────────────────────────────────────────────────────
function makeMini(val, label, color = '#FF5500') {
  return `<div class="stat-mini">
    <div class="stat-mini-val" style="color:${color}">${val}</div>
    <div class="stat-mini-label">${label}</div>
  </div>`;
}

// ── Chart helper ──────────────────────────────────────────────────────────
function makeChart(id, type, labels, data, color, opts = {}) {
  if (charts[id]) charts[id].destroy();
  const base = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#4A6580', font: { family: 'DM Mono', size: 10 } }, grid: { color: '#1C2A3A' } },
      y: { ticks: { color: '#4A6580', font: { family: 'DM Mono', size: 10 } }, grid: { color: '#1C2A3A' }, ...opts.y },
    }
  };
  charts[id] = new Chart(document.getElementById(id), {
    type,
    data: { labels, datasets: [{ data, ...opts.dataset }] },
    options: { ...base, ...opts.extra },
  });
}

// ── Main render ────────────────────────────────────────────────────────────
function renderDashboard(data) {
  const { player, cs2, lifetime, recent, mapStats, teams } = data;

  // Profil
  if (player.avatar) {
    const img = document.createElement('img');
    img.className = 'profile-avatar'; img.src = player.avatar; img.alt = player.nickname;
    document.getElementById('profileAvatar').replaceWith(img);
  }
  document.getElementById('profileName').textContent    = player.nickname;
  document.getElementById('profileCountry').textContent = player.country ? `🌍 ${player.country.toUpperCase()}` : '';
  document.getElementById('profileRole').textContent    = `Rôle estimé : ${recent.role}`;

  const fvBadge = document.getElementById('fvBadge');
  fvBadge.textContent = `FV ${recent.fvRating} — ${fvLabel(recent.fvRating)}`;
  fvBadge.className   = `fv-rating-badge ${fvClass(recent.fvRating)}`;

  const lvl = cs2.level || 1;
  document.getElementById('levelBadge').textContent = `LEVEL ${lvl}`;
  document.getElementById('levelBadge').className   = `level-badge lvl-${lvl}`;
  document.getElementById('eloVal').textContent     = cs2.elo.toLocaleString();
  if (teams.length > 0) document.getElementById('profileTeam').textContent = `Équipe : ${teams[0].name}`;

  const resultsRow = document.getElementById('resultsRow');
  resultsRow.innerHTML = '';
  (lifetime.recentResults || []).slice(0, 10).forEach(r => {
    const dot = document.createElement('div');
    dot.className = `res-dot ${r === '1' ? 'res-w' : 'res-l'}`;
    resultsRow.appendChild(dot);
  });

  // Scout Score
  const fvScore  = Math.min(parseFloat(recent.fvRating) / 1.5 * 100, 100);
  const eloScore = Math.min(cs2.elo / 3000 * 100, 100);
  const wrScore  = Math.min(parseFloat(recent.winRate), 100);
  const kdScore  = Math.min(parseFloat(recent.avgKd) / 2.5 * 100, 100);
  const hsScore  = Math.min(parseFloat(recent.avgHs) / 70 * 100, 100);
  const total    = Math.round(fvScore*.35 + eloScore*.30 + wrScore*.15 + kdScore*.10 + hsScore*.10);
  document.getElementById('scoutScore').textContent = total;
  document.getElementById('scoutDesc').textContent  = scoreLabel(total);
  const barsData = [
    { label:'FV Rating',  val:fvScore,  display:recent.fvRating },
    { label:'ELO',        val:eloScore, display:cs2.elo.toLocaleString() },
    { label:'Win rate',   val:wrScore,  display:`${recent.winRate}%` },
    { label:'K/D',        val:kdScore,  display:recent.avgKd },
    { label:'HS%',        val:hsScore,  display:`${recent.avgHs}%` },
    { label:'ADR',        val:Math.min(parseFloat(recent.avgAdr)/120*100,100), display:recent.avgAdr },
  ];
  document.getElementById('scoutBars').innerHTML = barsData.map(b => `
    <div class="scout-bar-item">
      <div class="scout-bar-label"><span>${b.label}</span><span>${b.display}</span></div>
      <div class="scout-bar-track"><div class="scout-bar-fill" style="width:${Math.max(0,b.val).toFixed(0)}%"></div></div>
    </div>`).join('');

  // ── KPIs PRINCIPAUX ──────────────────────────────────────────────────────
  const kd = parseFloat(recent.avgKd);
  document.getElementById('kpiMain').innerHTML = [
    makeKpi('FV Rating 2.1', recent.fvRating, fvClass(recent.fvRating).replace('fv-','hot'), fvLabel(recent.fvRating), 0),
    makeKpi('K/D moyen',     recent.avgKd,    kd>=1.3?'good':kd>=1?'warn':'hot', '20 derniers matchs', .04),
    makeKpi('HS moyen',      `${recent.avgHs}%`, parseFloat(recent.avgHs)>=45?'good':'accent', 'headshot rate', .08),
    makeKpi('ADR moyen',     recent.avgAdr,   parseFloat(recent.avgAdr)>=80?'good':'warn', 'avg dmg / round', .12),
    makeKpi('KAST moyen',    `${recent.avgKast}%`, parseFloat(recent.avgKast)>=70?'good':'accent', 'kill/assist/surv/traded', .16),
    makeKpi('Win rate',      `${recent.winRate}%`, parseFloat(recent.winRate)>=55?'good':'warn', '20 derniers matchs', .20),
    makeKpi('ELO FACEIT',    cs2.elo.toLocaleString(), 'hot', `Niveau ${lvl}/10`, .24),
    makeKpi('Matchs (life)', lifetime.matches.toLocaleString(), 'accent', `${lifetime.wins} victoires`, .28),
  ].join('');

  // ── CT / T SPLIT ──────────────────────────────────────────────────────────
  document.getElementById('kpiSides').innerHTML = [
    makeKpi('Win rate CT',  `${recent.ctWinRate}%`, parseFloat(recent.ctWinRate)>=55?'good':'warn', 'côté CT', 0),
    makeKpi('K/D CT',       recent.ctKd,  parseFloat(recent.ctKd)>=1.2?'good':'accent', 'côté CT', .04),
    makeKpi('Win rate T',   `${recent.tWinRate}%`,  parseFloat(recent.tWinRate)>=45?'good':'warn', 'côté T', .08),
    makeKpi('K/D T',        recent.tKd,   parseFloat(recent.tKd)>=1.1?'good':'accent', 'côté T', .12),
    makeKpi('Opening ratio',recent.openingRatio, parseFloat(recent.openingRatio)>=1?'good':'hot', `${recent.totalFirstKills}K / ${recent.totalFirstDeaths}D`, .16),
    makeKpi('Série max',    lifetime.longestStreak, 'good', 'wins consécutives', .20),
    makeKpi('Série actuelle',(lifetime.currentStreak||0), (lifetime.currentStreak||0)>=3?'good':'accent', 'en cours', .24),
    makeKpi('K/R moyen',    recent.avgKr, 'accent', 'kills per round', .28),
  ].join('');

  // ── FLASHES & UTILITY ─────────────────────────────────────────────────────
  document.getElementById('kpiUtility').innerHTML = [
    makeKpi('Flashes lancées',   recent.totalFlashesThrown,  'accent', '20 matchs', 0),
    makeKpi('Ennemis flashés',   recent.totalEnemiesFlashed, 'good',   '20 matchs', .04),
    makeKpi('Flash / round',     recent.avgFlashPerRound,    'accent', 'moyenne', .08),
    makeKpi('Util. dmg total',   recent.totalUtilDmg,        'warn',   '20 matchs', .12),
    makeKpi('Util. dmg / match', recent.avgUtilDmg,          'warn',   'moyenne', .16),
    makeKpi('AWP / sniper kills',recent.totalSniperKills,    'hot',    `${recent.sniperKillRate}/match`, .20),
  ].join('');

  // ── TRADES & SAVES ────────────────────────────────────────────────────────
  document.getElementById('kpiTrades').innerHTML = [
    makeKpi('Trade kills',  recent.totalTradeKills,  'good',   '20 matchs', 0),
    makeKpi('Trade deaths', recent.totalTradeDeaths, 'hot',    '20 matchs', .04),
    makeKpi('Saves',        recent.totalSaves,        'accent', 'armes sauvées', .08),
    makeKpi('Pistol win%',  `${recent.pistolWinRate}%`, parseFloat(recent.pistolWinRate)>=50?'good':'warn', `${recent.totalPistolWins}/${recent.totalPistolTotal}`, .12),
  ].join('');

  // ── GRAPHIQUES ────────────────────────────────────────────────────────────
  const matches = recent.matches || [];
  const labels  = matches.map((_, i) => `M${i + 1}`);

  makeChart('chartKd', 'line', labels, matches.map(m => m.kd), '#FF5500', {
    dataset: { fill:true, backgroundColor:'rgba(255,85,0,.1)', borderColor:'#FF5500', borderWidth:2, pointRadius:3, pointBackgroundColor:'#FF5500', tension:.3 },
    y: { suggestedMin: 0 }
  });
  const hsVals = matches.map(m => m.hsPct);
  makeChart('chartHs', 'bar', labels, hsVals, '#00E5FF', {
    dataset: { backgroundColor: hsVals.map(v => v>=50?'rgba(57,255,138,.4)':'rgba(0,229,255,.2)'), borderColor: hsVals.map(v => v>=50?'#39FF8A':'#00E5FF'), borderWidth:1, borderRadius:3 }
  });
  makeChart('chartAdr', 'line', labels, matches.map(m => m.adr), '#FFB800', {
    dataset: { fill:true, backgroundColor:'rgba(255,184,0,.1)', borderColor:'#FFB800', borderWidth:2, pointRadius:3, pointBackgroundColor:'#FFB800', tension:.3 },
    y: { suggestedMin: 0 }
  });
  const ratingVals = matches.map(m => m.fvRating);
  makeChart('chartRating', 'line', labels, ratingVals, '#39FF8A', {
    dataset: { fill:true, backgroundColor:'rgba(57,255,138,.08)', borderColor:'#39FF8A', borderWidth:2, pointRadius:4, pointBackgroundColor: ratingVals.map(v => v>=1.05?'#39FF8A':v>=0.9?'#FFB800':'#FF4560'), tension:.3 },
    y: { suggestedMin: 0.4 }
  });

  // CT vs T bar chart
  if (charts['chartSides']) charts['chartSides'].destroy();
  charts['chartSides'] = new Chart(document.getElementById('chartSides'), {
    type: 'bar',
    data: {
      labels: ['Win rate CT', 'Win rate T', 'K/D CT', 'K/D T'],
      datasets: [{
        data: [parseFloat(recent.ctWinRate)||0, parseFloat(recent.tWinRate)||0, parseFloat(recent.ctKd)||0, parseFloat(recent.tKd)||0],
        backgroundColor: ['rgba(0,229,255,.3)','rgba(255,85,0,.3)','rgba(0,229,255,.5)','rgba(255,85,0,.5)'],
        borderColor:     ['#00E5FF','#FF5500','#00E5FF','#FF5500'],
        borderWidth: 1, borderRadius: 4,
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales: {
        x: { ticks:{color:'#4A6580', font:{family:'DM Mono',size:10}}, grid:{color:'#1C2A3A'} },
        y: { ticks:{color:'#4A6580', font:{family:'DM Mono',size:10}}, grid:{color:'#1C2A3A'}, suggestedMin:0 }
      }
    }
  });

  // ── MULTI-KILLS ───────────────────────────────────────────────────────────
  document.getElementById('multiKillCards').innerHTML = [
    makeMini(recent.totalDoubles, '2K — Doubles', '#00E5FF'),
    makeMini(recent.totalTriples, '3K — Triples', '#FFB800'),
    makeMini(recent.totalQuads,   '4K — Quadros', '#FF5500'),
    makeMini(recent.totalAces,    '5K — Aces',    '#ff1a5e'),
  ].join('');

  // ── CLUTCHES ─────────────────────────────────────────────────────────────
  document.getElementById('clutchCards').innerHTML = [
    makeMini(recent.totalClutch1v1, 'Clutch 1v1', '#39FF8A'),
    makeMini(recent.totalClutch1v2, 'Clutch 1v2', '#FFB800'),
    makeMini(recent.totalClutch1v3, 'Clutch 1v3', '#FF5500'),
    makeMini(recent.totalClutch1v4, 'Clutch 1v4', '#ff1a5e'),
    makeMini(recent.totalClutch1v5, 'Clutch 1v5', '#ff0040'),
    makeMini(recent.totalFirstKills,  'Opening kills',  '#39FF8A'),
    makeMini(recent.totalFirstDeaths, 'Opening deaths', '#FF4560'),
    makeMini(recent.openingRatio,     'Opening ratio',  parseFloat(recent.openingRatio)>=1?'#39FF8A':'#FF5500'),
  ].join('');

  // ── MAP CARDS ─────────────────────────────────────────────────────────────
  const mapContainer = document.getElementById('mapCards');
  mapContainer.innerHTML = '';
  (mapStats || []).forEach(m => {
    const wr = parseFloat(m.winRate);
    const borderColor = wr >= 60 ? '#39FF8A' : wr >= 45 ? '#FFB800' : '#FF4560';
    mapContainer.innerHTML += `
      <div class="map-card" style="border-color:${borderColor}40">
        <div class="map-card-name">${m.map}</div>
        <div class="map-card-wr" style="color:${borderColor}">${m.winRate}%</div>
        <div class="map-card-sub">${m.matches} matchs</div>
        <div class="map-card-row"><span>K/D</span><span>${m.kd}</span></div>
        <div class="map-card-row"><span>CT win</span><span>${m.ctWinRate}%</span></div>
        <div class="map-card-row"><span>T win</span><span>${m.tWinRate}%</span></div>
        <div class="map-card-row"><span>ADR</span><span>${m.avgAdr}</span></div>
        <div class="map-card-row"><span>FV Rating</span><span style="color:${fvColor(m.avgFvRating)}">${m.avgFvRating}</span></div>
      </div>`;
  });

  // ── TABLEAU MATCHS ────────────────────────────────────────────────────────
  const tbody = document.getElementById('matchTable');
  tbody.innerHTML = '';
  matches.forEach(m => {
    const won  = m.result === 1;
    const kdCl = m.kd >= 1.3 ? 'td-kd-good' : m.kd >= 1 ? 'td-kd-ok' : 'td-kd-bad';
    const frCl = m.fvRating >= 1.05 ? 'td-kd-good' : m.fvRating >= 0.9 ? 'td-kd-ok' : 'td-kd-bad';
    tbody.innerHTML += `<tr>
      <td class="${won?'td-result-w':'td-result-l'}">${won?'WIN':'LOSS'}</td>
      <td class="td-map">${m.map}</td>
      <td>${m.score}</td>
      <td class="${kdCl}">${m.kd.toFixed(2)}</td>
      <td>${m.kills}</td><td>${m.deaths}</td><td>${m.assists}</td>
      <td>${m.hsPct.toFixed(0)}%</td>
      <td>${m.adr>0?m.adr.toFixed(0):'—'}</td>
      <td>${m.kast>0?m.kast.toFixed(0)+'%':'—'}</td>
      <td>${m.double+m.triple+m.quad+m.ace}</td>
      <td>${m.clutch1v1+m.clutch1v2+m.clutch1v3}</td>
      <td>${m.mvp}</td>
      <td class="${frCl}">${m.fvRating.toFixed(2)}</td>
    </tr>`;
  });

  showDashboard(player.nickname);
}

function scoreLabel(s) {
  if (s >= 85) return 'Talent exceptionnel — recruter immédiatement';
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
