// api/_lib/drill-library.js · FragValue
// Library de 50 drills CS2 calibres et reels (workshop maps, KovaaK, Yprac, etc.).
// Permet a Claude de selectionner des drills concrets et realistes par axe
// et level, au lieu d'inventer "fais du DM" generique.
//
// Pour le rubric Coach IA, axe 3 (Actionnabilite drills) :
// chaque drill a une duree, un workshop reel, des metriques de validation chiffrees.
//
// Axes : aim | crosshair | spray | utility | positioning | gamesense
//        economy | mental | movement | comms | reaction
// Level FACEIT : 1-10

const DRILLS = [
  // === AIM (10) ===
  {
    id: 'aim_botz_crosshair_placement',
    name: 'Aim_botz · Crosshair Placement',
    axes: ['aim', 'crosshair'],
    levelMin: 1, levelMax: 10,
    durationMin: 15,
    workshop: 'aim_botz',
    instructions: 'USP-S puis AK · crosshair hauteur tete constante · pas de double-tap inutile',
    metric: 'lvl 1-4: 50 kills/min · lvl 5-7: 65 kills/min · lvl 8-10: 80 kills/min sur 5 runs',
  },
  {
    id: 'fastaim_reflex_hard',
    name: 'FastAim Reflex Training (Hard)',
    axes: ['aim', 'reaction'],
    levelMin: 4, levelMax: 10,
    durationMin: 10,
    workshop: 'FastAim/Reflex Training',
    instructions: '5 sessions x 2min · niveau Hard · focus flick precision distance moyenne/longue',
    metric: 'Score > 4500 sur 3 sessions Hard',
  },
  {
    id: 'training_aim_csgo2',
    name: 'training_aim_csgo2 · Long range',
    axes: ['aim'],
    levelMin: 5, levelMax: 10,
    durationMin: 15,
    workshop: 'training_aim_csgo2',
    instructions: 'Long range mode · AK + AWP · enchainement de 50 cibles · pas de spray',
    metric: '90%+ accuracy single shot AK sur 50 cibles',
  },
  {
    id: 'kovaak_1w6t_strafing',
    name: 'KovaaK · 1w6t Strafing',
    axes: ['aim', 'movement'],
    levelMin: 6, levelMax: 10,
    durationMin: 10,
    workshop: 'KovaaK FPS Aim Trainer (Steam)',
    instructions: 'Routine 1w6t Strafing · 5 runs de 60s · focus tracking + counter-strafe',
    metric: 'lvl 6-7: score > 700 · lvl 8-9: > 850 · lvl 10: > 1000',
  },
  {
    id: 'aimtrain_csgohub',
    name: 'csgohub.com Aim Trainer',
    axes: ['aim', 'reaction'],
    levelMin: 3, levelMax: 10,
    durationMin: 15,
    workshop: 'csgohub Aim Course',
    instructions: 'Niveau Hard · 3 enemies bots · enchaine 10 rounds · focus headshot',
    metric: 'lvl 3-5: 40% HS · lvl 6-8: 55% HS · lvl 9-10: 65% HS sur 10 rounds',
  },
  {
    id: 'deathmatch_ffa_warmup',
    name: 'Deathmatch FFA · Echauffement',
    axes: ['aim'],
    levelMin: 1, levelMax: 10,
    durationMin: 10,
    workshop: 'In-game DM FFA (Valve servers)',
    instructions: '10 min FFA · focus prefire et duels rapides · stats apres : >25 kills',
    metric: '>25 kills par session 10min',
  },
  {
    id: 'aim_redline_pistol',
    name: 'Aim_redline Pistol',
    axes: ['aim', 'crosshair'],
    levelMin: 1, levelMax: 8,
    durationMin: 10,
    workshop: 'aim_redline',
    instructions: 'USP-S + Glock + Deagle · 50 cibles bots · focus 1-tap pistol',
    metric: '60%+ HS sur USP-S et Deagle',
  },
  {
    id: 'recoil_master_ak_m4',
    name: 'Recoil Master · AK + M4',
    axes: ['spray', 'aim'],
    levelMin: 1, levelMax: 8,
    durationMin: 12,
    workshop: 'Recoil Master',
    instructions: 'AK 30 balles spray full + burst · M4A4 + M4A1-S · niveau 4 et 5',
    metric: 'Pattern AK 30 balles dans cible 4m, M4 idem',
  },
  {
    id: 'aim_botz_speedlock',
    name: 'Aim_botz · Speedlock',
    axes: ['aim', 'reaction'],
    levelMin: 5, levelMax: 10,
    durationMin: 10,
    workshop: 'aim_botz (mode speedlock)',
    instructions: 'Mode speedlock · 200 cibles · focus flick instant + recentrage',
    metric: '<8 secondes par 10 cibles speedlock',
  },
  {
    id: 'awp_practice_crusha',
    name: 'AWP Practice (Crusha)',
    axes: ['aim', 'crosshair'],
    levelMin: 4, levelMax: 10,
    durationMin: 15,
    workshop: 'AWP Practice (Crusha) workshop CS2',
    instructions: 'Practice quickscope + noscope · 5 zones map · focus flick AWP + recentrage scope',
    metric: 'lvl 4-6: 50% accuracy quickscope · lvl 7-8: 60% · lvl 9-10: 70% sur 50 shots',
  },

  // === SPRAY / RECOIL (5) ===
  {
    id: 'spray_workshop_full_arsenal',
    name: 'Spray Workshop · Full Arsenal',
    axes: ['spray'],
    levelMin: 2, levelMax: 8,
    durationMin: 15,
    workshop: 'training_aim_csgo2',
    instructions: 'AK + M4 + Galil + Famas · spray full 30 balles · cible 3m',
    metric: '20+ balles dans cible head-chest sur 30',
  },
  {
    id: 'burst_control_mid_range',
    name: 'Burst Control · Mid Range',
    axes: ['spray', 'aim'],
    levelMin: 3, levelMax: 9,
    durationMin: 10,
    workshop: 'aim_botz',
    instructions: 'Distance moyenne · burst de 4-5 balles · counter-strafe avant chaque burst',
    metric: '70%+ accuracy bursts sur 50 duels',
  },
  {
    id: 'recoil_master_advanced',
    name: 'Recoil Master · Advanced',
    axes: ['spray'],
    levelMin: 5, levelMax: 10,
    durationMin: 12,
    workshop: 'Recoil Master',
    instructions: 'Niveau 7-9 · AK + M4 + Negev (challenge) · pattern long',
    metric: 'Score > 80 sur niveau 8 AK',
  },
  {
    id: 'spray_transfer_botz',
    name: 'Spray Transfer · Botz',
    axes: ['spray', 'aim'],
    levelMin: 4, levelMax: 10,
    durationMin: 10,
    workshop: 'aim_botz',
    instructions: '2-3 bots alignes · spray transfer entre cibles · pas de recentrage',
    metric: '3 bots elimines sur 1 spray AK 30 balles',
  },
  {
    id: 'pistol_one_taps',
    name: 'Pistol One-Taps',
    axes: ['aim', 'crosshair'],
    levelMin: 1, levelMax: 8,
    durationMin: 10,
    workshop: 'aim_botz',
    instructions: 'USP-S + Glock + P250 + Deagle · 1-tap head uniquement · pas de body',
    metric: '50%+ HS pistol sur 100 shots',
  },

  // === UTILITY / NADES (8) ===
  {
    id: 'lineups_mirage_essentials',
    name: 'Lineups Mirage · Essentials',
    axes: ['utility'],
    levelMin: 3, levelMax: 10,
    durationMin: 20,
    workshop: 'Yprac Mirage',
    instructions: 'CT: Smoke Connector, Smoke Stairs, Molo Window, Flash Sandwich · T: Smoke CT, Molo Connector, Flash Mid',
    metric: 'Reproduire chaque lineup sans miss x3 fois',
  },
  {
    id: 'lineups_inferno_essentials',
    name: 'Lineups Inferno · Essentials',
    axes: ['utility'],
    levelMin: 3, levelMax: 10,
    durationMin: 20,
    workshop: 'Yprac Inferno',
    instructions: 'T: Molo Banana CT, Smoke CT/Coffin, Flash Pop · CT: Smoke Apps, Molo 2nd Mid, HE Pit',
    metric: 'Reproduire chaque lineup sans miss x3 fois',
  },
  {
    id: 'lineups_dust2_essentials',
    name: 'Lineups Dust2 · Essentials',
    axes: ['utility'],
    levelMin: 3, levelMax: 10,
    durationMin: 18,
    workshop: 'Yprac Dust2 (workshop)',
    instructions: 'T: Smoke Xbox + CT, Molo Lower Tunnels, Flash Long · CT: Smoke Long Cross, HE Catwalk',
    metric: 'Reproduire chaque lineup sans miss x3 fois',
  },
  {
    id: 'lineups_train_essentials',
    name: 'Lineups Train · Essentials',
    axes: ['utility'],
    levelMin: 3, levelMax: 10,
    durationMin: 18,
    workshop: 'Yprac Train (workshop)',
    instructions: 'T: Smoke Z, Smoke Ivy, Molo Popdog, Flash Ladder · CT: Smoke Connector, Molo B halls',
    metric: 'Reproduire chaque lineup sans miss x3 fois',
  },
  {
    id: 'lineups_ancient_essentials',
    name: 'Lineups Ancient · Essentials',
    axes: ['utility'],
    levelMin: 4, levelMax: 10,
    durationMin: 18,
    workshop: 'Yprac Ancient (workshop)',
    instructions: 'T: Smoke Donut, Molo Top Mid, Flash Ramp · CT: Smoke A Main, Molo B Main',
    metric: 'Reproduire chaque lineup sans miss x3 fois',
  },
  {
    id: 'flash_pop_reaction',
    name: 'Flash Pop · Reaction Drill',
    axes: ['utility', 'reaction'],
    levelMin: 4, levelMax: 10,
    durationMin: 10,
    workshop: 'aim_botz',
    instructions: 'Bot pop-flash + duel · enchainer 50 fois · focus turn-and-shoot apres flash',
    metric: '60%+ kills apres pop-flash sur 50 duels',
  },
  {
    id: 'molotov_burn_zones',
    name: 'Molotov · Burn Zones',
    axes: ['utility'],
    levelMin: 4, levelMax: 9,
    durationMin: 12,
    workshop: 'Yprac (toutes maps)',
    instructions: 'Pratiquer molos cles : Banana CT, Connector Mid Mirage, Pit Inferno, Tunnels Dust2',
    metric: '4 molos consecutifs reussis sur chaque map',
  },
  {
    id: 'smoke_executes_practice',
    name: 'Smoke Executes · A Site',
    axes: ['utility', 'gamesense'],
    levelMin: 5, levelMax: 10,
    durationMin: 15,
    workshop: 'Yprac (toutes maps Active Duty)',
    instructions: 'Execute A site 5v0 avec smokes optimaux · timer < 15s pour entrer',
    metric: '5 executes sub-15s par map (Mirage, Inferno, Dust2)',
  },
  {
    id: 'utility_drop_practice',
    name: 'Utility Drop · Throw Speed',
    axes: ['utility', 'reaction'],
    levelMin: 4, levelMax: 10,
    durationMin: 8,
    workshop: 'aim_botz',
    instructions: 'Drop nade + reposition + duel · focus economy de mvt apres throw',
    metric: 'Throw + duel < 1.2s sur 30 reps',
  },
  {
    id: 'flash_assist_drill',
    name: 'Flash Assists · Team Drill',
    axes: ['utility', 'comms'],
    levelMin: 5, levelMax: 10,
    durationMin: 15,
    workshop: 'Custom server avec teammate',
    instructions: 'Pop-flash pour entry teammate · focus timing turn-and-peek',
    metric: '70%+ flash effectiveness sur 20 entries',
  },

  // === POSITIONING / GAMESENSE (10) ===
  {
    id: 'prefire_routine_mirage_t',
    name: 'Prefire Routine · Mirage T-side',
    axes: ['positioning', 'aim'],
    levelMin: 4, levelMax: 10,
    durationMin: 15,
    workshop: 'Yprac Mirage (workshop · mode Practice/Prefire)',
    instructions: 'T-side Mirage · prefire angles palace, ramp, connector, top mid · 3 runs',
    metric: 'lvl 4-6: sub-4min run · lvl 7-8: sub-3min · lvl 9-10: sub-2.5min sans mort',
  },
  {
    id: 'prefire_routine_inferno_ct',
    name: 'Prefire Routine · Inferno CT',
    axes: ['positioning', 'aim'],
    levelMin: 4, levelMax: 10,
    durationMin: 15,
    workshop: 'Yprac Inferno (workshop · mode Practice/Prefire)',
    instructions: 'CT-side Inferno · prefire angles banana, mid, apps, pit, library, balcony · 3 runs',
    metric: 'lvl 4-6: sub-4min run · lvl 7-8: sub-3min · lvl 9-10: sub-2.5min sans mort',
  },
  {
    id: 'crosshair_placement_walk',
    name: 'Crosshair Placement Walk',
    axes: ['crosshair', 'positioning'],
    levelMin: 1, levelMax: 8,
    durationMin: 10,
    workshop: 'cs_walk through Mirage',
    instructions: 'Marche A Long, mid, B halls · crosshair toujours hauteur tete + pre-aim coins',
    metric: 'Aucune position sans crosshair head-level sur 10min',
  },
  {
    id: 'angle_holding_static',
    name: 'Angle Holding · Static Hold',
    axes: ['positioning', 'aim'],
    levelMin: 3, levelMax: 9,
    durationMin: 10,
    workshop: 'aim_botz',
    instructions: 'Hold angle ferme · ne bouge pas · bot peek · 1-tap immediate',
    metric: '90%+ kills sur 50 peeks adverses',
  },
  {
    id: 'rotation_timing_solo',
    name: 'Rotation Timing · Solo Map',
    axes: ['gamesense', 'positioning'],
    levelMin: 4, levelMax: 9,
    durationMin: 10,
    workshop: 'Custom server (toutes maps)',
    instructions: 'Chronometre rotations A → B sur Mirage, Inferno, Dust2 · note les chemins courts',
    metric: 'Memoriser rotation sub-10s sur 5 maps',
  },
  {
    id: 'jiggle_peek_practice',
    name: 'Jiggle / Shoulder Peek',
    axes: ['positioning', 'gamesense'],
    levelMin: 5, levelMax: 10,
    durationMin: 10,
    workshop: 'Custom server avec bot',
    instructions: 'Jiggle peek pour info sans die · shoulder peek vs AWP · 30 reps',
    metric: '<10% deaths sur 30 jiggles vs bot',
  },
  {
    id: 'wide_swing_vs_jiggle',
    name: 'Wide Swing vs Jiggle Choice',
    axes: ['positioning', 'gamesense'],
    levelMin: 5, levelMax: 10,
    durationMin: 8,
    workshop: 'aim_botz',
    instructions: 'Bot avec angle ferme · choisir wide swing ou jiggle selon arme/distance',
    metric: '70%+ wins sur 30 duels avec bonne decision',
  },
  {
    id: 'eco_anti_eco_decisions',
    name: 'Eco / Anti-Eco · Decisions',
    axes: ['economy', 'gamesense'],
    levelMin: 4, levelMax: 10,
    durationMin: 12,
    workshop: 'Pratique en match retake/eco',
    instructions: 'Force-buy P250 + armor + grenade · stack vs anti-eco · 20 rounds',
    metric: '50%+ pistol/eco wins sur 20 rounds',
  },
  {
    id: 'map_control_t_default',
    name: 'Map Control · T Default Setup',
    axes: ['gamesense', 'comms'],
    levelMin: 6, levelMax: 10,
    durationMin: 15,
    workshop: 'Custom server avec team 5v5 vs bots',
    instructions: 'T-side default avec presence dans 3 zones · timer 30s avant decision execute',
    metric: 'Default reussi (info ou kill) sur 70% des rounds',
  },
  {
    id: 'retake_practice',
    name: 'Retake Practice · 4v3 / 3v3',
    axes: ['gamesense', 'utility'],
    levelMin: 5, levelMax: 10,
    durationMin: 20,
    workshop: 'Refrag Retakes ou Ulletical Retakes (community CS2)',
    instructions: '20 retakes Mirage + Inferno · focus util coordination + entry trade · debrief decisions',
    metric: 'lvl 5-7: 40% retake wins · lvl 8-10: 55% sur 20 retakes',
  },

  // === ECONOMY / MENTAL (5) ===
  {
    id: 'force_buy_decision_tree',
    name: 'Force-Buy · Decision Tree',
    axes: ['economy', 'gamesense'],
    levelMin: 4, levelMax: 10,
    durationMin: 5,
    workshop: 'Theorique - apprendre decision tree',
    instructions: 'Apprendre : 1400/1900/2400/2900/3400 bonus · 5v5 force vs 5v5 eco · table de decision',
    metric: 'Reciter toutes les econs sur 1 round perdu',
  },
  {
    id: 'pistol_round_routines',
    name: 'Pistol Round · 4 Routines',
    axes: ['economy', 'aim'],
    levelMin: 3, levelMax: 10,
    durationMin: 15,
    workshop: 'Custom server avec team',
    instructions: '4 setups pistol differents (rush/stack/split/anti-rush) · pratique en CT et T',
    metric: '60%+ pistol wins sur 20 rounds',
  },
  {
    id: 'tilt_breathing_routine',
    name: 'Tilt · Breathing Routine',
    axes: ['mental'],
    levelMin: 1, levelMax: 10,
    durationMin: 5,
    workshop: 'Hors-jeu (mental check)',
    instructions: 'Apres death : 4-7-8 breathing (4s in, 7s hold, 8s out) · 3 cycles avant rebuy',
    metric: 'Faire la routine sur 100% des morts pendant 10 matchs',
  },
  {
    id: 'review_demo_solo',
    name: 'Review Demo · Solo Session',
    axes: ['gamesense', 'mental'],
    levelMin: 5, levelMax: 10,
    durationMin: 30,
    workshop: 'CS2 Demo Viewer (in-game) ou FragValue 2D Replay',
    instructions: 'Review tes 3 derniers matchs · note 3 erreurs principales par match · plan de correction',
    metric: 'Liste de 9 corrections concretes apres review',
  },
  {
    id: 'sleep_warmup_routine',
    name: 'Routine Pre-Match',
    axes: ['mental'],
    levelMin: 1, levelMax: 10,
    durationMin: 30,
    workshop: 'Routine personnelle',
    instructions: '15min DM + 10min aim_botz + 5min util drill · setup eclairage / hydratation',
    metric: 'Routine identique sur 10 matchs consecutifs',
  },

  // === MOVEMENT (4) ===
  {
    id: 'counter_strafe_drill',
    name: 'Counter-Strafing · Foundation',
    axes: ['movement', 'aim'],
    levelMin: 1, levelMax: 8,
    durationMin: 10,
    workshop: 'training_aim_csgo2',
    instructions: 'Move + counter-strafe (A puis D simultane) + shoot · 100 reps',
    metric: 'Standing accuracy parfaite sur 100 counter-strafes',
  },
  {
    id: 'kz_movement_basics',
    name: 'KZ Movement · Basics',
    axes: ['movement'],
    levelMin: 3, levelMax: 10,
    durationMin: 20,
    workshop: 'KZ Climb community server (kz_summer / kz_lego2 / kz_kzhub)',
    instructions: 'Apprendre bhop + air strafing + crouch jump · 3 maps Easy · timer perso',
    metric: 'lvl 3-5: complete kz_summer · lvl 6-8: sub-3min kz_lego2 · lvl 9-10: complete kz_kzhub',
  },
  {
    id: 'jump_throw_practice',
    name: 'Jump-Throw · Bind + Lineups',
    axes: ['movement', 'utility'],
    levelMin: 3, levelMax: 9,
    durationMin: 10,
    workshop: 'Custom server',
    instructions: 'Bind jumpthrow + tester sur smokes Mirage T spawn / Dust2 long · 20 reps',
    metric: '95% smoke landing sur 20 reps',
  },
  {
    id: 'silent_movement_walk',
    name: 'Silent Movement · Audio Awareness',
    axes: ['movement', 'gamesense'],
    levelMin: 4, levelMax: 10,
    durationMin: 8,
    workshop: 'Custom server',
    instructions: 'Walk dans Mirage + Inferno · note les zones bruyantes vs silencieuses',
    metric: 'Liste de 5 zones par map ou walk est obligatoire',
  },

  // === COMMS (3) ===
  {
    id: 'callouts_mirage_inferno_dust2',
    name: 'Callouts · Active Duty',
    axes: ['comms'],
    levelMin: 3, levelMax: 10,
    durationMin: 20,
    workshop: 'Yprac (toutes maps)',
    instructions: 'Apprendre 100% des callouts Mirage, Inferno, Dust2, Nuke, Anubis · quiz solo',
    metric: 'Reciter callouts sur capture ecran sans erreur',
  },
  {
    id: 'comms_efficient_match',
    name: 'Comms Efficient · 1 Match',
    axes: ['comms'],
    levelMin: 5, levelMax: 10,
    durationMin: 30,
    workshop: 'Match FACEIT',
    instructions: 'Limit comms a info HP + position + util visible · pas de tilt vocal · 1 match complet',
    metric: 'Match termine sans tilt-comms (auto-eval honnete)',
  },
  {
    id: 'igl_mid_round_calls',
    name: 'IGL · Mid-Round Calls',
    axes: ['comms', 'gamesense'],
    levelMin: 7, levelMax: 10,
    durationMin: 20,
    workshop: 'Match FACEIT (en role IGL)',
    instructions: 'Call mid-round adjustments based on info enemy · note les calls qui marchent',
    metric: '5 calls mid-round qui changent l outcome du round (debrief post-match)',
  },
];

