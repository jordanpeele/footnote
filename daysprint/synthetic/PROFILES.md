# Synthetic street-audio ADVERSITY profiles & knobs (S1)

The generator (`tools/synthetic/gen-audio.js`) manufactures street-audio fixtures
with controllable adversity plus a ground-truth sidecar
(`SIDECAR_SCHEMA.md`). Each adversity dimension is a **knob**; knobs compose into
named **profiles** (`tools/synthetic/profiles.js`). Defaults reproduce the
**2026-08-14 Los Feliz run** (`docs/RUN_TEST_FIELD_REPORT_2026-08-14.md`): wind
that owned the capture (LRA 18.8 LU, sub-200 Hz within ~2 dB of full band, peaks
at -0.3 dBFS) and an ingestion frame that shredded speech into one-word finals.

## Speech source

Clean speech is synthesized with macOS **`say`** (`-v Alex` by default):
deterministic, free, offline, no API key. The run report's failure is *acoustic*
(wind + micro-gap shred), so the voice is a fixed control and the adversity is the
variable under test. (`tools/street/generate-test-audio.js` uses ElevenLabs for
the *produced* street fixture, where timbre matters; here reproducibility and
zero-cost regeneration win.)

## Knobs

Every knob is one dimension mapped to a real-world cause. Absent or `false` knobs
are no-ops. Full defaults live in `profiles.js` (`KNOB_DEFAULTS`).

### `wind` — gusting low-frequency rumble → **wind owns the capture**

An unprotected phone mic at arm's length in wind: brown noise (the natural
-6 dB/oct tilt of wind), hard-lowpassed to a sub-200 Hz rumble, then multiplied by
a **sparse, tall gust envelope**. The envelope is a sum of incommensurate
`pow(max(0,sin(2πt/period)), sharpness)` terms, hard-limited near 0 dBFS.

Why sparse+tall: EBU R128 loudness range (LRA) is the spread between quiet and
loud 3-second windows. Continuous wind *fills* the quiet windows and collapses
LRA; **occasional** gusts that saturate a few windows while most stay at quiet
speech level are what blow LRA out — exactly the field signature.

| field | default | maps to |
|-------|---------|---------|
| `color` | `brown` | wind's spectral tilt |
| `cutoff_hz` | `200` | two cascaded lowpasses → sub-200 Hz rumble band |
| `gust_periods_s` | `[23, 37, 53]` | irregular gust spacing (incommensurate periods) |
| `gust_amp` | `20` | gust height (pre-limiter) |
| `gust_sharpness` | `40` | gust narrowness/sparseness (exponent) |
| `floor` | `0` | between-gust rumble (0 = quiet lulls, maximizes LRA) |
| `limit` | `0.99` | limiter ceiling → peaks near 0 dBFS |

### `srt_microgaps` — 150-400 ms silences inside speech → **the shred cause**

The run's core capture-frame failure: Deepgram finalized at every micro-gap, so
one spoken thought arrived as 2-5 one-word finals (244 finals, median 1 word, 73%
of words never reached a check). The knob splits each synthesized utterance at
speech-plausible interior points and stitches short silences in.

| field | default | maps to |
|-------|---------|---------|
| `min_ms` / `max_ms` | `150` / `400` | the silence that triggers an STT endpoint |
| `rate_per_10s` | `4` | how aggressively speech gets finalized |

Verify with `silencedetect=noise=-45dB:d=0.14` — the windy_run/shred_only
fixtures carry ~100+ interior micro-gaps (the 8 s gaps are inter-claim, expected).

### `packet_loss` — 40-160 ms burst mutes → **un-recovered SRT loss**

Brief dropouts clustered in bursts: audio the relay lost and never recovered.
Distinct from a handoff (below) — short and speckled, not a clean 2 s hole.

| field | default | |
|-------|---------|---|
| `burst_min_ms` / `burst_max_ms` | `40` / `160` | dropout length |
| `bursts_per_min` | `3` | how lossy the link is |

### `bonded_handoff` — ~2 s total silences → **cell handoff, bond recovers**

The run saw two back-to-back total-silence dropouts (2.0 s + 2.6 s) at ~20:53 —
a cell-handoff signature; the bond recovered both. Models the worst-case gap the
W1.3 window / assembler must survive without losing a straddling claim.

| field | default | |
|-------|---------|---|
| `count` | `2` | number of dropouts |
| `dur_s` | `[2.0, 2.6]` | their durations (matches the run) |
| `at_fraction` | `[0.55, 0.58]` | placement as a fraction of total duration (back-to-back) |

### `distance` — slow gain drift → **speaker moving toward/away from the mic**

Sinusoidal level drift between `min_gain` and `max_gain` over `period_s`.

### `crosstalk` — second synthesized voice bleeding in → **bystander / second speaker**

A second `say` voice, gained down, mixed under the primary.

### `ambience` — steady pink-noise bed → **café / traffic**

`kind: "traffic"` (low-shelved) or `"cafe"` (broader), at `gain`.

## Profiles

Compose knobs. `resolveProfile(name)` expands them; the exact resolved values are
recorded in each sidecar's `profile_knobs` (audit trail).

| profile | knobs | purpose |
|---------|-------|---------|
| `clean` | — | control: clean speech + silence gaps, no adversity |
| **`windy_run`** | wind + microgaps + handoff + distance | **KEYSTONE** — reproduces 2026-08-14 Los Feliz |
| `shred_only` | microgaps (rate 6) | isolates the endpointing shred (no wind) — proves the W1.3 window recovers coverage |
| `bonded_dropout` | packet_loss + handoff | transport adversity, clean capture |
| `busy_street` | ambience + crosstalk + mild wind + distance | realistic busy-sidewalk capture |

## `windy_run` measured vs run-report target

Full 31-segment street script (~6.4 min incl. 8 s inter-claim gaps), `--seed 1337`:

| metric | run-report target | `windy_run` measured |
|--------|-------------------|----------------------|
| Loudness range (LRA) | 18.8 LU | **16.7 LU** |
| Peak | -0.3 dBFS | **~0.0 dBFS** |
| sub-200 Hz vs full band | within ~2 dB | **-0.5 dB** |
| (clean control, for contrast) | voice trails 10-15 dB | **-4.3 dB** |

LRA lands at 16.7 vs the field's 18.8. The field figure was 32 minutes of
continuous real gusting; on a ~6-minute fixture with speech gaps the achievable
LRA plateaus in the mid-teens (sparser gusts raise peak height but cut the count
of loud windows, which caps LRA). The spectral fingerprint — sub-200 Hz within
0.5 dB of full band vs 4.3 dB on the clean control — matches the report tightly,
and the micro-gap shred is reproduced independently. This is a faithful,
on-demand reproduction of the morning's two failures.

## Regenerating

```bash
npm run synth:fixtures          # rebuild all three committed sample fixtures (deterministic, seed 1337)
npm run synth -- --script tools/synthetic/scripts/street-claims.jsonl \
  --profile windy_run --out daysprint/synthetic/fixtures/windy_run   # one profile
```

The `.wav` files are gitignored (large, regenerable); the `.sidecar.json` ground
truth is committed. Requires macOS `say`, `ffmpeg`, `ffprobe`.
