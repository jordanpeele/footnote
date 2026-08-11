# Calibration report #4 — 2026-08-11 (first run with polarity + aired-verdict measurement)

**The answer to the standing question: auto-air eligible categories — still NONE. Veto-everything
stands, on evidence, a 4th time.** But #4 measures something the first three couldn't: the actual
polarity failure that aired the one wrong card — and it shows the R46 tripwire is doing its job.

Run: all goldens through the LIVE local pipeline (extract → verify) with `--judge --aired`, so the
R46 negation tripwire and applyPolarity are exercised. Raw: `eval/results/calibration4-2026-08-11.jsonl`.
Zero HTTP errors. Spend: ~$6 (a little over the $5 estimate — the 99 unadjudicated field drafts in
eval/golden/ were swept into the run, adding ~99 extract/verify calls; they carry no ground truth so
they don't corrupt the scored numbers, but `run.js` should exclude `drafts-*` — filed).

## The headline: R46 works. The mirror class is the real remaining gap.

**Polarity (F-1) — first-ever measurement, 193 goldens with `expected_polarity`:**
- Extractor polarity correct: **93.3%**
- **FS-8 class (asserts mislabeled denies): 11 — R46 tripwire catches ALL 11, misses 0.**
- **MIRROR class (denies mislabeled asserts): 2 — UNGUARDED (pol-001, geo-029).** R46 cannot catch
  this direction (negation-present + asserts is riddled with false positives), exactly as F-1 predicted.

**Aired verdict (Task 0b) — what would actually reach the screen:**
- Raw eval number: 12 rows "aired wrong from polarity" (canonical verdict correct, aired flipped).
- **Corrected for production behavior: only 1 of those 12 would genuinely air wrong.** The other 11
  are `suspect_denies` — R46 fired, so production routes them to `polarity_conflict` → HELD → never
  auto-aired. The 1 that would air wrong is pol-001, the mirror class.
- So the true production air-wrong-from-polarity risk on this set is **1 in 193 (~0.5%)** — and it's
  entirely the unguarded mirror direction. R46 holds the rest.

### Task 0b refinement (filed, not a blocker)
`deriveAired()` normalizes `suspect_denies`→`denies` before applyPolarity, so it counts R46-caught
cases as "would flip and air wrong" when production actually HOLDS them. The eval therefore OVERSTATES
polarity air-risk 12× (12 vs the true 1). Fix: model `suspect_denies` as a held conflict in the
derivation, matching production. Until then, read the "AIRED WRONG (polarity)" number against the
`got_polarity` column as done above.

## Verdict quality (unchanged story)
- Canonical-claim verdict accuracy: 221/241 (91.7%); aired accuracy 163/193 (84.5%).
- Per-category precision at the 0.85 floor: 84–97% — still below the 95% bar in every category. No
  category clears auto-air. Same picture as calibrations 1–3: single-verifier sonar-pro is an
  ~85–97% instrument at the floor and doesn't reach 95%.

## Confidence is still theater (A-2 validated on fresh data)
Mean confidence when correct vs when wrong, by category: 0.98 vs 0.96, 0.99 vs 0.97, 0.99 vs 0.99
(historical — no separation at all). The floor filters almost nothing. The Sprint-A `?conf=bucket`
treatment (built, flagged off) and Sprint-C calibration are the right responses; the raw % should not
drive an operator's thumb.

## Eligibility gate note (mechanical)
The report re-flags the same inversions as "uninvestigated" (adv-007, adv-027, pol-004…011, geo-*)
because `adjudicated:true` lived on the run-#2 results file, not this fresh one. The RULINGS stand
(eval/ADJUDICATIONS.md, canonical-positive contract); they need porting to each new run, or report.js
should consult ADJUDICATIONS.md. Filed. It does not change the outcome — nothing was eligible anyway.

## What #4 changes for the roadmap
1. **R46 is validated at scale** — 11/11 FS-8-direction errors held. The one wrong card that ever aired
   is now a class the pipeline catches.
2. **The mirror class is the concrete next target** (F-1): 2 cases, 1 airs wrong. Small, real, unguarded.
   A guard here is harder than R46 (can't key on negation tokens) — likely wants the polarity FIELD
   cross-checked against a cheap second signal, or Sprint-C concurrence catching the flipped verdict.
3. **Auto-air stays off on evidence (4th time)** — and now we can say precisely why: precision floor +
   saturated confidence. Sprint C (concurrence + calibration) is the only lever with a real chance of
   moving it.

---

## ADDENDUM (same day) — first-ever ELIGIBLE categories, and what that does NOT mean

With the standing-rulings registry applied (eval/adjudications.json — the Sections-1+2 human
adjudications now persist across runs) and the three `investigated_pol_pending` cases RESOLVED
by this run's own data (got_polarity='denies' on all three — the extractor was right; the
pending mechanism worked exactly as designed), the D3 gate computes:

**AUTO-AIR ELIGIBLE (first time in four calibrations): `adversarial`, `science_health` —
both at 96.9% precision at the floor, n=32, both scorers clean, zero uninvestigated inversions.**

What this means: those two categories have MET the mechanical calibration bar (D3) that no
category had ever met.

What this does NOT mean: auto-air does not turn on. Per the standing posture (D15,
HOW_FOOTNOTE_DECIDES): eligibility is the calibration gate; ENABLING is a separate, explicit,
per-category decision for the orchestrator + operator, with its own D-number. Known caveats
for that decision: (a) the eligibility emerged after human adjudication corrected the scorers —
legitimate, but worth one skeptical re-read of the 2 remaining wrong verdicts in each category;
(b) eval-vs-street distribution mismatch (gap F-6) — goldens are trivia/news-shaped, street
claims are not; (c) `adversarial` as a category being auto-air-eligible deserves extra thought:
these are precisely the claims bad actors bring; (d) confidence remains uninformative, so the
0.85 floor is doing little work — the 96.9% is carried by verdict accuracy alone.

Recommendation carried to the orchestrator: treat this as the trigger to run the Sprint-C
concurrence eval (two-verifier agreement) on these two categories specifically — if concurrence
holds ≥95% there too, the enabling decision has real legs. Veto-everything remains the shipped
posture until that decision is made.
