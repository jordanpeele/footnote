# DAYSPRINT 1a handoff — W1.3 window hardening (2026-08-14)

Scope: full test suite + lifecycle observability for the rolling-window extraction that
shipped in 11f25bc. **No behavior changes to the window itself** — tunable values and gate
semantics untouched (RED). Mirror discipline respected: zero edits inside the MIRROR BLOCK,
so `test/utterance-sync.test.js` passes unchanged.

## What shipped

### 1. `src/core/window-sim.js` — the window state machine, extracted once
The simulation that lived inline in `tools/bench/window-replay.js` is now an importable
module: `createWindowSim()` (step-drivable: `addFinal` / `tick` / `flush`),
`replayWindow(finals)` (real-timeline replay with the 400ms tick loop), and
`windowCoverage(finals, windows)`. The bench tool and the new tests both import it, so the
replay tool and the regression pin can never disagree. The decision predicate + tunables
stay in `src/core/utterance.js` (imported, never restated). `WINDOW_TICK_MS=400` /
`WINDOW_BUFFER_WORDS=60` are exported as wiring constants (mirrors of app.js wiring, not
tunables).

**Parity proof**: pre-refactor tool output on a synthetic 29-final run-shape fixture =
`10 windows · 100% coverage`; post-refactor output byte-identical.

### 2. `test/window-ingestion.test.js` — 32 tests
- **Cadence-trigger matrix**: 11-row edge table over `windowShouldExtract` — min-words
  floor gates all three triggers; terminal immediate at the floor; cadence and silence
  exact-threshold edges (fire at N, hold at N-1); word-flood does not beat the cadence clock.
- **Wiring behavior** (via window-sim): terminal fires on ingest, cadence/silence only on
  the timer path; window text capped at `WINDOW_WORDS` (newest words win); empty/whitespace
  no-ops.
- **winLastSent suppression**: identical re-fire sends nothing but *consumes* the fire
  (new-word count reset, cadence clock restarted — no re-fire loop); suppressions counted;
  distinct new words break suppression.
- **Window ↔ F2 interplay** (logic-level mirror of `checkUtterance` app.js:515-532):
  overlapping windows extracting the same claim (incl. surface-form drift) → exactly one
  card + `duplicate_claim` dispositions; a new claim in the same window is not swallowed;
  operator `force` bypasses but still registers; past `DUP_CLAIM_WINDOW_MS` the claim
  legitimately cards again.
- **Dup-gate accounting over a real replay**: the fixture's GDP sentence appears in 6
  overlapping windows → 1 card + 5 `duplicate_claim`. Field-read note baked into the test:
  under W1.3, `duplicate_claim` gate events are EXPECTED and healthy; their absence with
  high window counts is the regression signal (overlap not reaching extraction).
- **Grounding-fence contract** (server-side, P4-F1): documented + pinned — `windowExtract`
  POSTs the *window text* as `text`; `api/extract.js` runs `groundedClaim(claim, text)`
  against exactly that window (stateless per request). A claim spread across many 1-word
  finals grounds against the joined window (the point of W1.3); hallucinated numbers,
  assistant-voice echo, and off-window claims are rejected. Cross-window repetition is
  F2's job, never grounding's.
- **Replay regression pin** (2026-08-14 run shape): 29 one-word finals @2.3s synthesized
  inline (no gitignored-log dependency). Asserts coverage ≥ 95% (run-test baseline: 27%),
  window count within [6, ⌊29/3⌋+1], no suppressions on distinct text, every window ≤ 30
  words, known trigger reasons only, and the end flush covers the session's last words.

### 3. Lifecycle observability — `window_summary` (app.js only, additive)
`window_extract` already existed per fire; what was missing for the morning field analysis
was per-stream totals. Added `winStats` accounting (outside the mirror block):

```
window_summary { windows, by_reason: {terminal, cadence, silence}, suppressed, words_in, words_sent }
```

- `words_in` = words ingested into the window; `words_sent` = sum of window sizes handed to
  extraction (overlap makes sent > in by design); `suppressed` = winLastSent identical-window
  hits.
- Emitted ONCE at End Stream (before state reset); counters survive Deepgram reconnects
  (window *state* resets per connect, the summary is per *stream*); belt-and-suspenders
  reset at Start Stream for reload-skipped endStream.
- Morning read: `words_in` vs stt_final word totals ⇒ ingestion held; `by_reason` mix ⇒
  which trigger carried the session; `suppressed` high ⇒ re-final repetition shape.

## Verification
- `npm test`: 277 tests, 275 pass, 0 fail, 2 skipped (pre-existing skips; baseline identical).
- `node --check app.js` clean; mirror-sync + prompt-sync untouched and green.
- `tools/bench/window-replay.js` re-run post-refactor: output identical (incl. `--live`
  path untouched apart from the shared sim).

## Explicitly NOT done
- No tunable value changed, no gate semantics changed, no window wiring behavior changed.
- No new harness events beyond `window_summary` (window_extract was already sufficient
  per-fire; anything more is noise — see alerting-noise feedback).
- Not pushed. Branch: `daysprint/w13-window-hardening`.
