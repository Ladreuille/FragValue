// app.js — FragValue Frontend Logic
// Appelle /api/stats, affiche le dashboard, génère les graphiques Chart.js

// ── Permet aussi d'appuyer sur Entrée dans le champ ────────────────────────
document.getElementById('steamInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchPlayer();
});

// ── Références Chart.js (pour détruire avant de recréer) ──────────────────
let chartWeapons = null;
let chartWinrate = null;

// ── Fonction principale ────────────────────────────────────────────────────
async function searchPlayer() {
  const input   = document.getElementById('steamInput');
  const steamid = input.value.trim();

  // Reset état
  hideError();
  hideDashboard();

  // Validation légère côté client
  if (!steamid) {
    showError('Entre ton SteamID64 avant de lancer la recherche.');
    return;
  }

  if (!/^\d{17}$/.test(steamid)) {
    showError('SteamID invalide — il doit contenir exactement 17 chiffres. Utilise steamidfinder.com pour retrouver le tien.');
    return;
  }

  // Affiche le loader
  showLoading(true);
  document.getElementById('searchBtn').disabled = true;

  try {
    const res  = await fetch(`/api/stats?steamid=${steamid}`);
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Erreur inconnue.');
      return;
    }

    renderDashboard(data);

  } catch (err) {
    showError('Impossible de contacter le serveur. Vérifie ta connexion et réessaie.');
  } finally {
    showLoading(false);
    document.getElementById('searchBtn').disabled = false;
  }
}

// ── Rendu du dashboard ─────────────────────────────────────────────────────
function renderDashboard(data) {
  const { player, stats, weapons } = data;

  // Scroll vers le dashboard
  document.getElementById('hero').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Profil
  const avatarEl = document.getElementById('profileAvatar');
  if (player.avatar) {
    avatarEl.outerHTML = `<img class="profile-avatar" id="profileAvatar" src="${player.avatar}" alt="Avatar"/>`;
  }
  document.getElementById('profileName').textContent = player.name;
  document.getElementById('profileId').textContent   = `SteamID64: ${player.steamid}`;

  // Badges dynamiques
  const badges = document.getElementById('profileBadges');
  badges.innerHTML = '';

  const kdNum = parseFloat(stats.kd);
  if (kdNum >= 1.5) addBadge(badges, `K/D ${stats.kd} — Excellent`, 'badge-green');
  else if (kdNum >= 1.0) addBadge(badges, `K/D ${stats.kd} — Positif`, 'badge-accent');
  else addBadge(badges, `K/D ${stats.kd}`, 'badge-orange');

  if (parseFloat(stats.hsPercent) >= 50) addBadge(badges, 'HS Machine', 'badge-green');
  if (stats.hoursPlayed >= 1000) addBadge(badges, `${stats.hoursPlayed}h jouées`, 'badge-accent');
  if (stats.mvpCount >= 500)    addBadge(badges, `${stats.mvpCount} MVPs`, 'badge-orange');

  // KPI cards
  const kpiGrid = document.getElementById('kpiGrid');
  kpiGrid.innerHTML = '';

  const kpis = [
    { label: 'K/D Ratio',     value: stats.kd,                   cls: kdNum >= 1 ? 'good' : 'warn',   sub: `${stats.kills.toLocaleString()} kills / ${stats.deaths.toLocaleString()} morts` },
    { label: 'Win Rate',      value: `${stats.winRate}%`,         cls: parseFloat(stats.winRate) >= 50 ? 'good' : 'warn', sub: `${stats.wins.toLocaleString()} victoires` },
    { label: 'Headshot %',    value: `${stats.hsPercent}%`,       cls: parseFloat(stats.hsPercent) >= 40 ? 'good' : 'accent', sub: `${stats.hsKills.toLocaleString()} HS` },
    { label: 'Précision',     value: `${stats.accuracy}%`,        cls: 'accent',   sub: `${stats.shotsHit.toLocaleString()} tirs au but` },
    { label: 'Kills totaux',  value: stats.kills.toLocaleString(), cls: 'accent',  sub: `${stats.roundsPlayed.toLocaleString()} rounds joués` },
    { label: 'MVPs',          value: stats.mvpCount.toLocaleString(), cls: 'good', sub: `${stats.hoursPlayed}h de jeu` },
  ];

  kpis.forEach((k, i) => {
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.style.animationDelay = `${i * 0.06}s`;
    card.innerHTML = `
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value ${k.cls}">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    `;
    kpiGrid.appendChild(card);
  });

  // Graphique 1 — Kills par arme (bar chart)
  if (chartWeapons) chartWeapons.destroy();
  const top6 = weapons.slice(0, 6);
  chartWeapons = new Chart(document.getElementById('chartWeapons'), {
    type: 'bar',
    data: {
      labels: top6.map(w => w.label),
      datasets: [{
        label: 'Kills',
        data:  top6.map(w => w.kills),
        backgroundColor: 'rgba(0,229,255,.25)',
        borderColor:     '#00E5FF',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#5A7A94', font: { family: 'DM Mono', size: 11 } }, grid: { color: '#1E2D3D' } },
        y: { ticks: { color: '#5A7A94', font: { family: 'DM Mono', size: 11 } }, grid: { color: '#1E2D3D' } },
      }
    }
  });

  // Graphique 2 — Win rate (doughnut)
  if (chartWinrate) chartWinrate.destroy();
  const losses = 100 - parseFloat(stats.winRate);
  chartWinrate = new Chart(document.getElementById('chartWinrate'), {
    type: 'doughnut',
    data: {
      labels: ['Victoires', 'Défaites'],
      datasets: [{
        data: [parseFloat(stats.winRate), losses > 0 ? losses : 0],
        backgroundColor: ['rgba(57,255,138,.3)', 'rgba(255,69,96,.2)'],
        borderColor:     ['#39FF8A', '#FF4560'],
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#5A7A94', font: { family: 'DM Mono', size: 11 }, boxWidth: 12 }
        }
      }
    }
  });

  // Tableau des armes
  const tbody = document.getElementById('weaponsTable');
  tbody.innerHTML = '';
  weapons.forEach(w => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-weapon">${w.label}</td>
      <td class="td-num">${w.kills.toLocaleString()}</td>
      <td class="td-hs">${w.hsPct}%</td>
      <td class="td-num">${w.accuracy}%</td>
    `;
    tbody.appendChild(tr);
  });

  showDashboard();
}

// ── Helpers UI ─────────────────────────────────────────────────────────────
function addBadge(container, text, cls) {
  const span = document.createElement('span');
  span.className = `badge ${cls}`;
  span.textContent = text;
  container.appendChild(span);
}

function showLoading(show) {
  document.getElementById('loading').style.display   = show ? 'block' : 'none';
}

function showDashboard() {
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hideDashboard() {
  document.getElementById('dashboard').style.display = 'none';
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent    = msg;
  el.style.display  = 'block';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}
