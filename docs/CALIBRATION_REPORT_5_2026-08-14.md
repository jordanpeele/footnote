# Calibration report #5 — 2026-08-14 (first FULL-set run under the concurrence verifier)

**The answer to the standing question: two categories are auto-air ELIGIBLE at the D3 gate —
`current_events` (new) and `science_health` (repeat) — and against the stricter R64-A-0d
graduation bar, exactly ONE category clears: `science_health`.** This is the first calibration
where the whole golden set ran through `FOOTNOTE_VERIFIER=concurrence` (perplexity ∥
brave-claude, R49's pairing) instead of single-verifier sonar-pro, and the two headline
predictions from R49 both held at full scale: concurrence lifts floor precision into the
95%+ neighborhood, and min-of-arms confidence finally does real discriminating work.

Run: all 260 goldens through the LIVE local pipeline (extract → verify) with `--judge --aired`,
server on `localhost:3100` with `FOOTNOTE_VERIFIER=concurrence`, `FOOTNOTE_CONCURRENCE_A=perplexity`,
`FOOTNOTE_CONCURRENCE_B=brave-claude`. Raw: `eval/results/calibration5-2026-08-14.jsonl` (260 rows,
canonical). Zero HTTP errors, zero judge errors. Standing rulings merged from `eval/adjudications.json`.
Wall ~70 min. Spend: ~$19 estimated for this packet (260 cases + 6-case smoke at the ~7¢/case
concurrence rate observed in R49); a further ~$2 was burned by the duplicate tail run described
in the methodology note. Within the approved $10–20 envelope, at the top end.

**Methodology note — duplicate tail run (read before trusting any other copy of this data):**
while the primary run was still executing its final ~23 cases, a second harness invocation
(the sprint HEALTH loop's `--skip-done` resume, flag added on main at bf12ecc after
diagnosing the run "DEAD at 227" — a diagnosis the logs contradict: the primary run never
died — single invocation header, 260/260 progress lines, clean exit 0) appended a
duplicate re-run of the last 23 cases
(ids `*-031`…`*-035`) into the same `--out` file, briefly producing 283 rows. The 23 foreign
rows were identified by matching every row against the primary run's own log and quarantined
to `eval/results/calibration5-2026-08-14-foreign-append.jsonl`; the canonical file is the
primary run's 260 rows exactly. Side effect that DOES touch the numbers: during the overlap
window the doubled request rate cost the primary run its perplexity arm on 9 verifies
(curr-032, geo-032, hist-032, stat-032, adv-033, curr-033, geo-033, hist-033, adv-034) — the
one-arm policy degraded them to `NeedsContext` at ~0.5 confidence, all below the floor. See
caveat 2 for the impact accounting.

## Per-category table

n = golden rows; vscored = stage-2 verdicts with ground truth; conc = both-arm agreement rate
(rows where both arms returned); scorers = judge/token state after standing rulings.

| category | n | vscored | verdict acc | n@floor | precision@0.85 | concurrence | scorers |
|---|---|---|---|---|---|---|---|
| adversarial | 34 | 32 | 90.6% | 28 | **100.0%** | 96.7% (29/30) | clean |
| attributed_quotes | 20 | 18 | 94.4% | 16 | **100.0%** | 88.9% (16/18) | clean |
| current_events | 35 | 32 | 87.5% | 29 | **96.6%** | 96.7% (29/30) | clean |
| geography_civics | 34 | 32 | 90.6% | 28 | **96.4%** | 93.3% (28/30) | 1 open (geo-005) |
| historical_events | 35 | 32 | 87.5% | 29 | 93.1% | 100.0% (30/30) | clean |
| person_claims | 20 | 19 | 94.7% | 16 | **100.0%** | 89.5% (17/19) | clean |
| polarity_traps | 12 | 12 | 91.7% | 10 | **100.0%** | 91.7% (11/12) | clean¹ |
| science_health | 35 | 32 | 93.8% | 30 | **96.7%** | 100.0% (32/32) | clean |
| statistics | 35 | 32 | 90.6% | 30 | 93.3% | 96.8% (30/31) | clean |
| **overall** | **260** | **241** | **90.9%** | **216** | **96.8%** | **95.7%** (222/232) | — |

¹ polarity_traps' 6 judge inversions are all standing-adjudicated (canonical-positive contract,
eval/ADJUDICATIONS.md) — investigated, not open.

D3 gate (report.js, n≥20 at floor): **ELIGIBLE — current_events, science_health.** adversarial
met the numeric bar again (100% at floor) and stays NEVER under R51; person_claims (100% at
floor) stays NEVER under D4; attributed_quotes (100% at floor) stays BLOCKED under D11 — though
see the graduation table: this is the first harness-v2-clean quote calibration, so lifting D11
is now a decidable question rather than a blocked one.

