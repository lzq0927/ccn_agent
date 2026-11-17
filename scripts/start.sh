#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python ]]; then
  echo "Please run: python3 -m venv .venv && .venv/bin/pip install -r requirements.lock.txt" >&2
  exit 1
fi
if [[ ! -f frontend/dist/index.html ]]; then
  echo "Please run: cd frontend && npm ci && npm run build" >&2
  exit 1
fi
exec .venv/bin/uvicorn backend.app.main:app --host "${CHR_HOST:-127.0.0.1}" --port "${CHR_PORT:-8010}"
