// app.js — FragValue Scout Frontend

document.getElementById('nickInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchPlayer();
});

let chartKd = null;
let chartHs = null;

async function searchPlayer() {
  const input    = document.getElementById('nickInput');
  const nickname = input.value.trim();

  hideError(); hideDashboard();

  if (!nickname) { showError('Entre un pseudo FACEIT.'); return; }

  showLoading(true);
  document.getElementById('searchBtn').disabled = true;

  try {
    const res  = await fetch(`/api/scout?nickname=${encodeURIComponent(nickname)}`);
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Erreur inconnue.'); return; }
    renderDashboard(data);
  } catch {
    showError('Impossible de contacter le serveur. Vérifie ta connexion.');
  } finally {
    showLoading(false);
    document.getElementById('searchBtn').disabled = false;
  }
}

function renderDashboard(data) {
  const { player, cs2, lifetime, recent, teams } = data;

  // ── Profil ───────────────────────────────────────────────────────────────
  if (player.avatar) {
    const img = document.createElement('img');
    img.className = 'profile-avatar';
    img.src = player.avatar;
    img.alt = player.nickname;
    document.getElementById('profileAvatar').replaceWith(img);
  }
  document.getElementById('profileName').textContent    = player.nickname;
  document.getElementById('profileCountry').textContent = player.country ? `🌍 ${player.country.toUpperCase()}` : '';

  const lvl = cs2.level || 1;
  const levelBadge = document.getElementById('levelBadge');
  levelBadge.textContent  = `LEVEL ${lvl}`;
  levelBadge.className    = `level-badge lvl-${lvl}`;
  document.getElementById('eloVal').textContent = cs2.elo.toLocaleString();

  if (teams.length > 0) {
    document.getElementById('profileTeam').textContent = `Équipe : ${teams[0].name}`;
  }

  // Recent results dots
  const resultsRow = document.getElementById('resultsRow');
  resultsRow.innerHTML = '';
  const recentRes = lifetime.recentResults || [];
  recentRes.slice(0, 10).forEach(r => {
    const dot = document.createElement('div');
    dot.className = `res-dot ${r === '1' ? 'res-w' : 'res-l'}`;
    resultsRow.appendChild(dot);
  });

  // ── Scout Score ──────────────────────────────────────────────────────────
  const kdScore  = Math.min(parseFloat(recent.avgKd)  / 2.5 * 100, 100);
  const hsScore  = Math.min(parseFloat(recent.avgHs)  / 70  * 100, 100);
  const eloScore = Math.min(cs2.elo / 3000 * 100, 100);
  const wrScore  = Math.min(parseFloat(recent.winRate), 100);
  const totalScore = Math.round((kdScore * .35) + (hsScore * .2) + (eloScore * .3) + (wrScore * .15));

  document.getElementById('scoutScore').textContent = totalScore;
  document.getElementById('scoutDesc').textContent  = scoreLabel(totalScore);

  const barsData = [
    { label: 'K/D moyen',   val: kdScore,  display: recent.avgKd },
    { label: 'Headshot %',  val: hsScore,  display: `${recent.avgHs}%` },
    { label: 'ELO',         val: eloScore, display: cs2.elo },
    { label: 'Win rate',    val: wrScore,  display: `${recent.winRate}%` },
  ];

  const barsEl = document.getElementById('scoutBars');
  barsEl.innerHTML = '';
  barsData.forEach(b => {
    barsEl.innerHTML += `
      <div class="scout-bar-item">
        <div class="scout-bar-label"><span>${b.label}</span><span>${b.display}</span></div>
        <div class="scout-bar-track"><div class="scout-bar-fill" style="width:${b.val.toFixed(0)}%"></div></div>
      </div>`;
  });

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpiGrid = document.getElementById('kpiGrid');
  kpiGrid.innerHTML = '';
  const kd = parseFloat(recent.avgKd);

  const kpis = [
    { label: 'K/D moyen',    value: recent.avgKd,      cls: kd >= 1.3 ? 'good' : kd >= 1 ? 'warn' : 'hot',  sub: '20 derniers matchs' },
    { label: 'HS moyen',     value: `${recent.avgHs}%`, cls: parseFloat(recent.avgHs) >= 45 ? 'good' : 'accent', sub: 'headshot rate' },
    { label: 'Win rate',     value: `${recent.winRate}%`, cls: parseFloat(recent.winRate) >= 55 ? 'good' : 'warn', sub: '20 derniers matchs' },
    { label: 'ELO FACEIT',   value: cs2.elo.toLocaleString(), cls: 'hot', sub: `Niveau ${lvl}/10` },
    { label: 'Matchs totaux', value: lifetime.matches.toLocaleString(), cls: 'accent', sub: `${lifetime.wins} victoires` },
    { label: 'Meilleure série', value: lifetime.longestStreak, cls: 'good', sub: 'wins consécutives' },
  ];

  if (recent.avgKast) kpis.splice(2, 0, { label: 'KAST moyen', value: `${recent.avgKast}%`, cls: 'accent', sub: 'kill/assist/survived/traded' });
  if (recent.avgAdr)  kpis.splice(3, 0, { label: 'ADR moyen',  value: recent.avgAdr,        cls: 'warn',   sub: 'avg damage per round' });

  kpis.slice(0, 6).forEach((k, i) => {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.style.animationDelay = `${i * .05}s`;
    card.innerHTML = `<div class="kpi-label">${k.label}</div><div class="kpi-value ${k.cls}">${k.value}</div><div class="kpi-sub">${k.sub}</div>`;
    kpiGrid.appendChild(card);
  });

  // ── Graphiques ────────────────────────────────────────────────────────────
  const matches  = recent.matches || [];
  const labels   = matches.map((_, i) => `M${i + 1}`);
  const kdVals   = matches.map(m => m.kd);
  const hsVals   = matches.map(m => m.hsPct);

  const chartDefaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#4A6580', font: { family: 'DM Mono', size: 10 } }, grid: { color: '#1C2A3A' } },
      y: { ticks: { color: '#4A6580', font: { family: 'DM Mono', size: 10 } }, grid: { color: '#1C2A3A' } },
    }
  };

  if (chartKd) chartKd.destroy();
  chartKd = new Chart(document.getElementById('chartKd'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: kdVals, fill: true,
        backgroundColor: 'rgba(255,85,0,.1)', borderColor: '#FF5500',
        borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#FF5500', tension: .3,
      }]
    },
    options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, suggestedMin: 0 } } }
  });

  if (chartHs) chartHs.destroy();
  chartHs = new Chart(document.getElementById('chartHs'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: hsVals,
        backgroundColor: hsVals.map(v => v >= 50 ? 'rgba(57,255,138,.4)' : 'rgba(0,229,255,.2)'),
        borderColor:     hsVals.map(v => v >= 50 ? '#39FF8A' : '#00E5FF'),
        borderWidth: 1, borderRadius: 3,
      }]
    },
    options: chartDefaults
  });

  // ── Tableau matchs ───────────────────────────────────────────────────────
  const tbody = document.getElementById('matchTable');
  tbody.innerHTML = '';
  matches.forEach(m => {
    const won  = m.result === 1;
    const kdCl = m.kd >= 1.3 ? 'td-kd-good' : m.kd >= 1 ? 'td-kd-ok' : 'td-kd-bad';
    tbody.innerHTML += `
      <tr>
        <td class="${won ? 'td-result-w' : 'td-result-l'}">${won ? 'VICTOIRE' : 'DÉFAITE'}</td>
        <td class="td-map">${m.map || '—'}</td>
        <td>${m.score || '—'}</td>
        <td class="${kdCl}">${m.kd.toFixed(2)}</td>
        <td>${m.kills}</td>
        <td>${m.deaths}</td>
        <td>${m.hsPct.toFixed(0)}%</td>
        <td>${m.mvp}</td>
      </tr>`;
  });

  showDashboard(player.nickname);
}

