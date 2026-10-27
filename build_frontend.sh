#!/usr/bin/env bash
# Linux twin of build_frontend.bat: build the React bundle into
# backend/finance/static/finance/react/. With --skip-setup, setup_dev.sh doesn't run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$ROOT/frontend"

if [ "${1:-}" != "--skip-setup" ]; then
    "$ROOT/setup_dev.sh"
fi

if ! command -v npm > /dev/null; then
    echo "npm is not available. Run setup_dev.sh first." >&2
    exit 1
fi

cd "$FRONTEND"
if [ ! -d node_modules ]; then
    npm ci
fi
npm run build
