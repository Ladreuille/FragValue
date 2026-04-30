#!/usr/bin/env bash
# scripts/assemble-demo.sh · FragValue
# Concatene les clips .webm produits par record-demo.js en un MP4 final
# pret pour upload (YouTube, X, Discord, landing).
#
# PRE-REQUIS
#   brew install ffmpeg
#
# USAGE
#   ./scripts/assemble-demo.sh                 # concat dans video-assets/fragvalue-demo.mp4
#   ./scripts/assemble-demo.sh portrait        # variante 9:16 (TikTok / Reels)
#
# OPTIONS
#   La voix-off n'est PAS automatique. Apres ce script :
#     1. Importe le MP4 dans CapCut/iMovie/DaVinci
#     2. Ajoute la voix-off (script narration : scripts/video-script.md)
#     3. Ajoute musique de fond + transitions + sous-titres
#     4. Re-export final
#
#   Pour une version SANS post-prod (rapide), le MP4 brut produit ici peut
#   deja etre utilise comme banner muet sur la landing page.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIPS_DIR="$ROOT_DIR/video-assets/clips"
OUT_FILE="$ROOT_DIR/video-assets/fragvalue-demo.mp4"
VARIANT="${1:-landscape}"

# Verifie ffmpeg
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "✗ ffmpeg non installe. Lance : brew install ffmpeg"
  exit 1
fi

# Verifie qu'on a des clips
if [ ! -d "$CLIPS_DIR" ]; then
  echo "✗ Dossier clips introuvable : $CLIPS_DIR"
  echo "  Lance d'abord : node scripts/record-demo.js"
  exit 1
fi

CLIP_COUNT=$(find "$CLIPS_DIR" -maxdepth 1 -name "*.webm" | wc -l | tr -d ' ')
if [ "$CLIP_COUNT" -eq 0 ]; then
  echo "✗ Aucun .webm dans $CLIPS_DIR"
  echo "  Lance d'abord : node scripts/record-demo.js"
  exit 1
fi

echo "🎞  Concatenation de $CLIP_COUNT clips → $OUT_FILE"
echo "📐 Variante : $VARIANT"

# Genere le manifest concat ffmpeg (ordre alphabetique des fichiers .webm)
MANIFEST="$CLIPS_DIR/concat-list.txt"
: > "$MANIFEST"
find "$CLIPS_DIR" -maxdepth 1 -name "*.webm" -print | sort | while read -r f; do
  echo "file '$f'" >> "$MANIFEST"
done

case "$VARIANT" in
  portrait|9:16|tiktok|reels)
    # Recadrage centre 9:16 pour TikTok/Reels
    # 1920x1080 -> 608x1080 (crop centre) -> scale 1080x1920
    echo "⚙  Recadrage portrait (9:16) en cours..."
    ffmpeg -y -hide_banner -loglevel warning \
      -f concat -safe 0 -i "$MANIFEST" \
      -vf "crop=ih*9/16:ih,scale=1080:1920:flags=lanczos" \
      -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.2 \
      -pix_fmt yuv420p -movflags +faststart \
      -an \
      "${OUT_FILE%.mp4}-portrait.mp4"
    echo "✅ Sortie : ${OUT_FILE%.mp4}-portrait.mp4"
    ;;
  square|1:1)
    # Carre 1080x1080 pour Instagram feed
    ffmpeg -y -hide_banner -loglevel warning \
      -f concat -safe 0 -i "$MANIFEST" \
      -vf "crop=ih:ih,scale=1080:1080:flags=lanczos" \
      -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.2 \
      -pix_fmt yuv420p -movflags +faststart \
      -an \
      "${OUT_FILE%.mp4}-square.mp4"
    echo "✅ Sortie : ${OUT_FILE%.mp4}-square.mp4"
    ;;
  landscape|16:9|*)
    # 16:9 1920x1080 standard YouTube/X/Twitter
    ffmpeg -y -hide_banner -loglevel warning \
      -f concat -safe 0 -i "$MANIFEST" \
      -vf "scale=1920:1080:flags=lanczos" \
      -c:v libx264 -preset slow -crf 20 -profile:v high -level 4.2 \
      -pix_fmt yuv420p -movflags +faststart \
      -an \
      "$OUT_FILE"
    echo "✅ Sortie : $OUT_FILE"
    ;;
esac

echo ""
echo "▶  Apercu rapide :"
echo "    open '$OUT_FILE'"
echo ""
echo "🎙  Prochaine etape : ajouter voix-off + musique"
echo "    Storyboard et script narration : scripts/video-script.md"
echo "    Importer dans CapCut/iMovie/DaVinci pour finaliser"
