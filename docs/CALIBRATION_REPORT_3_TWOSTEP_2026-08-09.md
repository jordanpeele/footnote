# Calibration report #3 — 2026-08-09 (P4-C: the two-step verifier's promotion eval)

**The answer: `perplexity-twostep` does NOT clear the D15 bar. It stays dark.**
Best category precision at the floor is 93.8% against the 95% requirement; the regression
guard (the three mid-tier controls) is explicitly violated; and the zero-uninvestigated-
inversions precondition remains unmet — as in run #2, no polarity inversion or scorer
disagreement has yet received the human `"adjudicated": true` pass, so that condition
fails regardless of scores. Production stays on the single-shot default; street/live
operation stays veto-everything.

Run: full golden set, both stages, both scorers (token + LLM judge), against a **local**
server on port 3100 with `FOOTNOTE_VERIFIER=perplexity-twostep` (never production —
docs/VERIFY_TWOSTEP.md). Raw artifacts in `eval/results/` (gitignored):

- results (as appended): `run3-twostep-2026-08-09.jsonl`
- **results (scored — use this one): `run3-twostep-2026-08-09-final.jsonl`** (320 rows)
- harness log: `run3-twostep-2026-08-09.log`; server log: `server-twostep-3100.log`
- per-call Perplexity observability: `fetch-tap.log` (see "Method notes")

Baseline for every comparison: run #2, `docs/CALIBRATION_REPORT_2_2026-08-07.md`
(results `eval/results/2026-08-07T13-45-01.jsonl`, 260 cases, single-shot verifier in
production).

## Adapter-selection verification (before spending)

The two-step adapter has no success-path logging and no debug flag, so selection was
verified two ways before the full run:

1. `src/core/registry.js` reads `FOOTNOTE_VERIFIER` at call time; `perplexity-twostep`
   maps to `src/adapters/verifier/perplexity-twostep/index.js` (read, not modified).
2. A `fetch` tap (eval-only preload injected via `NODE_OPTIONS --import`, file lives in
   gitignored `eval/results/fetch-tap.mjs`; product code untouched) logged every
   Perplexity call. A single smoke `/api/verify` produced exactly **two** `sonar-pro`
   calls: step 1 with search + the evidence-gathering system prompt, step 2 with
   `disable_search: true`, `temperature: 0` + the verdict system prompt. The tap stayed
   on for the whole run: 652 calls, all in step-1/step-2 pairs, zero non-200s.

## Headline: precision at the floor, run #2 (single-shot) vs run #3 (two-step)

| category | run #2 @floor | run #3 @floor | Δ | run #2 judge-clean | run #3 judge-clean | status (D3 gate) |
|---|---|---|---|---|---|---|
| statistics | 87.5% (n=32) | **90.6% (n=32)** | +3.1 | 100% | 88.6% | below-bar |
| science_health | 93.8% (n=32) | **93.8% (n=32)** | 0 | 97.1% | 85.7% | below-bar |
| historical_events | 93.8% (n=32) | **93.8% (n=32)** | 0 | — | 65.7% | below-bar |
| geography_civics | 90.6% (n=32) | **90.6% (n=32)** | 0 | — | 64.7% | below-bar |
| current_events | 84.4% (n=32) | **87.5% (n=32)** | +3.1 | — | 94.3% | below-bar |
| adversarial | 96.9% (n=32)¹ | **96.9% (n=32)** | 0 | 2 uninv. inversions | 85.3%, 2 uninv. inversions | below-bar (inversions + control flip) |
| attributed_quotes | 83.3% (n=18) | 88.9% (n=18) | +5.6 | — | 75.0% | BLOCKED (D11) |
| person_claims | 100% (n=18) | 100% (n=19) | 0 | 95% | 85.0% | NEVER (D4) |
| polarity_traps | 91.7% (n=12) | 91.7% (n=12) | 0 | 41.7% | 41.7% (6 uninv. inversions) | insufficient-n |

¹ Run #2's report table showed adversarial as "—" (blocked on its 2 uninvestigated
inversions before precision was worth quoting); 96.9%/32 is recomputed here from the run
#2 results file for a like-for-like comparison.

