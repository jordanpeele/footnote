#!/bin/bash
# Street-session re-arm — survives reboots. Run from anywhere: bash tools/street/arm.sh
# Brings up: Footnote server (loopback-only, street log sink) + srtla_rec + checks.
#
# Phone /op access is `tailscale serve` (HTTPS proxy to loopback:3000 — the documented
# path). The old /tmp/fn-tailnet-relay.js is GONE: its quoted heredoc expanded
# "${TAILNET_IP}" to a literal string, so the relay listened on a garbage host and had
# been dead weight since tailscale-serve replaced it (packet 5de).
#
# Usage: arm.sh [--verifier <name>] [--log-name <slug>] [--check]
#   --verifier <name>  FOOTNOTE_VERIFIER override for THIS arm only. D19 posture rule:
#                      the DEFAULT lives in .env.local (FOOTNOTE_VERIFIER=…) / the registry,
#                      exactly like `npm start` — a session must not change posture by how
#                      the server was launched. (pre-D19 this script defaulted to
#                      run-era arming default; see src/core/registry.js for the roster)
#   --log-name <slug>  slug for the dated field-test log:
#                      eval/results/fieldtest-YYYY-MM-DD[-<slug>].jsonl
#   --check            dry-run: print what arming would do and run read-only probes only.
#                      Nothing is killed or started (a real arm pkills the operator's
#                      live server/srtla processes — never do that to "test" the script).
set -e
cd "$(dirname "$0")/../.."

VERIFIER=""; LOG_SLUG=""; CHECK=0   # D19: empty = defer to .env.local/registry (same as npm start)
while [ $# -gt 0 ]; do
  case "$1" in
    --verifier) VERIFIER="${2:?--verifier needs a value}"; shift 2 ;;
    --log-name) LOG_SLUG="${2:?--log-name needs a value}"; shift 2 ;;
    --check)    CHECK=1; shift ;;
    *) echo "unknown arg: $1"; echo "usage: arm.sh [--verifier <name>] [--log-name <slug>] [--check]"; exit 1 ;;
  esac
done
case "$LOG_SLUG" in (*[!a-zA-Z0-9_-]*) echo "error: --log-name must be [a-zA-Z0-9_-] (it becomes a filename)"; exit 1;; esac
FT_LOG="$PWD/eval/results/fieldtest-$(date +%F)${LOG_SLUG:+-$LOG_SLUG}.jsonl"

TS_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
if [ "$CHECK" = 0 ]; then
  pkill -f "node src/server" 2>/dev/null || true
  pkill -f "fn-tailnet-relay" 2>/dev/null || true   # reap the legacy relay from pre-5de arms
  pkill -f "srtla_rec" 2>/dev/null || true
  sleep 1
  open -a Tailscale 2>/dev/null; sleep 3
fi
TAILNET_IP=$("$TS_BIN" ip -4 2>/dev/null | head -1)
if [ -z "$TAILNET_IP" ]; then echo "note: no tailnet address (Tailscale off?) — phone paths unavailable"; TAILNET_IP="127.0.0.1"; fi
TS_HOST=$("$TS_BIN" status --json 2>/dev/null | node -e 'try{const s=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(((s.Self&&s.Self.DNSName)||"").replace(/\.$/,""))}catch{}' 2>/dev/null || true)
SERVE_ON=0
"$TS_BIN" serve status 2>/dev/null | grep -q ':3000' && SERVE_ON=1

DG=$(grep '^DEEPGRAM_API_KEY' .env.local 2>/dev/null | cut -d= -f2 || true)