// Selectionne les drills par axes (matching), niveau, et compte
function getDrillsByAxis(axes, level = 5, count = 3) {
  if (!Array.isArray(axes)) axes = [axes];
  const candidates = DRILLS.filter(d =>
    axes.some(a => d.axes.includes(a)) &&
    level >= d.levelMin && level <= d.levelMax
  );
  // Score par nombre d'axes matches (priorite aux drills multi-axes pertinents)
  candidates.sort((a, b) => {
    const sa = a.axes.filter(ax => axes.includes(ax)).length;
    const sb = b.axes.filter(ax => axes.includes(ax)).length;
    return sb - sa;
  });
  return candidates.slice(0, count);
}

function getDrillById(id) {
  return DRILLS.find(d => d.id === id) || null;
}

// Format compact pour injection dans le prompt Claude
function formatDrillsForPrompt(drills) {
  if (!drills || !drills.length) return '';
  return drills.map(d =>
    `- ${d.id} | "${d.name}" | ${d.durationMin}min | axes: ${d.axes.join(', ')} | level ${d.levelMin}-${d.levelMax}\n  Workshop: ${d.workshop}\n  Instructions: ${d.instructions}\n  Metrique: ${d.metric}`
  ).join('\n\n');
}

// Pour le prompt Claude : list compacte des IDs disponibles avec axes
function listAllDrillIds() {
  return DRILLS.map(d => `${d.id} (axes: ${d.axes.join('+')}, lvl ${d.levelMin}-${d.levelMax}, ${d.durationMin}min)`).join('\n');
}

module.exports = {
  DRILLS,
  getDrillsByAxis,
  getDrillById,
  formatDrillsForPrompt,
  listAllDrillIds,
};
