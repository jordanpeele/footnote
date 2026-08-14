# DAYSPRINT handoff — packet 3d (judge-disagreement analysis, cals 1–5)

**Date:** 2026-08-14 · **Branch:** `daysprint/3d-judge-disagreement` (isolated worktree,
NOT pushed) · **Contract:** analysis + written proposals only — judge/scorer machinery is
RED, zero code changed, zero rulings applied.

## Deliverable

`docs/eval/JUDGE_DISAGREEMENT_ANALYSIS_2026-08-14.md` — full cross-calibration analysis:
rates/trend, 4-class taxonomy of cal-#5's 29 verbatim flags, ruling-correlation, cost of
scorer-clean at the gate (geo-005 deep dive), and 6 ranked written proposals (P1–P6) each
with risk + validation protocol.

## Headline findings

1. **Raw disagreement rate is flat (~17% of judged rows; 12→31→30→30→29 flags) but the
   marginal rate collapsed: 19 new flags in cal #2, then 0, 0, 1 (geo-005).** The flag
   population is ~96% recurring registry-ruled cases re-flagged every run.
2. **Taxonomy (cal #5, 29 flags):** 18 token-scorer paraphrase blindness (62%; judge
   ruled right 19/19 all-time on this shape) · 8 canonical-positive-contract collisions
   (28%; judge structurally blind to the polarity field, ruled against 8/8 — policy, not
   hallucination) · 2 genuine multi-claim-selection disagreements (geo-032 ruled,
   geo-005 open) · 1 judge quibble ever (geo-026).
3. **Neither scorer is globally right — the disagreement SHAPE predicts the ruling
   almost perfectly.** The only informative shape left is `different_claim`-on-token-PASS.
4. **geo-005 is the sole D3 blocker for geography_civics** (96.4%@floor, n=28, zero
   uninvestigated inversions — verified by running report.js on the cal-#5 file). The
   flag itself is threshold jitter: same extractor behavior in cals #1/#4 scored F1
   0.571 (both scorers failed, no flag); cal #5's wording hit 0.625, token flipped to
   PASS, and the identical semantic event became category-blocking. Judge label also
   drifted (`partial`→`different_claim`). Exact precedent: geo-032.
5. **Negative finding that matters: fuzzy-threshold tuning is NOT supported.** Class-A
   F1 spans 0.267–0.588 vs the Einstein inversion's 0.828 — no threshold separates
   them. The threshold's real effect is flag churn at the 0.6 boundary (geo-005,
   geo-012, curr-027 at exactly 0.600).

## Proposals (written only, ranked)

- **P1 (do first):** rule geo-005 `different_claim` via registry, geo-032 precedent →
  geography D3 line goes ELIGIBLE (graduation verdict unchanged — still concurrence/n
  blocked at R64-A-0d).
- **P2:** judge-prompt v2 teaching the canonical-positive contract (kills the 8-case
  class B at the source; HIGH-care change — validation gate: zero misses on an
  inversion regression set incl. adv-007/geo-029/geo-032, run `--no-cache`).
- **P3:** registry-aware flag surfacing in run.js console (28/29 of cal-#5 flags were
  known noise; safer variant hashes the ruled wording).
- **P4:** standing pattern rule pre-ratifying judge on token-FAIL/`same_claim` (19/19
  evidence) with audit sampling + judge-model pin — first crack in never-auto-resolve,
  hence ranked below P2.
- **P5:** do NOT tune FUZZY_F1_THRESHOLD; add a report-only "boundary landings"
  (F1 ∈ [0.55, 0.65)) line instead.
- **P6:** surface `partial`-on-token-PASS counts (6 silent rows in cal #5), report-only.

## State

- `npm test`: **green** — 245 tests, 243 pass, 2 skipped, 0 fail. No code changed.
- Files added (2): the analysis doc + this handoff. Nothing in `eval/` touched.
- Raw data read read-only from the MAIN tree (`/Users/cobyweiss/Code/footnote/eval/results/`);
  cal-#5 canonical file used (260 rows), foreign-append sidecar not scored.
- Not pushed; push requires its own authorization.

## Open questions for the sitting

1. geo-005 ruling (P1) — and whether the golden lane wants a multi-claim annotation
   convention instead/as well.
2. Whether P2's prompt edit is worth severing judge-label comparability with cals 1–5
   (cache invalidation is by design; cost <$1, comparability is the real price).
3. P4's never-auto-resolve exception: acceptable with audit sampling, or keep manual?
