#!/usr/bin/env bash
# Linux twin of setup_dev.bat: create .venv, install the backend requirements, and
# install the frontend and desktop npm packages from their lockfiles when missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
DESKTOP="$ROOT/desktop"
PY="$ROOT/.venv/bin/python"

if [ ! -x "$PY" ]; then
    echo "Creating Python virtual environment..."
    if ! python3 -m venv "$ROOT/.venv"; then
        # A failed venv (no ensurepip) leaves a python without pip behind.
        rm -rf "$ROOT/.venv"
        echo "Could not create .venv. On Debian/Ubuntu: sudo apt install python3-venv" >&2
        exit 1
    fi
fi

echo "Installing Python dependencies..."
"$PY" -m pip install -r "$BACKEND/requirements.txt"

NPM="$(command -v npm || true)"
if [ -z "$NPM" ]; then
    echo "npm is not available. Install Node.js 24, then run setup_dev.sh again." >&2
    exit 1
fi
# WSL adds Windows' PATH, so a Windows npm can answer here; it can't build in Linux.
case "$NPM" in
    /mnt/*)
        echo "This npm is the Windows one ($NPM). Install Node.js 24 inside Linux, then run setup_dev.sh again." >&2
        exit 1
        ;;
esac

for dir in "$FRONTEND" "$DESKTOP"; do
    if [ -f "$dir/package.json" ] && [ ! -d "$dir/node_modules" ]; then
        echo "Installing $(basename "$dir") dependencies..."
        (cd "$dir" && npm ci)
    fi
done

echo "Development setup complete."
