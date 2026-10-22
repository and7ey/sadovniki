#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-5173}"
echo "Квартира 3D → http://localhost:${PORT}"
python3 -m http.server "$PORT"
