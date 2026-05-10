// api/_lib/role-detection.js · FragValue
// Detection automatique du role CS2 a partir des stats FACEIT/FragValue.
// Roles : entry / awp / awp_support / igl / support / second_entry / lurker / anchor / rifler
//
// Pour le rubric Coach IA, axe 4 (Personnalisation role/level) :
// permet d'adapter le diag et les drills au role réel du joueur,
// pas de tout-en-un generique.
//
// Heuristiques (pas de weapon stats granulaires dispo cote FACEIT) :
// - entry        : opening WR > 55% ET fk_per_match > 1.0 (high engagement)
// - awp          : K/D haut + ADR moyen (proxy : impact precis sans volume rifle)
// - awp_support  : K/D haut, opening ratio < 0.50 (secondary AWPer)
// - igl          : KAST haut + ADR bas + KR bas (high impact via comms)
// - support      : KAST haut + opening ratio bas (entry trade, backup)
// - second_entry : opening 0.45-0.55 + ADR haut (trade fragger juste apres entry)
// - lurker       : opening ratio bas + K/D haut (impact late-round)
// - anchor       : KAST haut + first_deaths bas (defensive hold)
// - rifler       : default si signal pas clair

function detectRole(stats) {
  const fk = stats.firstKills ?? stats.fk ?? 0;
  const fd = stats.firstDeaths ?? stats.fd ?? 0;
  const kills = stats.totalKills ?? stats.kills ?? 0;
  const deaths = stats.totalDeaths ?? stats.deaths ?? 0;
  const matches = stats.matchesAnalyzed ?? stats.matches ?? 1;
  const kast = parseFloat(stats.avgKast ?? stats.kast) || 0;
  const adr = parseFloat(stats.avgAdr ?? stats.adr) || 0;
  const kd = parseFloat(stats.avgKd ?? stats.kd) || 0;
  const kr = parseFloat(stats.avgKr ?? stats.kpr ?? stats.kr) || 0;

  const fkPerMatch = matches > 0 ? fk / matches : 0;
  const fdPerMatch = matches > 0 ? fd / matches : 0;
  const openingRatio = (fk + fd) > 0 ? fk / (fk + fd) : 0.5;

  const signals = {
    entry: 0,
    awp: 0,
    awp_support: 0,
    igl: 0,
    support: 0,
    second_entry: 0,
    lurker: 0,
    anchor: 0,
  };

  // Entry : prend l'opening + ADR haut + volume kills
  if (openingRatio > 0.55 && fkPerMatch > 1.0) signals.entry += 3;
  if (adr > 85 && fkPerMatch > 1.2) signals.entry += 2;
  if (openingRatio > 0.60) signals.entry += 1;

  // AWP : K/D haut, ADR moyen (proxy : kills precis sans volume rifle)
  if (kd > 1.15 && adr < 90 && adr > 65) signals.awp += 2;
  if (kd > 1.20 && openingRatio > 0.50) signals.awp += 1;

  // AWP support : K/D haut, opening ratio < 0.50 (secondary AWPer)
  if (kd > 1.10 && openingRatio < 0.50 && adr < 85) signals.awp_support += 2;
  if (kast > 70 && kd > 1.10 && fkPerMatch < 1.0) signals.awp_support += 1;

  // IGL : KAST haut, ADR bas, KR bas (impact via comms)
  if (kast > 72 && adr < 78 && kr < 0.75) signals.igl += 3;
  if (kast > 70 && fkPerMatch < 0.8) signals.igl += 1;

  // Support : KAST haut, opening ratio bas, ADR moyen
  if (kast > 70 && openingRatio < 0.45) signals.support += 2;
  if (adr < 80 && kast > 70 && kd < 1.10) signals.support += 1;

  // Second entry : opening 0.45-0.55 + ADR haut (trade fragger)
  if (openingRatio >= 0.45 && openingRatio <= 0.55 && adr > 80) signals.second_entry += 2;
  if (fdPerMatch < 1.0 && fkPerMatch > 0.8 && adr > 78) signals.second_entry += 1;

  // Lurker : opening ratio bas + K/D haut (impact late-round)
  if (openingRatio < 0.40 && kd > 1.05) signals.lurker += 3;
  if (openingRatio < 0.42 && kd > 1.10 && kast > 68) signals.lurker += 1;

  // Anchor : KAST haut, opening ratio < 0.45, fdPerMatch faible
  // (defensive hold sans crame d'opening)
  if (kast > 70 && openingRatio < 0.45 && fdPerMatch < 0.8) signals.anchor += 3;
  if (kast > 72 && fdPerMatch < 0.7 && kd >= 1.0) signals.anchor += 1;

  // Tri par signal
  const sorted = Object.entries(signals).sort(([, a], [, b]) => b - a);
  const [topRole, topScore] = sorted[0];
  const [, secondScore] = sorted[1];

  // Confidence : (top - second) / (top + 1) → plus c'est ecart, plus c'est sur
  const confidence = topScore > 0 ? Math.min(1, (topScore - secondScore) / (topScore + 1)) : 0;

  // Si pas de signal clair (topScore < 2), on classe rifler par defaut
  const role = topScore >= 2 ? topRole : 'rifler';

  return {
    role,
    confidence: +confidence.toFixed(2),
    signals,
    metrics: {
      fkPerMatch: +fkPerMatch.toFixed(2),
      fdPerMatch: +fdPerMatch.toFixed(2),
      openingRatio: +openingRatio.toFixed(2),
      kd, kast, adr, kr,
    },
  };
}

