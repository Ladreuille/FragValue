// api/_lib/demo-rounds-formatter.js · FragValue
// Convertit le `matches.demo_data` brut (parser Railway output) en XML compact
// pour injection dans le prompt Coach IA. Sans ca, Claude n'a que les stats
// globales (kills/ADR/KAST) et ne peut pas raisonner sur "round 2", "round 12 clutch".
//
// Output format :
//   <rounds n="24" user="quentin" team="T">
//     <round n="1" outcome="W" econ="pistol" plant="A" event="t_eliminated"
//            user_k="0" user_d="0" opening="dEcay-,daMs_- @ long" />
//     <round n="2" outcome="L" econ="eco" event="t_eliminated"
//            user_k="0" user_d="1" died="@ T-spawn by daMs_- (deagle, HS)" />
//     ...
//   </rounds>
//
//   <key_round n="12" outcome="W" econ="full" plant="B" detail="...">
//     <kill tick="194532" attacker="user" victim="daMs_-" weapon="ak47" hs="true"
//           pos_attacker="-1200,800" pos_victim="-1000,750" />
//     <kill ... />
//   </key_round>
//
// Tokens budget : ~2400 tokens pour 24 rounds summary + ~2-3K pour 5-8 key rounds.

// Determine si un round est notable pour le user (worth deep injection).
function isKeyRound(roundKills, userName) {
  const userKills = roundKills.filter(k => k.attacker === userName).length;
  const userDeath = roundKills.find(k => k.victim === userName);
  // Clutch detection serait ideal mais demo_data n'a pas toujours r.clutch=true.
  // Heuristique : multi-kill (>=3) OU opening duel involving user.
  if (userKills >= 3) return { type: 'multi', detail: `${userKills}K multi-kill` };
  const openingKill = roundKills[0];  // premier kill du round (assume parser ordre)
  if (openingKill?.attacker === userName) return { type: 'opening_kill', detail: 'opening kill user' };
  if (openingKill?.victim === userName) return { type: 'opening_loss', detail: 'opening death user' };
  return null;
}

// Bucket l'economy en eco/semi/force/full base sur weapon equipped au round start.
// Approximation : sans equipValue, on regarde l'arme primaire des kills user.
function classifyEcon(round, userTeam, userKillsInRound, userDeathsInRound) {
  // Heuristic basee sur le round number :
  // Round 1 = pistol toujours
  // Round 13 = pistol (half-time)
  const num = round.number || round.round || round.roundNum || 0;
  if (num === 1 || num === 13) return 'pistol';

  // Sinon on regarde le weapon des kills attribues au user (proxy de son buy).
  const userKill = userKillsInRound[0];
  if (userKill?.weapon) {
    const w = userKill.weapon.toLowerCase().replace(/^weapon_/, '');
    if (/^(ak47|m4a1|m4a4|awp|aug|sg556)/.test(w)) return 'full';
    if (/^(galilar|famas|ssg08|mp9|mac10|mp7|p90)/.test(w)) return 'force';
    if (/^(usp_silencer|glock|hkp2000|p2000|deagle|p250|tec9|fiveseven|cz75a)/.test(w)) {
      return num === 1 || num === 13 ? 'pistol' : 'eco';
    }
  }
  return 'unknown';
}

// Format une position en compact callout approxime (pas de map data, juste raw coords).
function fmtPos(x, y) {
  if (x == null || y == null) return '?';
  return `${Math.round(x)},${Math.round(y)}`;
}

