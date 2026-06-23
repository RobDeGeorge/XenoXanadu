#!/usr/bin/env bash
# Risk online — one command to play with friends over the internet, for free.
#
# Starts the match-server locally and opens a Cloudflare "quick tunnel" in front
# of it, then prints the wss:// URL to share. No account, no credit card. The URL
# is fresh each run; share it + your room code with friends. Ctrl-C stops both.
#
#   cd public/game/risk/net && ./play-online.sh
#
# Requires: node (18+) and cloudflared.
#   cloudflared:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
#   Arch:  yay -S cloudflared    (or grab the static binary from the link above)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8790}"
# Friends load the page from the hosted site, so their browser's Origin is
# xenoxanadu.com — it must be on the server's allowlist. (localhost is always
# allowed, so playing on a locally-served copy needs nothing extra.) Override
# ORIGINS if you host the page somewhere else.
export ORIGINS="${ORIGINS:-https://xenoxanadu.com}"

if ! command -v node >/dev/null 2>&1; then echo "✗ node not found — install Node 18+." >&2; exit 1; fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "✗ cloudflared not found." >&2
  echo "  Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  echo "  (Arch: 'yay -S cloudflared'.)" >&2
  exit 1
fi

echo "▶ starting match-server on ws://localhost:$PORT …"
PORT="$PORT" node server.js &
SERVER_PID=$!

# Cloudflare requires an allowlisted Origin; the hosted site's origin is xenoxanadu.com.
# localhost is always allowed by the server, so the host can also just use ws://localhost.
cleanup() { echo; echo "▶ stopping…"; kill "$SERVER_PID" "${TUNNEL_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

sleep 1
echo "▶ opening Cloudflare tunnel …"
# stream cloudflared output to a temp file so we can fish out the public URL
TMP="$(mktemp)"
cloudflared tunnel --url "http://localhost:$PORT" >"$TMP" 2>&1 &
TUNNEL_PID=$!

# wait for the trycloudflare URL to appear, then print the wss:// form
URL=""
for _ in $(seq 1 30); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TMP" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done

echo
if [ -n "$URL" ]; then
  WSS="${URL/https:/wss:}"
  echo "════════════════════════════════════════════════════════════════"
  echo "  ✅ Share this with your friends:"
  echo
  echo "     Site:    https://xenoxanadu.com/game/risk/"
  echo "     Server:  $WSS"
  echo "     Room:    (the 4-letter code you get after Create Room)"
  echo
  echo "  Everyone (including you) pastes the Server address into the"
  echo "  \"Play Online\" box, then Create / Join with the room code."
  echo "  Keep this window open while you play. Ctrl-C to stop."
  echo "════════════════════════════════════════════════════════════════"
else
  echo "⚠ couldn't detect the tunnel URL automatically — see the cloudflared output below:"
  cat "$TMP"
fi
echo
# keep running, surfacing live tunnel logs
tail -f "$TMP"