// Drills + focus axes recommandes par role (avec pros pour proRefs)
const ROLE_FOCUS = {
  entry: {
    description: 'Entry fragger - prend l\'opening, ouvre la bombsite avec util support',
    primaryAxes: ['aim', 'positioning', 'reaction'],
    keyMetrics: ['opening_wr', 'first_kills', 'adr', 'fk_per_match'],
    proExamples: ['donk (Spirit)', 'NiKo (G2)', 'apEX (Vitality)', 'jL (NaVi)'],
  },
  awp: {
    description: 'AWPer (main) - kills precis, hold angles, info, opening avec AWP',
    primaryAxes: ['crosshair', 'positioning', 'gamesense'],
    keyMetrics: ['opening_wr', 'kd', 'multi_kills'],
    proExamples: ['ZywOo (Vitality)', 'm0NESY (G2)', 'sh1ro (Cloud9)'],
  },
  awp_support: {
    description: 'Second AWP / AWP support - hold off-angles, swap arme apres opening miss',
    primaryAxes: ['crosshair', 'positioning', 'gamesense'],
    keyMetrics: ['kast', 'kd', 'multi_kills'],
    proExamples: ['Jame (Virtus.pro)', 'sh1ro (Cloud9)', 'donk hybride (Spirit)'],
  },
  igl: {
    description: 'In-Game Leader - call les rounds, gere l\'eco, mid-round adjust',
    primaryAxes: ['gamesense', 'comms', 'economy'],
    keyMetrics: ['kast', 'win_rate', 't_side_wr'],
    proExamples: ['karrigan (FaZe)', 'Aleksib (NaVi)', 'cadiaN (Heroic)'],
  },
  support: {
    description: 'Support - flash entry trade, util usage, KAST, drop AWP',
    primaryAxes: ['utility', 'positioning', 'comms'],
    keyMetrics: ['kast', 'flash_assists', 'util_damage'],
    proExamples: ['ropz (FaZe)', 'broky (FaZe)', 'HObbit (Cloud9)'],
  },
  second_entry: {
    description: 'Second entry / trade fragger - rentre juste apres l\'entry pour trade kill',
    primaryAxes: ['aim', 'positioning', 'reaction'],
    keyMetrics: ['adr', 'kast', 'trade_kills'],
    proExamples: ['NiKo (G2)', 'b1t (NaVi)', 'frozen (MOUZ)'],
  },
  lurker: {
    description: 'Lurker - decale, info opp rotation, late-round impact, post-plant',
    primaryAxes: ['gamesense', 'positioning', 'aim'],
    keyMetrics: ['kd', 'multi_kills', 'clutches'],
    proExamples: ['s1mple (style)', 'magixx', 'KSCERATO', 'Twistzz'],
  },
  anchor: {
    description: 'Anchor (B-anchor / A-anchor) - hold defensif site CT, delay execute',
    primaryAxes: ['positioning', 'gamesense', 'utility'],
    keyMetrics: ['kast', 'first_deaths_low', 'multi_kills'],
    proExamples: ['ropz (FaZe)', 'sh1ro (Cloud9)', 'frozen (MOUZ)'],
  },
  rifler: {
    description: 'Rifler polyvalent - pas de role specialise, adaptable',
    primaryAxes: ['aim', 'gamesense', 'positioning'],
    keyMetrics: ['kd', 'kast', 'adr'],
    proExamples: ['frozen (MOUZ)', 'jL (NaVi)', 'iM (G2)'],
  },
};

function getRoleFocus(role) {
  return ROLE_FOCUS[role] || ROLE_FOCUS.rifler;
}

module.exports = { detectRole, getRoleFocus, ROLE_FOCUS };
