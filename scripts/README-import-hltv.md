# Import HLTV en CLI — FragValue

Outil pour ingérer des matchs pro depuis HLTV en une commande.

## Ce qui marche / ce qui ne marche pas

| Donnée | Auto-fetch script | Source |
|--------|-------------------|--------|
| Teams, scores série | ✓ | HLTV match page |
| Maps jouées + scores | ✓ | HLTV match page |
| Event, format, date | ✓ | HLTV match page |
| MVP, picks (vetoes) | ✓ | HLTV match page |
| **Scorecards par joueur** | ✗ | HLTV stats pages bloquées par Cloudflare Turnstile |

**Conclusion** : le script récupère ~80% du match (toutes les méta visibles dans la liste). Pour les **scorecards détaillés** (K/D/A/ADR/KAST/Rating par joueur), il faut compléter via l'admin UI (~5 min/map).

Si tu as besoin d'auto-fetch 100% des scorecards (pour scaler sans saisie manuelle), passe à **ScrapingBee Premium** ($49/mo) — wire en 10 min, je peux le faire quand tu veux.

## Setup (une seule fois)

### 1. Récupère ta Supabase service key

Sur Vercel → **Project** `frag-value` → **Settings** → **Environment Variables** → cherche `SUPABASE_SERVICE_KEY` → clique "Show" → copie la valeur (commence par `eyJ...`).

### 2. Crée `.env.local` à la racine du projet

```bash
cd ~/Documents/Fragvalue/GitHub/GitHub/FragValue
cat > .env.local <<'EOF'
SUPABASE_URL=https://xmyruycvvkmcwysfygcq.supabase.co
SUPABASE_SERVICE_KEY=<colle-la-cle-ici>
EOF
```

`.env.local` est dans `.gitignore`, ne sera jamais commit.

### 3. Install les deps (si pas déjà fait)

```bash
npm install
```

## Usage

### Un seul match

```bash
# Par ID HLTV
npm run import:hltv -- 2393243

# Par URL HLTV (colle directement)
npm run import:hltv -- "https://www.hltv.org/matches/2393243/furia-vs-vitality-iem-rio-2026"
```

### Plusieurs matchs d'un coup

```bash
npm run import:hltv -- 2393243 2393244 2393245
```

Le script attend 2s entre chaque match pour rester poli avec HLTV.

## Workflow recommandé

**Pour chaque match pro qui t'intéresse** :

1. Ingère la méta via le script :
   ```bash
   npm run import:hltv -- <url-ou-id>
   ```
   ~5s par match. Tu vois immédiatement le match dans `/pro-demos.html` avec teams/scores/MVP/maps.

2. Si tu veux les scorecards détaillés (visibles sur la page détail du match) :
   - Va sur [https://fragvalue.com/admin/pro-matches.html](https://fragvalue.com/admin/pro-matches.html)
   - Clique **"Scorecards"** sur la ligne du match fraîchement importé
   - Pour chaque map, ouvre la page stats HLTV correspondante en parallèle
   - Saisis les 5 joueurs par équipe (paste TSV row supporté : tu colles 1 ligne du HLTV scoreboard et ça fill les 7 fields automatiquement)
   - ~5 min par map en moyenne

**Exemple weekend Major** :
- Vendredi/samedi : tu lances `npm run import:hltv -- <url1> <url2> ... <url10>` pour tous les matchs S-tier
- Score final : 10 matchs en DB en 1 minute
- Tu choisis les 3-4 matchs "stars" pour compléter les scorecards (15-20 min)
- Les 6-7 autres restent meta-only (suffisant pour un listing)

## Quand est-ce que tu devrais payer pour ScrapingBee ?

- Tu as 10+ abonnés Pro qui consultent régulièrement les pro demos
- Tu ingères 30+ matchs/semaine et la saisie manuelle devient un goulot
- Tu lances un partenariat avec un tournament organizer qui veut auto-ingestion

Avant ça, garde le free workflow.

## Troubleshooting

### `Access denied | Cloudflare used to restrict access`

Si même `getMatch` échoue, essaie :
- VPN (changer d'IP)
- Attendre 10-30 min (rate limit temporaire)

### `SUPABASE_SERVICE_KEY manquant`

`.env.local` n'existe pas, ou la variable n'y est pas. Vérifie le path et la syntaxe.

### Le match est déjà ingéré

Pas de souci : le script supprime l'ancienne version avant de ré-importer. Utile pour corriger un match avec des stats incomplètes.
