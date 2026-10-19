#!/bin/bash
# Double-click to start LearnHub on macOS
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "LearnHub needs Node.js 18 or newer. Download it from https://nodejs.org and run this again."
  read -p "Press Enter to close…"
  exit 1
fi
PORT="${PORT:-3000}"
(sleep 1.5; open "http://localhost:$PORT") &
PORT=$PORT node server.js
