#!/usr/bin/env bash
# Télécharge les TTF Anton + Space Mono depuis les dépôts Google Fonts (GitHub)
# pour que scripts/og.mjs puisse les utiliser via satori.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)/fonts"
mkdir -p "$DIR"

BASE_ANTON="https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf"
BASE_MONO_REG="https://raw.githubusercontent.com/google/fonts/main/ofl/spacemono/SpaceMono-Regular.ttf"
BASE_MONO_BOLD="https://raw.githubusercontent.com/google/fonts/main/ofl/spacemono/SpaceMono-Bold.ttf"

download() {
  local url="$1" dest="$2"
  if [ -f "$dest" ]; then
    echo "  ✓ $(basename "$dest") (déjà présent)"
    return
  fi
  echo "  ↓ $(basename "$dest")"
  curl -fsSL "$url" -o "$dest"
}

download "$BASE_ANTON"      "$DIR/Anton.ttf"
download "$BASE_MONO_REG"   "$DIR/SpaceMono-Regular.ttf"
download "$BASE_MONO_BOLD"  "$DIR/SpaceMono-Bold.ttf"

echo "Fonts prêtes dans $DIR"
