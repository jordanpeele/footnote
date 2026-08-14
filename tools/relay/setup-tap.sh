#!/bin/bash
# Phase-2 keystone (DAYSPRINT 2a) — relay-side ffmpeg AUDIO TAP, shipped DARK.
#
# Installs the "tap mode" unit set on the existing relay box, DISABLED BY DEFAULT.
# Nothing changes for current sessions: srt-out keeps serving home OBS exactly as
# provisioned by setup-relay.sh until an operator deliberately swaps modes.
#
#   scp tools/relay/setup-tap.sh <vm>:  &&  ssh <vm> 'sudo SRT_PASSPHRASE=... bash setup-tap.sh'
#
# WHY A TEE (measured, 2026-08-14): srt-live-transmit's :4001 listener serves exactly
# ONE caller — a second caller completes the SRT handshake but receives 0 bytes while
# the first is connected (control: the same solo caller pulled 824 KB in 10 s). So the
# tap cannot ride :4001 as a second caller; tap mode terminates SRT once and tees the
# MPEG-TS locally. See docs/PHASE2_AUDIO_TAP_SPIKE.md for the experiment record.
#
# Tap-mode topology (all on-box, loopback):
#   srtla_rec :5000 ──srt──> srt-tee (ffmpeg, listener :4000, -c copy)
#                              ├─ mpegts udp://127.0.0.1:4002 ─> srt-out-tap
#                              │      (srt-live-transmit, listener :4001, passphrase —
#                              │       IDENTICAL contract for the home OBS caller)
#                              └─ mpegts udp://127.0.0.1:4003 ─> audio-tap (ffmpeg)
#                                     ├─ 60s pcm16 mono 16k WAV segments
#                                     │      /var/lib/footnote-tap/tap-*.wav
#                                     └─ s16le udp://127.0.0.1:9877 (20 ms/640 B
#                                            datagrams — the future Deepgram-bridge
#                                            stub; see docs/PHASE2_DESIGN.md)
#
# Mode swap (operator-invoked, never automatic):
#   ON:   sudo systemctl start footnote-tap.target     # Conflicts= stops srt-out first
#   OFF:  sudo systemctl stop footnote-tap.target && sudo systemctl start srt-out
# The swap drops the media path for ~2-4 s — do it between sessions, never mid-stream.
# Do NOT hand-start srt-out while tap mode is up (libsrt sets SRT_REUSEADDR, so the
# bind may "succeed" and the two listeners will fight for :4000/:4001).
set -euo pipefail

SRT_PASSPHRASE="${SRT_PASSPHRASE:?set SRT_PASSPHRASE env var before running (same value setup-relay.sh used)}"

command -v ffmpeg >/dev/null || { echo "ffmpeg missing — apt-get install -y ffmpeg"; exit 1; }

# --- credentials: EnvironmentFile is read by systemd (root), so 600 root:root works
#     even though the services themselves run as nobody ---
mkdir -p /etc/footnote
printf 'SRT_PASSPHRASE=%s\n' "$SRT_PASSPHRASE" > /etc/footnote/tap.env
chmod 600 /etc/footnote/tap.env

# --- tap output dir (audio-tap runs as nobody) ---
mkdir -p /var/lib/footnote-tap
chown nobody:nogroup /var/lib/footnote-tap

# --- the target: one handle for the whole tap mode ---
cat > /etc/systemd/system/footnote-tap.target <<'UNIT'
[Unit]
Description=Footnote tap mode (Phase-2 audio tap: tee + OBS hand-off + audio extract)
Conflicts=srt-out.service
After=srt-out.service
Wants=srt-tee.service srt-out-tap.service audio-tap.service
UNIT

