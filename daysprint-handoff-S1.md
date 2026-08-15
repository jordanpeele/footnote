# NIGHTSPRINT S1 — Synthetic Audio Generator — HANDOFF

**Branch:** `worktree-agent-a0a47a449a9071d63` (committed, NOT pushed)
**Status:** all deliverables GREEN. `npm test` = 256 pass / 0 fail / 2 skipped (pre-existing skips; +13 new tests).

## What this is

The keystone tooling for the nightsprint: manufacture realistic street-audio
fixtures with controllable adversity + a ground-truth sidecar, so the 2026-08-14
Los Feliz run's two failures (wind-owned capture + endpointing shred) reproduce on
demand. S2 (scoring) grades pipeline output against the sidecar; S3 builds on it.

## Deliverables

| # | deliverable | path |
|---|-------------|------|
| 1 | Generator (script + profile → wav + sidecar) | `tools/synthetic/gen-audio.js` |
| 1 | Speech source | macOS `say -v Alex` (deterministic, free, offline — documented in PROFILES.md; the failure is acoustic, so the voice is a fixed control) |
| 2 | Adversity knobs + named profiles | `tools/synthetic/profiles.js` |
| 3 | Knob→cause docs + sample fixtures | `daysprint/synthetic/PROFILES.md`, `daysprint/synthetic/fixtures/` |
| 4 | Sidecar schema (consume without reading code) | `daysprint/synthetic/SIDECAR_SCHEMA.md` |
| 5 | Sidecar builder + unit test | `tools/synthetic/sidecar.js`, `test/synthetic-sidecar.test.js` (13 tests) |
| — | Claim script reproducing the run | `tools/synthetic/scripts/street-claims.jsonl` (31 segments, 25 claims) |
| — | Fixture regen wrapper + npm scripts | `tools/synthetic/gen-fixtures.js`; `npm run synth`, `npm run synth:fixtures` |
| — | Tool README | `tools/synthetic/README.md` |

## Adversity knobs (each a documented dimension → real-world cause)

`wind` (gusting sub-200 Hz rumble), `srt_microgaps` (150-400 ms in-speech
silences — the shred cause), `packet_loss` (burst mutes), `bonded_handoff` (~2 s
total silences), `distance` (level drift), `crosstalk` (2nd speaker), `ambience`
(café/traffic). Defaults match the run report. Full knob→cause table in PROFILES.md.

## Profiles

`clean` (control) · **`windy_run`** (KEYSTONE — reproduces the run) · `shred_only`
(micro-gaps, no wind) · `bonded_dropout` (transport) · `busy_street` (everything mild).

## Sample fixtures produced (`daysprint/synthetic/fixtures/`)

Sidecars are committed; `.wav` are gitignored (large, regenerable via
`npm run synth:fixtures`, seed 1337).

| fixture | dur | LRA | sub-200 Δ vs full | notes |
|---------|-----|-----|-------------------|-------|
| `clean` | 6.3 min | 9.3 LU | **-4.3 dB** | control; clean voice trails sub-band |
| **`windy_run`** | 6.4 min | **16.7 LU** | **-0.5 dB** | keystone; wind + 113 shred gaps + 2 handoff dropouts |
| `shred_only` | 6.5 min | 8.8 LU | -4.2 dB | micro-gap shred isolated (no wind) |

## windy_run measured vs run-report target

| metric | run-report target | measured |
|--------|-------------------|----------|
| LRA | 18.8 LU | **16.7 LU** |
| peak | -0.3 dBFS | **~0.0 dBFS** |
| sub-200 Hz vs full band | within ~2 dB | **-0.5 dB** (vs -4.3 dB clean control) |

The spectral wind fingerprint is reproduced tightly (0.5 dB vs the ~2 dB target).
LRA lands at 16.7 vs the field's 18.8: the field figure was 32 min of continuous
gusting; on a ~6-min fixture with speech gaps, LRA plateaus mid-teens (sparser
gusts raise peak height but reduce the count of loud 3 s windows, capping LRA).
The micro-gap shred is reproduced independently and verifiably (113 interior
150-400 ms gaps via `silencedetect`). Faithful, on-demand reproduction of both
morning failures. Tuning `wind.gust_*` in `profiles.js` is the lever if a future
scorer needs a higher LRA.

## For S2/S3

Consume `<name>.sidecar.json` only — schema in SIDECAR_SCHEMA.md. Per segment:
`start_s`/`end_s` bound the utterance in the wav (post-shred), `claim` (null =
no card expected), `expected_polarity` / `category` / `expected_verdict` /
`expected_gate` (`air`/`hold`/`drop`). Decision cases baked into windy_run's
sidecar: dedupe (`dupe-b` → drop), split-claim join (`split-a` drop + `split-b`
air), harm-hold (`priv1` → hold), opinion/filler/injection → drop.

## Notes / non-goals

- No app or gate changes; tooling + fixtures only (as scoped).
- The packet run report referenced `docs/BENCH_ENDPOINTING_2026-08-14.md` and
  `tools/bench/make-shredded-fixture.sh` as existing to build on — **neither
  exists in this worktree**. Built the gap+wind mechanics fresh in `gen-audio.js`
  (composable, sidecar-emitting), consistent with their described intent.
- `tools/street/test-audio-5min.mp3` (bundled clean speech) is also absent
  (gitignored, regenerated via ElevenLabs). Used macOS `say` instead — better
  fit here: deterministic, free, no key.
