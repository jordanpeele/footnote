#!/bin/bash
# SRTLA loopback drill — proves the bonded-receiver chain WITHOUT phones.
# P7-D (R45). Run from anywhere: bash tools/street/srtla-drill.sh
#
# Chain under test (all local):
#   feeder (srt-live-transmit, random bytes)
#     -> srtla_send  :6100  (bonds TWO local paths: 127.0.0.1 + the en0 LAN IP)
#     -> srtla_rec   :5100  (reassembles)
#     -> mock SRT listener :9100  (same shape as the real OBS listener on :9000)
#
# What this drill PROVES:
#   - srtla_rec runs on this Mac and accepts srtla connections
#   - two distinct-source-IP legs register into one connection group (bonding
#     handshake) and the reassembled stream lands at a plain SRT listener
#   - the rec -> OBS-listener handoff leg (mock stands in for OBS)
# What it does NOT prove:
#   - real multi-network bonding (cell + hotspot are different physical paths;
#     loopback + LAN-IP are two sockets on one machine) — that needs the phones
#   - Moblin's srtla sender (we use srtla_send here; on the street the PHONE
#     is the sender — the macOS-patched srtla_send is drill-only)
#
# Deliberately avoids live street ports: OBS listens on *:9000 and street
# srtla_rec uses :5000; the drill uses 5100/9100/6100.
set -u
cd "$(dirname "$0")/../.."

SRTLA_DIR="$HOME/Code/vendor/srtla"
REC_PORT=5100
MOCK_SRT_PORT=9100
SEND_PORT=6100
RUN_SECS=12
TMP=/tmp/srtla-drill
OUT="$TMP/received.bin"

if [ ! -x "$SRTLA_DIR/srtla_rec" ] || [ ! -x "$SRTLA_DIR/srtla_send" ]; then
  echo "FAIL: srtla binaries missing — run: bash tools/street/build-srtla.sh"
  exit 1
fi
command -v srt-live-transmit >/dev/null || { echo "FAIL: srt-live-transmit missing — brew install srt"; exit 1; }

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || true)
if [ -z "$LAN_IP" ]; then
  echo "WARN: no en0 IP — drill will run single-path (loopback only)"
fi

rm -rf "$TMP"; mkdir -p "$TMP"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; }
trap cleanup EXIT

echo "— drill: mock SRT listener :$MOCK_SRT_PORT  srtla_rec :$REC_PORT  srtla_send :$SEND_PORT"

# 1) mock OBS: plain SRT listener, dumps payload to a file
srt-live-transmit "srt://127.0.0.1:$MOCK_SRT_PORT?mode=listener&lossmaxttl=40&latency=2000" "file://con" \
  > "$OUT" 2> "$TMP/mock.log" &
PIDS+=($!)
sleep 1

# 2) srtla receiver -> mock listener (street shape: srtla_rec 5000 127.0.0.1 9000)
"$SRTLA_DIR/srtla_rec" "$REC_PORT" 127.0.0.1 "$MOCK_SRT_PORT" > "$TMP/rec.log" 2>&1 &
PIDS+=($!)
sleep 1

# 3) srtla sender bonding two local source IPs
printf '127.0.0.1\n' > "$TMP/ips"
[ -n "$LAN_IP" ] && printf '%s\n' "$LAN_IP" >> "$TMP/ips"
"$SRTLA_DIR/srtla_send" "$SEND_PORT" 127.0.0.1 "$REC_PORT" "$TMP/ips" > "$TMP/send.log" 2>&1 &
PIDS+=($!)
sleep 1

# 4) feeder: ~200 KB/s of random bytes through srtla_send's local SRT port
(
  end=$((SECONDS + RUN_SECS))
  while [ $SECONDS -lt $end ]; do dd if=/dev/urandom bs=1316 count=8 2>/dev/null; sleep 0.05; done
) | srt-live-transmit "file://con" "srt://127.0.0.1:$SEND_PORT" > "$TMP/feed.log" 2>&1 &
PIDS+=($!)

echo "— streaming for ${RUN_SECS}s..."
sleep $((RUN_SECS + 3))
cleanup; trap - EXIT

BYTES=$(stat -f %z "$OUT" 2>/dev/null || echo 0)
# success line: "IP:port (group 0x...): connection registration" — the earlier
# "for group 0x0 failed" lines are the normal 2-phase reg first attempt, skip them
LEGS=$(grep -E "\(group 0x[0-9a-f]+\): connection registration" "$TMP/rec.log" \
  | sed -E 's/^([0-9.]+):[0-9]+ .*/\1/' | sort -u)
NLEGS=$(echo "$LEGS" | grep -c . || true)

echo
echo "— results:"
echo "  bytes delivered to mock SRT listener: $BYTES"
echo "  srtla legs registered at srtla_rec:   $NLEGS"
echo "$LEGS" | sed 's/^/    leg: /'
echo "  logs: $TMP/{rec,send,mock,feed}.log"
echo

PASS=1
[ "$BYTES" -gt 100000 ] || { echo "FAIL: too few bytes arrived (rec->listener handoff not proven)"; PASS=0; }
if [ "$NLEGS" -ge 2 ]; then
  echo "PASS: two-leg srtla bond reassembled to plain SRT (loopback + $LAN_IP)"
elif [ "$NLEGS" -eq 1 ] && [ "$PASS" -eq 1 ]; then
  echo "PARTIAL: single leg only — rec->listener handoff proven; bonding handshake"
  echo "         multi-leg NOT proven (check $TMP/send.log for the failed leg)"
  PASS=0
fi
[ "$PASS" -eq 1 ] || exit 1
