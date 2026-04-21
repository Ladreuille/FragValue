// app.js : FragValue Scout v6 : Premium Design

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
    // Ajouter le token Supabase si l'utilisateur est connecté
    // (permet au rate limit server-side de decompter correctement pour Free)
    const headers = {};
    try {
      if (window.supabase) {
        const sbUrl = 'https://xmyruycvvkmcwysfygcq.supabase.co';
        const sbAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhteXJ1eWN2dmttY3d5c2Z5Z2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTQzMzcsImV4cCI6MjA4OTUzMDMzN30.TaPIaI7puA3qnIrkHQ-VL9o9QgegmOjJR8yYVYsi8oI';
        const sb = window.supabase.createClient(sbUrl, sbAnon);
        const { data: { session } } = await sb.auth.getSession();
        if (session) headers['Authorization'] = 'Bearer ' + session.access_token;
      }
    } catch(_) {}

    const res  = await fetch(`/api/scout?nickname=${encodeURIComponent(nickname)}`, { headers });
    const data = await res.json();
    if (res.status === 429 && data.code === 'scout_limit_reached') {
      showScoutLimitModal(data.message, data.usedToday, data.limit);
      return;
    }
    if (!res.ok) { showError(data.error || 'Erreur inconnue.'); return; }
    if (fromTopbar) resetDashboard();
    renderDashboard(data);
    // ── Sauvegarde historique Supabase ────────────────────────────────────
    saveAnalysis(data);
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
    avatarEl.textContent = '';
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
  const { player, cs2, lifetime, recent, mapStats, teams, fvScore } = data;
  _currentPlayerData = data; // Stocker pour le bouton Suivre

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
      avatarEl.textContent = '';
    }
  }

  // Level badge : sous-niveau dynamique pour lvl 10
  const lvl = cs2.level || 1;
  const levelBadge = document.getElementById('levelBadge');
  if (levelBadge) {
    const bracket = fvScore?.eloBracket;
    if (lvl === 10 && bracket) {
      levelBadge.textContent = bracket === 'Challenger'
        ? ` Challenger${fvScore.challengerRank ? ' #'+fvScore.challengerRank : ''}`
        : `Level ${bracket}`; // ex: "Level 10.5"
      levelBadge.className = bracket === 'Challenger'
        ? 'badge badge-challenger'
        : `badge badge-level-10`;
    } else {
      levelBadge.textContent = `Level ${lvl}`;
      levelBadge.className   = `badge badge-level-${lvl}`;
    }
  }

  document.getElementById('profileName').textContent = player.nickname;

  // FV badge
  const fvBadge = document.getElementById('fvBadge');
  if (fvBadge) {
    fvBadge.textContent = `FV ${recent.fvRating} : ${fvLabel(recent.fvRating)}`;
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

  // ── FV Score /100 (depuis API) ────────────────────────────────────────
  const score = fvScore || null;
  const total = score?.total ?? Math.round(
    Math.min(parseFloat(recent.fvRating)/1.5*100,100)*.35 +
    Math.min(cs2.elo/3000*100,100)*.30 +
    Math.min(parseFloat(recent.winRate),100)*.15 +
    Math.min(parseFloat(recent.avgKd)/2.5*100,100)*.10 +
    Math.min(parseFloat(recent.avgHs)/70*100,100)*.10
  );

  document.getElementById('scoutScore').textContent = total;
  document.getElementById('scoutDesc').textContent  = score?.label
    ? `${score.label} : ${scoreLabel(total)}`
    : scoreLabel(total);

  // Barre de sous-niveau lvl10 (si applicable)
  const subLevelHtml = (score?.subLevel && score?.subLevelProgress !== null) ? `
    <div class="sublevel-bar-wrap">
      <div class="sublevel-bar-label">
        <span>${score.eloBracket || 'Lvl 10'}</span>
        <span style="color:var(--text3)">${score.subLevelProgress}% vers ${score.subLevel < 10 ? 'Lvl 10.'+(score.subLevel+1) : 'Challenger'}</span>
      </div>
      <div class="bar-track" style="margin:4px 0 10px">
        <div class="bar-fill" style="width:${score.subLevelProgress}%;background:linear-gradient(90deg,#3B7FF5,#2DD4A0)"></div>
      </div>
    </div>` : '';

  // Breakdown FV Score si disponible
  const breakdownHtml = score?.breakdown ? `
    <div class="fvscore-breakdown">
      ${[
        { key:'performance', label:'Performance', color:'#3B7FF5', icon:'' },
        { key:'consistency', label:'Consistance',  color:'#2DD4A0', icon:'' },
        { key:'impact',      label:'Impact',       color:'#F5C842', icon:'HS' },
        { key:'utility',     label:'Utilité',      color:'#EDA020', icon:'' },
      ].map(d => {
        const dim = score.breakdown[d.key];
        const pct = Math.round((dim.score / dim.max) * 100);
        return `<div class="fvscore-dim">
          <div class="fvscore-dim-header">
            <span class="fvscore-dim-label">${d.icon} ${d.label}</span>
            <span class="fvscore-dim-val" style="color:${d.color}">${dim.score.toFixed(0)}<span style="color:var(--text3);font-size:10px">/${dim.max}</span></span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct}%;background:${d.color}22;border-right:2px solid ${d.color}"></div>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  document.getElementById('scoutBars').innerHTML = subLevelHtml + breakdownHtml + `
    <div style="margin-top:12px">
    ${[
      { label:'FV Rating', val:Math.min(parseFloat(recent.fvRating)/1.5*100,100),  display:recent.fvRating },
      { label:'ELO',       val:Math.min(cs2.elo/3000*100,100),                     display:cs2.elo.toLocaleString() },
      { label:'Win rate',  val:Math.min(parseFloat(recent.winRate),100),            display:`${recent.winRate}%` },
      { label:'K/D',       val:Math.min(parseFloat(recent.avgKd)/2.5*100,100),     display:recent.avgKd },
      { label:'ADR',       val:Math.min(parseFloat(recent.avgAdr)/120*100,100),    display:recent.avgAdr },
    ].map(b => `
      <div class="bar-row">
        <span class="bar-label">${b.label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,b.val).toFixed(0)}%"></div></div>
        <span class="bar-val">${b.display}</span>
      </div>`).join('')}
    </div>`;

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
        <td>${m.adr>0?m.adr.toFixed(0):''}</td>
        <td>${m.kast>0?m.kast.toFixed(0)+'%':''}</td>
        <td>${m.double+m.triple+m.quad+m.ace}</td>
        <td>${m.clutch1v1+m.clutch1v2+m.clutch1v3}</td>
        <td>${m.mvp}</td>
        <td class="${frCl}">${m.fvRating.toFixed(2)}</td>
      </tr>`;
    }).join('');
  }

  showDashboard(player.nickname);
  // Générer la section amélioration
  injectImprovementCSS();
  renderImprovements(data);
}