// Build le rounds XML block compact pour injection prompt.
//
// Structure attendue parser output (matches.demo_data) :
//   demoData.rounds  : [{round, killsRound, winner (2=T|3=CT), startTick, endTick, isKnife, displayNum}]
//   demoData.kills   : [{round (0-indexed), tick, attacker, victim, weapon, attackerX, attackerY, victimX, victimY, isHeadshot, thruSmoke, isWallbang, ...}]
//   demoData.bombPlants/bombDefuses/bombExplodes : [{round (1-indexed!), tick, X, Y, ...}]
//
// ATTENTION indexing mixed dans le parser :
//   - kills.round = e.total_rounds_played (0-indexed)
//   - rounds.round = freezeR = total_rounds_played (0-indexed)
//   - bombs.round = total_rounds_played + 1 (1-indexed)
// On normalise vers display = round + 1 (1-indexed user-facing).
function formatDemoRoundsXml(demoData, userName, userTeam, options = {}) {
  if (!demoData) return '';
  const { keyRoundsDetail = 6, maxRoundsSummary = 30 } = options;

  const rounds = demoData.rounds || [];
  const kills = demoData.kills || [];
  const bombPlants = demoData.bombPlants || [];
  const bombDefuses = demoData.bombDefuses || [];
  const bombExplodes = demoData.bombExplodes || [];
  const grenadesByRound = demoData.grenadesByRound || {};

  if (!Array.isArray(rounds) || rounds.length === 0) {
    if (!kills.length) return '';
    return formatFromKillsOnly(kills, bombPlants, bombDefuses, bombExplodes, userName, userTeam, maxRoundsSummary);
  }

  // Group kills par round (0-indexed cote kills)
  const killsByRound = {};
  for (const k of kills) {
    const r = k.round ?? 0;
    if (!killsByRound[r]) killsByRound[r] = [];
    killsByRound[r].push(k);
  }
  // Sort par tick chaque round pour identifier l'opening duel
  for (const r in killsByRound) killsByRound[r].sort((a, b) => (a.tick || 0) - (b.tick || 0));

  const summaries = [];
  const keyRounds = [];

  for (const r of rounds.slice(0, maxRoundsSummary)) {
    // Round number : 0-indexed dans le parser, on affiche 1-indexed (displayNum)
    const rIdx = r.round ?? 0;
    const displayN = r.displayNum || r.killsRound || (rIdx + 1);
    if (r.isKnife) continue;  // skip knife rounds (warmup)

    const roundKills = killsByRound[rIdx] || [];
    const userKillsInRound = roundKills.filter(k => k.attacker === userName);
    const userDeathsInRound = roundKills.filter(k => k.victim === userName);

    // Outcome : winner 2=T, 3=CT. Si user team match winner -> W
    const winnerTeam = r.winner === 2 ? 'T' : r.winner === 3 ? 'CT' : null;
    // userSideThisRound : swap apres halftime (round 13+ display = 2eme mi)
    const userSideThisRound = (displayN <= 12) ? userTeam : (userTeam === 'T' ? 'CT' : 'T');
    const outcome = winnerTeam ? (winnerTeam === userSideThisRound ? 'W' : 'L') : '?';

    // Bombs : 1-indexed dans parser, donc match avec displayN
    const planted = bombPlants.find(b => b.round === displayN);
    const defused = bombDefuses.find(b => b.round === displayN);
    const exploded = bombExplodes.find(b => b.round === displayN);
    const bombInfo = exploded ? 'plant_explode' : (defused ? 'plant_defused' : (planted ? 'planted' : ''));

    // Econ heuristic
    const econ = classifyEconFromKills(displayN, userKillsInRound);

    // Event reason
    const eventReason = exploded ? 't_bomb_explode' :
                        defused ? 'ct_defuse' :
                        winnerTeam ? `${winnerTeam.toLowerCase()}_eliminated` : '?';

    // Opening duel = premier kill (kills sorted par tick)
    const opening = roundKills[0];
    let openingStr = '';
    if (opening) {
      const tag = opening.attacker === userName ? '★user_kill' : opening.victim === userName ? '☠user_died' : '';
      openingStr = ` opening="${escapeXml(opening.attacker)} → ${escapeXml(opening.victim)} (${opening.weapon || ''})${tag ? ' ' + tag : ''}"`;
    }

    // User stats du round
    const uK = userKillsInRound.length;
    const uD = userDeathsInRound.length;
    const userDied = userDeathsInRound[0];
    let diedStr = '';
    if (userDied) {
      diedStr = ` died_to="${escapeXml(userDied.attacker)} (${userDied.weapon || ''}${userDied.isHeadshot ? ', HS' : ''}${userDied.thruSmoke ? ', smoke' : ''}${userDied.isWallbang ? ', wallbang' : ''})"`;
    }

    // Grenades summary
    const grenSum = grenadesByRound[displayN] || grenadesByRound[rIdx];
    let grenStr = '';
    if (grenSum) {
      const parts = [];
      if (grenSum.smoke) parts.push(`${grenSum.smoke}smk`);
      if (grenSum.flash) parts.push(`${grenSum.flash}fl`);
      if (grenSum.he) parts.push(`${grenSum.he}he`);
      if (grenSum.molo) parts.push(`${grenSum.molo}mol`);
      if (parts.length) grenStr = ` nades_round="${parts.join(' ')}"`;
    }

    summaries.push(
      `  <round n="${displayN}" outcome="${outcome}" econ="${econ}" event="${eventReason}"${bombInfo ? ` bomb="${bombInfo}"` : ''} user_k="${uK}" user_d="${uD}"${openingStr}${diedStr}${grenStr} />`
    );

    // Key round detection (multi-kill, opening involving user)
    const keyCheck = isKeyRound(roundKills, userName);
    if (keyCheck && keyRounds.length < keyRoundsDetail) {
      keyRounds.push({ displayN, rIdx, kills: roundKills, type: keyCheck.type, detail: keyCheck.detail });
    }
  }

  // Build XML
  let xml = `<rounds n="${summaries.length}" user="${escapeXml(userName)}" team="${userTeam}">\n`;
  xml += summaries.join('\n');
  xml += `\n</rounds>`;

  // Key rounds en detail (full kill list with positions)
  if (keyRounds.length > 0) {
    xml += '\n<key_rounds>\n';
    for (const kr of keyRounds) {
      xml += `  <round n="${kr.displayN}" type="${kr.type}">\n`;
      for (const k of kr.kills.slice(0, 8)) {
        const isUser = k.attacker === userName ? ' user_kill="true"' : k.victim === userName ? ' user_death="true"' : '';
        xml += `    <kill tick="${k.tick || 0}" attacker="${escapeXml(k.attacker)}" victim="${escapeXml(k.victim)}" weapon="${k.weapon || ''}"${k.isHeadshot ? ' hs="true"' : ''}${k.thruSmoke ? ' smoke="true"' : ''}${k.isWallbang ? ' wb="true"' : ''} pos_a="${fmtPos(k.attackerX, k.attackerY)}" pos_v="${fmtPos(k.victimX, k.victimY)}"${isUser} />\n`;
      }
      xml += `  </round>\n`;
    }
    xml += '</key_rounds>';
  }

  return xml;
}

