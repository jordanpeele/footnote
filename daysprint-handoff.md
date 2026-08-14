# DAYSPRINT packet 1b — AUDIO CHAIN — handoff

Branch: `worktree-agent-a5dee4911a900e325` (isolated worktree; NOT pushed).
Context: 2026-08-14 run test's wind-dominated capture
(docs/RUN_TEST_FIELD_REPORT_2026-08-14.md — LRA 18.8 LU, gusts to -0.3 dBFS,
sub-200 Hz within ~2 dB of full band). All deliverables GREEN-lane: docs,
tooling, bench. **No gate or pipeline semantics touched; no defaults changed
(R62 — the bench is tuning input, the window is the architecture).**

## 1. OBS audio preset (field-report prescription #2)

- `tools/street/obs-audio-preset.md` — the preset, the why, the ~60-second
  click path, and a scripted-install route.
- `tools/street/obs-audio-filters.json` — the `filters` array in OBS's own
  scene-collection shape, ready to splice onto the relay media source
  (`moblin-feed`).
- Preset: **3-Band Equalizer, Low -20 dB** (OBS 32 has no parametric high-pass;
  the max low-band cut is the native stand-in for the 120 Hz HPF — the true
  `highpass=f=120` lands in the relay ffmpeg tap in Phase 2) → **Limiter,
  threshold -6 dB, release 60 ms**, in that order so the ceiling reacts to the
  de-rumbled signal.
- Filter ids/settings keys (`basic_eq_filter`: low/mid/high;
  `limiter_filter`: threshold/release_time) were verified against the installed
  OBS 32.1.2 binary + locale, and the JSON shape against the user's existing
  scene collections (READ-ONLY). The splice script was validated against a
  throwaway copy in /tmp; **the live OBS configs were not modified.**

## 2. STREET_RIG.md capture subsection

- New section "Capture — the mic is the street's first filter" (between "Why
  each piece" and the SRTLA section): wired-mic earbuds/AirPods as Moblin's
  input (distance beats DSP), windscreen note, and the per-session sanity
  check via Moblin's mic picker (Settings → Mic) + OBS meter cross-check.
  Links to the OBS preset as standing policy.

## 3. Endpointing sweep (W1.1, tuning-grade)

- `tools/bench/make-shredded-fixture.sh` — deterministic (seed 20260814)
  synthetic shredded fixture from the clean `tools/street/test-audio-5min.mp3`
  (ffmpeg only, no sox): 93 hard mutes of 150-400 ms every ~2.5-4.5 s + 22
  pink-noise-lowpassed-150 Hz wind gusts of 0.8-3 s mixed near full scale.
  Result profile: true peak -0.2 dBFS, LRA 12.6 LU, bursts ~30 dB over the
  quiet-speech regions — a fair imitation of the run capture. Sidecar
  `.schedule.json` records the exact gap/burst windows. Outputs land in
  `tools/bench/results/` (gitignored).
- `tools/bench/endpointing-sweep.js` — streams the fixture's PCM real-time
  (100 ms chunks) over Deepgram's realtime WS (nova-3, linear16/16 kHz) at
  endpointing = 10/300/500/800/1200 ms; measures finals/min, median
  words/final, and added final-latency (receipt wall-clock minus the moment
  the last recognized WORD was sent — the final's own audio window extends
  through the endpoint silence, so `start+duration` hides the wait).
  Key loads from env / repo-root `.env` / `.env.local`, never committed.
- Results + recommendation: `docs/BENCH_ENDPOINTING_2026-08-14.md`.
  **No default changed** — the existing `/control?ep=` hatch (L2, latency
  ledger) is the application path, per session.
- Spend: ~25 billed audio-minutes ≈ <$0.20 (approved trivial).

## 4. Repo state

- `npm test`: 245 tests, 0 fail (2 pre-existing skips) — green before and
  after.
- Committed on the worktree branch; **not pushed** (push needs its own
  authorization).
- Raw sweep artifacts (fixture wav, schedule json, per-final JSONL, stdout
  log) are in `tools/bench/results/` — gitignored by that directory's own
  `.gitignore`, left in place for inspection.

## Open / carried

- The preset is click-installed policy, not yet live in the operator's OBS —
  install per obs-audio-preset.md before the next street session (60 s).
- Field-proof of the audio prescriptions (earbud mic + preset) still comes
  free with the next session, per the field report's "carried forward".
- Phase-2 note stands: the same high-pass belongs in the relay's ffmpeg audio
  tap when the pipeline moves cloud-side.
