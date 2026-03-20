// app.js — FragValue Scout v6 — Premium Design

document.getElementById('nickInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchPlayer();
});

let charts = {};

// ── Search ─────────────────────────────────────────────────────────────────
async function searchPlayer(nicknameOverride) {
  const nickname = nicknameOverride || document.getElementById('nickInput').value.trim();
  hideError();
  if (!nickname) { showError('Entre un pseudo FACEIT.'); return; }

  const fromTopbar = !!nicknameOverride;

  if (fromTopbar) {
    document.getElementById('topbarNick').textContent = `Recherche : ${nickname}...`;
    showTopbarLoading(true);
  } else {
    hideDashboard();
    resetDashboard();
    showLoading(true);
    document.getElementById('searchBtn').disabled = true;
  }

  try {
    const res  = await fetch(`/api/scout?nickname=${encodeURIComponent(nickname)}`);
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Erreur inconnue.'); return; }
    if (fromTopbar) resetDashboard();
    renderDashboard(data);
  } catch { showError('Impossible de contacter le serveur.'); }
  finally {
    showTopbarLoading(false);
    showLoading(false);
    document.getElementById('searchBtn').disabled = false;
  }
}

function showTopbarLoading(show) {
  let overlay = document.getElementById('topbarLoadingOverlay');
  if (show) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'topbarLoadingOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,9,12,.75);z-index:200;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
      overlay.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:14px"><div style="width:32px;height:32px;border:2px solid #1F2433;border-top-color:#3B7FF5;border-radius:50%;animation:spin .7s linear infinite"></div><div style="font-family:JetBrains Mono,monospace;font-size:12px;color:#8892A4;letter-spacing:.5px">Chargement...</div></div>';
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
  } else {
    if (overlay) overlay.style.display = 'none';
  }
}

// ── Reset ──────────────────────────────────────────────────────────────────
function resetDashboard() {
  const avatarEl = document.getElementById('profileAvatar');
  if (avatarEl) {
    avatarEl.style.backgroundImage = '';
    avatarEl.textContent = '👤';
    avatarEl.classList.remove('has-avatar');
  }
  ['profileName','profileCountry','profileRole','profileTeam',
   'eloVal','resultsRow','scoutScore','scoutDesc','scoutBars',
   'kpiMain','kpiSides','kpiUtility','kpiTrades',
   'multiKillCards','clutchCards','mapCards','matchTable','matchTableHead',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });

  const fvBadge = document.getElementById('fvBadge');
  if (fvBadge) { fvBadge.textContent = ''; fvBadge.className = 'badge'; }
  const levelBadge = document.getElementById('levelBadge');
  if (levelBadge) { levelBadge.textContent = ''; levelBadge.className = 'badge'; }

  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
  charts = {};
}

// ── FV Rating helpers ──────────────────────────────────────────────────────
function fvBadgeClass(r) {
  const v = parseFloat(r);
  if (v >= 1.20) return 'badge badge-fv-elite';
  if (v >= 1.05) return 'badge badge-fv-great';
  if (v >= 0.90) return 'badge badge-fv-good';
  if (v >= 0.75) return 'badge badge-fv-avg';
  return 'badge badge-fv-low';
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
  if (v >= 1.20) return '#2DD4A0';
  if (v >= 1.05) return '#60A5FA';
  if (v >= 0.90) return '#F5C842';
  if (v >= 0.75) return '#EDA020';
  return '#F06B6B';
}

// ── KPI card ──────────────────────────────────────────────────────────────
function kpiCard(label, value, cls, sub) {
  return `<div class="kpi-card">
    <div class="kpi-label">${label}</div>
    <div class="kpi-val ${cls}">${value}</div>
    <div class="kpi-sub">${sub}</div>
  </div>`;
}

// ── Chart helper ──────────────────────────────────────────────────────────
const CHART_DEFAULTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: {
    backgroundColor: '#1C1F28', titleColor: '#EDF0F7', bodyColor: '#8892A4',
    borderColor: '#252B3B', borderWidth: 1, padding: 10,
    titleFont: { family: 'JetBrains Mono', size: 11 },
    bodyFont:  { family: 'JetBrains Mono', size: 11 },
  }},
  scales: {
    x: { ticks: { color: '#4A5568', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: '#1F2433' } },
    y: { ticks: { color: '#4A5568', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: '#1F2433' } },
  }
};

