#!/usr/bin/env bash
# Linux twin of run_app.bat: set up, migrate, build the frontend, start the Django
# development server on 127.0.0.1:8000 and open the Electron shell (or the browser).
# Arguments go to Electron, e.g. ./run_app.sh --remote-debugging-port=9333
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
PY="$ROOT/.venv/bin/python"
APP_URL="http://127.0.0.1:8000/"
ELECTRON="$ROOT/desktop/node_modules/.bin/electron"

"$ROOT/setup_dev.sh"

# Stop an old dev server so stale assets or code can't keep serving port 8000.
pkill -u "$(id -u)" -f "manage.py runserver 127.0.0.1:8000" || true

"$PY" "$BACKEND/manage.py" migrate

if [ -f "$ROOT/frontend/package.json" ]; then
    "$ROOT/build_frontend.sh" --skip-setup
fi

nohup "$PY" "$BACKEND/manage.py" runserver 127.0.0.1:8000 --noreload > "$BACKEND/runserver.log" 2>&1 &

server_up=0
for _ in $(seq 1 40); do
    if (exec 3<> /dev/tcp/127.0.0.1/8000) 2> /dev/null; then
        server_up=1
        break
    fi
    sleep 0.5
done
if [ "$server_up" -eq 0 ]; then
    echo "The dev server didn't answer within 20 s; see backend/runserver.log." >&2
fi
echo "The dev server keeps running after the app closes (log: backend/runserver.log)."
echo "Stop it with: pkill -f 'manage.py runserver 127.0.0.1:8000'"

# Electron's sandbox needs unprivileged user namespaces, which stock Ubuntu 24.04+
# blocks for apps without an AppArmor profile. The app never runs with --no-sandbox,
# so in that case it opens in the browser instead.
if [ -x "$ELECTRON" ] && unshare -Ur true 2> /dev/null; then
    nohup "$ELECTRON" "$ROOT/desktop" "$@" > "$ROOT/desktop/electron.log" 2>&1 &
    echo "Electron's output goes to desktop/electron.log."
else
    if [ -x "$ELECTRON" ]; then
        echo "Electron can't start its sandbox here (user namespaces are blocked), so the app opens in the browser."
    fi
    if command -v xdg-open > /dev/null; then
        xdg-open "$APP_URL" > /dev/null 2>&1 &
    else
        echo "Open $APP_URL in a browser."
    fi
fi