# --- stage 1: terminate SRT at :4000 (same passphrase-less contract srt-out's input
#     had — srtla_rec is the only path here) and tee the TS to two loopback UDP ports.
#     -c copy: no transcode, ~1% CPU. ffmpeg exits when the street session's caller
#     drops; Restart=always re-listens in 2 s (between-sessions gap, never mid-stream).
cat > /etc/systemd/system/srt-tee.service <<'UNIT'
[Unit]
Description=Footnote SRT ingest tee (tap mode) — one SRT termination, two TS branches
Conflicts=srt-out.service
After=network-online.target srt-out.service
PartOf=footnote-tap.target
[Service]
ExecStart=/usr/bin/ffmpeg -nostdin -hide_banner -loglevel warning \
  -i "srt://127.0.0.1:4000?mode=listener" \
  -map 0 -c copy -f mpegts "udp://127.0.0.1:4002?pkt_size=1316" \
  -map 0 -c copy -f mpegts "udp://127.0.0.1:4003?pkt_size=1316"
Restart=always
RestartSec=2
KillSignal=SIGKILL
SuccessExitStatus=SIGKILL
User=nobody
UNIT

# --- stage 2a: re-offer the hand-off listener the home OBS caller expects —
#     same port, same passphrase, same pbkeylen. OBS config does not change. ---
cat > /etc/systemd/system/srt-out-tap.service <<'UNIT'
[Unit]
Description=Footnote SRT hand-off (tap mode) — home OBS dials in as caller
Conflicts=srt-out.service
After=network-online.target srt-out.service srt-tee.service
PartOf=footnote-tap.target
[Service]
EnvironmentFile=/etc/footnote/tap.env
ExecStart=/usr/bin/srt-live-transmit "udp://127.0.0.1:4002" "srt://0.0.0.0:4001?mode=listener&passphrase=${SRT_PASSPHRASE}&pbkeylen=16"
Restart=always
RestartSec=2
User=nobody
UNIT

# --- stage 2b: the tap itself — decode audio once, emit Deepgram-ready pcm16 mono
#     16 kHz to (1) 60 s WAV segments and (2) a local UDP stub in 20 ms/640 B
#     datagrams (the exact framing the future websocket bridge will forward).
#     A crash mid-segment leaves the last WAV with an unfinalized header — fine for
#     a debug artifact. fifo+overrun_nonfatal: a stalled disk can't stall the tee.
#     KillSignal=SIGKILL (both ffmpeg units): ffmpeg ignores SIGTERM while blocked on
#     a quiet UDP/SRT input (measured: 90 s stop-sigterm timeout → 'failed' marker);
#     tap-mode stops happen between sessions when the input IS quiet, so a hard stop
#     is deterministic and clean. Cost: the in-flight WAV segment keeps a provisional
#     (ffffffff-sized) RIFF header — readers handle it, it's a debug artifact. ---
cat > /etc/systemd/system/audio-tap.service <<'UNIT'
[Unit]
Description=Footnote audio tap — pcm16/16k mono to WAV segments + udp://127.0.0.1:9877 stub
After=srt-tee.service
PartOf=footnote-tap.target
[Service]
ExecStart=/usr/bin/ffmpeg -nostdin -hide_banner -loglevel warning \
  -i "udp://127.0.0.1:4003?fifo_size=65536&overrun_nonfatal=1" \
  -map 0:a -ac 1 -ar 16000 -c:a pcm_s16le \
    -f segment -segment_time 60 -strftime 1 "/var/lib/footnote-tap/tap-%%Y%%m%%d-%%H%%M%%S.wav" \
  -map 0:a -ac 1 -ar 16000 -c:a pcm_s16le -f s16le "udp://127.0.0.1:9877?pkt_size=640"
Restart=always
RestartSec=2
KillSignal=SIGKILL
SuccessExitStatus=SIGKILL
User=nobody
UNIT

systemctl daemon-reload
# deliberately NO enable, NO start — everything ships dark.
echo "tap mode installed DARK. state:"
systemctl is-enabled footnote-tap.target srt-tee srt-out-tap audio-tap 2>&1 | paste -sd' ' -
echo "  swap on:   sudo systemctl start footnote-tap.target   (between sessions only)"
echo "  swap off:  sudo systemctl stop footnote-tap.target && sudo systemctl start srt-out"
echo "  listen to the stub: python3 tap-stub-listen.py   (tools/relay/tap-stub-listen.py)"
