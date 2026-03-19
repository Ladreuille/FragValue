// api/stats.js — Vercel Serverless Function
// Proxy Steam API pour éviter les erreurs CORS côté navigateur
// Déploie sur Vercel, ajoute STEAM_API_KEY dans les variables d'environnement

export default async function handler(req, res) {
  // CORS headers — autorise les appels depuis ton domaine
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { steamid } = req.query;

  // Validation du SteamID
  if (!steamid) {
    return res.status(400).json({ error: 'SteamID manquant.' });
  }

  if (!/^\d{17}$/.test(steamid)) {
    return res.status(400).json({
      error: 'SteamID invalide. Il doit contenir exactement 17 chiffres. Ex: 76561198XXXXXXXXX'
    });
  }

  const API_KEY = process.env.STEAM_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: 'Clé API Steam non configurée sur le serveur.' });
  }

  try {
    // Appel 1 : Récupère les stats de jeu CS2 (appID 730)
    const statsUrl = `https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v0002/?appid=730&key=${API_KEY}&steamid=${steamid}`;

    // Appel 2 : Récupère le profil public du joueur
    const profileUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${API_KEY}&steamids=${steamid}`;

    const [statsRes, profileRes] = await Promise.all([
      fetch(statsUrl),
      fetch(profileUrl)
    ]);

    // Gestion des erreurs HTTP
    if (!statsRes.ok) {
      return res.status(statsRes.status).json({
        error: `Erreur Steam API (stats): ${statsRes.status}. Vérifie que ton profil Steam est public.`
      });
    }

    const statsData  = await statsRes.json();
    const profileData = await profileRes.json();

    // Vérifie que les stats existent
    if (!statsData.playerstats || !statsData.playerstats.stats) {
      return res.status(404).json({
        error: 'Aucune stats CS2 trouvée. Assure-toi que ton profil Steam est public et que tu as joué à CS2.'
      });
    }

    // Transforme le tableau de stats en objet clé/valeur pour faciliter l'utilisation
    const rawStats = statsData.playerstats.stats;
    const statsMap = {};
    rawStats.forEach(s => { statsMap[s.name] = s.value; });

    // Profil joueur
    const players = profileData.response?.players || [];
    const player  = players[0] || {};

    // ── Calculs des métriques principales ──────────────────────────────────

    const kills       = statsMap['total_kills']       || 0;
    const deaths      = statsMap['total_deaths']      || 0;
    const wins        = statsMap['total_wins']        || 0;
    const roundsPlayed = statsMap['total_rounds_played'] || 0;
    const hsKills     = statsMap['total_kills_headshot'] || 0;
    const shotsFired  = statsMap['total_shots_fired'] || 0;
    const shotsHit    = statsMap['total_shots_hit']   || 0;
    const mvpCount    = statsMap['total_mvps']        || 0;
    const timePlayed  = statsMap['total_time_played'] || 0;

    const kd          = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
    const hsPercent   = kills > 0  ? ((hsKills / kills) * 100).toFixed(1) : '0.0';
    const accuracy    = shotsFired > 0 ? ((shotsHit / shotsFired) * 100).toFixed(1) : '0.0';
    const winRate     = roundsPlayed > 0 ? ((wins / roundsPlayed) * 100).toFixed(1) : '0.0';
    const hoursPlayed = Math.round(timePlayed / 3600);

    // ── Stats par arme ──────────────────────────────────────────────────────
    // Liste des armes principales CS2
    const weaponKeys = [
      { key: 'ak47',       label: 'AK-47'      },
      { key: 'm4a1',       label: 'M4A1-S'     },
      { key: 'awp',        label: 'AWP'         },
      { key: 'hkp2000',    label: 'P2000'       },
      { key: 'deagle',     label: 'Desert Eagle'},
      { key: 'famas',      label: 'FAMAS'       },
      { key: 'galilar',    label: 'Galil AR'    },
      { key: 'sg556',      label: 'SG 553'      },
      { key: 'aug',        label: 'AUG'         },
      { key: 'ssg08',      label: 'SSG 08'      },
      { key: 'mp9',        label: 'MP9'         },
      { key: 'mac10',      label: 'MAC-10'      },
      { key: 'ump45',      label: 'UMP-45'      },
      { key: 'xm1014',     label: 'XM1014'      },
      { key: 'nova',       label: 'Nova'        },
      { key: 'negev',      label: 'Negev'       },
      { key: 'm249',       label: 'M249'        },
      { key: 'knife',      label: 'Couteau'     },
    ];

    const weapons = weaponKeys
      .map(w => {
        const wKills   = statsMap[`total_kills_${w.key}`]           || 0;
        const wShots   = statsMap[`total_shots_${w.key}`]           || 0;
        const wHits    = statsMap[`total_hits_${w.key}`]            || 0;
        const wHs      = statsMap[`total_kills_headshot_${w.key}`]  || 0;
        const wAcc     = wShots > 0 ? ((wHits / wShots) * 100).toFixed(1) : '0.0';
        const wHsPct   = wKills > 0 ? ((wHs   / wKills) * 100).toFixed(1) : '0.0';
        return { label: w.label, kills: wKills, accuracy: wAcc, hsPct: wHsPct };
      })
      .filter(w => w.kills > 0)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 10);

    // ── Réponse finale ──────────────────────────────────────────────────────
    return res.status(200).json({
      player: {
        steamid,
        name:        player.personaname || 'Joueur inconnu',
        avatar:      player.avatarfull  || null,
        profileUrl:  player.profileurl  || null,
        visibility:  player.communityvisibilitystate || 0,
      },
      stats: {
        kills,
        deaths,
        kd,
        wins,
        roundsPlayed,
        winRate,
        hsKills,
        hsPercent,
        shotsFired,
        shotsHit,
        accuracy,
        mvpCount,
        hoursPlayed,
      },
      weapons,
    });

  } catch (err) {
    console.error('FragValue API error:', err);
    return res.status(500).json({
      error: 'Erreur interne du serveur. Réessaie dans quelques instants.'
    });
  }
}