function scoreLabel(s) {
  if (s >= 85) return 'Talent exceptionnel : recruter immédiatement';
  if (s >= 70) return 'Très bon joueur : fort potentiel';
  if (s >= 55) return 'Joueur solide : à suivre';
  if (s >= 40) return 'Niveau correct : progression possible';
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
  // Afficher bouton Suivre si connecté
  initFollowBtn();
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

function showScoutLimitModal(message, used, limit) {
  const existing = document.getElementById('fvScoutLimitModal');
  if (existing) { existing.style.display = 'flex'; return; }
  const ov = document.createElement('div');
  ov.id = 'fvScoutLimitModal';
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(8,9,12,.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)';
  ov.innerHTML =
    '<div style="background:#0F1119;border:1px solid #1F2433;border-radius:12px;padding:36px 32px;max-width:420px;width:90%;text-align:center;position:relative">' +
      '<button aria-label="Fermer" onclick="document.getElementById(\'fvScoutLimitModal\').style.display=\'none\'" style="position:absolute;top:14px;right:14px;width:28px;height:28px;background:transparent;border:1px solid #252B3B;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#8892A4">' +
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>' +
      '</button>' +
      '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(184,255,87,.1);color:#b8ff57;padding:4px 10px;border-radius:40px;font-family:JetBrains Mono,monospace;font-size:10px;font-weight:700;letter-spacing:.08em;margin-bottom:18px">PLAN FREE</div>' +
      '<div style="font-size:22px;font-weight:700;letter-spacing:-.4px;color:#EDF0F7;margin-bottom:12px">Limite quotidienne atteinte</div>' +
      '<p style="font-family:JetBrains Mono,monospace;font-size:12px;color:#8892A4;line-height:1.7;margin-bottom:24px">' + (message || ('Tu as utilise tes ' + (limit||3) + ' scouts du jour.')) + '</p>' +
      '<a href="pricing.html" style="display:inline-block;background:#b8ff57;color:#000;padding:12px 28px;border-radius:6px;font-family:JetBrains Mono,monospace;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:.04em">Passer a Pro</a>' +
      '<div style="margin-top:14px"><button onclick="document.getElementById(\'fvScoutLimitModal\').style.display=\'none\'" style="background:none;border:none;color:#4A5568;font-family:JetBrains Mono,monospace;font-size:11px;cursor:pointer;letter-spacing:.04em">Plus tard</button></div>' +
    '</div>';
  ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none'; });
  document.body.appendChild(ov);
  showLoading(false);
  showTopbarLoading(false);
  const btn = document.getElementById('searchBtn');
  if (btn) btn.disabled = false;
}

// ── Bouton Suivre (Watchlist) ─────────────────────────────────────────────
let _currentPlayerData = null;

async function initFollowBtn() {
  const btn = document.getElementById('followBtn');
  if (!btn || !_currentPlayerData) return;
  try {
    const sbUrl  = 'https://xmyruycvvkmcwysfygcq.supabase.co';
    const sbAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhteXJ1eWN2dmttY3d5c2Z5Z2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTQzMzcsImV4cCI6MjA4OTUzMDMzN30.TaPIaI7puA3qnIrkHQ-VL9o9QgegmOjJR8yYVYsi8oI';
    if (!window.supabase) return;
    const sb = window.supabase.createClient(sbUrl, sbAnon);
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return; // Pas connecté → cacher le bouton
    btn.style.display = 'block';
    // Vérifier si déjà en watchlist
    const nick = _currentPlayerData.player?.nickname;
    const { data } = await sb.from('watchlist').select('id').eq('user_id', session.user.id).eq('faceit_nickname', nick).single();
    if (data) { btn.textContent = '✓ Suivi'; btn.classList.add('following'); }
    else       { btn.textContent = '+ Suivre'; btn.classList.remove('following'); }
  } catch(e) {}
}

async function toggleWatchlist() {
  const btn = document.getElementById('followBtn');
  if (!btn || !_currentPlayerData) return;
  const sbUrl  = 'https://xmyruycvvkmcwysfygcq.supabase.co';
  const sbAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhteXJ1eWN2dmttY3d5c2Z5Z2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTQzMzcsImV4cCI6MjA4OTUzMDMzN30.TaPIaI7puA3qnIrkHQ-VL9o9QgegmOjJR8yYVYsi8oI';
  const sb   = window.supabase.createClient(sbUrl, sbAnon);
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  const nick = _currentPlayerData.player?.nickname;
  const elo  = _currentPlayerData.cs2?.elo;
  const avatar = _currentPlayerData.player?.avatar;
  const lvl  = _currentPlayerData.cs2?.level;
  btn.disabled = true;
  try {
    if (btn.classList.contains('following')) {
      await sb.from('watchlist').delete().eq('user_id', session.user.id).eq('faceit_nickname', nick);
      btn.textContent = '+ Suivre'; btn.classList.remove('following');
    } else {
      await sb.from('watchlist').upsert({
        user_id: session.user.id, faceit_nickname: nick,
        faceit_elo: elo, avatar_url: avatar,
        note: `Lvl ${lvl} · ${elo} ELO`,
      }, { onConflict: 'user_id,faceit_nickname' });
      btn.textContent = '✓ Suivi'; btn.classList.add('following');
    }
  } catch(e) { console.warn('toggleWatchlist:', e.message); }
  finally    { btn.disabled = false; }
}

// ── Sauvegarde auto Supabase ───────────────────────────────────────────────
async function saveAnalysis(data) {
  try {
    // Récupérer la session Supabase si dispo
    const sbUrl  = 'https://xmyruycvvkmcwysfygcq.supabase.co';
    const sbAnon = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhteXJ1eWN2dmttY3d5c2Z5Z2NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NTQzMzcsImV4cCI6MjA4OTUzMDMzN30.TaPIaI7puA3qnIrkHQ-VL9o9QgegmOjJR8yYVYsi8oI';
    if (!window.supabase) return; // Supabase non chargé
    const sb = window.supabase.createClient(sbUrl, sbAnon);
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return; // Pas connecté → pas de sauvegarde
    await sb.from('analyses').insert({
      user_id:         session.user.id,
      faceit_nickname: data.player?.nickname,
      faceit_elo:      data.cs2?.elo,
      fv_rating:       parseFloat(data.recent?.fvRating) || null,
      analysed_at:     new Date().toISOString(),
    });
  } catch(e) {
    // Silencieux : pas critique
    console.warn('saveAnalysis:', e.message);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// MOTEUR D'AMÉLIORATION PERSONNELLE
// ═══════════════════════════════════════════════════════════════════════════

function generateImprovements(data) {
  const { recent, cs2, fvScore } = data;
  const matches = recent.matches || [];
  const last = matches[0] || null; // Dernier match

  // ── Analyse dernier match ─────────────────────────────────────────────
  const lastMatchInsights = last ? analyzeLastMatch(last, recent) : null;

  // ── Analyse globale (20 matchs) ───────────────────────────────────────
  const globalInsights = analyzeGlobal(recent, cs2, fvScore, matches);

  return { lastMatchInsights, globalInsights };
}

function analyzeLastMatch(m, recent) {
  const strengths = [];
  const warnings  = [];

  const kd   = parseFloat(m.kd)   || 0;
  const hs   = parseFloat(m.hsPct)|| 0;
  const adr  = parseFloat(m.adr)  || 0;
  const kast = parseFloat(m.kast) || 0;
  const fvR  = parseFloat(m.fvRating) || 0;
  const won  = m.result === 1;

  // Points forts
  if (kd >= 1.5)  strengths.push({ icon: 'kill', label: 'Excellent fragger', detail: `K/D ${kd.toFixed(2)} sur ce match` });
  if (hs >= 60)   strengths.push({ icon: 'hs', label: 'HS% très élevé', detail: `${hs.toFixed(0)}% de headshots` });
  if (adr >= 90)  strengths.push({ icon: 'dmg', label: 'Impact offensif fort', detail: `${adr.toFixed(0)} ADR sur la partie` });
  if (kast >= 75) strengths.push({ icon: 'pres', label: 'Présence constante', detail: `${kast.toFixed(0)}% KAST` });
  const clutchesThisMatch = (m.clutch1v1||0) + (m.clutch1v2||0) + (m.clutch1v3||0);
  if (clutchesThisMatch >= 2) strengths.push({ icon: 'clutch', label: 'Clutcheur en forme', detail: `${clutchesThisMatch} clutches gagnés` });
  const mkThisMatch = (m.triple||0) + (m.quad||0)*2 + (m.ace||0)*3;
  if (mkThisMatch >= 2) strengths.push({ icon: 'mk', label: 'Multi-kills décisifs', detail: `${m.triple||0} triples · ${m.quad||0} quads` });
  if (fvR >= 1.2) strengths.push({ icon: 'fv', label: 'FV Rating élite', detail: `${fvR.toFixed(2)} ce match` });

  // Points à améliorer
  if (kd < 0.8)  warnings.push({
    icon: 'kd', label: 'K/D difficile',
    detail: `${kd.toFixed(2)} ce match`,
    advice: 'Joue plus en équipe, évite les duels isolés en fin de round.'
  });
  if (kd >= 0.8 && kd < 1.0) warnings.push({
    icon: 'kd', label: 'K/D légèrement négatif',
    detail: `${kd.toFixed(2)} ce match`,
    advice: 'Privilégie les duels favorables. Recule si ta position est compromise.'
  });
  if (hs < 35 && kd < 1.2) warnings.push({
    icon: 'hs', label: 'HS% faible',
    detail: `${hs.toFixed(0)}% de headshots`,
    advice: 'Travaille le positionnement de ta mire : vise naturellement à hauteur de tête.'
  });
  if (adr < 65) warnings.push({
    icon: 'dmg', label: 'Peu de dégâts infligés',
    detail: `${adr.toFixed(0)} ADR seulement`,
    advice: 'Essaie de damage checker les ennemis avant les duels : chaque point compte.'
  });
  if (kast < 60) warnings.push({
    icon: 'pres', label: 'Faible présence dans les rounds',
    detail: `${kast.toFixed(0)}% KAST`,
    advice: 'Sois plus actif dans chaque round : trade, assist ou survive. Évite de mourir sans impact.'
  });
  if ((m.firstDeaths||0) > (m.firstKills||0) + 1) warnings.push({
    icon: 'open', label: 'Trop de duels d'ouverture perdus',
    detail: `${m.firstKills||0} opening kills vs ${m.firstDeaths||0} opening deaths`,
    advice: `Sur ${m.map || 'cette map'}, attends que tes coéquipiers prennent les duels d'info en premier.`
  });

  return {
    match: m,
    won,
    strengths: strengths.slice(0, 3),
    warnings: warnings.slice(0, 3),
  };
}

function analyzeGlobal(recent, cs2, fvScore, matches) {
  const strengths = [];
  const improvements = [];

  const kd      = parseFloat(recent.avgKd)   || 0;
  const hs      = parseFloat(recent.avgHs)   || 0;
  const adr     = parseFloat(recent.avgAdr)  || 0;
  const kast    = parseFloat(recent.avgKast) || 0;
  const winRate = parseFloat(recent.winRate) || 0;
  const fvR     = parseFloat(recent.fvRating)|| 0;
  const opening = parseFloat(recent.openingRatio) || 0;
  const ctWR    = parseFloat(recent.ctWinRate) || 0;
  const tWR     = parseFloat(recent.tWinRate)  || 0;
  const flashPR = parseFloat(recent.avgFlashPerRound) || 0;
  const elo     = cs2.elo || 0;

  // Calculer la consistance (CV sur les 20 matchs)
  const fvRatings = matches.map(m => parseFloat(m.fvRating)).filter(v => v > 0);
  const avg = fvRatings.reduce((a,b)=>a+b,0) / (fvRatings.length||1);
  const std = Math.sqrt(fvRatings.reduce((s,v)=>s+(v-avg)**2,0)/(fvRatings.length||1));
  const cv  = avg > 0 ? std/avg : 1;

  // Trend : 5 derniers vs 5 précédents
  const last5  = fvRatings.slice(0,5).reduce((a,b)=>a+b,0)/5;
  const prev5  = fvRatings.slice(5,10).reduce((a,b)=>a+b,0)/5;
  const trendUp = last5 > prev5 + 0.05;
  const trendDown = last5 < prev5 - 0.05;

  // ── POINTS FORTS ─────────────────────────────────────────────────────
  if (kd >= 1.4)   strengths.push({ icon:'kill', label:'Fragger solide',        detail:`K/D moyen ${kd.toFixed(2)} sur 20 matchs`, color:'#2DD4A0' });
  if (hs >= 55)    strengths.push({ icon:'hs',   label:'Mire précise',          detail:`${hs.toFixed(0)}% de headshots en moyenne`,  color:'#3B7FF5' });
  if (adr >= 85)   strengths.push({ icon:'dmg',  label:'Impact offensif',       detail:`${adr.toFixed(0)} ADR moyen sur 20 matchs`,  color:'#2DD4A0' });
  if (kast >= 72)  strengths.push({ icon:'pres', label:'Présence constante',    detail:`${kast.toFixed(0)}% KAST en moyenne`,        color:'#2DD4A0' });
  if (winRate >= 58) strengths.push({ icon:'win', label:'Win rate solide',      detail:`${winRate.toFixed(0)}% de victoires`,         color:'#2DD4A0' });
  if (opening >= 1.2) strengths.push({ icon:'open', label:'Bon duelliste d'ouverture', detail:`Opening ratio ${opening.toFixed(2)}`, color:'#3B7FF5' });
  if (cv <= 0.12)  strengths.push({ icon:'cons', label:'Très consistant',       detail:`Écart-type faible sur 20 matchs`,            color:'#A78BFA' });
  if (recent.totalClutch1v1 + recent.totalClutch1v2 >= 5)
                   strengths.push({ icon:'clutch', label:'Clutcheur',           detail:`${recent.totalClutch1v1 + recent.totalClutch1v2} clutches gagnés`, color:'#F5C842' });
  if (trendUp)     strengths.push({ icon:'trend', label:'En progression',       detail:'FV Rating en hausse sur les 5 derniers matchs', color:'#2DD4A0' });

  // ── AXES D'AMÉLIORATION ───────────────────────────────────────────────
  // Opening ratio
  if (opening < 0.85) improvements.push({
    icon: 'open', label: 'Opening ratio faible',
    detail: `${opening.toFixed(2)} sur 20 matchs`,
    advice: 'Évite de prendre les duels d'information en premier. Laisse un coéquipier peeaker et prends le trade si nécessaire.',
    priority: 'high',
    metric: `${opening.toFixed(2)} ratio`,
  });

  // T side sous-performant vs CT
  if (ctWR > 0 && tWR > 0 && ctWR - tWR >= 12) improvements.push({
    icon: 'tside', label: 'Côté T sous-performant',
    detail: `CT ${ctWR}% vs T ${tWR}% de win rate`,
    advice: 'Travaille les exécutions en équipe côté T. Utilise ta utility avant d\'entrer : smokes, flashes et molotovs font la différence.',
    priority: 'high',
    metric: `${(ctWR - tWR).toFixed(0)}pt d'écart`,
  });

  // KAST faible
  if (kast < 65) improvements.push({
    icon: 'kast', label: 'Faible présence dans les rounds',
    detail: `${kast.toFixed(0)}% KAST sur 20 matchs`,
    advice: 'Cherche à contribuer dans chaque round : assist, trade, ou survive. Mourir sans impact est le problème principal à régler.',
    priority: 'high',
    metric: `${kast.toFixed(0)}% KAST`,
  });

  // Inconsistance
  if (cv >= 0.22) improvements.push({
    icon: 'cons', label: 'Manque de consistance',
    detail: `Forte variabilité de ton FV Rating`,
    advice: 'Joue simple dans les matchs où tu te sens moins bien : prends moins de risques, concentre-toi sur ta survie et tes échanges.',
    priority: cv >= 0.3 ? 'high' : 'medium',
    metric: `CV ${(cv*100).toFixed(0)}%`,
  });

  // ADR faible
  if (adr < 72) improvements.push({
    icon: 'dmg', label: 'Impact en jeu insuffisant',
    detail: `${adr.toFixed(0)} ADR moyen`,
    advice: 'Damage check systématiquement avant les duels. Chaque point de dégât augmente ta présence dans les rounds même sans kill.',
    priority: 'medium',
    metric: `${adr.toFixed(0)} ADR`,
  });

  // Utility passive
  if (flashPR < 0.25 && elo > 1500) improvements.push({
    icon: 'util', label: 'Utilisation de l'utility limitée',
    detail: `${flashPR.toFixed(2)} flash par round`,
    advice: 'Flash avant d'entrer sur un site ou de peeaker un angle difficile. Une bonne flash peut te sauver le duel.',
    priority: 'medium',
    metric: `${flashPR.toFixed(2)} flash/round`,
  });

  // HS% trop élevé (dépendance headshot)
  if (hs >= 72 && kd < 1.3) improvements.push({
    icon: 'hs', label: 'Dépendance aux headshots',
    detail: `${hs.toFixed(0)}% de HS · attention aux angles fermés`,
    advice: 'Un HS% très élevé indique parfois que tu vises trop haut sur des angles difficiles. Spray sur le torse sur les duels lointains.',
    priority: 'low',
    metric: `${hs.toFixed(0)}% HS`,
  });

  // Trend baissier
  if (trendDown && !trendUp) improvements.push({
    icon: 'trend', label: 'Tendance baissière récente',
    detail: 'FV Rating en baisse sur tes 5 derniers matchs',
    advice: 'Fais une pause ou change de map pool. Continuer sur une mauvaise série empire souvent les habitudes.',
    priority: 'medium',
    metric: `${((last5-prev5)/prev5*100).toFixed(0)}% de baisse`,
  });

  return {
    strengths: strengths.slice(0, 4),
    improvements: improvements.sort((a,b) => (a.priority==='high'?0:a.priority==='medium'?1:2) - (b.priority==='high'?0:b.priority==='medium'?1:2)).slice(0, 4),
    trendUp,
    trendDown,
    cv,
  };
}

// ── Render improvements section ──────────────────────────────────────────
function renderImprovements(data) {
  const { lastMatchInsights, globalInsights } = generateImprovements(data);
  const { recent } = data;
  const matches = recent.matches || [];
  const last = matches[0];

  const container = document.getElementById('improvementsPanel');
  if (!container) return;

  // Icônes SVG inline par type
  const icons = {
    kill:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 6.3 6.9 1-5 4.8 1.2 6.9L12 18l-6.1 3 1.2-6.9-5-4.8 6.9-1z"/></svg>`,
    hs:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`,
    dmg:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
    pres:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    clutch:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>`,
    mk:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>`,
    fv:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
    win:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>`,
    open:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22l-4-4 4-4M8 18h8a4 4 0 000-8h-1"/><path d="M12 2l4 4-4 4"/><path d="M16 6H8a4 4 0 000 8h1"/></svg>`,
    cons:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 12l4-4 4 4 5-5"/></svg>`,
    tside: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
    kast:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>`,
    util:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`,
    trend: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/></svg>`,
    kd:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  };

  const getIcon = (key) => icons[key] || icons.fv;

  // ── Dernier match ────────────────────────────────────────────────────
  let lastMatchHtml = '';
  if (lastMatchInsights && last) {
    const won = lastMatchInsights.won;
    const map = last.map || 'Inconnu';
    const date = last.date || '';
    const score = last.score || '';

    lastMatchHtml = `
    <div class="impr-section">
      <div class="impr-section-header">
        <div class="impr-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Dernier match
        </div>
        <div class="impr-match-badge ${won ? 'win' : 'loss'}">
          ${won ? 'Victoire' : 'Défaite'} · ${map} · ${score}
        </div>
      </div>

      <div class="impr-cols">
        ${lastMatchInsights.strengths.length > 0 ? `
        <div class="impr-col">
          <div class="impr-col-header strength">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Ce qui a bien marché
          </div>
          ${lastMatchInsights.strengths.map(s => `
          <div class="impr-item strength">
            <div class="impr-item-icon strength">${getIcon(s.icon)}</div>
            <div class="impr-item-content">
              <div class="impr-item-label">${s.label}</div>
              <div class="impr-item-detail">${s.detail}</div>
            </div>
          </div>`).join('')}
        </div>` : ''}

        ${lastMatchInsights.warnings.length > 0 ? `
        <div class="impr-col">
          <div class="impr-col-header warning">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="9" x2="12" y2="13"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            À corriger
          </div>
          ${lastMatchInsights.warnings.map(w => `
          <div class="impr-item warning">
            <div class="impr-item-icon warning">${getIcon(w.icon)}</div>
            <div class="impr-item-content">
              <div class="impr-item-label">${w.label}</div>
              <div class="impr-item-detail">${w.detail}</div>
              <div class="impr-item-advice">${w.advice}</div>
            </div>
          </div>`).join('')}
        </div>` : ''}
      </div>
    </div>`;
  }

  // ── Analyse globale ──────────────────────────────────────────────────
  const globalHtml = `
    <div class="impr-section">
      <div class="impr-section-header">
        <div class="impr-section-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m7 16 4-4 4 4 5-5"/></svg>
          Tendances globales (20 matchs)
        </div>
        ${globalInsights.trendUp ? '<div class="impr-trend-up">En progression</div>' :
          globalInsights.trendDown ? '<div class="impr-trend-down">Tendance baissière</div>' : ''}
      </div>

      <div class="impr-cols">
        ${globalInsights.strengths.length > 0 ? `
        <div class="impr-col">
          <div class="impr-col-header strength">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Tes points forts
          </div>
          ${globalInsights.strengths.map(s => `
          <div class="impr-item strength">
            <div class="impr-item-icon strength">${getIcon(s.icon)}</div>
            <div class="impr-item-content">
              <div class="impr-item-label">${s.label}</div>
              <div class="impr-item-detail">${s.detail}</div>
            </div>
          </div>`).join('')}
        </div>` : ''}

        ${globalInsights.improvements.length > 0 ? `
        <div class="impr-col">
          <div class="impr-col-header improvement">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Axes prioritaires
          </div>
          ${globalInsights.improvements.map(imp => `
          <div class="impr-item improvement ${imp.priority}">
            <div class="impr-item-icon improvement">${getIcon(imp.icon)}</div>
            <div class="impr-item-content">
              <div class="impr-item-header-row">
                <div class="impr-item-label">${imp.label}</div>
                <div class="impr-priority-badge ${imp.priority}">${imp.priority === 'high' ? 'Priorité haute' : imp.priority === 'medium' ? 'À travailler' : 'Secondaire'}</div>
              </div>
              <div class="impr-item-detail">${imp.detail}</div>
              <div class="impr-item-advice">${imp.advice}</div>
              <div class="impr-item-metric">${imp.metric}</div>
            </div>
          </div>`).join('')}
        </div>` : ''}
      </div>
    </div>`;

  container.innerHTML = lastMatchHtml + globalHtml;
}

// ── CSS à injecter ───────────────────────────────────────────────────────
function injectImprovementCSS() {
  if (document.getElementById('impr-styles')) return;
  const style = document.createElement('style');
  style.id = 'impr-styles';
  style.textContent = `
    .impr-section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:14px}
    .impr-section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px}
    .impr-section-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.6px;font-family:var(--mono)}
    .impr-match-badge{font-family:var(--mono);font-size:11px;font-weight:600;padding:4px 10px;border-radius:5px}
    .impr-match-badge.win{background:rgba(45,212,160,.1);color:var(--success);border:1px solid rgba(45,212,160,.2)}
    .impr-match-badge.loss{background:rgba(240,107,107,.08);color:var(--danger);border:1px solid rgba(240,107,107,.2)}
    .impr-trend-up{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--success);background:rgba(45,212,160,.1);border:1px solid rgba(45,212,160,.2);padding:4px 10px;border-radius:5px}
    .impr-trend-down{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--danger);background:rgba(240,107,107,.08);border:1px solid rgba(240,107,107,.2);padding:4px 10px;border-radius:5px}
    .impr-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media(max-width:700px){.impr-cols{grid-template-columns:1fr}}
    .impr-col{display:flex;flex-direction:column;gap:8px}
    .impr-col-header{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;font-family:var(--mono);margin-bottom:4px;padding:6px 10px;border-radius:6px}
    .impr-col-header.strength{color:var(--success);background:rgba(45,212,160,.06);border:1px solid rgba(45,212,160,.12)}
    .impr-col-header.warning{color:var(--gold);background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.12)}
    .impr-col-header.improvement{color:#60A5FA;background:rgba(59,127,245,.06);border:1px solid rgba(59,127,245,.12)}
    .impr-item{display:flex;gap:10px;padding:12px;border-radius:8px;border:1px solid transparent;transition:border-color .15s}
    .impr-item.strength{background:rgba(45,212,160,.04);border-color:rgba(45,212,160,.1)}
    .impr-item.warning{background:rgba(245,200,66,.04);border-color:rgba(245,200,66,.1)}
    .impr-item.improvement{background:rgba(59,127,245,.04);border-color:rgba(59,127,245,.1)}
    .impr-item.improvement.high{background:rgba(240,107,107,.04);border-color:rgba(240,107,107,.12)}
    .impr-item-icon{width:30px;height:30px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
    .impr-item-icon.strength{background:rgba(45,212,160,.12);color:var(--success)}
    .impr-item-icon.warning{background:rgba(245,200,66,.12);color:var(--gold)}
    .impr-item-icon.improvement{background:rgba(59,127,245,.12);color:#60A5FA}
    .impr-item-content{flex:1;min-width:0}
    .impr-item-header-row{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:2px}
    .impr-item-label{font-size:13px;font-weight:600;letter-spacing:-.2px}
    .impr-item-detail{font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:4px}
    .impr-item-advice{font-size:12px;color:var(--text2);line-height:1.55;background:rgba(255,255,255,.02);border-left:2px solid var(--border2);padding:6px 8px;border-radius:0 4px 4px 0;margin-top:4px}
    .impr-item-metric{font-family:var(--mono);font-size:10px;color:var(--text3);margin-top:4px}
    .impr-priority-badge{font-family:var(--mono);font-size:9px;font-weight:600;padding:2px 6px;border-radius:3px;white-space:nowrap;flex-shrink:0}
    .impr-priority-badge.high{background:rgba(240,107,107,.12);color:var(--danger)}
    .impr-priority-badge.medium{background:rgba(245,200,66,.1);color:var(--gold)}
    .impr-priority-badge.low{background:rgba(59,127,245,.1);color:#60A5FA}
  `;
  document.head.appendChild(style);
}
