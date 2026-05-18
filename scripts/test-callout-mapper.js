#!/usr/bin/env node
/* eslint-disable */
// scripts/test-callout-mapper.js · FragValue
//
// Tests sur le mapper coords -> callout pour les 7 active duty maps.
//
// Limites :
//   - Les zones bounds dans callout-mapper.js sont des estimations a vue
//     de nez (pas de validation contre vraies demos prod). Ces tests ne
//     valident que la coherence interne (Mirage A != Mirage B, etc.), pas
//     l'exactitude absolue des bounds.
//   - Pour valider en prod : extraire 20-30 vraies positions (kills aux
//     callouts connus) depuis 5-10 demos pros + checker que le mapper
//     retourne le bon callout pour chaque. TODO en Phase 2.
//
// Run : node scripts/test-callout-mapper.js

const { posToCallout, normalizeMap } = require('../api/_lib/callout-mapper.js');

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { console.log('  ✓', label); pass++; }
  else { console.log('  ✗ FAIL :', label); fail++; }
}
function eq(actual, expected, label) {
  assert(actual === expected, `${label} (got "${actual}", expected "${expected}")`);
}

console.log('Test 1 : normalizeMap accepte plusieurs formats');
eq(normalizeMap('de_mirage'), 'de_mirage', 'forme canonical');
eq(normalizeMap('mirage'), 'de_mirage', 'sans prefix de_');
eq(normalizeMap('Mirage'), 'de_mirage', 'case insensitive');
eq(normalizeMap('workshop/12345/de_mirage'), 'de_mirage', 'strip workshop prefix');
eq(normalizeMap(''), '', 'empty -> empty');

console.log('\nTest 2 : Mirage zones distinctes (smoke test cohrence interne)');
// Coords approximatives mais distinctes
eq(posToCallout('de_mirage', 1200, 0), 'A_site', 'Mirage A');
eq(posToCallout('de_mirage', -2000, -500), 'b_site', 'Mirage B (lowercase intentionnel)');
eq(posToCallout('de_mirage', 0, -500), 'mid', 'Mirage mid');
assert(posToCallout('de_mirage', 1200, 0) !== posToCallout('de_mirage', -2000, -500), 'A != B');

console.log('\nTest 3 : Inferno zones distinctes');
eq(posToCallout('de_inferno', 2100, 900), 'A_site', 'Inferno A');
eq(posToCallout('de_inferno', 300, -1200), 'B_site', 'Inferno B');
eq(posToCallout('de_inferno', 400, 0), 'banana', 'Inferno banana');
assert(posToCallout('de_inferno', 2100, 900) !== posToCallout('de_inferno', 300, -1200), 'A != B');

console.log('\nTest 4 : Nuke Z-discrimination (CRITIQUE map verticale)');
// Meme X/Y, Z different = A floor vs B basement
eq(posToCallout('de_nuke', 400, 400, -400), 'A_site', 'Nuke A (top floor, Z=-400)');
eq(posToCallout('de_nuke', 400, 400, -800), 'B_site', 'Nuke B (basement, Z=-800)');
assert(posToCallout('de_nuke', 400, 400, -400) !== posToCallout('de_nuke', 400, 400, -800),
  'A et B doivent etre distincts avec Z fourni');
// Sans Z : fallback A (premiere zone matchee)
eq(posToCallout('de_nuke', 400, 400), 'A_site', 'Nuke sans Z -> fallback A');
// Outside (cote exterieur) : independant du Z
eq(posToCallout('de_nuke', 400, -500, -400), 'outside', 'Nuke outside');

console.log('\nTest 5 : Ancient, Anubis, Dust2, Overpass');
eq(posToCallout('de_ancient', 1200, 400), 'A_site', 'Ancient A');
eq(posToCallout('de_ancient', -1200, 600), 'B_site', 'Ancient B');
eq(posToCallout('de_anubis', 1800, -100), 'A_site', 'Anubis A');
eq(posToCallout('de_anubis', -1000, 0), 'B_site', 'Anubis B');
eq(posToCallout('de_dust2', 1200, 2500), 'A_site', 'Dust2 A');
eq(posToCallout('de_dust2', -1500, 2500), 'B_site', 'Dust2 B');
eq(posToCallout('de_overpass', -800, 0), 'A_site', 'Overpass A');
eq(posToCallout('de_overpass', 1200, 1000), 'B_site', 'Overpass B');

console.log('\nTest 6 : Map inconnue -> empty');
eq(posToCallout('de_train', 0, 0), '', 'de_train inconnu (hors active duty)');
eq(posToCallout('cs_office', 0, 0), '', 'CS map inconnue');
eq(posToCallout('de_mirage', null, null), '', 'null coords -> empty');

console.log('\nTest 7 : Hors zone -> empty (pas de garbage callout)');
// Coords dans le no man's land entre les zones
eq(posToCallout('de_mirage', 99999, 99999), '', 'Mirage coords absurdes');
eq(posToCallout('de_inferno', -10000, -10000), '', 'Inferno coords absurdes');

console.log('\n────────────────────────────────────────────');
if (fail === 0) {
  console.log(`✅ ALL TESTS PASSED (${pass} assertions)`);
  process.exit(0);
} else {
  console.log(`❌ ${fail} FAIL / ${pass} PASS`);
  process.exit(1);
}