if [ "$CHECK" = 1 ]; then
  echo "— check mode (nothing killed, nothing started) — a real arm would:"
  echo "  1. pkill: node src/server, fn-tailnet-relay (legacy reap), srtla_rec"
  echo "  2. start server: FOOTNOTE_VERIFIER=${VERIFIER:-<from .env.local/registry — same as npm start>}"
  echo "     FOOTNOTE_FIELDTEST_LOG=$FT_LOG"
  if [ -f "$FT_LOG" ]; then echo "     (log exists — a re-arm today APPENDS to it; archive first if that's not intended)"; fi
  echo "  3. start srtla_rec (UDP *:5000 -> SRT 127.0.0.1:9000) + caffeinate -d -u"
  echo "— probes:"
  if [ -n "$DG" ]; then echo "  deepgram key:  present in .env.local"; else echo "  deepgram key:  ⚠ MISSING from .env.local — transcription will fail"; fi
  RUNNING=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://127.0.0.1:3000/control || true)
  if [ "$RUNNING" = 200 ]; then echo "  server:        already running on :3000 (a real arm restarts it)"; else echo "  server:        not running (a real arm starts it)"; fi
  echo "  tailnet IP:    ${TAILNET_IP}"
  if [ "$SERVE_ON" = 1 ] && [ -n "$TS_HOST" ]; then
    SERVE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "https://${TS_HOST}/op" || true)
    echo "  tailscale serve: ON — https://${TS_HOST}/op -> $SERVE_CODE"
  else
    echo "  tailscale serve: ⚠ OFF — phone /op path needs: tailscale serve --bg 3000"
  fi
  SRTLA_REC="$HOME/Code/vendor/srtla/srtla_rec"
  if [ -x "$SRTLA_REC" ]; then echo "  srtla_rec:     built ($SRTLA_REC)"; else echo "  srtla_rec:     not built — run: bash tools/street/build-srtla.sh"; fi
  RELAY_HEALTH=$(curl -s -m 5 http://54.203.255.224:8080/ 2>/dev/null || true)
  if echo "$RELAY_HEALTH" | grep -q '"srtla_rec":"active"'; then echo "  relay:         UP — $RELAY_HEALTH"
  else echo "  relay:         ⚠ NOT ANSWERING (http://54.203.255.224:8080/) — bonded path unavailable"; fi
  echo "  kill-switch:   NOT auto-cycled (protocol step) — cycle it yourself pre-departure:"
  echo "                 status -> kill -> verify 503 -> restore (docs/WALK_TEST_PROTOCOL.md)"
  exit 0
fi

DEEPGRAM_API_KEY="$DG" ${VERIFIER:+FOOTNOTE_VERIFIER="$VERIFIER"} FOOTNOTE_FIELDTEST_LOG="$FT_LOG" \
  nohup npm start > /tmp/fn-server.log 2>&1 &
until curl -sf -o /dev/null http://127.0.0.1:3000/control; do sleep 0.5; done
echo "server:   UP — verifier=${VERIFIER:-config-default}  fieldtest log=$FT_LOG"
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
    echo "           Moblin bonded URL: srtla://${TAILNET_IP}:5000"
  else
    echo "srtla_rec: FAILED to start (see /tmp/fn-srtla-rec.log) — use single-path srt://${TAILNET_IP}:9000"
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
if [ "$SERVE_ON" = 1 ] && [ -n "$TS_HOST" ]; then
  curl -s -o /dev/null -w "  tailnet:  %{http_code} (tailscale serve)\n" -m 5 "https://${TS_HOST}/op" || echo "  tailnet:  FAILED (tailscale serve configured but not answering)"
else
  echo "  tailnet:  ⚠ tailscale serve OFF — phone /op path down; run: tailscale serve --bg 3000"
fi
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || echo 192.168.0.1)
curl -s -o /dev/null -w "  LAN:      %{http_code} (000=REFUSED, correct)\n" --connect-timeout 3 "http://$LAN_IP:3000/op" || true
echo
echo "URLs:  control  http://localhost:3000/control"
echo "       overlay  (copy from control bar — keep localhost, for OBS)"
if [ -n "$TS_HOST" ]; then
  echo "       /op      https://${TS_HOST}/op?room=<room>&key=<key>  (use the control bar's Copy tailnet URL — never hand-type the key)"
else
  echo "       /op      (no tailnet hostname — Tailscale off?)"
fi
echo "       Moblin   srtla://${TAILNET_IP}:5000  (bonded — preferred)"
echo "                srt://${TAILNET_IP}:9000     (single-path fallback)"
# W2: relay health (walk-test pre-flight) — the media front door must answer before anyone leaves the house
RELAY_HEALTH=$(curl -s -m 5 http://54.203.255.224:8080/ 2>/dev/null || true)
if echo "$RELAY_HEALTH" | grep -q '"srtla_rec":"active"'; then echo "relay:    UP — $RELAY_HEALTH"
else echo "relay:    ⚠ NOT ANSWERING (http://54.203.255.224:8080/) — bonded path unavailable; indoor srt:// fallback only"; fi
echo "kill-switch: NOT auto-cycled (it's a protocol step, not an arm step) — cycle it yourself"
echo "             pre-departure: status -> kill -> verify 503 -> restore (docs/WALK_TEST_PROTOCOL.md)"
echo "pre-flight: docs/STREET_CHECKLIST.md"
echo "dashboard:  node tools/fieldtest/dashboard.js $FT_LOG"
