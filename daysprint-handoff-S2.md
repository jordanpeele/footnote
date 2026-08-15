# NIGHTSPRINT S2 — Stream Simulator + Scorecard (handoff)

Feed synthetic audio through the REAL Footnote surfaces exactly as a live session would,
then score every run against S1's ground-truth sidecar. GREEN packet — a test/measurement
harness, **no app changes**.

Branch: `worktree-agent-a27fe050ec09a7e2d` (worktree). Committed, **not pushed**.

## What shipped

| File | Role |
|---|---|
| `tools/synthetic/simulate.js` | CLI driver. Two modes (`--real`, `--replay`) that share the same pipeline. |
| `tools/synthetic/window-sim.js` | The ONE window→gate→extract→verify→air simulator both modes drive. Faithful offline mirror of the live client path in `app.js` (window loop from `tools/bench/window-replay.js`, gate predicates imported straight from `src/core/utterance.js` + `src/core/grounding.js` — no second copy to drift). |
| `tools/synthetic/scorecard.js` | Pure scoring math vs the S1 sidecar. Emits JSON + `summarize()` human text. |
| `tools/synthetic/fixtures/mixed.replay.json` | Hand-authored `--replay` fixture exercising every gate path. |
| `test/synthetic-simulate.test.js` | Determinism + gate-path + WAV-decode + air-decision tests (no keys, no network). |
| `daysprint/synthetic/results/sample-scorecard.json` | Sample scorecard (from the replay fixture). |

## Modes (both drive the SAME logic → comparable scores)

**`--real`** — streams a fixture WAV through Deepgram's realtime WS (same `dgUrl` params as
the live client, `app.js:1099`), collects finals, spawns `npm start` on a spare port
(`:3131` default) with keys injected, then runs window→extract→verify against it with the
eval harness's rate-limit discipline (`eval/run.js`).

```
node tools/synthetic/simulate.js --real --wav FIXTURE.wav --sidecar SIDECAR.json [--base URL] [--port N] [--out FILE]
```

Keys are read from the MAIN tree `/Users/cobyweiss/Code/footnote/.env.local` (override with
`--env`), merged over any shell-env keys — mirrors `src/server/index.js` precedence. Nothing
is committed.

**`--replay`** — consumes a recorded transcript + recorded extract/verify replies.
Deterministic, keyless, network-free — for regression/CI.

```
node tools/synthetic/simulate.js --replay FIXTURE.replay.json [--sidecar SIDECAR.json] [--out FILE]
```

Replay fixture: `{ profile, finals:[{t,text}], extract:{"<window text>":{…}}, verify:{"<claim>":{…}}, claims:[…] }`.
extract/verify keys are the exact rolling-window texts `window-sim` emits over `finals`.

## Scorecard (deliverable 2)

Per the packet, vs the S1 sidecar:
- **word coverage %** — unique spoken words that reached an extracted window
- **claim recall** — expected claims that reached a CHECK (extract returned a claim)
- **category accuracy** — of recalled claims, extractor category vs expected
- **gate-outcome correctness** — did the right gate fire: `fragment / ground / dedupe / person-hold / polarity-conflict / checked / no-claim`
- **verdict correctness**
- **air-decision correctness** — aired vs held, via the full `maybeAutoAir` gate chain (`airDecision()`)
- **latency waterfall** — extract / verify percentiles **+ a RELAY stage placeholder** (offline can't exercise on-air relay; wire when a relay bench lands)

Plus a gate-distribution histogram and a per-claim table. Emits JSON (`--out`) and a human summary to stdout.

## Sidecar contract + adaptation

Assumes S1's stated shape `{ profile, claims:[{utterance, claim, expected_polarity, category,
expected_verdict, expected_gate, t_start, t_end}] }` and adds an optional `expected_air`
boolean for air scoring. **S1 had not landed any artifacts** in `daysprint/synthetic/` at
handoff time (no `PROFILES.md`, no schema doc, no WAV). `loadSidecar()` already tolerates a
top-level array or a `{sidecar:{…}}` wrapper; when S1's schema lands, only field-name
adaptation in `scorecard.js` (`matchCheck` / the metric extractors) should be needed.

## Proven (deliverable 3)

- **`--replay` — PROVEN** on `fixtures/mixed.replay.json`: 8 finals → 7 windows → gate
  distribution `checked=2, dedupe=2, person-hold=1, no-claim=2`. Scorecard:
  word-coverage 100%, gate-correctness 100%, verdict 100%, air 100%, category 100%,
  claim-recall 75% (the 4th expected item is a question that correctly yields no claim).
- **`--real` — PROVEN** end-to-end against live Deepgram + a locally-spawned server with real
  Haiku + real Perplexity, on a `say`-synthesized 7s WAV of two false science claims.
  Deepgram returned 2 finals (100% word coverage), Haiku extracted both, Perplexity returned
  `False`, and the first claim auto-aired (`science_health`, conf ≥ 0.85, tier-eligible).
  **Live-behavior finding:** both sentences landed in ONE rolling window, so the second claim
  hit **F2 dedupe** and never reached air — exactly the kind of behavior this simulator exists
  to surface. Latency: extract p50 ~860ms, verify ~2.9s.

## Tests (deliverable 4) — `npm test` GREEN

`test/synthetic-simulate.test.js` adds 6 tests, all keyless/offline:
1. `--replay` is deterministic (byte-identical scorecard run-to-run)
2. every gate path scored correctly on the inline fixture
3. `airDecision` D4 person-hold / polarity-conflict / category-hold / confidence-hold / air
4. `runPipeline` window state machine matches the `app.js` loop
5. `parseWav` (16-bit PCM + stereo→mono downmix) — covers the `--real` decode path w/o keys
6. `score()` tolerates an empty sidecar

Full suite: **248 pass, 2 skipped (pre-existing), 0 fail.**

## Sample scorecard (from `--replay`)

```
Footnote synthetic scorecard — profile: mixed-gates-selftest

  finals=8  windows=7  checks=7  expected-claims=4  verdicts=3  aired=2

  word coverage            100%   (spoken words seen)
  claim recall              75%   (3/4)
  category accuracy        100%   (3/3)
  gate correctness         100%   (4/4)
  verdict accuracy         100%   (3/3)
  air decision             100%   (3/3)

  latency waterfall (ms):
  extract    p50= 470  p90= 500  max= 520  (n=7)
  verify     p50=2400  p90=2400  max=2600  (n=3)
  relay      p50=  —  p90=  —  max=  —  ← PLACEHOLDER (relay/on-air stage not exercised offline)

  gate distribution: no-claim=2  checked=2  dedupe=2  person-hold=1
```

## Follow-ups when S1 lands

1. Point `--real`/`--replay` at S1's real WAV + sidecar; adapt `scorecard.js` field names if
   S1's schema differs from the assumed contract.
2. Record a `--replay` fixture FROM a `--real` run (capture the finals + API replies) so CI
   regressions track the real transcript, not a hand-authored one.
3. Fill the RELAY latency stage once a relay/on-air measurement path exists.
