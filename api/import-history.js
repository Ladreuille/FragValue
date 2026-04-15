// api/import-history.js
// Importe les 5 derniers matchs FACEIT du user (de moins d 1 mois) et lance
// le parsing parser Railway via l extension FragValue.
//
// POURQUOI CES LIMITES :
//  - FACEIT purge les fichiers .dem du CDN Backblaze apres ~30 jours. Au-dela
//    de cette fenetre, le parser retourne systematiquement "err_nf0 file not
//    found" et les rows finissent en failed — inutile de les queuer.
//  - On cap a 5 matches pour limiter le fan-out auto et eviter de saturer
//    l extension qui doit aller chercher une URL presignee fraiche pour
//    chaque match (un appel api.faceit.com authentifie par match). Au-dela,
//    l utilisateur passe par l upload manuel de .dem via /demo.html.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FACEIT_API_KEY = process.env.FACEIT_API_KEY;
const PARSER_URL = process.env.PARSER_URL || 'https://fragvalue-demo-parser-production.up.railway.app';
const PARSER_SECRET = process.env.FACEIT_WEBHOOK_SECRET || '';

// Configuration de l import automatique. Aligne sur la politique de retention
// FACEIT (~30j) + plafond sur le fan-out extension.
const AUTO_IMPORT_MAX_MATCHES = 5;
const AUTO_IMPORT_MAX_AGE_DAYS = 30;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://frag-value.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token invalide' });

    // Recuperer le profil pour avoir faceit_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('faceit_id, faceit_nickname')
      .eq('id', user.id)
      .single();

    if (!profile?.faceit_id && !profile?.faceit_nickname) {
      return res.status(400).json({ error: 'FACEIT non lie a ce compte' });
    }

    if (!FACEIT_API_KEY) {
      return res.status(503).json({ error: 'FACEIT_API_KEY non configure' });
    }

    // Resoudre faceit_id a la volee via le nickname si manquant (legacy profils
    // crees avant qu'on stocke l'id) puis persister pour les prochains imports
    let faceitId = profile.faceit_id;
    if (!faceitId && profile.faceit_nickname) {
      const lookupUrl = `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(profile.faceit_nickname)}&game=cs2`;
      const lookupRes = await fetch(lookupUrl, {
        headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
      });
      if (!lookupRes.ok) {
        return res.status(502).json({ error: 'FACEIT player lookup failed' });
      }
      const lookup = await lookupRes.json();
      faceitId = lookup.player_id || lookup.id || null;
      if (!faceitId) {
        return res.status(404).json({ error: 'Joueur FACEIT introuvable' });
      }
      await supabase.from('profiles').update({
        faceit_id: faceitId,
        faceit_elo: lookup.games?.cs2?.faceit_elo || null,
        faceit_level: lookup.games?.cs2?.skill_level || null,
      }).eq('id', user.id);
    }

    // Fetch les N derniers matchs CS2 (N = AUTO_IMPORT_MAX_MATCHES).
    // On reste volontairement sous la limite FACEIT (100) pour coller a la
    // politique "5 derniers matchs" annoncee dans l UI.
    const histUrl = `https://open.faceit.com/data/v4/players/${faceitId}/history?game=cs2&offset=0&limit=${AUTO_IMPORT_MAX_MATCHES}`;
    const histRes = await fetch(histUrl, {
      headers: { 'Authorization': `Bearer ${FACEIT_API_KEY}` }
    });
    if (!histRes.ok) {
      return res.status(histRes.status).json({ error: 'FACEIT history error' });
    }
    const history = await histRes.json();
    const items = history.items || [];

    // Filtre fenetre de retention : on skippe tout match termine il y a plus
    // de AUTO_IMPORT_MAX_AGE_DAYS jours. Sans ce filtre on queuerait des
    // matches condamnes d avance (demo purgee du CDN FACEIT apres ~30j) qui
    // pollueraient la liste en `failed` avec "err_nf0 file not found".
    const nowSec = Math.floor(Date.now() / 1000);
    const maxAgeSec = AUTO_IMPORT_MAX_AGE_DAYS * 86400;
    const eligibleItems = items.filter(m => {
      const finishedAt = m.finished_at || m.started_at || 0;
      if (!finishedAt) return true; // match en cours ou date manquante : on tente
      return (nowSec - finishedAt) <= maxAgeSec;
    });
    const skippedTooOld = items.length - eligibleItems.length;

    // Inserer les matches en pending.
    // IMPORTANT: depuis v0.2 on ne declenche PLUS le parser Railway ici car
    // les URLs renvoyees par open.faceit.com/data/v4 pointent toutes sur le
    // CDN regional Backblaze decommissionne par FACEIT en 2024. A la place,
    // l'extension navigateur FragValue reprend cette liste et va chercher
    // des URLs presignees fraiches via www.faceit.com (authentifie via
    // cookies user), puis les envoie a /api/submit-demo-url qui fait le
    // fan-out au parser avec l'override demoUrl.
    const imported = [];
    for (const m of eligibleItems) {
      const matchId = m.match_id;
      if (!matchId) continue;

      // Recuperer l'etat existant. On skippe les rows qui sont deja terminees
      // (status='parsed') ou en cours (status='parsing') pour ne pas stomper
      // le travail du parser. Les rows 'pending' ou 'failed' sont re-queuees
      // (l'utilisateur peut vouloir retenter un match echoue).
      //
      // ATTENTION: on se fie UNIQUEMENT a `status` comme signal de verite.
      // Un test du genre `score_ct != null` donne des faux positifs parce que
      // la colonne a un default 0 (pas null), donc toute row fraichement
      // inseree declenche le match. Un test `rounds > 0` est aussi risque
      // (rows debug / mid-parse). status est la seule source de verite
      // canonique du parser.
      const { data: existing } = await supabase
        .from('matches')
        .select('status')
        .eq('faceit_match_id', matchId)
        .single();

      if (existing?.status === 'parsed' || existing?.status === 'parsing') {
        imported.push({ matchId, status: 'already_parsed' });
        continue;
      }

      // Insert une nouvelle row ou reset une row 'failed' / 'pending' sans
      // donnees parsees. Pas de map : m.i1 est une URL d'image FACEIT, pas
      // un nom de map. Le parser ecrit le vrai map sur le succes.
      await supabase.from('matches').upsert({
        id: matchId,
        faceit_match_id: matchId,
        user_id: user.id,
        status: 'pending',
        error_message: null,
      }, { onConflict: 'faceit_match_id' });

      imported.push({ matchId, status: 'queued' });
    }

    return res.status(200).json({
      imported: imported.length,
      matches: imported,
      // Metadata pour que l UI puisse expliquer les matches skippes : on
      // distingue les matches recents (<= 30j) qu on queue vraiment et les
      // matches trop vieux qu on laisse de cote pour upload manuel.
      skippedTooOld,
      maxMatches: AUTO_IMPORT_MAX_MATCHES,
      maxAgeDays: AUTO_IMPORT_MAX_AGE_DAYS,
      // Flag lu par l'UI pour afficher le hint extension si elle n'est pas
      // installee. Le flow auto-import ne peut pas marcher sans extension.
      extensionRequired: true,
    });
  } catch (err) {
    console.error('import-history error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