**No category reaches 95%.** The closest (science_health, historical_events) are 1.2
points short; statistics and geography 4.4 short; current_events 7.5 short. The two
categories that moved (+3.1 statistics, +3.1 current_events) moved for the intended
reason — hedges converted to correct definitive verdicts — but the gains are small
because under-commitment was no longer the dominant @floor miss class on the post-growth
golden diet (see next section). Adversarial's 96.9% exceeds the threshold but fails the
gate on its two uninvestigated extraction-stage inversions (adv-007, adv-027) — and its
single verdict miss is itself the failed adv-010 control (below).

Judge-clean deltas are an **extractor**-stage property (same extractor both runs; Haiku
is stochastic run to run, and this run judged fuzzy matches that run #2's cache had
already cleared). They do not measure the verifier — stage 2 is fed the *expected*
extraction by design — but they feed the both-scorers-clean gate condition, which fails
in both runs for the same reason: nothing has been human-adjudicated yet.

## Did the failure mode move? Yes — and that is the problem

The two-step design targeted two miss classes: (1) under-commitment (NeedsContext/
Misleading at high confidence on definitive evidence), (2) confident-wrong via
verdict/correction inconsistency. Across all scored verdicts (both runs, same 241
scorable goldens):

| behavior | run #2 (single-shot) | run #3 (two-step) |
|---|---|---|
| hedged (mid-tier verdict) on a definitive-golden claim, n=221 | 5 (2.3%) | **3 (1.4%)** |
| wrong-direction definitive verdict (True↔False) | 3 | **0** |
| definitive verdict on a mid-tier golden (NC/Misleading/Unverifiable), n=20 | 11 (55.0%) | **13 (65.0%)** |

- **Under-commitment: fixed.** The flagship hedges cleared — quote-002 (Armstrong)
  NeedsContext 0.97 → True 0.98, quote-005 (Gandhi) NeedsContext 0.95 → False 0.98,
  pol-006 (Nixon) and sci-013 (chimp DNA) stayed correct-definitive. Rule (2) of the
  step-2 prompt does what it says. (One residual/variance case: curr-019, the 2022
  inflation claim, regressed True 0.98 → NeedsContext 0.98 this run.)
- **Wrong-direction definitive verdicts: eliminated** (3 → 0). Run #2's curr-022/curr-029
  class (False on a True golden) did not recur; the verdict/evidence-consistency guards
  (rules 5-6) appear to work for *direction*.
- **But confident-wrong on mid-tier claims got worse, not better** (11 → 13 of 20 — and
  at 0.93-0.99 confidence, every one of them airs under an auto-air floor of 0.85). This
  is the same trade the rejected prompt iteration made (eval/ADJUDICATIONS.md), arriving
  through the structural route in softer form. The two-step moved the miss mass from
  "hedges on definitive claims" to "definitive verdicts on claims that deserve hedges,"
  which is the worse failure on air.

## The regression guard: explicitly violated

D15/VERIFY_TWOSTEP.md names three mid-tier controls that must NOT flip to confident
definitive verdicts:

