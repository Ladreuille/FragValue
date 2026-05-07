#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "[session-start] sync repo with origin"

if ! git fetch --quiet origin 2>/dev/null; then
  echo "[session-start] git fetch failed (network or auth) — skipping pull"
  exit 0
fi

BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
if [ -z "$BRANCH" ]; then
  echo "[session-start] detached HEAD, skipping pull"
  exit 0
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[session-start] working tree dirty on '$BRANCH', skipping pull"
  exit 0
fi

if ! git rev-parse --quiet --verify "@{u}" >/dev/null 2>&1; then
  echo "[session-start] branch '$BRANCH' has no upstream, skipping pull"
  exit 0
fi

if git pull --ff-only --quiet 2>/dev/null; then
  echo "[session-start] '$BRANCH' fast-forwarded to origin/$BRANCH"
else
  echo "[session-start] cannot fast-forward '$BRANCH' (diverged), skipping"
fi

if [ -f package-lock.json ] && [ -f package.json ]; then
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
    echo "[session-start] installing npm dependencies"
    npm install --no-audit --no-fund --silent || echo "[session-start] npm install failed (non-fatal)"
  fi
fi

echo "[session-start] done"
