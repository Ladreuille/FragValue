# Import HLTV en CLI — FragValue

Outil pour ingérer des matchs pro depuis HLTV en une commande.
Tourne en local (sur ton Mac, pas sur Vercel) parce que HLTV bloque les IPs datacenter via Cloudflare. Les IPs résidentielles passent.

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

Ce fichier est déjà dans `.gitignore`, il ne sera pas commit.

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

## Ce qui est ingéré

Par match, le script fetch :
- Méta : teams, scores, event, date, format, MVP, picks/vetoes
- Par map : score, pick, durée, **10 joueurs avec K/D/A/ADR/KAST/Rating 2.1**

~**5-10 secondes par match** total. Un BO5 avec 5 maps = ~10s.

Si un match était déjà en DB (par ID HLTV), il est supprimé et ré-importé proprement.

## Troubleshooting

### `Access denied | Cloudflare used to restrict access`

HLTV bloque ton IP. Essaie :
- VPN (ExpressVPN, Mullvad, etc.) pour changer d'IP
- Attendre 10-30 min (rate limit temporaire)
- Dernier recours : [ScrapingBee](https://www.scrapingbee.com/) en backend (à $29/mois, on peut wire ça plus tard)

### `SUPABASE_SERVICE_KEY manquant`

Vérifie que `.env.local` existe à la racine du projet et contient la clé. Ou exporte à la volée :

```bash
export SUPABASE_SERVICE_KEY="eyJ..."
npm run import:hltv -- 2393243
```

### Le match est déjà ingéré

Pas de souci : le script supprime l'ancienne version avant de ré-importer. Utile pour corriger un match avec des stats incomplètes.

## Workflow recommandé

1. Tu vois un match intéressant terminé sur HLTV (Major, Blast, ESL...)
2. Copie l'URL depuis ton navigateur
3. Ouvre un terminal, `npm run import:hltv -- <url>`
4. 10s plus tard il est dispo sur `/pro-demos.html` avec scorecards complets

Pour du batch weekend (tous les matchs du weekend d'un tournoi) : copie toutes les URLs et passe-les en args, le script les traite à la chaîne.