function escapeXml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function classifyEconFromKills(displayN, userKillsInRound) {
  if (displayN === 1 || displayN === 13) return 'pistol';
  const k = userKillsInRound[0];
  if (!k?.weapon) return 'unknown';
  const w = k.weapon.toLowerCase().replace(/^weapon_/, '');
  if (/^(ak47|m4a1|m4a4|awp|aug|sg556|sg553)/.test(w)) return 'full';
  if (/^(galilar|famas|ssg08|mp9|mac10|mp7|p90|ump45|bizon|nova|mag7|xm1014)/.test(w)) return 'force';
  if (/^(usp_silencer|glock|hkp2000|p2000|deagle|p250|tec9|fiveseven|cz75a|revolver|elite)/.test(w)) return 'eco';
  return 'unknown';
}

// Fallback : si demo_data n'a pas de rounds[] structure, on derive depuis kills.
function formatFromKillsOnly(kills, bombPlants, bombDefuses, bombExplodes, userName, userTeam, maxRounds) {
  // Group by round
  const roundNums = [...new Set(kills.map(k => k.round ?? 0))].filter(n => n > 0).sort((a, b) => a - b);
  if (!roundNums.length) return '';

  let xml = `<rounds n="${roundNums.length}" user="${userName}" team="${userTeam}" source="kills_only">\n`;
  for (const num of roundNums.slice(0, maxRounds)) {
    const roundKills = kills.filter(k => k.round === num);
    const uK = roundKills.filter(k => k.attacker === userName).length;
    const userDied = roundKills.find(k => k.victim === userName);
    const planted = bombPlants.some(b => b.round === num);
    const defused = bombDefuses.some(b => b.round === num);
    const exploded = bombExplodes.some(b => b.round === num);
    const bombInfo = exploded ? 'plant_explode' : (defused ? 'plant_defused' : (planted ? 'planted' : ''));
    xml += `  <round n="${num}" user_k="${uK}" user_d="${userDied ? 1 : 0}"${bombInfo ? ` bomb="${bombInfo}"` : ''}${userDied ? ` died_to="${userDied.attacker} (${userDied.weapon || ''})"` : ''} />\n`;
  }
  xml += `</rounds>`;
  return xml;
}

module.exports = {
  formatDemoRoundsXml,
  isKeyRound,
  classifyEcon,
};
