#!/usr/bin/env bash
# Launch the Oura Local app with uvicorn.
set -euo pipefail
cd "$(dirname "$0")"

if [ -d .venv ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

HOST="${HOST:-localhost}"
PORT="${PORT:-8000}"
exec uvicorn app.main:app --host "$HOST" --port "$PORT" "$@"
