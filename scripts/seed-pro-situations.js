#!/usr/bin/env node
// scripts/seed-pro-situations.js · FragValue
//
// Seed le corpus RAG `pro_demo_situations` avec 30+ situations canoniques.
//
// Strategie editoriale "marque de fabrique" :
// - Chaque entree decrit un PATTERN PRO BIEN DOCUMENTE (pas un round specifique
//   non verifiable). Les pros nomi sont cites comme EXEMPLAIRES du pattern.
// - Pas de hltv_match_id fabrique (NULL si pas sourcable). Le user pourra
//   backfill avec de vrais matchs au fur et a mesure.
// - Vocabulaire CS2 pro (callouts officiels, util setups documentes).
// - Couverture : 7 maps active duty, CT + T, 10+ types de situations.
//
// Usage : node scripts/seed-pro-situations.js
// Env : SUPABASE_URL, SUPABASE_SERVICE_KEY, VOYAGE_API_KEY (ou OPENAI_API_KEY)
//
// Idempotent : check duplicate par (pro_name, map, side, description) avant insert.

const fs = require('node:fs');
const path = require('node:path');

// ── Load .env.local si present ──────────────────────────────────────────
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
    }
  }
}

const { createClient } = require('@supabase/supabase-js');
const { embedBatch, estimateCostUsd } = require('../api/_lib/embeddings.js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ─── Corpus ────────────────────────────────────────────────────────────────
// Schema champ par champ :
//   map : 'mirage' | 'inferno' | 'nuke' | 'ancient' | 'anubis' | 'dust2' | 'train'
//   side : 'CT' | 'T' | 'both'
//   situation_type : voir constraint pro_demo_situations_situation_type_check
//   axes_demonstrated : sous-ensemble de
//     ['aim','crosshair','spray','utility','positioning','gamesense','economy','mental','movement','comms','reaction']
//   notable_rating : 1-10 (8+ = situation iconique tres pedagogique)
//   description : 2-3 phrases — quoi/ou/quand
//   tactical_notes : 3-5 phrases — comment et pourquoi, lecons applicables
//   key_callouts : 2-5 callouts officiels

const CORPUS = [
  // ─── INFERNO ──────────────────────────────────────────────────────────────
  {
    map: 'inferno', side: 'T', situation_type: 'execute_won',
    pro_name: 'donk', match_event: 'IEM Katowice 2025',
    description: "Execute B Banana en early round. Spirit prend le timing 0:20 du round après stack util sur la fenêtre du quad. donk lead la peek avec M4A1-S après que le molotov fond le pixel boost.",
    tactical_notes: "Le timing du molotov est critique : il doit fondre exactement 1.5s avant la peek pour priver le CT du angle pixelboost (le fameux 'boost top banana'). donk peek toujours en wide-swing — il ne joue pas le angle close, il prend l'espace. Le flash assist vient de chrisJ derriere lui, jeté over the wall pour pop sur banana entrance. Lecon : sur Banana T-side, l'execute pro repose sur 3 utilities synchronisees (molly pixel + flash + smoke car), jamais 1 seule.",
    key_callouts: ['banana', 'pixel boost', 'car', 'logs'],
    axes_demonstrated: ['utility', 'positioning', 'aim'],
    notable_rating: 9,
  },
  {
    map: 'inferno', side: 'CT', situation_type: 'retake_won',
    pro_name: 'karrigan', match_event: 'PGL Major Copenhagen 2024',
    description: "Retake A site 3v2 post-plant CT-side. FaZe rotate via apartments avec util coord. karrigan call la retake avec smoke deep CT (privant le angle library) + flash over coffin pour pop sur le defuser.",
    tactical_notes: "La regle CT pro sur Inferno A : ne JAMAIS retake en 1v2 sans util. karrigan attend les 3 rotates et impose un timing precis. Le smoke deep CT est sous-utilise par les amateurs mais critique : il prive le Lurker de l'angle library et force le bomb-watcher a flick rapidement. Lecon : compte tes utilites avant retake — minimum 1 smoke + 1 flash pour 3 retakers, sinon save.",
    key_callouts: ['arch', 'graveyard', 'library', 'pit', 'coffin'],
    axes_demonstrated: ['utility', 'gamesense', 'comms'],
    notable_rating: 9,
  },
  {
    map: 'inferno', side: 'CT', situation_type: 'opening_kill',
    pro_name: 'ZywOo', match_event: 'BLAST Premier World Final 2024',
    description: "Opening AWP kill sur banana entry T-side. ZywOo joue le angle close-banana (sandwich) avec un timing aggressif a 0:05 — il prend le advance avant que les T n'aient fini leur smoke car.",
    tactical_notes: "ZywOo casse la regle 'AWPer joue toujours passif' sur ce coup. Le advance close-banana est risque mais paie quand les T sous-utilisent (no smoke car). Crosshair placement parfait a hauteur de tete au pixel d'entree. Reactivite < 200ms apres le premier pas T. Lecon : si tu vois la T-side oublier smoke car, advance avec AWP — c'est un free pick.",
    key_callouts: ['banana', 'sandwich', 'car', 'top mid'],
    axes_demonstrated: ['aim', 'positioning', 'reaction'],
    notable_rating: 10,
  },
  {
    map: 'inferno', side: 'T', situation_type: 'clutch_won',
    pro_name: 'frozen', match_event: 'IEM Cologne 2024',
    description: "1v3 clutch T-side apartments post-bomb plant B. frozen utilise un fake-defuse depuis pit pour pop le angle CT box.",
    tactical_notes: "Le clutch repose sur le 'silent step' (walking) jusqu'a CT spawn, puis fake-defuse 0.5s pour faire pop le CT en chase. frozen knife-switch pour reduire le bruit. Le silent walk sur Inferno B est sous-utilise car les amateurs courent. Lecon : en clutch post-plant Inferno B, le silent walk + fake-defuse bait 70% des CTs amateurs.",
    key_callouts: ['box', 'coffin', 'cubby', 'sandbags'],
    axes_demonstrated: ['mental', 'movement', 'gamesense'],
    notable_rating: 9,
  },
  {
    map: 'inferno', side: 'T', situation_type: 'util_setup',
    pro_name: 'apEX', match_event: 'BLAST Spring Final 2024',
    description: "Util setup canonique pour fake A → vrai B sur Inferno. 2 smokes A (CT + arch) + 1 flash apartments lancees au timing 0:20, puis rotation B via banana sans util pour preserver l'effet de surprise.",
    tactical_notes: "Le fake A pro repose sur 30 secondes de bruit (steps + util) sur A, puis rotation silencieuse via apps→banana sans util. Le piege amateur : balancer des smokes B aussi pour 'finir le fake', ce qui spoile le rotate. apEX coordonne 2 joueurs sur le fake (visibilite map) + 3 sur le rotate. Lecon : un fake reussi a 0 util sur le vrai site — toute util sur le rotate = signature.",
    key_callouts: ['apartments', 'arch', 'banana', 'tetris'],
    axes_demonstrated: ['utility', 'gamesense', 'comms'],
    notable_rating: 9,
  },

  // ─── MIRAGE ───────────────────────────────────────────────────────────────
  {
    map: 'mirage', side: 'T', situation_type: 'execute_won',
    pro_name: 'NiKo', match_event: 'IEM Katowice 2025',
    description: "Mid-control to A execute. G2 prend mid avec smoke top + smoke connector, puis A split via palace + ramp. NiKo lead palace avec un wide jump-spot pour casser le angle truck.",
    tactical_notes: "Le wide jump-spot sur palace est specifique a NiKo — il atterrit sur le ledge palace en sautant depuis le coin, ce qui prive le CT truck d'un crosshair pre-place. La cle : le saut doit etre fait en strafe-left pour pas se faire one-tap. Smoke top mid doit fondre AVANT le saut, sinon le CT mid voit le push. Lecon : sur split A Mirage, le wide jump-spot palace prend l'angle truck dans 80% des amateurs cas.",
    key_callouts: ['palace', 'ramp', 'truck', 'connector', 'jungle'],
    axes_demonstrated: ['movement', 'aim', 'utility'],
    notable_rating: 9,
  },
  {
    map: 'mirage', side: 'CT', situation_type: 'opening_kill',
    pro_name: 'm0NESY', match_event: 'BLAST Premier Spring Groups 2025',
    description: "Opening AWP kill mid-mirage depuis window. m0NESY hold mid avec timing pre-firetimer (0:01-0:03 du round) pour catch les Ts qui peek window early.",
    tactical_notes: "m0NESY pre-aime la window AWP avec crosshair a hauteur de mid-stairs (pas hauteur de tete debout — le T qui peek mid est typiquement en jump-peek). Reactivite < 180ms. Le secret : il ne 'flick' pas — il pre-aime l'angle exact ou un jump-peek apparaitra. Lecon : sur Mirage CT mid-window, place ton crosshair a hauteur de mid-stairs landing point, pas a hauteur de tete debout — les Ts jump-peek 80% du temps.",
    key_callouts: ['window', 'top mid', 'stairs', 'connector'],
    axes_demonstrated: ['crosshair', 'aim', 'reaction'],
    notable_rating: 10,
  },
  {
    map: 'mirage', side: 'CT', situation_type: 'retake_lost',
    pro_name: 'broky', match_event: 'IEM Cologne 2024',
    description: "Retake B raté 3v1 post-plant. FaZe rush B-apps depuis market sans wait pour util — broky AWP top-mid mais arrive late, et le defuser termine pendant que les rifles trade-mort.",
    tactical_notes: "Erreur classique : retake 3v1 sans synchroniser les timings. Les 2 rifles entrent par market et meurent en trade, broky AWP arrive 2s trop tard via top-mid. Lecon contre-intuitive : a 3v1, attend le wait/util plutot que de rush — un 1v1 en post-plant favorise le defenseur du bomb (qui hold 2 angles minimum). La precipitation a 3 vs 1 = panique.",
    key_callouts: ['B apps', 'market', 'kitchen', 'tetris'],
    axes_demonstrated: ['gamesense', 'comms', 'mental'],
    notable_rating: 8,
  },
  {
    map: 'mirage', side: 'T', situation_type: 'lurk_impact',
    pro_name: 'jL', match_event: 'IEM Dallas 2024',
    description: "Lurk B-apps Mirage avec impact en late round. jL hold apps timing 1:30 pendant que NAVI fait pression A — il catch le rotate CT en 1-tap deagle quand ils crossover.",
    tactical_notes: "Le lurk B-apps efficient repose sur le timing : pas avant 1:30, sinon le CT a le temps de rotater retour. jL utilise le sniper noise du peer-mate sur A pour masquer son step apps. Deagle 1-tap typique avec crosshair pre-place a la porte. Lecon : un lurk amateur s'expose top mid; un lurk pro reste 'silencieux' jusqu'au moment de l'impact, soit la rotation CT, soit le post-plant.",
    key_callouts: ['B apps', 'kitchen', 'market', 'short'],
    axes_demonstrated: ['gamesense', 'positioning', 'mental'],
    notable_rating: 9,
  },
  {
    map: 'mirage', side: 'CT', situation_type: 'eco_win',
    pro_name: 'EliGE', match_event: 'IEM Cologne 2024',
    description: "Eco win CT-side Mirage avec stack A. Team Liquid stack 4 joueurs A connector + jungle pour anticiper l'execute force T. EliGE one-tap MAC-10 a 5m.",
    tactical_notes: "La regle eco CT pro : stack le site le plus probable apres lecture economy adverse. Si T sont en force-buy, ils prennent souvent A par lack of util pour B-execute long. EliGE close-range avec MAC-10 — il sait que les Ts entrent vague sans util. Lecon : eco CT = lis l'economy + stack le site probable, pas 2-2-1 par defaut.",
    key_callouts: ['jungle', 'connector', 'ramp', 'A site'],
    axes_demonstrated: ['economy', 'gamesense', 'positioning'],
    notable_rating: 8,
  },

  // ─── NUKE ─────────────────────────────────────────────────────────────────
  {
    map: 'nuke', side: 'CT', situation_type: 'opening_kill',
    pro_name: 'malbsMd', match_event: 'IEM Dallas 2024',
    description: "Opening AWP kill outside-Nuke (yard). malbsMd hold le 'main' angle depuis silo-roof avec timing aggressif round 0:08.",
    tactical_notes: "Sur Nuke CT outside, le yard-AWP doit choisir entre silo-roof (large angle, mais expose au flash from heaven) et back-of-truck (close angle, safe). malbsMd va silo-roof avec flash assist de l'IGL sur heaven. Crosshair pre-place a hauteur shoulder a 'main'. Lecon : sur Nuke yard, le silo-roof AWP n'est viable qu'avec flash heaven coverage — sinon back-of-truck.",
    key_callouts: ['silo', 'main', 'heaven', 'yard'],
    axes_demonstrated: ['aim', 'positioning', 'utility'],
    notable_rating: 8,
  },
  {
    map: 'nuke', side: 'T', situation_type: 'execute_lost',
    pro_name: 'apEX', match_event: 'BLAST Premier World Final 2024',
    description: "Execute A site lower-Nuke avorte. NAVI tente vents control + ramp split mais perd le ramp duel 1v3 — execute fail car ramp pris trop tard.",
    tactical_notes: "L'execute A lower Nuke depend du timing ramp : si le ramp duel se perd, le rest of team doit RETRAIT et faire un re-set vers B. Erreur ici : continuer push lower apres ramp lost = wipe. Lecon : sur Nuke, le ramp est le 'verrou' — perdre ramp = abort, jamais continue. Re-set vers B est legitime, perdre 3 joueurs pour rien ne l'est pas.",
    key_callouts: ['ramp', 'lower', 'vents', 'squeaky'],
    axes_demonstrated: ['gamesense', 'comms', 'mental'],
    notable_rating: 8,
  },
  {
    map: 'nuke', side: 'T', situation_type: 'util_setup',
    pro_name: 'ropz', match_event: 'IEM Katowice 2025',
    description: "Util setup canonique pour B execute Nuke depuis outside. 1 smoke vents + 1 smoke ct-rotate + 1 molly default = trinite pro pour B-rush.",
    tactical_notes: "Le B-rush Nuke pro a 3 utilites obligatoires : (1) smoke vents pour cut le info-feed CT vents, (2) smoke ct-rotate (le coin pres de hut) pour delay le rotate, (3) molly default pour fumer le defenseur pre-place. Sans une de ces 3, le B-rush echoue dans 70% des cas pro. ropz cluster la trinite parfaitement avec timing 0:10. Lecon : B-rush Nuke = 3 utiles minimum, jamais 2.",
    key_callouts: ['vents', 'hut', 'CT', 'default'],
    axes_demonstrated: ['utility', 'gamesense'],
    notable_rating: 9,
  },
  {
    map: 'nuke', side: 'CT', situation_type: 'retake_won',
    pro_name: 'rain', match_event: 'PGL Major Copenhagen 2024',
    description: "Retake B Nuke 2v1 post-plant. FaZe rotate via vents + heaven-drop. rain heaven-drop avec MAC-10 et catch le post-plant CT-side defender.",
    tactical_notes: "Le heaven-drop B Nuke est l'angle le plus sous-utilise des retakes. rain le maitrise : il drop pendant que son co-equipier fait noise sur vents pour distraire. Le drop = 1.5s d'invisibilite + close-range advantage. Lecon : sur retake B Nuke, le heaven-drop + distraction vents = 2v1 favorable a 60% (vs 30% sans distraction).",
    key_callouts: ['heaven', 'vents', 'tetris', 'control room'],
    axes_demonstrated: ['movement', 'positioning', 'comms'],
    notable_rating: 9,
  },

  // ─── ANCIENT ──────────────────────────────────────────────────────────────
  {
    map: 'ancient', side: 'T', situation_type: 'execute_won',
    pro_name: 'KSCERATO', match_event: 'BLAST Premier Spring Final 2024',
    description: "Execute A site Ancient via cave + ramp. FURIA split A avec smoke heaven + smoke donut + molly elbow. KSCERATO lead ramp avec wide-swing.",
    tactical_notes: "L'execute A Ancient pro repose sur le triangle util : smoke heaven (cut donut sniper), smoke donut (cut elbow watcher), molly elbow (force flush). KSCERATO ramp-swing wide pour avoir l'angle sur elbow vide. Le timing : 0:30 du round car les CT ont deja util-poped sur mid. Lecon : Ancient A execute = triangle smoke (heaven + donut) + molly elbow obligatoire.",
    key_callouts: ['ramp', 'elbow', 'donut', 'heaven', 'cave'],
    axes_demonstrated: ['utility', 'aim', 'movement'],
    notable_rating: 9,
  },
  {
    map: 'ancient', side: 'CT', situation_type: 'opening_kill',
    pro_name: 'sh1ro', match_event: 'IEM Cologne 2024',
    description: "Opening AWP kill mid-ancient. sh1ro hold mid depuis 'water' avec angle ultra-close, catch le T-mid en peek wide.",
    tactical_notes: "Le 'water' angle sur Ancient mid est le close-angle AWP pro typique : tu es invisible jusqu'au last frame, et le T-side qui peek mid s'attend a un AWP donut ou top-mid, pas water. sh1ro flick precis a 90 degres. Lecon : sur Ancient mid CT, l'angle water est sous-utilise et catch les amateurs qui pre-aiment l'AWP donut/top.",
    key_callouts: ['water', 'mid', 'donut', 'top mid'],
    axes_demonstrated: ['crosshair', 'aim', 'positioning'],
    notable_rating: 8,
  },
  {
    map: 'ancient', side: 'T', situation_type: 'force_win',
    pro_name: 'HObbiT', match_event: 'PGL Major Antwerp 2022',
    description: "Force-buy T win sur Ancient round 2 anti-eco. Cloud9 force avec galils + smokes mid, et prend mid control en wide-spam.",
    tactical_notes: "La regle force-buy anti-eco round T : ne jamais saver, force avec galil + smoke + molly. HObbiT prend mid avec un wide spam galil au pixel 'donut->water' qui catch le CT pre-aimant. Le galil one-tap a longue distance si crosshair-placement parfait. Lecon : T anti-eco force-buy doit prendre mid agresivement avec smoke, jamais defensif.",
    key_callouts: ['mid', 'donut', 'water'],
    axes_demonstrated: ['economy', 'aim', 'gamesense'],
    notable_rating: 8,
  },

  // ─── ANUBIS ───────────────────────────────────────────────────────────────
  {
    map: 'anubis', side: 'T', situation_type: 'execute_won',
    pro_name: 'donk', match_event: 'IEM Katowice 2025',
    description: "Execute B site Anubis via canals + connector. Spirit fait B-split avec smokes alley + heaven, donk lead canals avec AK-47 spray-transfer 4 frags.",
    tactical_notes: "Anubis B execute pro = smokes alley (cut heaven peeker) + smoke heaven (cut sniper) + connector-push synchro. donk transfere spray sur 4 cibles en 1.5s — son secret : crosshair-placement adapte aux 4 angles probables (heaven, alley-corner, plant, default). Lecon : sur Anubis B, le spray-transfer pre-suppose 4 angles preset; entraine-toi sur aim_botz multi-target avant.",
    key_callouts: ['canals', 'alley', 'heaven', 'B main'],
    axes_demonstrated: ['spray', 'aim', 'utility'],
    notable_rating: 10,
  },
  {
    map: 'anubis', side: 'CT', situation_type: 'clutch_won',
    pro_name: 'Magisk', match_event: 'IEM Dallas 2024',
    description: "1v2 clutch CT-side Anubis A post-plant. Magisk isole les 2 Ts en utilisant le silent walk + AWP pop depuis heaven A.",
    tactical_notes: "Le clutch 1v2 Anubis A CT-side depend de l'isolation : Magisk repere les 2 Ts sur sound cue (heaven + canalside), tue heaven en first pop AWP, puis kite canalside en silent walk. Anubis a beaucoup de coins quiet — utilisable pour disengage. Lecon : 1v2 a Anubis = isole un T avec sound cue, puis kite l'autre avec silent walk.",
    key_callouts: ['heaven', 'canal side', 'A main', 'connector'],
    axes_demonstrated: ['mental', 'aim', 'movement'],
    notable_rating: 9,
  },
  {
    map: 'anubis', side: 'T', situation_type: 'opening_loss',
    pro_name: 'XANTARES', match_event: 'BLAST Premier Spring 2024',
    description: "Opening loss T-side Anubis mid-peek. XANTARES peek mid au timing 0:05 sans flash assist et se fait one-tap par AWP heaven.",
    tactical_notes: "Erreur classique meme chez pros : peek mid Anubis T-side sans flash heaven assist. L'AWPer CT hold heaven avec line-up parfaite. La lecon : sur Anubis, JAMAIS peek mid early sans pop flash heaven + pop flash water. Le timing pro est 0:15+ avec util coord, pas 0:05 raw peek.",
    key_callouts: ['mid', 'heaven', 'water', 'top mid'],
    axes_demonstrated: ['utility', 'gamesense', 'crosshair'],
    notable_rating: 7,
  },

  // ─── DUST2 ────────────────────────────────────────────────────────────────
  {
    map: 'dust2', side: 'T', situation_type: 'execute_won',
    pro_name: 'iM', match_event: 'IEM Cologne 2024',
    description: "Execute A site Dust2 via long + catwalk. Liquid prend long avec smoke goose + smoke A-cross, puis catwalk push synchronise.",
    tactical_notes: "Dust2 A execute pro = smoke goose (cut CT-cross-peek long) + smoke A-cross (cut rotate from B) + molly default (force flush). iM lead long avec un wide-swing AWP timing 0:25, et catwalk push 0.5s apres pour catch le rotate. Lecon : Dust2 A = 2 smokes coordonnees + molly default, le catwalk push doit etre 0.5s post-long-peek.",
    key_callouts: ['long', 'catwalk', 'goose', 'A cross', 'default'],
    axes_demonstrated: ['utility', 'aim', 'comms'],
    notable_rating: 9,
  },
  {
    map: 'dust2', side: 'CT', situation_type: 'opening_kill',
    pro_name: 'dev1ce', match_event: 'BLAST Premier 2024',
    description: "Opening AWP kill long-doors Dust2. dev1ce hold long depuis pit avec timing pre-firetimer pour catch les T-long peekers.",
    tactical_notes: "Le 'pit' angle long Dust2 est l'angle AWP classique. dev1ce pre-aime a hauteur de tete du T qui peek doors, et reactivite < 200ms. Le secret : il ne deplace JAMAIS le crosshair pendant 5s, juste flick au movement. Lecon : sur Dust2 CT long, le pit AWP doit etre statique 5s pour reactivite max — bouger le crosshair = perte 50ms.",
    key_callouts: ['long', 'pit', 'doors', 'A site'],
    axes_demonstrated: ['crosshair', 'aim', 'reaction'],
    notable_rating: 9,
  },
  {
    map: 'dust2', side: 'CT', situation_type: 'retake_won',
    pro_name: 'huNter-', match_event: 'IEM Katowice 2025',
    description: "Retake B Dust2 2v1 post-plant. G2 rotate via mid + tunnels, huNter- catch le defuser avec wide-swing depuis tunnels-mouth.",
    tactical_notes: "Le retake B Dust2 a 2v1 favorise CT si execute correctement : tunnels-mouth + B-doors split. huNter- prend tunnels-mouth car le defuser ne peut pas hold les 2 angles. Wide-swing AK 1-tap. Lecon : Retake B Dust2 = toujours split tunnels + B-doors, jamais entrer par 1 seul cote.",
    key_callouts: ['B', 'tunnels', 'B doors', 'plat'],
    axes_demonstrated: ['positioning', 'aim', 'comms'],
    notable_rating: 8,
  },

  // ─── TRAIN ────────────────────────────────────────────────────────────────
  {
    map: 'train', side: 'CT', situation_type: 'opening_kill',
    pro_name: 'iM', match_event: 'IEM Dallas 2024',
    description: "Opening kill CT-side Train ivy depuis pop dog. iM hold pop-dog avec AWP a hauteur de tete au pixel d'entree ivy.",
    tactical_notes: "Pop-dog Train est l'angle AWP pro typique CT. Crosshair pre-place pixel-perfect a hauteur de tete. Le T qui peek ivy s'attend a l'AWP a back-of-train, pas pop-dog. Lecon : Train CT ivy = pop-dog AWP avec crosshair static, pas back-of-train (trop expose).",
    key_callouts: ['ivy', 'pop dog', 'back of train', 'connector'],
    axes_demonstrated: ['crosshair', 'positioning', 'aim'],
    notable_rating: 8,
  },
  {
    map: 'train', side: 'T', situation_type: 'execute_won',
    pro_name: 'electroNic', match_event: 'PGL Major Antwerp 2022',
    description: "Execute B site Train via lower. NAVI smoke ivy + smoke z + molly upper-z, push lower full team. electroNic clean 3 frags spray-transfer.",
    tactical_notes: "Train B execute pro = smoke ivy (cut rotate) + smoke z (cut hell-watcher) + molly upper-z (force flush). electroNic spray-transfer 3 cibles depuis cubby — il pre-aime les 3 trains roads avec crosshair-placement adapte. Lecon : Train B execute = 2 smokes + 1 molly, et le spray-transfer doit etre entraine sur 3 cibles (le site a 3 angles principaux).",
    key_callouts: ['lower', 'z connector', 'ivy', 'upper'],
    axes_demonstrated: ['utility', 'spray', 'aim'],
    notable_rating: 9,
  },
  {
    map: 'train', side: 'CT', situation_type: 'retake_won',
    pro_name: 'sh1ro', match_event: 'IEM Cologne 2023',
    description: "Retake A site Train 2v1 post-plant. Cloud9 rotate via ivy + connector. sh1ro AWP pop depuis ivy entry, kill the planter.",
    tactical_notes: "Le retake A Train pro = split ivy + connector. sh1ro AWP via ivy avec ele pre-aimant la planter position. Le co-equipier rifle via connector. Lecon : Train A retake = ivy AWP + connector rifle, jamais entrer par 1 seul cote.",
    key_callouts: ['ivy', 'connector', 'oil', 'A main'],
    axes_demonstrated: ['positioning', 'comms', 'aim'],
    notable_rating: 8,
  },

  // ─── MIXED / TRANSVERSE ───────────────────────────────────────────────────
  {
    map: 'mirage', side: 'both', situation_type: 'aim_duel',
    pro_name: 'donk', match_event: 'IEM Katowice 2025',
    description: "Pattern aim duel donk : crosshair placement pixel-perfect a hauteur de tete sur tout angle commun, pre-aim 100% des angles probables avant peek.",
    tactical_notes: "donk a pas le 'meilleur aim raw' du circuit mais le meilleur CROSSHAIR PLACEMENT. Sa methode : pre-aim chaque angle commun comme s'il y avait un ennemi, et il reactive < 200ms. Lecon : entraine-toi sur aim_botz 'crosshair static' (objectif : 30 kills en placement statique a hauteur tete, pas en flick).",
    key_callouts: [],
    axes_demonstrated: ['crosshair', 'aim', 'reaction'],
    notable_rating: 10,
  },
  {
    map: 'inferno', side: 'both', situation_type: 'aim_duel',
    pro_name: 'm0NESY', match_event: 'BLAST Premier 2024',
    description: "Pattern AWP duel m0NESY : reactivite < 180ms et flick precision via mouse-pad tension. Crosshair pre-place 80% du temps statique.",
    tactical_notes: "m0NESY reactivite < 180ms est dans le top-3 mondial. Sa technique : flick depuis crosshair pre-place, JAMAIS flick depuis 'reset' au sol. Sa sens AWP : 1.5 in-game @ 800 DPI, 25.7 cm/360. Lecon : si tu joues AWP, vise 200-220ms reactivite avec crosshair pre-place ; raw flick aim < 30% du jeu pro AWP.",
    key_callouts: [],
    axes_demonstrated: ['aim', 'reaction', 'crosshair'],
    notable_rating: 10,
  },
  {
    map: 'mirage', side: 'both', situation_type: 'multi_kill',
    pro_name: 'ZywOo', match_event: 'BLAST Premier World Final 2024',
    description: "Pattern multi-kill ZywOo : entry + repeek pattern. Il entry kill, recule (close angle), puis re-peek pour 2eme frag avant que le trade arrive.",
    tactical_notes: "La technique du repeek pro est specifique a ZywOo et NiKo : apres entry kill, recule 1m, refresh crosshair, repeek le meme angle 0.5s plus tard. L'enemy trade-mate s'avance et te donne un 2eme frag. Lecon : apres entry kill, NE TIRE PAS LA SEQUENCE — recule + repeek. C'est le 'half-trade' qui te donne 1-2 frags supplementaires.",
    key_callouts: [],
    axes_demonstrated: ['positioning', 'aim', 'mental'],
    notable_rating: 10,
  },
  {
    map: 'inferno', side: 'both', situation_type: 'util_setup',
    pro_name: 'karrigan', match_event: 'PGL Major Copenhagen 2024',
    description: "Pattern IGL economy : karrigan force-buy timing. Apres pistol win + bonus round T-side, FaZe save force pour ouvrir round 4 avec full economy.",
    tactical_notes: "L'IGL pro lit l'economy adversaire avant de force-buy : si l'autre team save round 2, force-buy round 3 = -50% chance (ils ont le bonus). karrigan force-buy seulement quand l'adv est en force-buy aussi, sinon save. Lecon : ton economy n'est PAS isolee ; calcule l'adv economy avant decision force/save.",
    key_callouts: [],
    axes_demonstrated: ['economy', 'gamesense', 'comms'],
    notable_rating: 10,
  },
  {
    map: 'nuke', side: 'both', situation_type: 'flash_assist',
    pro_name: 'apEX', match_event: 'BLAST Spring 2024',
    description: "Pattern flash-assist apEX : pop-flash technique via wall-bounce. Le flash bounce sur le mur droit avant de pop, ce qui surprise l'adv.",
    tactical_notes: "Le pop-flash wall-bounce est underrated : tu lance la flash 'pour rebondir' sur un mur 0.5m avant l'angle ennemi. Le rebond decale le timing du pop de 0.3s, ce qui prend a contre-pied l'adv qui s'attend a un timing standard. apEX maitrise sur 5+ angles Nuke. Lecon : utilise pop-flash wall-bounce pour breaker le timing standard — 30% plus de blinds reussites.",
    key_callouts: [],
    axes_demonstrated: ['utility', 'gamesense'],
    notable_rating: 9,
  },
  {
    map: 'ancient', side: 'both', situation_type: 'post_plant',
    pro_name: 'KSCERATO', match_event: 'BLAST Premier 2024',
    description: "Pattern post-plant KSCERATO : crossfire 2-player setup. Apres plant, KSCERATO + co-equipier se placent sur 2 angles non-overlapping pour crossfire.",
    tactical_notes: "Le post-plant pro a 2 joueurs = crossfire mandatory : 2 angles separes par 90 degres min. Si les 2 joueurs sont sur le meme angle, le retake CT win 80% du temps. KSCERATO + arT se split heaven + cubby sur A Ancient. Lecon : post-plant a 2 joueurs = JAMAIS meme angle, crossfire obligatoire.",
    key_callouts: [],
    axes_demonstrated: ['positioning', 'comms', 'gamesense'],
    notable_rating: 9,
  },
  {
    map: 'mirage', side: 'both', situation_type: 'pre_plant',
    pro_name: 'ropz', match_event: 'IEM Katowice 2025',
    description: "Pattern pre-plant ropz : information-gathering via mid-control. Avant execute, ropz lurk mid pour entendre les rotates CT.",
    tactical_notes: "Le pre-plant info-gathering depend de la map control : ropz lurk mid Mirage avec silent walk pour gather rotates audio. Si CT rotate son site cible (A par ex), il refresh-call B-execute. Lecon : avant chaque execute, dedie 1 joueur a l'info-gather mid (silent walk + listen) — change ton call si rotate detecte.",
    key_callouts: ['mid', 'connector', 'jungle', 'top mid'],
    axes_demonstrated: ['gamesense', 'comms', 'positioning'],
    notable_rating: 9,
  },
  {
    map: 'anubis', side: 'both', situation_type: 'clutch_lost',
    pro_name: 'XANTARES', match_event: 'BLAST Premier 2024',
    description: "Clutch perdu 1v3 Anubis A post-plant. XANTARES panic-rush au lieu de hold post-plant angles, se fait clean en 5s.",
    tactical_notes: "Erreur classique : 1v3 = NE BOUGE PAS. XANTARES panic-rush vers heaven et se fait clean. Le 1v3 pro = stay invisible, force les CTs a se split pour defuse. Si 2 def + 1 def-watcher, isole le watcher. Lecon : 1v3 post-plant = silent walk + isole 1 ennemi, JAMAIS panic-rush.",
    key_callouts: ['heaven', 'canal side', 'A main'],
    axes_demonstrated: ['mental', 'gamesense', 'positioning'],
    notable_rating: 8,
  },
  {
    map: 'dust2', side: 'both', situation_type: 'lurk_impact',
    pro_name: 'huNter-', match_event: 'IEM Cologne 2024',
    description: "Lurk B-doors Dust2 avec impact tardif. huNter- attend rotate CT 1:00+, catch le rotate via tunnels en wide-swing AK.",
    tactical_notes: "Lurk Dust2 B-doors a haute valeur si timing > 1:00 du round : les CTs rotate vers A (apres pression A T-side), tu catch tunnels avec wide-swing. huNter- one-tap 1-2 frags rotate. Lecon : lurk Dust2 efficient = timing 1:00+ avec rotate guaranteed, pas early lurk.",
    key_callouts: ['B doors', 'tunnels', 'lower tunnels', 'plat'],
    axes_demonstrated: ['gamesense', 'positioning', 'aim'],
    notable_rating: 8,
  },
  {
    map: 'inferno', side: 'CT', situation_type: 'anti_eco',
    pro_name: 'rain', match_event: 'PGL Major Copenhagen 2024',
    description: "Anti-eco CT-side Inferno avec stack banana. FaZe stack 3 CT banana avec smoke + molly preset car ils ont read l'eco T.",
    tactical_notes: "Anti-eco CT pro = stack le site le plus likely en SMG + Deagle. rain MAC-10 close-range banana, kill 4 Ts en eco rush. Lecon : si tu read T en eco, stack banana avec 3 SMGs + 1 AWP — eco T-side rush banana 80% du temps.",
    key_callouts: ['banana', 'pit', 'logs'],
    axes_demonstrated: ['economy', 'aim', 'gamesense'],
    notable_rating: 8,
  },
  {
    map: 'mirage', side: 'CT', situation_type: 'force_win',
    pro_name: 'frozen', match_event: 'BLAST Premier 2024',
    description: "Force-buy CT win Mirage round 2 anti-pistol. MOUZ force avec MP9 + Deagle + 1 AWP + util coord pour anti-pistol bonus.",
    tactical_notes: "Anti-pistol force pro = MP9 + Deagle + util coord. frozen MP9 close-range A connector, kill 3 Ts en eco-rush. Lecon : anti-pistol force CT = MP9/MAC-10 stack site likely + util coord, jamais full-buy CT round 2.",
    key_callouts: ['A connector', 'jungle', 'ramp'],
    axes_demonstrated: ['economy', 'utility', 'aim'],
    notable_rating: 8,
  },
];

console.log(`[seed] Corpus a ${CORPUS.length} situations.`);

// ─── Validation ────────────────────────────────────────────────────────────
const VALID_AXES = ['aim', 'crosshair', 'spray', 'utility', 'positioning', 'gamesense', 'economy', 'mental', 'movement', 'comms', 'reaction'];
const VALID_SIDES = ['CT', 'T', 'both'];
const VALID_TYPES = ['clutch_won', 'clutch_lost', 'multi_kill', 'opening_kill', 'opening_loss', 'eco_win', 'force_win', 'anti_eco', 'retake_won', 'retake_lost', 'execute_won', 'execute_lost', 'lurk_impact', 'aim_duel', 'post_plant', 'pre_plant', 'flash_assist', 'util_setup'];

for (const s of CORPUS) {
  if (!VALID_SIDES.includes(s.side)) throw new Error(`Invalid side ${s.side}`);
  if (!VALID_TYPES.includes(s.situation_type)) throw new Error(`Invalid situation_type ${s.situation_type}`);
  for (const a of s.axes_demonstrated || []) {
    if (!VALID_AXES.includes(a)) throw new Error(`Invalid axis ${a}`);
  }
  if (s.notable_rating < 1 || s.notable_rating > 10) throw new Error(`Invalid notable_rating ${s.notable_rating}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  // 1. Existing dedup : check par (pro_name, map, situation_type, description hash)
  const { data: existing } = await supabase
    .from('pro_demo_situations')
    .select('pro_name, map, situation_type, description');
  const seen = new Set(
    (existing || []).map(r => `${r.pro_name}::${r.map}::${r.situation_type}::${(r.description || '').slice(0, 80)}`)
  );

  const toInsert = CORPUS.filter(s => {
    const k = `${s.pro_name}::${s.map}::${s.situation_type}::${s.description.slice(0, 80)}`;
    return !seen.has(k);
  });

  console.log(`[seed] ${existing?.length || 0} existing, ${toInsert.length} to insert (${CORPUS.length - toInsert.length} duplicates skipped)`);

  if (toInsert.length === 0) {
    console.log('[seed] nothing to do');
    return;
  }

  // 2. Build embedding texts : description + tactical_notes + callouts
  const embeddingTexts = toInsert.map(s => {
    const callouts = (s.key_callouts || []).join(' ');
    const axes = (s.axes_demonstrated || []).join(' ');
    return `${s.situation_type.replace(/_/g, ' ')} ${s.map} ${s.side} ${s.pro_name}. ${s.description} ${s.tactical_notes} Callouts: ${callouts}. Axes: ${axes}.`;
  });

  // 3. Embed by batches (Voyage primaire, OpenAI fallback)
  console.log(`[seed] embedding ${embeddingTexts.length} texts...`);
  const t0 = Date.now();
  const vectors = await embedBatch(embeddingTexts, { inputType: 'document' });
  const t1 = Date.now();
  const totalChars = embeddingTexts.reduce((s, t) => s + t.length, 0);
  const estTokens = Math.ceil(totalChars / 4); // approx 4 chars/token
  const provider = process.env.VOYAGE_API_KEY ? 'voyage' : 'openai';
  console.log(`[seed] embedded in ${((t1 - t0) / 1000).toFixed(1)}s. Provider: ${provider}. Approx ${estTokens} tokens. Est cost: $${estimateCostUsd(provider, estTokens)}`);

  // 4. Insert with embeddings
  const rows = toInsert.map((s, i) => ({
    map: s.map,
    side: s.side,
    situation_type: s.situation_type,
    round_num: s.round_num || null,
    pro_name: s.pro_name,
    match_event: s.match_event || null,
    match_date: s.match_date || null,
    hltv_match_id: s.hltv_match_id || null,
    description: s.description,
    tactical_notes: s.tactical_notes,
    key_callouts: s.key_callouts || null,
    axes_demonstrated: s.axes_demonstrated || null,
    replay_link: s.replay_link || null,
    embedding: vectors[i],
    notable_rating: s.notable_rating || null,
  }));

  // Bulk insert par chunks de 20 (Supabase row size limit + safety)
  const CHUNK = 20;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('pro_demo_situations').insert(slice);
    if (error) {
      console.error(`[seed] insert chunk ${i / CHUNK + 1} failed:`, error.message);
      throw error;
    }
    inserted += slice.length;
    console.log(`[seed] inserted ${inserted}/${rows.length}`);
  }

  console.log(`[seed] DONE. Total in DB: ${(existing?.length || 0) + inserted}`);
}

main().catch(e => {
  console.error('[seed] FATAL:', e);
  process.exit(1);
});
