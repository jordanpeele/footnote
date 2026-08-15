# R-audio — red-team the audio path against the W1.3 window

**Question.** Can any wind / gap / loss / dropout / level profile drive word-coverage back
toward the 2026-08-14 run's **27%** baseline, defeating the W1.3 rolling window?

**Verdict — the window HOLDS.** No profile defeats the window itself. The window carries
**100% of every word Deepgram delivers**, on every profile including the worst. Coverage
*can* be driven low (worst found: **39.7%**, dropout_siege), but only by destroying words
*upstream of STT* — long total-silence dropouts that mute half of each spoken claim before
it ever reaches Deepgram. That is a **transport/capture failure, not a window failure**, and
no window-tunable can recover audio that was never captured. This is the exact same class as
the field report's wind finding: *the chain delivers what it captured; the capture is the
problem.*

## Method

Streamed synthetic fixtures through the **real Deepgram nova-3 realtime WS** (same params as
the live client, `app.js:1099`), ran the W1.3 window over the finals, scored **word coverage**
against the S1 sidecar. Coverage is a pure function of the finals the window receives, so
this isolates the audio-path attack with no LLM spend. Harness:
`tools/synthetic/redteam-sweep.js`. Claim script: `tools/synthetic/scripts/redteam-claims.jsonl`
(8 claims, 2s gaps, ~42s). New adversary profiles added to `tools/synthetic/profiles.js`.
Full results JSON: `daysprint/synthetic/results/redteam-audio-sweep.json`.

Note: `clean` scores 86.8% (not 100%) — a fixed offset from macOS-`say` filler words the
STOP-word/normalization differs on. All numbers below are relative to that clean baseline.

## Coverage vs. adversity (real Deepgram, W1.3 window)

| profile         | knob cranked                                   | STT words | coverage |
|-----------------|------------------------------------------------|-----------|----------|
| faint           | level 0.10-0.30 (far mic)                       | 83        | **88.2%** |
| clean (control) | none                                            | 82        | **86.8%** |
| wind_extreme    | sustained near-full-scale wind, no lulls        | 81        | **86.8%** |
| packet_storm    | 20 bursts/min, 80-320ms                          | 76        | **82.4%** |
| windy_run       | keystone (wind + microgaps + 2 handoffs)         | 77        | **80.9%** |
| microgap_storm  | 12 gaps/10s, all < 1500ms silence threshold      | 80        | **79.4%** |
| worst_case      | ALL knobs cranked at once                        | 47        | **50.0%** |
| **dropout_siege** | **8 mid-claim 2.5-4s total-silence dropouts**  | **35**    | **39.7%** ← WORST |

### The two big surprises (and what they mean)

- **Wind does NOT break coverage.** `wind_extreme` (sustained rumble, gusts slammed to 0 dBFS,
  integrated -9.6 LUFS) scored **86.8% = clean**, and produced 81 STT words vs clean's 82.
  Deepgram nova-3 separates voice from an *additive* sub-200Hz bed cleanly. The field-report
  wind loss was **capture-gain** damage — an unshielded iPhone body mic whose gusts *pumped and
  clipped the speech itself* (peaks -0.3 dBFS over speech in the -30s) — words drowned *before
  digitization*. Synthetic additive wind doesn't reproduce that regime, so STT rides through it.
- **Faint / low level does NOT break coverage** either (88.2%). nova-3 handles quiet speech.

The **only** knob that collapses coverage is **long total-silence dropouts mid-claim**. Every
other knob (wind, microgaps, packet-loss bursts, low level, crosstalk) is survived by the
STT+window chain.

## Breaking point — the dropout ladder

3s mid-claim total-silence dropouts, count swept:

| # dropouts | coverage |
|-----------:|----------|
| 0 (clean)  | 86.8% |
| 2          | 76.5% |
| 4          | 64.7% |
| 6          | 52.9% |
| 8          | **39.7%** |

Roughly **-6 coverage points per mid-claim 3s dropout**. Coverage crosses **50% between 6 and
8** dropouts. Extrapolating linearly, reaching the **27%** run-test baseline needs **~10-11**
such dropouts in a 42s window — a dropout every ~4s, i.e. a near-continuously-broken bond. The
real run saw only **two** back-to-back handoff dropouts (which the bond recovered), so the field
was nowhere near this regime; the 27% there was **shred + final-centric ingestion**, which the
window already fixed. The window is not at risk from realistic transport loss.

