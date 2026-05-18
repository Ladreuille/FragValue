// api/_lib/callout-mapper.js · FragValue
//
// Convertit des coordonnees world CS2 (x, y) en callouts lisibles par humain
// pour les 7 cartes active duty (Mirage, Inferno, Nuke, Ancient, Anubis,
// Dust2, Overpass). Resolution coarse (zones broad) -> trade-off complexite
// vs valeur Coach IA. "A site" suffit a contextualiser, pas besoin de
// distinguer "A default" de "A ninja" pour du diag.
//
// Source coordonnees : radar overlays Liquipedia + community csgo-callouts
// repos (zones boxes approximees a la main). Pas pixel-perfect, mais
// suffisant pour categoriser "kill sur A" vs "kill sur B" etc.
//
// Usage :
//   const { posToCallout } = require('./callout-mapper.js');
//   posToCallout('de_mirage', -1200, 800)  -> 'A_site'
//   posToCallout('unknown_map', x, y)       -> ''   (fallback silencieux)
//
// IMPORTANT : les coords CS2 demo sont les coords world directement (pas
// transformees). Si le parser fait deja une transformation (ex. inversion Y),
// adapter ici. Test E2E rapide via le smoke-test en bas de fichier.

// Helper : check si (x, y, z) est dans une zone rectangulaire 2D ou 3D.
// Si la zone declare minZ/maxZ, on filtre aussi sur l'altitude (utile pour
// les maps verticales type Nuke ou A site est sur le toit, B en sous-sol).
function inZone(x, y, zone, z) {
  if (x < zone.minX || x > zone.maxX) return false;
  if (y < zone.minY || y > zone.maxY) return false;
  if (zone.minZ != null && z != null && z < zone.minZ) return false;
  if (zone.maxZ != null && z != null && z > zone.maxZ) return false;
  return true;
}

