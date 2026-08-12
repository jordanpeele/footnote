# R49 concurrence eval — 2026-08-12 (executes D16; the D18 precondition run)

First live run of two-verifier concurrence: `perplexity` (sonar-pro) ∥ `brave-claude`
(Brave Search evidence + Claude verdict — independent index AND model), with the R50
independent polarity signal active. 69 goldens (adversarial 34, science_health 35),
zero arm errors, ~$5 spend. Raw: `eval/results/r49-{adversarial,science_health}-2026-08-12.jsonl`.

## Headline: the D18 precondition is MET for science_health

| | adversarial | science_health |
|---|---|---|
| concurrence rate (arms agree) | **96.9%** (31/32) | **100%** (32/32) |
| merged verdict accuracy | 96.9% | 93.8% |
| precision @0.85 floor | **100%** (30/30) | **100%** (29/29) |
| wrong card that would AUTO-AIR | **0** | **0** |

- **science_health ≥95% concurrence: YES (100%).** D18 precondition (1) met.
  Precondition (2) — R50 guard shipped + replay-verified — met earlier today.
  Precondition (3) — the operator's skepticism re-read — remains open (human).
- adversarial's numbers stand as calibration fact only (R51: permanently manual).

## Disagreement cases, verbatim (per the ruling)

**adversarial — 1 disagreement:**
- `adv-026` — claim "Honey never spoils." (golden **True**)
  - perplexity: **NeedsContext** · brave-claude: **True** → merged **NeedsContext** (conservative downgrade)
  - Cost: one true claim held for the human instead of airing. This is the intended
    trade — disagreement never airs; the human decides.

**science_health — 0 disagreements.** But one case is the important lesson:

- `sci-033` — claim "A supplement company's internal study proved its pill doubles
  energy levels." (golden **Unverifiable**)
  - perplexity: **False** · brave-claude: **False** → merged **False** — BOTH ARMS
    AGREED ON A WRONG-VOCABULARY VERDICT (an unverifiable corporate claim called
    False). Concurrence alone would have been air-eligible.
  - **The floor caught it:** concurrence takes the MIN of arm confidences → 0.72,
    below the 0.85 auto-air floor → would NOT auto-air in production.
  - Two lessons: (a) concurrence is not sufficient alone — engines share cultural
    priors and can agree wrong; the layered gate (concurrence + floor + tier) is the
    unit that held. (b) Notably, min-of-arms confidence did real discriminating work
    here — the first time the confidence number has earned its place in the gate
    chain (it is still non-load-bearing by design per D18, but it is no longer
    pure theater under concurrence).

## Cost/latency observed
Concurrence verify wall time ≈ 3.5s (arms + polarity signal in parallel; ~0.9s over
single-verifier). Per-check cost roughly 2.2× single-verifier (two engines + one
Haiku signal). For an auto-air pilot capped at 10/session this is negligible; for
always-on checking it's a real spend-profile choice.

## D18 status after this run
1. ✅ Concurrence ≥95% on science_health (100%)
2. ✅ R50 polarity guard shipped + replay-verified (geo-029 caught, zero false holds)
3. ☐ Operator skepticism re-read of the category's misses — **the remaining gate,
   ~15 minutes of human reading** (the 2 science_health canonical misses + sci-033).

When (3) completes, D18 activation is an orchestrator + operator decision. Until
then: veto-everything, unchanged.
