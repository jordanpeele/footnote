# NIGHTSPRINT S4 handoff — SIMULATION AT VOLUME + THE FAILURE CATALOG

**Branch:** `worktree-agent-ac91aba0332a811ec` (merged `main` first to pick up the S1–S3 synthetic street).
**Do NOT push** — committed on the branch only.

## What shipped

1. **`tools/synthetic/volume-run.js`** — runs the system at VOLUME. The 9 base scenarios plus
   programmatically-generated variants: seeded timing-jitter, micro-gap-shred, and packet-loss
   word-drop intensity sweeps (each × N RNG seeds), plus cross-scenario concatenations (ring-pair
   at tight-handoff and dead-air gaps). Every run is scored in deterministic `--replay` mode
   (keyless, free) against its base sidecar ground truth. Default `--seeds 6` → **513 sessions**.
   - `--seeds N` — seeds per (scenario × transform × intensity) cell
   - `--json FILE` — raw aggregate + every run
   - `--catalog FILE` — (re)writes `FAILURE_CATALOG.md`
   - `--real N` — records intent for a keyed honesty batch; defers the actual keyed run to
     `simulate.js --real` so spend stays explicit and capped (keys in main-tree `.env.local`).
   - npm convenience: `npm run synth:volume`.

2. **`daysprint/synthetic/FAILURE_CATALOG.md`** — the morning's headline artifact. Every failure
   class ranked by **frequency × severity**, per-class samples, and a fixed-vs-parked
   cross-reference to the merged/parked red-team findings (transport/dead-air, sci-033,
   injection-held, F2-dedupe/capveto races). Regenerate any time with `npm run synth:volume`.

3. **Before/after coverage baseline** — per-scenario base-run coverage/recall/aired, as-is. This
   is the **pre-fix** baseline; the morning's capture-chain fixes (R-audio 120 Hz high-pass /
   window-tunable) will be measured against it. Those have NOT merged as in-code DSP/tunable
   changes yet (the high-pass lives in preflight/OBS/relay-tap docs; the w13 rolling-window
   already merged and is reflected here at 100% replay coverage), so the catalog is the honest
   pre-fix floor. When they land, re-run and the windy_run/shred numbers move.

4. **CI-sane:** volume-run is a script, NOT in `npm test`. One small aggregation unit test added
   (`test/synthetic-volume.test.js`, 4 tests) pinning the ranking invariant (impact = severity ×
   frequency, descending) + the coverage-baseline base-only filter. **`npm test` green: 436 pass,
   2 pre-existing skips, 0 fail (438 total).**

## Headline numbers (`--seeds 6`, 513 sessions)

Top failure classes by frequency × severity:

| # | class | severity | count | impact |
|---|---|---|---|---|
| 1 | Claim missed (recall miss / should-air held) | 4 | 1484 | **5936** |
| 2 | Wrong gate fired | 5 | 895 | **4475** |
| 3 | Wrong card AIRED (a false/unverifiable thing on-air) | 10 | 163 | **1630** |
| 4 | Wrong verdict on a recalled claim | 7 | 163 | 1141 |
| 5 | Word-coverage dropped | 3 | 183 | 549 |

- **#1 claim_missed** is dominated by windy_run (capture loss), rapid_fire (one-window-dedupe),
  and two_speaker_overlap (crosstalk) — all PARKED classes, plus every variant that shreds/drops
  words hard enough to strand a claim. This is the volume tail of the keystone failure.
- **#2 wrong_gate** is led by rapid_fire's dedupe collisions and windy shred fragments (real
  claims landing on the wrong gate). Counted only on rows with a real ground-truth claim — the
  scenarios README documents that the fuzzy matcher binds `claim:null` rows unreliably, so those
  are excluded as matcher noise, not gate failures.
- **#3 wrong_air (sev 10, the top of the pyramid)** is almost entirely `sci033_class_barrage` —
  the uncheckable-proof claims two engines flatten to a confident False and auto-air. Class-detector
  is PARKED (`redteam/sci033-class-detector`, default-OFF). Every hit is that one pinned slip
  (× seeds × cross-pairs), not a new failure.

## Cross-reference / honesty checks

- **Injections: 0 confirmed bypasses across all 513 runs** — matches R-inject (42 payloads, 0
  bypasses). An early version over-reported here: the scorecard's fuzzy matcher binds a
  `claim:null` ground-truth row onto the one legitimate `checked` window (the README's documented
  matcher caveat). The classifier now derives injection-bypass from the RUN's real gate
  distribution (`checked` > legit-claim count), which is 0 everywhere. In injection_barrage the
  gate distribution is exactly `no-claim:5, checked:1` and only the real octopus claim airs.
- **windy_run KEYSTONE baseline: word coverage 39.5%, claim recall 25%, aired 1** — the
  2026-08-14 Los Feliz morning failure, pinned. The pre-fix floor.

## How to reproduce / next steps

```bash
npm run synth:volume                                   # 513 sessions → FAILURE_CATALOG.md
node tools/synthetic/volume-run.js --seeds 12 --json /tmp/vol.json   # more volume + raw dump
```

When the R-audio high-pass / window-tunable capture fix merges: re-run `npm run synth:volume`,
watch the windy_run / coverage_drop / claim_missed numbers fall, and re-baseline the windy_run
ceiling in its scenario manifest (the ceiling failing = CI telling you the fix landed).
