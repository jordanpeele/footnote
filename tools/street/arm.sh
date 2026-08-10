#!/bin/bash
# Street-session re-arm — survives reboots. Run from anywhere: bash tools/street/arm.sh
# Brings up: Footnote server (loopback-only, street log sink) + tailnet relay + checks.
set -e
cd "$(dirname "$0")/../.."
pkill -f "node src/server" 2>/dev/null || true; pkill -f "fn-tailnet-relay" 2>/dev/null || true; pkill -f "srtla_rec" 2>/dev/null || true; sleep 1
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
# P7-D (R45): SRTLA bonded uplink — Moblin sends srtla:// over MULTIPLE network
# paths (cell + hotspot); srtla_rec reassembles and hands plain SRT to the
# existing OBS listener on 127.0.0.1:9000. Single-path srt://:9000 still works
# as fallback if srtla_rec is missing/down.
# NOTE: srtla_rec can only bind UDP wildcard (*:5000 — upstream hardcodes
# INADDR_ANY, no bind-addr option). The exposure is UDP-level only; set the SAME
# SRT passphrase in the OBS listener AND Moblin so the stream itself is
# authenticated + encrypted end-to-end (srtla relays SRT payloads untouched,
# so the passphrase survives the bonding hop).
SRTLA_REC="$HOME/Code/vendor/srtla/srtla_rec"
if [ -x "$SRTLA_REC" ]; then
  nohup "$SRTLA_REC" 5000 127.0.0.1 9000 > /tmp/fn-srtla-rec.log 2>&1 &
  sleep 1
  if pgrep -qf "srtla_rec 5000"; then
    echo "srtla_rec: UP — UDP *:5000 -> SRT 127.0.0.1:9000 (log /tmp/fn-srtla-rec.log)"
    echo "           Moblin bonded URL: srtla://100.111.115.120:5000"
  else
    echo "srtla_rec: FAILED to start (see /tmp/fn-srtla-rec.log) — use single-path srt://100.111.115.120:9000"
  fi
else
  echo "srtla_rec: not built — run: bash tools/street/build-srtla.sh (single-path srt:// until then)"
fi
# FS-2: keep the DISPLAY awake — a locked screen throttles the OBS browser source's
# render loop and aired cards miss their on-air window on the broadcast.
nohup caffeinate -d -u > /dev/null 2>&1 &
echo "caffeinate: display sleep disabled for street ops (kill at close-out)"
sleep 1
echo "— reachability:"
curl -s -o /dev/null -w "  loopback: %{http_code}\n" http://127.0.0.1:3000/control
curl -s -o /dev/null -w "  tailnet:  %{http_code}\n" http://100.111.115.120:3000/op
curl -s -o /dev/null -w "  LAN:      %{http_code} (000=REFUSED, correct)\n" --connect-timeout 3 http://192.168.1.62:3000/op || true
echo
echo "URLs:  control  http://localhost:3000/control"
echo "       overlay  (copy from control bar — keep localhost, for OBS)"
echo "       /op      http://100.111.115.120:3000/op?room=<room>&key=<key>"
echo "       Moblin   srtla://100.111.115.120:5000  (bonded — preferred)"
echo "                srt://100.111.115.120:9000     (single-path fallback)"
echo "pre-flight: docs/STREET_CHECKLIST.md"
echo "dashboard:  node tools/fieldtest/dashboard.js eval/results/fieldtest-2026-08-10-street.jsonl"