## Worst profile + the failing fixture

- **Worst profile: `dropout_siege` — 39.7% word coverage.** Committed:
  - `daysprint/synthetic/fixtures/dropout_siege.sidecar.json` (full 31-segment street script)
  - `daysprint/synthetic/fixtures/dropout_siege.replay.json` — **FAILING FIXTURE**: the real
    captured Deepgram finals, replayable with **no keys**:
    `node tools/synthetic/simulate.js --replay daysprint/synthetic/fixtures/dropout_siege.replay.json`
    → reproduces **39.7%** deterministically. The transcript shows the mechanism directly:
    "You can see the Great Wall Of China" (rest muted), "The US economy is around" (number muted),
    "Flamingos are" (rest muted).
  - Registered in `npm run synth:fixtures` for wav regeneration.
- **Regression pins** (`test/window-ingestion.test.js`, section 6): three tests embedding the
  real dropout_siege finals inline — (1) coverage collapses < 50% under transport loss,
  (2) the window loses **NOTHING** it receives (window-word-retention = 100%), (3) the clean
  case is unregressed.

## Does the window hold? — YES.

Proven two ways: (a) coverage tracks STT-word-count **1:1** across all profiles (clean 82→86.8%,
dropout_siege 35→39.7%); (b) direct measurement — on every profile, **every unique word Deepgram
transcribed reached a window** (0 dropped). The window is a faithful downstream consumer; it
cannot be the failure point because it sits downstream of the loss.

## GREEN fix — none applicable (and why not, honestly)

There is **no window-tunable that recovers dropout coverage**: the missing words were never
captured, so no `WINDOW_*` value can bring them back. Applying a window "fix" here would be
fabricated — the correct mitigation is transport-layer (bonded-link recovery / SRT retransmit,
already the relay's job) and capture-layer (mic shielding), both out of the window's scope. No
window change was made; the clean/run-shape behavior is untouched (verified by the unregressed
pin + the full W1.3 replay pin still green).

## High-pass (120 Hz) — does it measurably help? — NO (in this test), and the reason matters.

Tested the phase-2 prescription (`highpass=f=120` from `tools/street/obs-audio-preset.md`) by
pre-filtering windy fixtures before STT:

| profile        | no HP  | HP 120Hz | delta |
|----------------|--------|----------|-------|
| windy_run      | 80.9%  | 80.9%    | **0.0** |
| wind_extreme   | 86.8%  | 86.8%    | **0.0** |
| worst_case     | 50.0%  | 50.0%    | **0.0** |
| dropout_siege  | 39.7%  | 39.7%    | **0.0** |

**Zero measurable coverage change on any profile.** This is an honest null result with a clear
cause: the high-pass recovers coverage only when sub-200Hz rumble is *masking* speech at the STT
input — but nova-3 already handled the synthetic wind bed at clean-level coverage (86.8%), so
there was no masking loss to recover. The OBS preset doc says exactly this: *"Speech that was
drowned or pumped by the gust at capture is gone before OBS ever sees it."* The high-pass is
still worth deploying (it de-rumbles the recording and protects against the *capture-clipping*
regime this synthetic bed can't reproduce), but **the empirical claim "high-pass recovers
coverage" is not supported by this test** — coverage was never the thing wind cost us at the STT
stage. To prove the high-pass's real value we'd need a fixture that reproduces gust-driven
*capture-gain pumping/clipping of the speech itself* (a level-modulated speech track, not an
additive bed) — flagged as the next audio-chain experiment.

## Artifacts

- `tools/synthetic/profiles.js` — 6 red-team profiles + 3-rung dropout ladder
- `tools/synthetic/redteam-sweep.js` — STT+window coverage harness (real Deepgram)
- `tools/synthetic/scripts/redteam-claims.jsonl` — compact sweep script
- `daysprint/synthetic/results/redteam-audio-sweep.json` — all 15 runs (base + ladder + HP)
- `daysprint/synthetic/fixtures/dropout_siege.{sidecar,replay}.json` — worst profile + failing fixture
- `test/window-ingestion.test.js` §6 — red-team regression pins (396 tests green)
