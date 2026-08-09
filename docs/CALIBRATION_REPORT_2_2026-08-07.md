# Calibration report #2 — 2026-08-07 (P3-I re-run, the D15 street-scope artifact)

**The answer: auto-air eligible categories — NONE. Street shoot runs veto-everything.**
Per D15 this is an acceptable outcome, not a failure state. It is also now a *confident*
answer rather than an underpowered one.

Run: 260 golden cases (grown from 173; statistics/science/current/historical/geography/
adversarial at 34-35 each), full pipeline against production, both scorers. Raw:
`eval/results/rerun2.log` + the results JSONL beside it. Re-adjudication audit:
`eval/ADJUDICATIONS.md`.

## What changed since run #1 — and what it revealed

Run #1 said "insufficient-n everywhere" (18-19 scored vs the bar). The growth pass fixed
that: core categories now score n=27-32 at the floor. With real statistical power, the
excuse is gone and the truth is visible:

**Measured verdict precision at the confidence floor, by category:**

| category | precision @floor | n | judge-clean | status |
|---|---|---|---|---|
| statistics | 87.5% | 32 | 100% | below-bar |
| science_health | 93.8% | 32 | 97.1% | below-bar |
| historical_events | 93.8% | 32 | — | below-bar |
| geography_civics | 90.6% | 32 | — | below-bar |
| current_events | 84.4% | 32 | — | below-bar |
| adversarial | — | — | 2 uninvestigated inversions | below-bar |
| attributed_quotes | — | — | — | BLOCKED (D11) |
| person_claims | 100% | 18 | 95% | NEVER (D4) |
| polarity_traps | 91.7% | 12 | 41.7% | insufficient-n (tripwire set) |

Note precision went DOWN versus run #1 (94-95% → 84-94%). That is the growth pass working
as designed: the 87 new cases deliberately skewed False/mid-tier ("no easy-True stacking"),
so run #2 measures the verifier against a representative diet instead of a friendly one.
**On honest material, the verifier is an ~85-94% instrument at the floor. The 95% bar is
not close, and 94.x would not have rounded up anyway.**

## Why, and what would actually move it

- The dominant miss class is unchanged: verifier under-commitment (NeedsContext/Misleading
  where evidence is definitive) plus a smaller class of confident-wrong on genuinely hard
  mid-tier claims.
- The permitted prompt iteration was ATTEMPTED AND REJECTED this round: commitment language
  fixed the hedges but flipped control cases to confident-wrong definitive verdicts —
  strictly worse on air. Full before/after in `eval/ADJUDICATIONS.md`.
- The credible next lever is structural, not prompt-tuning: a two-step verify (evidence
  gathering, then a separate verdict-commitment step against the evidence), or a
  second-verifier concurrence gate for auto-air. Both are round-4+ design work.
- 6 polarity inversions + open scorer disagreements still need the `"adjudicated": true`
  human pass before any category can satisfy the zero-uninvestigated-inversions condition.

## Operational meaning

- **Street shoot: veto-everything.** The second-phone operator page (/op) is the street
  authority; nothing airs without a thumb. Auto-air stays unticked.
- The Auto-air toggle remains safe to leave OFF-by-default in the product: the calibration
  gate (D3) has now twice declined to grant autonomy, on evidence. That's the system
  working — and the launch story: *the fact-checker that measured itself and kept the
  human.*
