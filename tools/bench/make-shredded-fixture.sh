#!/usr/bin/env bash
# Build the SYNTHETIC "shredded" endpointing fixture (W1.1 bench input).
#
#   bash tools/bench/make-shredded-fixture.sh [-i input.mp3] [-o output.wav] [-s seed]
#
# Imitates the 2026-08-14 run-test capture profile (docs/RUN_TEST_FIELD_REPORT_2026-08-14.md:
# LRA 18.8 LU, wind gusts to -0.3 dBFS, sub-200Hz within ~2 dB of full band) on top of the
# clean 5-minute street fixture (tools/street/test-audio-5min.mp3):
#
#   1. silence gaps  — 150-400 ms hard mutes injected every ~2.5-4.5 s of program time,
#                      the "shredded speech" signature that produced 244 one-word finals.
#   2. wind bursts   — pink noise low-passed at 150 Hz, gated into 0.8-3.0 s gusts every
#                      ~8-20 s, mixed hot over the speech (near-full-scale vs -19 LUFS voice).
#
# Deterministic: the gap/burst schedule comes from a seeded LCG (default seed 20260814), and
# the sidecar schedule JSON is written next to the output so a run is reproducible/auditable.
# Output is 16 kHz mono s16le WAV — exactly what tools/bench/endpointing-sweep.js streams.
#
# Requires ffmpeg + ffprobe only (no sox). Output + sidecar land in tools/bench/results/
# (gitignored) by default.

set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$BENCH_DIR/../.." && pwd)"

INPUT="$REPO_ROOT/tools/street/test-audio-5min.mp3"
OUTPUT="$BENCH_DIR/results/shredded-fixture.wav"
SEED=20260814

while getopts "i:o:s:h" opt; do
  case "$opt" in
    i) INPUT="$OPTARG" ;;
    o) OUTPUT="$OPTARG" ;;
    s) SEED="$OPTARG" ;;
    h) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) exit 2 ;;
  esac
done

command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe not found" >&2; exit 1; }
[ -f "$INPUT" ] || {
  echo "input not found: $INPUT" >&2
  echo "(the clean fixture is gitignored; generate it with tools/street/generate-test-audio.js" >&2
  echo " or point -i at an existing copy, e.g. the main tree's tools/street/test-audio-5min.mp3)" >&2
  exit 1
}

DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$INPUT")"
mkdir -p "$(dirname "$OUTPUT")"
SIDECAR="${OUTPUT%.wav}.schedule.json"
FILTER_SCRIPT="$(mktemp -t shredded-filter.XXXXXX)"
trap 'rm -f "$FILTER_SCRIPT"' EXIT

# Deterministic schedule via awk LCG (glibc constants). rnd() in [0,1).
awk -v dur="$DUR" -v seed="$SEED" '
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  BEGIN {
    # --- silence gaps: every 2.5-4.5s, 150-400ms each ---
    ngaps = 0; t = 2.0 + rnd() * 2.0
    while (t < dur - 1.0) {
      len = 0.15 + rnd() * 0.25
      gs[ngaps] = t; ge[ngaps] = t + len; ngaps++
      t += len + 2.5 + rnd() * 2.0
    }
    # --- wind bursts: every 8-20s, 0.8-3.0s each ---
    nbursts = 0; t = 4.0 + rnd() * 8.0
    while (t < dur - 2.0) {
      len = 0.8 + rnd() * 2.2
      bs[nbursts] = t; be[nbursts] = t + len; nbursts++
      t += len + 8.0 + rnd() * 12.0
    }

    # speech chain: one volume=0 mute whose enable expr covers every gap window
    gexpr = ""
    for (i = 0; i < ngaps; i++)
      gexpr = gexpr (i ? "+" : "") sprintf("between(t\\,%.3f\\,%.3f)", gs[i], ge[i])
    # noise chain: pink noise -> lowpass 150Hz -> muted except inside burst windows
    bexpr = ""
    for (i = 0; i < nbursts; i++)
      bexpr = bexpr (i ? "+" : "") sprintf("between(t\\,%.3f\\,%.3f)", bs[i], be[i])

    printf "[0:a]aresample=16000,pan=mono|c0=c0,volume=volume=0:enable=%s[speech];\n", "\x27" gexpr "\x27"
    printf "anoisesrc=color=pink:seed=%d:amplitude=0.85:sample_rate=16000:duration=%.3f,", seed, dur
    printf "lowpass=f=150:p=2,volume=8dB,volume=volume=0:enable=%s[wind];\n", "\x27lt(" bexpr "\\,1)\x27"
    printf "[speech][wind]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.97:level=false[out]\n"

    # sidecar schedule
    printf "{\n  \"seed\": %d,\n  \"input_duration_s\": %.3f,\n", seed, dur > "/dev/stderr"
    printf "  \"gaps\": [" > "/dev/stderr"
    for (i = 0; i < ngaps; i++)
      printf "%s[%.3f,%.3f]", (i ? "," : ""), gs[i], ge[i] > "/dev/stderr"
    printf "],\n  \"wind_bursts\": [" > "/dev/stderr"
    for (i = 0; i < nbursts; i++)
      printf "%s[%.3f,%.3f]", (i ? "," : ""), bs[i], be[i] > "/dev/stderr"
    printf "]\n}\n" > "/dev/stderr"
  }
' >"$FILTER_SCRIPT" 2>"$SIDECAR"

ffmpeg -hide_banner -loglevel error -y \
  -i "$INPUT" \
  -filter_complex_script "$FILTER_SCRIPT" \
  -map "[out]" -ar 16000 -ac 1 -c:a pcm_s16le \
  "$OUTPUT"

GAPS="$(python3 -c "import json;d=json.load(open('$SIDECAR'));print(len(d['gaps']))" 2>/dev/null || echo "?")"
BURSTS="$(python3 -c "import json;d=json.load(open('$SIDECAR'));print(len(d['wind_bursts']))" 2>/dev/null || echo "?")"
echo "wrote $OUTPUT ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT")s, 16kHz mono s16le)"
echo "schedule: $SIDECAR ($GAPS silence gaps, $BURSTS wind bursts, seed $SEED)"
