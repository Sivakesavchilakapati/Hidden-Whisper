#!/usr/bin/env bash
set -euo pipefail

echo "Checking local health endpoint..."
curl -fsS http://127.0.0.1:3000/api/health

echo
echo "Checking Tor SOCKS port..."
if command -v nc >/dev/null 2>&1; then
  nc -z 127.0.0.1 9050
else
  timeout 2 bash -c '</dev/tcp/127.0.0.1/9050'
fi

echo "Tests passed."