function makeChart(id, type, labels, data, opts = {}) {
  if (charts[id]) { try { charts[id].destroy(); } catch(e) {} }
  const el = document.getElementById(id);
  if (!el) return;
  charts[id] = new Chart(el, {
    type,
    data: { labels, datasets: [{ data, ...opts.dataset }] },
    options: { ...CHART_DEFAULTS, ...opts.extra, scales: {
      x: { ...CHART_DEFAULTS.scales.x },
      y: { ...CHART_DEFAULTS.scales.y, ...(opts.yOpts||{}) },
    }},
  });
}

// ── Main render ────────────────────────────────────────────────────────────
function renderDashboard(data) {
  const { player, cs2, lifetime, recent, mapStats, teams } = data;

  // Avatar
  const avatarEl = document.getElementById('profileAvatar');
  if (avatarEl) {
    if (player.avatar) {
      avatarEl.style.backgroundImage = `url(${player.avatar})`;
      avatarEl.style.backgroundSize  = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
      avatarEl.classList.add('has-avatar');
    } else {
      avatarEl.style.backgroundImage = '';
      avatarEl.textContent = '👤';
    }
  }

  // Level badge — texte coloré selon le niveau
  const lvl = cs2.level || 1;
  const levelBadge = document.getElementById('levelBadge');
  if (levelBadge) {
    levelBadge.textContent = `Level ${lvl}`;
    levelBadge.className   = `badge badge-level-${lvl}`;
  }

  document.getElementById('profileName').textContent = player.nickname;

  // FV badge
  const fvBadge = document.getElementById('fvBadge');
  if (fvBadge) {
    fvBadge.textContent = `FV ${recent.fvRating} — ${fvLabel(recent.fvRating)}`;
    fvBadge.className   = fvBadgeClass(recent.fvRating);
  }

  // Role / country / team
  const roleEl = document.getElementById('profileRole');
  if (roleEl) roleEl.textContent = recent.role || 'Rifler';

  const countryEl = document.getElementById('profileCountry');
  if (countryEl) {
    countryEl.textContent = player.country ? player.country.toUpperCase() : '';
    countryEl.style.display = player.country ? '' : 'none';
  }

  const teamEl = document.getElementById('profileTeam');
  if (teamEl) {
    if (teams && teams.length > 0) {
      teamEl.textContent = teams[0].name;
      teamEl.style.display = '';
    } else {
      teamEl.style.display = 'none';
    }
  }

  // ELO
  document.getElementById('eloVal').textContent = cs2.elo.toLocaleString();

  // Results
  const resultsRow = document.getElementById('resultsRow');
  if (resultsRow) {
    resultsRow.innerHTML = (lifetime.recentResults || []).slice(0, 10).map(r =>
      `<div class="result-dot ${r === '1' ? 'w' : 'l'}"></div>`
    ).join('');
  }

  // ── Scout Score ────────────────────────────────────────────────────────
  const fvScore  = Math.min(parseFloat(recent.fvRating)  / 1.5 * 100, 100);
  const eloScore = Math.min(cs2.elo / 3000 * 100, 100);
  const wrScore  = Math.min(parseFloat(recent.winRate), 100);
  const kdScore  = Math.min(parseFloat(recent.avgKd) / 2.5 * 100, 100);
  const hsScore  = Math.min(parseFloat(recent.avgHs) / 70 * 100, 100);
  const total    = Math.round(fvScore*.35 + eloScore*.30 + wrScore*.15 + kdScore*.10 + hsScore*.10);

  document.getElementById('scoutScore').textContent = total;
  document.getElementById('scoutDesc').textContent  = scoreLabel(total);

  const barsData = [
    { label:'FV Rating', val:fvScore,  display:recent.fvRating },
    { label:'ELO',       val:eloScore, display:cs2.elo.toLocaleString() },
    { label:'Win rate',  val:wrScore,  display:`${recent.winRate}%` },
    { label:'K/D',       val:kdScore,  display:recent.avgKd },
    { label:'HS%',       val:hsScore,  display:`${recent.avgHs}%` },
    { label:'ADR',       val:Math.min(parseFloat(recent.avgAdr)/120*100,100), display:recent.avgAdr },
  ];
  document.getElementById('scoutBars').innerHTML = barsData.map(b => `
    <div class="bar-row">
      <span class="bar-label">${b.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,b.val).toFixed(0)}%"></div></div>
      <span class="bar-val">${b.display}</span>
    </div>`).join('');

  // ── KPIs principaux ────────────────────────────────────────────────────
  const kd = parseFloat(recent.avgKd);
  document.getElementById('kpiMain').innerHTML = [
    kpiCard('FV Rating 2.1', recent.fvRating, fvColor(recent.fvRating).startsWith('#2D')?'kpi-good':fvColor(recent.fvRating).startsWith('#60')?'kpi-blue':fvColor(recent.fvRating).startsWith('#F5')?'kpi-warn':'kpi-bad', fvLabel(recent.fvRating)),
    kpiCard('K/D moyen',  recent.avgKd,        kd>=1.3?'kpi-good':kd>=1?'kpi-warn':'kpi-bad', '20 derniers matchs'),
    kpiCard('HS%',        `${recent.avgHs}%`,  parseFloat(recent.avgHs)>=45?'kpi-good':'kpi-blue', 'headshot rate'),
    kpiCard('ADR',        recent.avgAdr,        parseFloat(recent.avgAdr)>=80?'kpi-good':'kpi-warn', 'avg dmg / round'),
    kpiCard('KAST',       `${recent.avgKast}%`, parseFloat(recent.avgKast)>=70?'kpi-good':'kpi-blue', 'kill/assist/surv/traded'),
    kpiCard('Win rate',   `${recent.winRate}%`, parseFloat(recent.winRate)>=55?'kpi-good':'kpi-warn', '20 derniers matchs'),
    kpiCard('ELO',        cs2.elo.toLocaleString(), 'kpi-neutral', `Niveau ${lvl}/10`),
    kpiCard('Matchs',     lifetime.matches.toLocaleString(), 'kpi-blue', `${lifetime.wins} victoires`),
  ].join('');

  // ── CT/T split ─────────────────────────────────────────────────────────
  document.getElementById('kpiSides').innerHTML = `
    <div class="side-grid">
      <div class="side-card">
        <div class="side-title"><div class="side-dot ct"></div>Côté CT</div>
        <div class="side-stats">
          <div class="side-stat"><div class="side-stat-val kpi-blue">${recent.ctWinRate}%</div><div class="side-stat-label">Win rate</div></div>
          <div class="side-stat"><div class="side-stat-val kpi-neutral">${recent.ctKd}</div><div class="side-stat-label">K/D</div></div>
        </div>
      </div>
      <div class="side-card">
        <div class="side-title"><div class="side-dot t"></div>Côté T</div>
        <div class="side-stats">
          <div class="side-stat"><div class="side-stat-val kpi-warn">${recent.tWinRate}%</div><div class="side-stat-label">Win rate</div></div>
          <div class="side-stat"><div class="side-stat-val kpi-neutral">${recent.tKd}</div><div class="side-stat-label">K/D</div></div>
        </div>
      </div>
    </div>
    <div class="kpi-grid" style="margin-top:8px">
      ${kpiCard('Opening ratio', recent.openingRatio, parseFloat(recent.openingRatio)>=1?'kpi-good':'kpi-bad', `${recent.totalFirstKills}K / ${recent.totalFirstDeaths}D`)}
      ${kpiCard('Série max', lifetime.longestStreak, 'kpi-good', 'wins consécutives')}
      ${kpiCard('Série actuelle', lifetime.currentStreak||0, (lifetime.currentStreak||0)>=3?'kpi-good':'kpi-blue', 'en cours')}
      ${kpiCard('K/R moyen', recent.avgKr, 'kpi-blue', 'kills per round')}
    </div>`;

  // ── Charts ─────────────────────────────────────────────────────────────
  const matches = recent.matches || [];
  const labels  = matches.map((_, i) => `M${i+1}`);

  makeChart('chartKd', 'line', labels, matches.map(m => m.kd), {
    dataset: { fill:true, backgroundColor:'rgba(59,127,245,.08)', borderColor:'#3B7FF5', borderWidth:1.5, pointRadius:2, pointBackgroundColor:'#3B7FF5', tension:.4 },
    yOpts: { suggestedMin: 0 }
  });
  makeChart('chartHs', 'bar', labels, matches.map(m => m.hsPct), {
    dataset: { backgroundColor:'rgba(59,127,245,.2)', borderColor:'#3B7FF5', borderWidth:1, borderRadius:2 },
    yOpts: { suggestedMin: 0 }
  });
  makeChart('chartAdr', 'line', labels, matches.map(m => m.adr), {
    dataset: { fill:true, backgroundColor:'rgba(245,200,66,.06)', borderColor:'#F5C842', borderWidth:1.5, pointRadius:2, pointBackgroundColor:'#F5C842', tension:.4 },
    yOpts: { suggestedMin: 0 }
  });
  makeChart('chartFv', 'line', labels, matches.map(m => m.fvRating), {
    dataset: {
      fill:true, backgroundColor:'rgba(45,212,160,.06)', borderColor:'#2DD4A0',
      borderWidth:1.5, pointRadius:3, tension:.4,
      pointBackgroundColor: matches.map(m => m.fvRating>=1.05?'#2DD4A0':m.fvRating>=0.9?'#F5C842':'#F06B6B')
    },
    yOpts: { suggestedMin: 0.3 }
  });

  // ── Utility ────────────────────────────────────────────────────────────
  document.getElementById('kpiUtility').innerHTML = `
    <div class="utility-grid">
      <div class="util-card"><div class="util-label">Flashes lancées</div><div class="util-val kpi-blue">${recent.totalFlashesThrown}</div><div class="util-sub">20 matchs</div></div>
      <div class="util-card"><div class="util-label">Ennemis flashés</div><div class="util-val kpi-good">${recent.totalEnemiesFlashed}</div><div class="util-sub">20 matchs</div></div>
      <div class="util-card"><div class="util-label">Flash / round</div><div class="util-val kpi-blue">${recent.avgFlashPerRound}</div><div class="util-sub">moyenne</div></div>
      <div class="util-card"><div class="util-label">Utility dmg</div><div class="util-val kpi-warn">${recent.totalUtilDmg}</div><div class="util-sub">20 matchs</div></div>
      <div class="util-card"><div class="util-label">AWP / sniper</div><div class="util-val kpi-neutral">${recent.totalSniperKills}</div><div class="util-sub">${recent.sniperKillRate}/match</div></div>
    </div>`;

  // ── Trades ─────────────────────────────────────────────────────────────
  document.getElementById('kpiTrades').innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Trade kills',  recent.totalTradeKills,  'kpi-good',    '20 matchs')}
      ${kpiCard('Trade deaths', recent.totalTradeDeaths, 'kpi-bad',     '20 matchs')}
      ${kpiCard('Saves',        recent.totalSaves,        'kpi-blue',    'armes sauvées')}
      ${kpiCard('Pistol win%',  `${recent.pistolWinRate}%`, parseFloat(recent.pistolWinRate)>=50?'kpi-good':'kpi-warn', `${recent.totalPistolWins}/${recent.totalPistolTotal}`)}
    </div>`;

  // ── Multi-kills ────────────────────────────────────────────────────────
  document.getElementById('multiKillCards').innerHTML = `
    <div class="mk-card"><div class="mk-label">Double kill</div><div class="mk-val mk-2k">${recent.totalDoubles}</div><div class="mk-sub">2K</div></div>
    <div class="mk-card"><div class="mk-label">Triple kill</div><div class="mk-val mk-3k">${recent.totalTriples}</div><div class="mk-sub">3K</div></div>
    <div class="mk-card"><div class="mk-label">Quadro kill</div><div class="mk-val mk-4k">${recent.totalQuads}</div><div class="mk-sub">4K</div></div>
    <div class="mk-card"><div class="mk-label">Ace</div><div class="mk-val mk-5k">${recent.totalAces}</div><div class="mk-sub">5K</div></div>`;

  // ── Clutches ───────────────────────────────────────────────────────────
  document.getElementById('clutchCards').innerHTML = `
    <div class="clutch-grid">
      <div class="clutch-card"><div class="clutch-label">1v1</div><div class="clutch-val kpi-good">${recent.totalClutch1v1}</div></div>
      <div class="clutch-card"><div class="clutch-label">1v2</div><div class="clutch-val kpi-blue">${recent.totalClutch1v2}</div></div>
      <div class="clutch-card"><div class="clutch-label">1v3</div><div class="clutch-val kpi-warn">${recent.totalClutch1v3}</div></div>
      <div class="clutch-card"><div class="clutch-label">1v4</div><div class="clutch-val kpi-bad">${recent.totalClutch1v4}</div></div>
      <div class="clutch-card"><div class="clutch-label">1v5</div><div class="clutch-val" style="color:#D93535">${recent.totalClutch1v5}</div></div>
    </div>
    <div class="kpi-grid" style="margin-top:8px">
      ${kpiCard('Opening kills',  recent.totalFirstKills,  'kpi-good', '20 matchs')}
      ${kpiCard('Opening deaths', recent.totalFirstDeaths, 'kpi-bad',  '20 matchs')}
      ${kpiCard('Opening ratio',  recent.openingRatio, parseFloat(recent.openingRatio)>=1?'kpi-good':'kpi-bad', 'K/D duels ouverture')}
    </div>`;

  // ── Map cards ──────────────────────────────────────────────────────────
  const mapContainer = document.getElementById('mapCards');
  if (mapContainer) {
    mapContainer.innerHTML = (mapStats || []).map(m => {
      const wr = parseFloat(m.winRate);
      const wrColor = wr>=60 ? 'var(--success)' : wr>=45 ? 'var(--gold)' : 'var(--danger)';
      return `<div class="map-card">
        <div class="map-winrate">
          <div class="map-name">${m.map}</div>
          <div class="map-wr-val" style="color:${wrColor}">${m.winRate}%</div>
        </div>
        <div class="map-wr-bar"><div class="map-wr-fill" style="width:${wr}%"></div></div>
        <div class="map-matches">${m.matches} matchs</div>
        <div class="map-stats" style="margin-top:10px">
          <div class="map-stat"><div class="map-stat-val kpi-neutral">${m.kd}</div><div class="map-stat-label">K/D</div></div>
          <div class="map-stat"><div class="map-stat-val kpi-blue">${m.avgAdr}</div><div class="map-stat-label">ADR</div></div>
          <div class="map-stat"><div class="map-stat-val" style="color:${fvColor(m.avgFvRating)}">${m.avgFvRating}</div><div class="map-stat-label">FV Rating</div></div>
          <div class="map-stat"><div class="map-stat-val kpi-warn">${m.ctWinRate}%</div><div class="map-stat-label">CT win</div></div>
        </div>
      </div>`;
    }).join('');
  }

  // ── Match history ──────────────────────────────────────────────────────
  const thead = document.getElementById('matchTableHead');
  if (thead) {
    thead.innerHTML = ['Résultat','Map','Score','K/D','K','D','A','HS%','ADR','KAST','MK','Clutch','MVP','FV'].map(h => `<th>${h}</th>`).join('');
  }
  const tbody = document.getElementById('matchTable');
  if (tbody) {
    tbody.innerHTML = matches.map(m => {
      const won  = m.result === 1;
      const kdCl = m.kd>=1.3?'td-kd-good':m.kd>=1?'':'td-kd-bad';
      const frCl = m.fvRating>=1.05?'td-kd-good':m.fvRating>=0.9?'':'td-kd-bad';
      return `<tr>
        <td class="${won?'td-win':'td-loss'}">${won?'W':'L'}</td>
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
    }).join('');
  }

  showDashboard(player.nickname);
}