| control | golden | run #2 (single-shot) | run #3 (two-step) | guard |
|---|---|---|---|---|
| geo-019 Sahara largest desert | NeedsContext | False 0.99 ✗ | **False 0.99 ✗** | fail (already failing in #2) |
| stat-017 half of marriages end in divorce | Misleading | False 0.95 ✗ | **False 0.98 ✗** | fail (already failing in #2) |
| adv-010 neighbor saw a UFO | Unverifiable | Unverifiable 0.86 ✓ | **False 0.97 ✗** | **fail — REGRESSION vs #2** |

adv-010 is the damning one: run #2's single-shot got it right, and the two-step — whose
rules (1) and (6) exist precisely to force Unverifiable when no qualifying evidence bears
on the claim — returned a confident False on a private anecdote. The evidence-lines guard
did not hold: step 1 evidently returned general UFO-adjacent findings and step 2 treated
them as bearing on the neighbor's sighting. Related same-shape misses this run: stat-032
and sci-033 (Unverifiable goldens → False 0.96-0.98). Under the D15 clause — *"precision
that arrives by trading hedges for confident-wrong is a fail, not a pass"* — this alone
blocks promotion even if a category had cleared 95%.

## Confidence is saturated — the floor filters nothing

Mean confidence when correct 0.986 vs 0.972 when wrong; **zero** scored verdicts came in
below the 0.85 floor (n@floor == n scored in every category; run #2 had a thin sub-floor
tail). Two-step confidence carries no usable signal for the auto-air gate — the
temperature-0 verdict step pins nearly everything at 0.93-0.99. Any future gate work
should assume verdict-level confidence cannot price risk and lean on structural signals
(source tier, evidence_lines count, claim category) instead.

## Latency and cost (accepted trade, cheaper than advertised)

From the fetch tap across the full run (652 calls, 326 verifies, zero upstream non-200s):

- step 1 (evidence, search on): mean 3.20s, median 3.10s, p95 4.38s
- step 2 (verdict, search off): mean 1.05s, median 0.95s, p95 1.56s
- **per verify: mean ≈ 4.25s** — ≈ **1.33x** a single search call, not the ~2x
  docs/VERIFY_TWOSTEP.md budgeted; the no-search verdict call is much cheaper than a
  search call. Worst-case tail ≈ 6s.

Spend this eval: 326 verify pairs = 652 sonar-pro calls (≈ $5-6 at sonar-pro
token+search pricing), plus ~370 Haiku extractions and 172 judge calls (≈ $0.25
combined). **≈ $5-6 total**, within the sanctioned $4-8 envelope. That includes the ~35
calls burned on the aborted first attempt and the current_events rerun (method notes).

## PROMOTION VERDICT (D15)

**NOT PROMOTED. `perplexity-twostep` stays dark** — not the registry default, not set in
any deployed environment. Against the bar, condition by condition:

1. **≥95% @floor, per category: FAIL everywhere.** Best 93.8% (science_health,
   historical_events, -1.2 pts); statistics/geography 90.6% (-4.4); current_events 87.5%
   (-7.5). Adversarial's 96.9% clears the number but fails conditions 3-4.
2. **n ≥ 30 per category: MET** for the six core categories (n=32); polarity_traps
   (n=12) and quotes/person (n=18-19) remain under-powered/blocked as before.
3. **Both scorers clean, zero uninvestigated inversions: FAIL.** 13 uninvestigated
   polarity inversions (6 polarity_traps, 4 geography, 2 adversarial, 1 current_events)
   and 30 open scorer disagreements. As in runs #1-2, **no human adjudication pass has
   happened** — this precondition is unmet independent of any score in this report.
4. **Regression guard: FAIL.** All three controls are confident definitive False; adv-010
   is a clean regression against the single-shot baseline.

Honest summary: the structural fix did exactly what it was designed to do — hedging on
definitive evidence is essentially gone (2.3% → 1.4%) and wrong-direction verdicts went
to zero — and it still isn't enough, because it bought those wins by over-committing on
the mid-tier and unverifiable claims (55% → 65%) that the D15 controls exist to protect.
Net precision moved +0 to +3.1 points per category against a 1.2-7.5 point gap. The next
credible lever is not this adapter as-is: candidates are (a) hardening step 2's
NO_EVIDENCE/bearing-evidence discipline (adv-010 shows rule 6 is not binding in
practice), (b) a second-verifier concurrence gate for auto-air, and (c) doing the human
adjudication pass, without which no category can clear condition 3 no matter what any
verifier scores.

Per VERIFY_TWOSTEP.md: even a passing eval would only make flipping the default *its own
decision*; a failing one makes it no decision at all.

## Method notes (deviations from the run #2 protocol — read before comparing)

- **Golden set grew underneath the eval.** `eval/golden/` now contains 60 UNCATEGORIZED
  field-test draft cases (51 from 2026-08-08 plus 9 `draft-2026-08-09-*` added by a
  concurrent field-test session on this machine *while this eval ran*). They have null
  ground-truth verdicts, so they burn extract/verify spend but score nothing; they appear
  as the no-data UNCATEGORIZED row in report.js output. Run #3's scorable set is the same
  260 cases as run #2.
- **Chunked execution.** The single `--all` invocation was killed twice by the harness
  environment (background-process reaping), so the run executed as 10 sequential
  per-category `eval/run.js --category X --all --judge --out <shared file>` chunks, each
  with its own short-lived server on port 3100. Same harness, same throttles, same
  scoring; only the process supervision differs.
- **current_events was rerun in full.** A concurrent session's cleanup killed the eval
  server mid-chunk, leaving 12 `fetch failed` rows; the category was rerun end-to-end.
  `run3-twostep-2026-08-09-final.jsonl` keeps the **last** occurrence per case id (fresh
  complete rerun supersedes the partial), which is the file report.js and every number
  above are computed from. The raw append-order file is retained beside it. No other ids
  were duplicated; the final file has zero HTTP-error rows.
- The `.env.local` Deepgram-shadowing warning fired at server start; STT is not exercised
  by this eval.
