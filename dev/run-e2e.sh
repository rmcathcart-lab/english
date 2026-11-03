#!/usr/bin/env bash
# Starts a fresh dev server (clean demo data), runs a browser walk-through, then stops the server.
# Usage: dev/run-e2e.sh [e2e-script] [shots-dir] [port]
set -u
cd "$(dirname "$0")/.."
SCRIPT="${1:-dev/e2e-v2.js}"
SHOTS="${2:-/tmp/claude-0/shots}"
PORT="${3:-8091}"
node dev/server.js "$PORT" > "/tmp/claude-0/devserver-$PORT.log" 2>&1 &
PID=$!
for i in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.2; done
node "$SCRIPT" "http://localhost:$PORT/" "$SHOTS"
CODE=$?
kill "$PID" 2>/dev/null
exit $CODE