function scoreLabel(s) {
  if (s >= 85) return 'Talent exceptionnel — recruter immédiatement';
  if (s >= 70) return 'Très bon joueur — fort potentiel';
  if (s >= 55) return 'Joueur solide — à suivre';
  if (s >= 40) return 'Niveau correct — progression possible';
  return 'Niveau débutant / intermédiaire';
}

// ── Show/hide ──────────────────────────────────────────────────────────────
function showLoading(show) {
  const el = document.getElementById('loadingState');
  if (el) el.style.display = show ? 'flex' : 'none';
}

function showDashboard(nickname) {
  document.getElementById('hero').style.display      = 'none';
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('topbar').style.display    = 'flex';
  document.getElementById('tabBar').style.display    = 'flex';
  document.getElementById('topbarNick').textContent  = nickname;
  document.getElementById('topbarInput').value       = '';
  switchTab('stats', document.querySelector('.tab-btn'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideDashboard() {
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('topbar').style.display    = 'none';
  document.getElementById('tabBar').style.display    = 'none';
  document.getElementById('hero').style.display      = 'block';
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  if (btn) btn.classList.add('active');
}

function newSearch() {
  const nick = document.getElementById('topbarInput').value.trim();
  if (!nick) return;
  document.getElementById('topbarInput').value = '';
  document.getElementById('nickInput').value = nick;
  searchPlayer(nick);
}

document.addEventListener('DOMContentLoaded', () => {
  const t = document.getElementById('topbarInput');
  if (t) t.addEventListener('keydown', e => { if (e.key === 'Enter') newSearch(); });
});

function showError(msg) { const el = document.getElementById('errorMsg'); if(el){el.textContent=msg;el.style.display='block';} }
function hideError()    { const el = document.getElementById('errorMsg'); if(el) el.style.display='none'; }
