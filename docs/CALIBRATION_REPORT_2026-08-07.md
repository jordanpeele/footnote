# Calibration report — 2026-08-07 overnight run (P3-E)

**The five-minute read before you set auto-air scope (D12/D3).**
Run: 173 golden cases, full pipeline (extract → verify) against production, scored by
token-F1 AND the LLM judge (harness v2). Raw: `eval/results/2026-08-07T04-37-45.jsonl`,
full log `eval/results/overnight-run.log`.

## The answer

**Auto-air eligible categories: NONE.**

For the street shoot, run manual (veto-everything), same as the remote test. This is not
a failure — it's the calibration gate doing its job: autonomy has to be measured into
existence, and the measurements aren't there yet.

## Why nothing cleared

Two independent reasons, both fixable:

1. **Sample size.** The bar is ≥20 scored samples at the confidence floor per category.
   Every unblocked category came in at 18–19 (a few claims verify below the 0.85 floor
   or error out, shaving the scored n). One more golden-set growth pass (~5-8 cases per
   category) closes this.
2. **Measured precision is below the bar anyway.** Where we do have data, verdict
   precision at the floor runs 94–95% against a 95% bar. Close, but "close" on a
   fact-checker means one wrong verdict per ~20 aired checks — not good enough to
   remove the human. The wrong verdicts cluster in quote/context cases (verify returns
   NeedsContext where the golden truth is True/False).

## Category detail

| category | verdict precision @floor | n @floor | judge-clean | inversions | status |
|---|---|---|---|---|---|
| statistics | 94.4% | 18 | 100% | 0 | insufficient-n |
| science_health | 94.7% | 19 | 95.2% | 0 | insufficient-n |
| current_events | — | 18 | — | 0 | insufficient-n |
| historical_events | — | 18 | — | 0 | insufficient-n |
| geography_civics | — | 19 | — | 0 | insufficient-n |
| adversarial | — | 19 | — | — | insufficient-n |
| polarity_traps | 83.3% | 12 | 41.7% | **6** | insufficient-n |
| attributed_quotes | — | — | — | — | **BLOCKED (D11)** |
| person_claims | — | — | — | — | **NEVER (D4)** |

## Case study: the Einstein inversion (launch-story material)

The judge earned its keep this run. Live in production, the extractor turned the spoken
claim "Einstein said [the insanity quote]" into "Einstein did NOT say [it]" — a polarity
inversion that token-F1 scored as a PASS at 0.828 similarity. The LLM judge flagged it
`polarity_inverted`. Round 2's extractor v2 (canonical-assertive claim + explicit
polarity field) plus the polarity_traps category now trap this class structurally: 6
inversions caught in this run, every one flagged for human adjudication rather than
silently scored. A fact-checking system that can't see its own worst failure mode can't
earn autonomy; this one now sees it.

## What it takes to clear a category (the path to street auto-air)

1. Grow each category to ~30 golden cases (n≥20 survives sub-floor attrition).
2. Adjudicate the 6 polarity inversions + open disagreements in the results file
   (`"adjudicated": true` workflow, eval/README.md).
3. Fix the quote/context verdict misses (verify prompt: when evidence is definitive,
   commit to True/False rather than NeedsContext) — this is where the ~5% precision gap
   lives.
4. Re-run overnight. A category clears at ≥95% under BOTH scorers with zero
   uninvestigated inversions.

Statistics and science_health are closest — likely one growth-pass away.