**Concurrence-specific numbers (first full-set measurement):**
- Overall both-arm agreement: **95.7%** (222/232 both-arm verdicts).
- Precision inside the `concurrence.eligible` subset (mutual definitive agreement): **96.8%** (210/217).
- Precision in the true auto-air population (eligible AND ≥0.85 floor): **96.8%** (209/216) —
  7 would-air-wrong cards across all categories: stat-017, stat-030, hist-029, hist-030,
  geo-019, curr-031, sci-033. Four of those seven are Misleading/NeedsContext-vocabulary claims
  that both engines called False with high confidence — engines sharing cultural priors and
  over-committing on nuance remains the residual failure mode, exactly as sci-033 taught in R49.

## Confidence is no longer theater (the A-2 story flips)

Mean confidence when correct vs wrong: **0.95 vs 0.60** — a 35-point gap where calibrations
1–4 had 0–2 points. This is min-of-arms + disagreement-halving doing the work, not the models
getting humbler. The below-floor population (25 rows) is 60% wrong verdicts — the 0.85 floor
now filters a real error class instead of nothing. One sharp exception, worth naming: sci-033
(unverifiable supplement-study claim) merged at **exactly 0.85** this run (R49: 0.72) — both
arms agreed False, eligible, AT the floor → **it would have aired.** R49's "the floor caught
it" did not repeat. The layered gate is better than any single layer, but it is not a wall.

## The F-1 polarity slice