// Coords des zones broad par map. Chaque zone = (callout, box).
// Order matter : on retourne le 1er match (donc mettre zones specifiques avant generiques).
const ZONES = {
  // ── MIRAGE ────────────────────────────────────────────────────────────
  // Origin top-right, Y croissant vers nord, X croissant vers est.
  de_mirage: [
    { name: 'A_site',         minX:  650, maxX: 1700, minY:  -700, maxY:   650 },
    { name: 'A_palace',       minX:  900, maxX: 1700, minY:  -100, maxY:   650 },
    { name: 'A_ramp',         minX:  200, maxX:  800, minY:  -700, maxY:  -100 },
    { name: 'mid',            minX: -500, maxX:  500, minY:  -900, maxY:   100 },
    { name: 'mid_window',     minX:    0, maxX:  500, minY:  -300, maxY:   200 },
    { name: 'mid_connector',  minX:  100, maxX:  650, minY:    50, maxY:   550 },
    { name: 'b_site',         minX:-2400, maxX:-1100, minY:  -800, maxY:   400 },
    { name: 'b_apartments',   minX:-2700, maxX:-1700, minY:   400, maxY:  1500 },
    { name: 'b_short',        minX: -600, maxX:    0, minY:   300, maxY:  1100 },
    { name: 't_spawn',        minX: -700, maxX:  100, minY:   800, maxY:  1800 },
    { name: 'ct_spawn',       minX:-1100, maxX:    0, minY: -1700, maxY:  -700 },
  ],

  // ── INFERNO ───────────────────────────────────────────────────────────
  de_inferno: [
    { name: 'A_site',         minX: 1700, maxX: 2700, minY:   400, maxY:  1500 },
    { name: 'A_pit',          minX: 1700, maxX: 2200, minY:  -100, maxY:   500 },
    { name: 'A_short',        minX: 1100, maxX: 1700, minY:    50, maxY:   700 },
    { name: 'A_arch',         minX: 1000, maxX: 1700, minY:   700, maxY:  1500 },
    { name: 'mid',            minX:  300, maxX: 1100, minY:   400, maxY:  1300 },
    { name: 'banana',         minX:    0, maxX:  900, minY:  -800, maxY:   400 },
    { name: 'B_site',         minX: -100, maxX:  900, minY: -1700, maxY:  -800 },
    { name: 'B_apartments',   minX:-1100, maxX: -300, minY:  -200, maxY:   700 },
    { name: 't_spawn',        minX:-1500, maxX:    0, minY:   900, maxY:  2200 },
    { name: 'ct_spawn',       minX: 1500, maxX: 2900, minY: -1500, maxY:    50 },
  ],

  // ── NUKE (map verticale : A en haut Z>0, B en sous-sol Z<-200) ──────
  // Sans Z, A et B se superposent en X/Y (meme empreinte horizontale).
  // CS2 world Z: A site floor ~ -415, B site floor ~ -785 (par radar).
  // On utilise Z=-500 comme seuil A/B (au-dessus = A area, en-dessous = B).
  // Zones SANS minZ/maxZ s'appliquent sur n'importe quel Z (zones 2D-only).
  de_nuke: [
    // Outside : zone exterieure cote T/CT exterior
    { name: 'outside',        minX: -200, maxX:  900, minY:-1000, maxY:    0 },
    // A site : floor superieur (Z > -500)
    { name: 'A_site',         minX:  -50, maxX:  850, minY:  100, maxY:   850, minZ: -500, maxZ:  500 },
    { name: 'A_heaven',       minX:  100, maxX:  800, minY:  600, maxY:   900, minZ: -200, maxZ:  500 },
    { name: 'A_hut',          minX:-1000, maxX: -200, minY:    0, maxY:   600, minZ: -500, maxZ:  500 },
    { name: 'A_ramp',         minX:    0, maxX:  600, minY:  900, maxY:  1500, minZ: -500, maxZ:  500 },
    // B site : sous-sol (Z < -500)
    { name: 'B_site',         minX:    0, maxX:  900, minY:  100, maxY:   850, minZ:-1000, maxZ: -500 },
    { name: 'B_halls',        minX: -600, maxX:  100, minY:  100, maxY:   850, minZ:-1000, maxZ: -500 },
    // Spawns (Z indifferent, leur X/Y est unique)
    { name: 't_spawn',        minX: 1500, maxX: 2700, minY:-1700, maxY:  -400 },
    { name: 'ct_spawn',       minX: 1700, maxX: 2700, minY:  100, maxY:  1500 },
  ],

  // ── ANCIENT ───────────────────────────────────────────────────────────
  de_ancient: [
    { name: 'A_site',         minX:  900, maxX: 1700, minY: -200, maxY:   900 },
    { name: 'A_ramp',         minX:  500, maxX: 1100, minY:    0, maxY:   700 },
    { name: 'mid',            minX:    0, maxX:  900, minY: -500, maxY:   400 },
    { name: 'B_site',         minX:-1700, maxX: -700, minY:   100, maxY:  1100 },
    { name: 'B_main',         minX:-1300, maxX: -600, minY: -200, maxY:   400 },
    { name: 't_spawn',        minX: -700, maxX:  600, minY:  600, maxY:  2000 },
    { name: 'ct_spawn',       minX:  800, maxX: 2200, minY:-1700, maxY:    0 },
  ],

  // ── ANUBIS ────────────────────────────────────────────────────────────
  de_anubis: [
    { name: 'A_site',         minX: 1200, maxX: 2300, minY: -600, maxY:   400 },
    { name: 'A_connector',    minX:  500, maxX: 1300, minY:    0, maxY:   800 },
    { name: 'mid',            minX:    0, maxX:  900, minY:  -50, maxY:   900 },
    { name: 'B_site',         minX:-1700, maxX:  -50, minY: -700, maxY:   400 },
    { name: 'B_palace',       minX:-2200, maxX:-1300, minY:  100, maxY:  1100 },
    { name: 't_spawn',        minX:-1500, maxX: 1500, minY:  800, maxY:  1900 },
    { name: 'ct_spawn',       minX:    0, maxX: 1500, minY:-1500, maxY:  -300 },
  ],

  // ── DUST2 ─────────────────────────────────────────────────────────────
  de_dust2: [
    { name: 'A_site',         minX:  900, maxX: 1900, minY: 1900, maxY:  3100 },
    { name: 'A_long',         minX: -300, maxX:  800, minY: 2200, maxY:  3100 },
    { name: 'A_short',        minX:  400, maxX: 1200, minY:  900, maxY:  1900 },
    { name: 'A_ramp',         minX: 1200, maxX: 1900, minY: 1400, maxY:  2000 },
    { name: 'mid',            minX:    0, maxX:  900, minY:  100, maxY:  1300 },
    { name: 'B_site',         minX:-2000, maxX:-1000, minY: 1900, maxY:  3000 },
    { name: 'B_tunnels',      minX:-1200, maxX: -300, minY: 1400, maxY:  2200 },
    { name: 'B_doors',        minX:-1800, maxX:-1000, minY: 1100, maxY:  2000 },
    { name: 't_spawn',        minX: -200, maxX: 1200, minY: -800, maxY:    50 },
    { name: 'ct_spawn',       minX:    0, maxX:  900, minY: 2800, maxY:  3500 },
  ],

  // ── OVERPASS ──────────────────────────────────────────────────────────
  de_overpass: [
    { name: 'A_site',         minX:-1500, maxX: -300, minY: -700, maxY:   300 },
    { name: 'A_long',         minX:-2000, maxX: -700, minY:  300, maxY:  1300 },
    { name: 'A_short',        minX:-1100, maxX: -200, minY:  -50, maxY:   600 },
    { name: 'connector',      minX:    0, maxX:  900, minY: -200, maxY:   400 },
    { name: 'B_site',         minX:  700, maxX: 1900, minY:  400, maxY:  1700 },
    { name: 'B_monster',      minX:  300, maxX: 1300, minY: 1300, maxY:  2200 },
    { name: 'B_heaven',       minX: 1300, maxX: 2000, minY: 1100, maxY:  1800 },
    { name: 't_spawn',        minX:    0, maxX: 1700, minY: 2200, maxY:  3200 },
    { name: 'ct_spawn',       minX:-1700, maxX:    0, minY:-1700, maxY:  -700 },
  ],
};

