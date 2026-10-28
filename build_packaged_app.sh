#!/usr/bin/env bash
# Linux twin of build_packaged_app.bat: build the frontend and the PyInstaller backend,
# then package the Electron app as a .deb and an AppImage in desktop/dist.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$ROOT/.venv/bin/python"

"$ROOT/setup_dev.sh"
"$ROOT/build_frontend.sh" --skip-setup

# Build tools are pinned in requirements-build.txt (PyInstaller).
"$PY" -m pip install -r "$ROOT/backend/requirements-build.txt"

cd "$ROOT/backend"
"$PY" -m PyInstaller cashmoney-backend.spec --noconfirm --clean
# PyInstaller's Django hook would bundle a database next to manage.py (CR-60).
check=0
"$PY" check_bundle.py dist/cashmoney-backend || check=$?
if [ "$check" -eq 1 ]; then
    echo "The backend bundle contains a database file (listed above)." >&2
    exit 1
elif [ "$check" -ne 0 ]; then
    echo "Could not check the backend bundle (see above)." >&2
    exit 1
fi

cd "$ROOT/desktop"
# A clean install from the lockfile, so the package never uses stale or newer modules.
npm ci
npm run dist:linux

echo
echo "Packaged app created in desktop/dist"
