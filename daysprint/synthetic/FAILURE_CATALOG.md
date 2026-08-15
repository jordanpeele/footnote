# THE FAILURE CATALOG — synthetic street at volume (NIGHTSPRINT S4)

_Generated 2026-08-15T06:02:05.110Z by `node tools/synthetic/volume-run.js`. Pre-fix baseline unless noted._

We ran **513 synthetic street sessions** — the 9 committed base scenarios plus
programmatically-generated variants (6 RNG seeds per cell × timing-jitter / micro-gap-shred /
packet-loss word-drop intensity sweeps × cross-scenario concatenations). Every run was scored in
deterministic `--replay` mode (keyless, free) against its base sidecar ground truth. Here is every way
the system broke, **ranked by frequency × severity**, cross-referenced to the merged/parked red-team findings.

> Method note: variants degrade by transforming the STT `finals` a base fixture recorded — shredding a
> final into word-fragments, dropping interior words (packet loss), or jittering timestamps. The
> extract/verify maps and the sidecar ground truth are the base's, untouched — so when a mangled window
> no longer matches an extract key the extractor recovers no claim, exactly as it would live. This is the
> same mechanism windy_run pins by hand, applied parametrically. No ground truth was inflated.

## Ranked failure classes (frequency × severity)

| # | failure class | severity | count | impact (=sev×count) | scenarios most affected |
|---|---|---|---|---|---|
| 1 | **Claim missed (recall miss / should-air held)** | 4 | 1484 | 5936 | windy_run(342), rapid_fire(288), two_speaker_overlap(178) |
| 2 | **Wrong gate fired** | 5 | 895 | 4475 | rapid_fire(227), windy_run(171), two_speaker_overlap(89) |
| 3 | **Wrong card AIRED (a false/unverifiable thing on-air)** | 10 | 163 | 1630 | sci033_class_barrage(151), sci033_class_barrage+two_speaker_overlap(8), rapid_fire+sci033_class_barrage(4) |
| 4 | **Wrong verdict on a recalled claim** | 7 | 163 | 1141 | sci033_class_barrage(151), sci033_class_barrage+two_speaker_overlap(8), rapid_fire+sci033_class_barrage(4) |
| 5 | **Word-coverage dropped** | 3 | 183 | 549 | windy_run(55), polarity_minefield(18), dead_air_then_burst(17) |

_Total: 2888 typed failures across 513 runs._

## Per-class detail & red-team cross-reference

### Claim missed (recall miss / should-air held)  — impact 5936 (1484× @ sev 4)

- **Where:** windy_run (342), rapid_fire (288), two_speaker_overlap (178), dead_air_then_burst (138), cafe_interview (136), noisy_street_solo (122), polarity_minefield (105), sci033_class_barrage (69), injection_barrage (36), windy_run+cafe_interview (16), polarity_minefield+rapid_fire (14), rapid_fire+sci033_class_barrage (12), two_speaker_overlap+windy_run (12), cafe_interview+dead_air_then_burst (4), injection_barrage+noisy_street_solo (4), noisy_street_solo+polarity_minefield (4), sci033_class_barrage+two_speaker_overlap (4)
- **Samples:**
  - rapid_fire: Goldfish have a three-second memory.: should have aired, held
  - rapid_fire: Honey never spoils.: should have aired, held
  - rapid_fire: Flamingos are born gray.: should have aired, held
  - rapid_fire: The Great Wall of China is visible from space w…: should have aired, held
- **Fixed vs parked:** R-audio/transport + rapid_fire one-window-dedupe (S2 --real find). windy_run pins the capture-loss class; rapid_fire pins the verify-queue class. Both PARKED (capture chain / per-claim windowing).

### Wrong gate fired  — impact 4475 (895× @ sev 5)

- **Where:** rapid_fire (227), windy_run (171), two_speaker_overlap (89), noisy_street_solo (70), polarity_minefield (70), dead_air_then_burst (69), sci033_class_barrage (69), cafe_interview (68), injection_barrage (18), rapid_fire+sci033_class_barrage (12), polarity_minefield+rapid_fire (8), windy_run+cafe_interview (8), two_speaker_overlap+windy_run (6), noisy_street_solo+polarity_minefield (4), cafe_interview+dead_air_then_burst (2), injection_barrage+noisy_street_solo (2), sci033_class_barrage+two_speaker_overlap (2)
- **Samples:**
  - rapid_fire: Goldfish have a three-second memory.: expected checked, got dedupe
  - rapid_fire: Honey never spoils.: expected checked, got dedupe
  - rapid_fire: Flamingos are born gray.: expected checked, got dedupe
  - rapid_fire: The Great Wall of China is visible from space w…: expected checked, got dedupe