191 goldens with `expected_polarity`:
- Polarity correct: **94.8%** (cal #4: 93.3%).
- **FS-8 class (asserts→denies): 9 — R46 tripwire catches all 9, misses 0.** Third consecutive
  clean sweep for R46.
- **MIRROR class (denies→asserts): 1 — geo-029, the known standing case** (adjudicated).
  In production R50's independent polarity signal catches geo-029 when an utterance is sent;
  the eval harness does not send `utterance`, so R50 and the concurrence polarity extension
  were inert in this run — this slice measures the extractor field + R46 only.

## The aired-verdict slice (Task 0b)

190 goldens scored end-to-end (verify ∘ applyPolarity), with the calibration-#4 fix live
(`suspect_denies` modeled as HELD, matching production):
- Aired accuracy: **89.5%** (170/190; cal #4 corrected: 84.5%).
- **AIRED WRONG from polarity: 0.** Every aired miss (20) is a verifier canonical-verdict miss,
  not a polarity flip. 10 polarity conflicts held (R46 tripwire → never auto-aired).

## What changed vs #4

1. **Verifier: single sonar-pro → concurrence.** Floor precision moved from a 84–97% spread to
   93–100%: statistics 84.4→93.3, current_events 84.4→96.6, geography 90.6→96.4, quotes
   88.9→100, person 94.7→100, adversarial 96.9→100; science_health held (96.9→96.7),
   historical roughly held (93.8→93.1). The R49 hypothesis — mutual definitive agreement is
   materially more precise than either engine alone — survives contact with the full set.
2. **Confidence became load-bearing** (see above). The floor is now filtering; in cal #4 it
   filtered almost nothing.
3. **current_events crossed the D3 bar for the first time** (84.4% → 96.6% at floor).
4. **Canonical verdict accuracy is flat (91.7% → 90.9%)** — but 8 of the 22 misses are the
   contention-degraded one-arm rows (caveat 2), which are held-not-wrong in production terms.
   The foreign re-runs of those same ids, with both arms up, verdicted 6 of them correctly at
   0.99. A contention-free re-read of this run's accuracy is plausibly ~94%, but that is a
   counterfactual, not a measurement.
5. **Cost/latency: ~2.2× single-verifier per check**, ~70 min wall for the full set (vs ~45 in
   #4) — the brave-claude arm's opus-4-8 call dominates.

## Honest caveats

1. **The duplicate tail run** (methodology note above). Canonical rows are log-matched; the
   sidecar preserves the foreign 23 for forensics. 10 of the 23 duplicate pairs were
   scoring-identical either way.
2. **9 one-arm-degraded verifies** in the primary run's tail (ids listed above). Production
   framing: the one-arm policy did exactly what VERIFY_CONCURRENCE.md says — fail closed,
   never air — so these are coverage losses, not correctness losses. Eval framing: they count
   as wrong canonical verdicts and depress verdict accuracy ~3 points in four categories. They
   do NOT touch precision@floor anywhere (all 9 landed at ~0.5, below the floor).
3. **sci-033 would have aired this run** (0.85, eligible, wrong-vocabulary False). science_health
   still clears its bars, but the graduation sitting should read this case before any enabling
   decision — it is the sharpest known instance of both engines confidently sharing a wrong prior.
4. **Misleading-vs-False vocabulary carries most of the at-floor misses.** stat-017, hist-029,
   hist-030 all carry explicit "False also defensible" adjudication notes in the goldens;
   stat-030, geo-019, curr-031, sci-033 do not. Per the README, check the note before treating
   a miss as a bug — but a sitting must rule the claim, not rescue the number.
5. **Eval-vs-street distribution mismatch (gap F-6) stands.** Goldens are trivia/news-shaped;
   street claims are not. Graduation numbers are necessary, not sufficient.
6. **R50 was inert in this run** (no `utterance` in harness requests) — the polarity numbers
   here understate production's polarity defenses, and say nothing new about them.
7. Confidence values come from live models and drift with vendor updates; re-run before
   trusting this report from a distance.

---

## GRADUATION TABLE — every category vs the R64-A-0d bar

Bar: **n ≥ 30 scored at the 0.85 floor · precision@floor ≥ 95% · both scorers clean (zero
uninvestigated inversions, zero open disagreements) · concurrence ≥ 95% · not person- or
adversarial-class.**

| category | n@floor (need 30) | prec@floor (need ≥95%) | concurrence (need ≥95%) | scorers clean | class OK | verdict |
|---|---|---|---|---|---|---|
| science_health | 30 ✓ | 96.7% ✓ | 100.0% ✓ | ✓ | ✓ | **CLEARS** |
| current_events | 29 ✗ (1 short) | 96.6% ✓ | 96.7% ✓ | ✓ | ✓ | one card away |
| statistics | 30 ✓ | 93.3% ✗ | 96.8% ✓ | ✓ | ✓ | one adjudication away |
| historical_events | 29 ✗ (1 short) | 93.1% ✗ | 100.0% ✓ | ✓ | ✓ | one sitting + 1 card away |
| geography_civics | 28 ✗ (2 short) | 96.4% ✓ | 93.3% ✗ | ✗ (geo-005) | ✓ | far (concurrence-blocked) |
| attributed_quotes | 16 ✗ (14 short) | 100.0% ✓ | 88.9% ✗ | ✓ | D11 gate | far (n + D11 decision) |
| polarity_traps | 10 ✗ (20 short) | 100.0% ✓ | 91.7% ✗ | ✓ | ✓ | far (diagnostic set, n) |
| person_claims | 16 | 100.0% | 89.5% | ✓ | **✗ D4** | NEVER (by class) |
| adversarial | 28 | 100.0% | 96.7% | ✓ | **✗ R51** | NEVER (by class) |

**CLEARS (1): `science_health`.** All five conditions met on this run: n=30 at floor, 96.7%
precision, 100% both-arm concurrence, both scorers clean, category class allowed. Carry-over
condition for the enabling decision: the operator skepticism re-read (D18 precondition 3),
which should now include sci-033's would-have-aired card.

**One sitting away (3):**
- **`current_events` — 1 card short.** Everything else clears (96.6% precision, 96.7%
  concurrence, clean). One more at-floor scored card (its 3 sub-floor misses this run were
  one-arm/contention rows, so a clean re-run of even the existing set likely crosses 30).
- **`statistics` — 1 adjudication short.** n and concurrence clear; precision is 28/30, and
  one of the two misses (stat-017, the divorce zombie-stat) carries a standing "False also
  defensible" golden note. A sitting ruling that way puts the category at 29/30 = 96.7% ✓.
  If the sitting upholds Misleading, the category needs precision work, not cards.
- **`historical_events` — 1 sitting + 1 card short.** Both at-floor misses (hist-029
  states'-rights, hist-030 Yorktown) carry defensible-False notes; ruled that way the category
  is 29/29 = 100%, then needs 1 more at-floor card to reach n=30. Concurrence is already
  perfect (30/30).

**Far (3):**
- **`geography_civics`** — precision clears (96.4%) but concurrence is 93.3% (28/30), and an
  agreement rate cannot be adjudicated upward — it needs roughly 10 more both-arm-agreeing
  cards to cross 95%, plus the geo-005 disagreement ruling, plus 2 more at-floor cards.
- **`attributed_quotes`** — perfect precision on what it has, but 14 at-floor cards short with
  only 20 goldens in the category, concurrence 88.9%, and the D11 structural block on top.
  New fact worth recording: this is the first quote calibration that is harness-v2-verified
  clean (zero inversions, zero disagreements) — the precondition D11 names. Lifting D11 is
  now a live decision; graduation would still be a golden-growth project after it.
- **`polarity_traps`** — 20 at-floor cards short; it is a diagnostic set for the polarity
  machinery, not a graduation candidate, and should probably stay that way.

**Never by class (2):** `person_claims` (D4), `adversarial` (R51). Their perfect floor
precision this run stands as calibration fact only.
