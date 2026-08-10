#!/bin/bash
# Street-session re-arm — survives reboots. Run from anywhere: bash tools/street/arm.sh
# Brings up: Footnote server (loopback-only, street log sink) + tailnet relay + checks.
set -e
cd "$(dirname "$0")/../.."
pkill -f "node src/server" 2>/dev/null || true; pkill -f "fn-tailnet-relay" 2>/dev/null || true; sleep 1
open -a Tailscale 2>/dev/null; sleep 3
DG=$(grep '^DEEPGRAM_API_KEY' .env.local | cut -d= -f2)
DEEPGRAM_API_KEY="$DG" FOOTNOTE_FIELDTEST_LOG="$PWD/eval/results/fieldtest-2026-08-10-street.jsonl" \
  nohup npm start > /tmp/fn-server.log 2>&1 &
until curl -sf -o /dev/null http://127.0.0.1:3000/control; do sleep 0.5; done
cat > /tmp/fn-tailnet-relay.js <<'RELAY'
const net = require("net");
net.createServer((s) => {
  const c = net.connect(3000, "127.0.0.1");
  s.pipe(c); c.pipe(s);
  s.on("error", () => c.destroy()); c.on("error", () => s.destroy());
}).listen(3000, "100.111.115.120", () => console.log("relay up"));
RELAY
nohup node /tmp/fn-tailnet-relay.js > /tmp/fn-relay.log 2>&1 &
sleep 1
echo "— reachability:"
curl -s -o /dev/null -w "  loopback: %{http_code}\n" http://127.0.0.1:3000/control
curl -s -o /dev/null -w "  tailnet:  %{http_code}\n" http://100.111.115.120:3000/op
curl -s -o /dev/null -w "  LAN:      %{http_code} (000=REFUSED, correct)\n" --connect-timeout 3 http://192.168.1.62:3000/op || true
echo
echo "URLs:  control  http://localhost:3000/control"
echo "       overlay  (copy from control bar — keep localhost, for OBS)"
echo "       /op      http://100.111.115.120:3000/op?room=<room>&key=<key>"
echo "       Moblin   srt://100.111.115.120:9000"
echo "dashboard:  node tools/fieldtest/dashboard.js eval/results/fieldtest-2026-08-10-street.jsonl"