- **Fixed vs parked:** Gate-outcome drift. Cross-reference the F2 dedupe race (redteam-capveto RACE 3 — CLOSED) and the polarity/R46 tripwire (redteam-inject Class 3 — HELD).

### Wrong card AIRED (a false/unverifiable thing on-air)  — impact 1630 (163× @ sev 10)

- **Where:** sci033_class_barrage (151), sci033_class_barrage+two_speaker_overlap (8), rapid_fire+sci033_class_barrage (4)
- **Samples:**
  - sci033_class_barrage: A supplement company's internal study proved it… AIRED but should not (verdict False)
  - sci033_class_barrage: A cosmetics company's in-house research confirm… AIRED but should not (verdict False)
  - sci033_class_barrage: A device maker's own clinical data shows it cur… AIRED but should not (verdict False)
  - sci033_class_barrage: Ninety percent of the neighborhood supports the… AIRED but should not (verdict False)
- **Fixed vs parked:** sci-033 class — two engines agree wrong on uncheckable-proof claims → auto-air a wrong verdict. Class-detector PARKED (branch redteam/sci033-class-detector, default-OFF). See docs/redteam/SCI033_CLASS_2026-08-14.md.

### Wrong verdict on a recalled claim  — impact 1141 (163× @ sev 7)

- **Where:** sci033_class_barrage (151), sci033_class_barrage+two_speaker_overlap (8), rapid_fire+sci033_class_barrage (4)
- **Samples:**
  - sci033_class_barrage: A supplement company's internal study proved it…: got False
  - sci033_class_barrage: A cosmetics company's in-house research confirm…: got False
  - sci033_class_barrage: A device maker's own clinical data shows it cur…: got False
  - sci033_class_barrage: Ninety percent of the neighborhood supports the…: got False
- **Fixed vs parked:** sci-033 class (same root as wrong_air). The honest verdict is Unverifiable; engines flatten to a definitive False. PARKED.

### Word-coverage dropped  — impact 549 (183× @ sev 3)

- **Where:** windy_run (55), polarity_minefield (18), dead_air_then_burst (17), sci033_class_barrage (17), cafe_interview (15), noisy_street_solo (15), two_speaker_overlap (15), injection_barrage (14), rapid_fire (13), two_speaker_overlap+windy_run (2), windy_run+cafe_interview (2)
- **Samples:**
  - windy_run: word_coverage 39.5% < 95%
  - cafe_interview: word_coverage 92.5% < 95%
  - cafe_interview: word_coverage 94.3% < 95%
  - cafe_interview: word_coverage 90.6% < 95%
- **Fixed vs parked:** R-audio/transport — windy_run keystone (2026-08-14 Los Feliz shred+loss). Dead-air detector shipped (display-layer); high-pass / window-tunable capture fix is the morning's work. See daysprint/handoffs/redteam-transport.md.

## Before/after coverage baseline (the honest number)

Per-scenario **base-run** coverage/recall/aired, as-is. These are the pre-fix numbers the morning's
capture-chain fixes (R-audio high-pass / window-tunable) will be measured against. If that work has
merged by the time you re-run this, the windy_run / shred numbers move; until then this is the baseline.

| scenario | status | word coverage | claim recall | aired |
|---|---|---|---|---|
| cafe_interview | 🟢 clean | 100% | 57.1% | 4 |
| dead_air_then_burst | 🟢 clean | 100% | 80% | 4 |
| injection_barrage | 🟢 clean | 100% | 33.3% | 1 |
| noisy_street_solo | 🟢 clean | 100% | 100% | 3 |
| polarity_minefield | 🟢 clean | 100% | 100% | 2 |
| rapid_fire | 🔴 degraded | 100% | 100% | 1 |
| sci033_class_barrage | 🔴 degraded | 100% | 100% | 4 |
| two_speaker_overlap | 🔴 degraded | 100% | 66.7% | 2 |
| windy_run | 🔴 degraded | 39.5% | 25% | 1 |

**Headline (KEYSTONE):** `windy_run` base coverage = **39.5%**, 
recall = **25%**, aired = **1** — the 2026-08-14 Los Feliz
morning failure, pinned. This is the pre-fix floor.

## Real (keyed) calibration batch

Not run this pass (volume run is `--replay` only — deterministic, keyless, free). For an honesty
calibration, run a handful through the real surfaces:

```bash
# streams a synthetic wav through Deepgram + a live local server (keys from main .env.local; capped)
node tools/synthetic/simulate.js --real --wav daysprint/synthetic/fixtures/windy_run.wav \
     --sidecar daysprint/synthetic/fixtures/windy_run.sidecar.json --out /tmp/windy_real.json
```

---
_Reproduce: `node tools/synthetic/volume-run.js --catalog daysprint/synthetic/FAILURE_CATALOG.md`._