function scoreLabel(s) {
  if (s >= 85) return 'Talent exceptionnel — à recruter immédiatement';
  if (s >= 70) return 'Très bon joueur — fort potentiel';
  if (s >= 55) return 'Joueur solide — à suivre';
  if (s >= 40) return 'Niveau correct — progression possible';
  return 'Niveau débutant/intermédiaire';
}

function showLoading(s) { document.getElementById('loading').style.display = s ? 'block' : 'none'; }

function showDashboard(nickname) {
  document.getElementById('hero').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('topbarNick').textContent = `Analyse : ${nickname}`;
  document.getElementById('topbarInput').value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideDashboard() {
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('hero').style.display = 'block';
}

function newSearch() {
  const nick = document.getElementById('topbarInput').value.trim();
  if (!nick) return;
  document.getElementById('nickInput').value = nick;
  searchPlayer();
}

document.addEventListener('DOMContentLoaded', () => {
  const topInput = document.getElementById('topbarInput');
  if (topInput) topInput.addEventListener('keydown', e => { if (e.key === 'Enter') newSearch(); });
});

function showError(msg)  { const el = document.getElementById('errorMsg'); el.textContent = msg; el.style.display = 'block'; }
function hideError()     { document.getElementById('errorMsg').style.display = 'none'; }
