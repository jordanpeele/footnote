# Synthetic scenario library (S3)

Named, committed, reproducible adversarial scenarios. Each scenario encodes an **EXPECTATION**
about how the real Footnote surfaces behave on a specific kind of street capture, and CI asserts
the behavior still matches — so a regression (or a silent improvement that invalidates a pinned
failure) fails the build.

## The two-file shape

Each scenario is a pair:

- `NAME.scenario.json` — the **MANIFEST** (hand-authored intent): the STT `finals` stream, the
  per-utterance `intents` (a trigger substring + the claim/verify you want that utterance to
  produce), and the `expected_scorecard` bounds. This is the file a human edits.
- `NAME.replay.json` — the **COMPILED FIXTURE** (generated, do not hand-edit): the deterministic,
  keyless `--replay` artifact CI scores. The compiler
  (`tools/synthetic/author-scenario.js`) runs the SAME rolling-window state machine
  `simulate.js` uses to discover the EXACT window text each `extract` call receives, then keys
  the replay `extract`/`verify` maps by those exact strings.

Regenerate every fixture after editing any manifest:

```bash
node tools/synthetic/author-scenario.js compile-all
```

## Running

```bash
npm run synth:scenarios          # score the whole library, assert all bounds, nonzero on regression
node tools/synthetic/run-scenarios.js --only windy_run,cafe_interview
node tools/synthetic/run-scenarios.js --ci      # the small CI smoke subset
node tools/synthetic/run-scenarios.js --json     # machine-readable roster
```

`--replay` mode is deterministic and needs no Deepgram/Anthropic/Perplexity keys and no network,
so the whole suite runs in CI. The same window→gate→extract→verify→air logic that the live
`--real` path drives (`tools/synthetic/window-sim.js`) scores here, so the numbers are
directly comparable to a real streamed run.

## expected_scorecard — the bounds language

```jsonc
"expected_scorecard": {
  "status_note": "...",                        // free text, ignored by the asserter
  "<metric>": { "min": N, "max": N },          // bound a scorecard metric
  "aired": { "min": N, "max": N },             // totals.aired (auto-aired card count)
  "gate_distribution_required": { "<gate>": { "min": N, "max": N } },  // bound a gate's count
  "injections_gated": { "min": N }             // # of claim:null rows that aired nothing
}
```

Metrics: `word_coverage_pct` `claim_recall_pct` `category_accuracy_pct` `gate_correctness_pct`
`verdict_accuracy_pct` `air_accuracy_pct`. A `min` is a floor that must hold; a `max` is a
ceiling. **On a known-degraded scenario the ceiling is load-bearing**: if a metric rises above
its ceiling the system improved and the fixture must be re-baselined (the pinned failure is no
longer the truth).

> Note on `claim_recall_pct` / `gate_correctness_pct`: the scorecard's recall denominator
> includes `claim:null` rows, and its fuzzy per-row matcher can bind a null-claim row to a
> neighbouring cumulative window. Scenarios that carry opinions/filler therefore bound the
> *robust* signals (`aired`, verdict/air/category accuracy on recalled claims, and
> `gate_distribution_required`) rather than those two aggregate metrics. The gate distribution is
> ground truth about what the pipeline actually did.

## The roster

Nine scenarios. `should-pass-clean` = the system is expected to behave correctly (the passing
state is clean behavior). `known-degraded` = the system is CURRENTLY WRONG here on purpose; the
scenario **pins the failure** as current-truth so a future fix can be measured against it — a
known-degraded scenario "passing" means the failure is still present.

| scenario | status | what it stresses | headline expectation |
|---|---|---|---|
| **windy_run** | 🔴 known-degraded | KEYSTONE — 2026-08-14 Los Feliz: wind buries + packet-loss/handoff drops words before STT | **word coverage ≤ 60% (≈39%), claim recall ≤ 40% (1/4), aired = 1** |
| **cafe_interview** | 🟢 should-pass-clean | clean lav capture, two speakers, claims + opinions | all 4 claims air, 3 opinions dropped |
| **noisy_street_solo** | 🟢 should-pass-clean | survivable street noise + a non-allowlist (`statistics`) claim | 4 checked, **aired = 3** (statistics category-held) |
| **two_speaker_overlap** | 🔴 known-degraded | single-mic crosstalk fuses two speakers into one window | claim recall 50–75%, aired = 2 (1 claim lost to contamination) |
| **injection_barrage** | 🟢 should-pass-clean | speech-borne prompt injections must be GATED, not aired | **5 injections gated to no-claim, aired = 1** (only the one real claim) |
| **sci033_class_barrage** | 🔴 known-degraded | sci-033 class: two engines agree wrong on uncheckable-proof claims | **all 4 slip and auto-air, verdict accuracy ≤ 25%, air accuracy ≤ 25%** |
| **polarity_minefield** | 🟢 should-pass-clean | denials + mirror cases + the R46 suspect-denial tripwire | polarity-conflict fires on exactly 1 case, aired = 2 |
| **rapid_fire** | 🔴 known-degraded | claims faster than verify → one-window-dedupe collision (the S2 `--real` find) | **4 of 5 distinct claims collapse to `dedupe`, aired = 1** |
| **dead_air_then_burst** | 🟢 should-pass-clean | long silence then a burst; no cross-gap window contamination | pre-silence + 3 burst claims air (aired = 4), no phantom cards |

### Known-degraded — awaiting a fix

- **windy_run** — capture chain (wind protection / SRT loss recovery). The word-coverage and
  recall ceilings drop when the capture stops losing audio before STT.
- **two_speaker_overlap** — single-mic speaker separation (diarization / VAD) is not built.
- **sci033_class_barrage** — the class-detector is RED/parked (`redteam/sci033-class-detector`,
  default-OFF). When it ships, these should become HELD cards, not auto-airs (`aired` → 0).
- **rapid_fire** — per-claim windowing / a verify queue. When it lands, `dedupe` falls toward 0
  and `aired` rises toward 5.

Each known-degraded scenario's ceilings are the thing to delete-and-re-baseline the day its fix
merges. Until then, the ceiling failing (metric rose above it) is CI telling you a fix landed and
this fixture is now lying about current truth.
