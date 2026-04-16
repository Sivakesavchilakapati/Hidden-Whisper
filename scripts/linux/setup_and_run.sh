#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[Hidden Whisper] Linux setup starting..."

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash scripts/linux/setup_and_run.sh"
  exit 1
fi

apt-get update
apt-get install -y curl ca-certificates gnupg tor inspircd nodejs npm

read -r -p "Enter IRC onion host (example: abc...xyz.onion): " ONION
if [[ -z "${ONION}" ]]; then
  echo "Onion host is required."
  exit 1
fi

ONION="$(echo "$ONION" | tr '[:upper:]' '[:lower:]' | xargs)"
if [[ ! "$ONION" =~ ^[a-z2-7]{56}\.onion$ ]] && [[ ! "$ONION" =~ ^[a-z2-7][a-z2-7.-]*\.onion$ ]]; then
  echo "Onion host is invalid: $ONION"
  exit 1
fi

cat > "$ROOT_DIR/.env" <<EOF
HOST=0.0.0.0
PORT=3000
WS_PATH=/ws
TOR_ENABLED=true
TOR_SOCKS_HOST=127.0.0.1
TOR_SOCKS_PORT=9050
IRC_HOST=${ONION}
IRC_PORT=6667
IRC_TLS=false
IRC_TLS_REJECT_UNAUTHORIZED=true
APP_ACCESS_TOKEN=
ALLOW_CLIENT_IRC_SETTINGS=true
MAX_TEXT_LEN=900
MAX_NICK_LEN=24
EOF

systemctl enable tor || true
systemctl start tor || true

echo "Checking Tor SOCKS on 127.0.0.1:9050 ..."
ok=0
for i in {1..15}; do
  if command -v nc >/dev/null 2>&1; then
    if nc -z 127.0.0.1 9050 >/dev/null 2>&1; then
      ok=1
      break
    fi
  else
    if timeout 2 bash -c '</dev/tcp/127.0.0.1/9050' >/dev/null 2>&1; then
      ok=1
      break
    fi
  fi
  sleep 1
done

if [[ "$ok" -ne 1 ]]; then
  echo "Tor SOCKS is not reachable on 127.0.0.1:9050"
  systemctl status tor --no-pager || true
  journalctl -u tor --no-pager -n 50 || true
  exit 1
fi

npm install
npm run build
npm run start
