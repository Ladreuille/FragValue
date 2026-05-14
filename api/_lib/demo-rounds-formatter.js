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
function formatDemoRoundsXml(demoData, userName, userTeam, options = {}) {
  if (!demoData) return '';
  const { keyRoundsDetail = 6, maxRoundsSummary = 30 } = options;

  // demo_data structure varie selon parser. Try multiple paths.
  const rounds = demoData.rounds || demoData.roundsData || [];
  const kills = demoData.kills || [];
  const bombPlants = demoData.bombPlants || [];
  const bombDefuses = demoData.bombDefuses || [];
  const bombExplodes = demoData.bombExplodes || [];

  if (!Array.isArray(rounds) || rounds.length === 0) {
    // Fallback : on a juste les kills, on regroupe par round_num
    if (!kills.length) return '';
    return formatFromKillsOnly(kills, bombPlants, bombDefuses, bombExplodes, userName, userTeam, maxRoundsSummary);
  }

  // Group kills par round
  const killsByRound = {};
  for (const k of kills) {
    const r = k.round ?? 0;
    if (!killsByRound[r]) killsByRound[r] = [];
    killsByRound[r].push(k);
  }

  // Build summary line pour chaque round + collecte les key rounds
  const summaries = [];
  const keyRounds = [];

  for (const r of rounds.slice(0, maxRoundsSummary)) {
    const num = r.number || r.round || r.roundNum || 0;
    if (!num) continue;
    const roundKills = killsByRound[num] || [];
    const userKillsInRound = roundKills.filter(k => k.attacker === userName);
    const userDeathsInRound = roundKills.filter(k => k.victim === userName);

    // Outcome : W si user team a gagne, L sinon
    const winnerTeam = r.winner === 2 ? 'T' : r.winner === 3 ? 'CT' : null;
    // user_team peut changer mi-match (CT 1ere mi, T 2eme mi)
    // Pour MR12 : rounds 1-12 = user joue selon initial, 13-24 = swap
    const userSideThisRound = (num <= 12) ? userTeam : (userTeam === 'T' ? 'CT' : 'T');
    const outcome = winnerTeam ? (winnerTeam === userSideThisRound ? 'W' : 'L') : '?';

    // Plant
    const planted = bombPlants.find(b => b.round === num);
    const defused = bombDefuses.find(b => b.round === num);
    const exploded = bombExplodes.find(b => b.round === num);
    const bombInfo = exploded ? 'plant_explode' : (defused ? 'plant_defused' : (planted ? 'planted' : ''));

    // Econ heuristic
    const econ = classifyEcon(r, userTeam, userKillsInRound, userDeathsInRound);

    // Event reason
    const eventReason = r.reason || (exploded ? 't_eliminated' : (defused ? 'ct_eliminated' : winnerTeam ? `${winnerTeam.toLowerCase()}_win` : '?'));

    // Opening duel
    const opening = roundKills[0];
    let openingStr = '';
    if (opening) {
      const tag = opening.attacker === userName ? '★ user kill' : opening.victim === userName ? '☠ user died' : '';
      openingStr = ` opening="${opening.attacker} → ${opening.victim} (${opening.weapon || ''})${tag ? ' ' + tag : ''}"`;
    }

    // User stats du round
    const uK = userKillsInRound.length;
    const uD = userDeathsInRound.length;
    const userDied = userDeathsInRound[0];
    let diedStr = '';
    if (userDied) {
      diedStr = ` died_to="${userDied.attacker} (${userDied.weapon || ''}${userDied.isHeadshot ? ', HS' : ''})"`;
    }

    summaries.push(
      `  <round n="${num}" outcome="${outcome}" econ="${econ}" event="${eventReason}"${bombInfo ? ` bomb="${bombInfo}"` : ''} user_k="${uK}" user_d="${uD}"${openingStr}${diedStr} />`
    );

    // Check si key round (multi, opening, clutch)
    const keyCheck = isKeyRound(roundKills, userName);
    if (keyCheck && keyRounds.length < keyRoundsDetail) {
      keyRounds.push({ num, kills: roundKills, type: keyCheck.type, detail: keyCheck.detail });
    }
  }

  // Build XML
  let xml = `<rounds n="${rounds.length}" user="${userName}" team="${userTeam}">\n`;
  xml += summaries.join('\n');
  xml += `\n</rounds>`;

  // Key rounds en detail (full kill list with positions)
  if (keyRounds.length > 0) {
    xml += '\n<key_rounds>\n';
    for (const kr of keyRounds) {
      xml += `  <round n="${kr.num}" type="${kr.type}">\n`;
      for (const k of kr.kills.slice(0, 8)) {  // cap 8 kills per round
        const isUser = k.attacker === userName ? ' user_kill="true"' : k.victim === userName ? ' user_death="true"' : '';
        xml += `    <kill tick="${k.tick || 0}" attacker="${k.attacker}" victim="${k.victim}" weapon="${k.weapon || ''}"${k.isHeadshot ? ' hs="true"' : ''}${k.thruSmoke ? ' smoke="true"' : ''}${k.isWallbang ? ' wb="true"' : ''} pos_a="${fmtPos(k.attackerX, k.attackerY)}" pos_v="${fmtPos(k.victimX, k.victimY)}"${isUser} />\n`;
      }
      xml += `  </round>\n`;
    }
    xml += '</key_rounds>';
  }

  return xml;
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