// Normalise un nom de map vers la cle ZONES.
// Accepte : 'de_mirage', 'mirage', 'Mirage', 'workshop/123/de_mirage' etc.
function normalizeMap(mapName) {
  if (!mapName) return '';
  let m = String(mapName).toLowerCase().trim();
  m = m.replace(/^workshop\/\d+\//, '');
  m = m.replace(/^.*[\/\\]/, '');
  if (!m.startsWith('de_')) m = 'de_' + m;
  return m;
}

// API principale : retourne le callout pour (mapName, x, y, [z]) ou '' si inconnu.
// Le 4e param z est optionnel : utilise pour Nuke (A=top, B=basement) ou
// d'autres futures maps verticales (Vertigo aussi mais hors active duty).
function posToCallout(mapName, x, y, z) {
  if (x == null || y == null) return '';
  const map = normalizeMap(mapName);
  const zones = ZONES[map];
  if (!zones) return '';
  for (const zone of zones) {
    if (inZone(x, y, zone, z)) return zone.name;
  }
  return '';  // hors zones connues : on retourne vide (Claude verra les coords brutes)
}

// Helper : formate position en "callout (x,y)" si callout dispo, sinon "(x,y)".
// z optionnel passe a posToCallout pour les maps verticales.
function fmtPosCallout(mapName, x, y, z) {
  if (x == null || y == null) return '?';
  const callout = posToCallout(mapName, x, y, z);
  const coords = `${Math.round(x)},${Math.round(y)}`;
  return callout ? `${callout} (${coords})` : coords;
}

module.exports = {
  posToCallout,
  fmtPosCallout,
  normalizeMap,
};
