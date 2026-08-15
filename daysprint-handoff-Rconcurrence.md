# DAYSPRINT HANDOFF — R-concurrence (red-team the concurrence gate)

**Packet:** NIGHTSPRINT R-concurrence — quantify how often the two-verifier concurrence gate is
*falsely confident* (both arms agree AND both wrong) and test whether the two arms are actually
the two independent engines the design advertises. **ANALYSIS ONLY — the fix is RED.** No gate
code changed; all mitigations are written proposals, scaffold parked on a branch.

**Worktree branch:** `worktree-agent-aad638da3026ca5eb` (isolated). Committed, **NOT pushed.**
**Parked scaffold branch:** `redteam/rconcurrence-analysis` (R1 skeptic-arm + R3 evidence-
independence hooks, default-OFF, unwired).

---

## Deliverables

1. **`docs/redteam/CONCURRENCE_FALSE_CONFIDENCE_2026-08-14.md`** — the report. (a) false-
   confidence set + R-classify cross-ref, (b) disagreement rate + conservative-hold tax, (c)
   the do-the-arms-diverge measurement, plus ranked RED proposals.
2. **`eval/golden/drafts-rconcurrence-2026-08-14.jsonl`** — 18 authored adversarial rows
   (`drafts-` prefix → auto-excluded; `authored: true`; each carries an `rconc_prediction`).
   Engineered shared-wrong-prior claims + controls; OVERLAPS and cross-references R-classify's
   `drafts-sci033-class-*.jsonl` rather than duplicating it.
3. **PROPOSALS** — in the report, ranked. Scaffold parked on `redteam/rconcurrence-analysis`.
4. **`test/golden-drafts-rconcurrence-exclusion.test.js`** — pins the corpus is excluded from
   runs. `npm test` green: **247 tests, 245 pass, 0 fail, 2 skipped** (baseline was 245 pass;
   +2 new exclusion tests).

---

## Findings (recomputed from `eval/results/calibration5-2026-08-14.jsonl`, 260 rows)

### (a) False-confidence set: **7 cards.** All 7 would auto-air.
Both arms agreed a definitive verdict, both wrong: stat-017, stat-030, hist-029, hist-030,
geo-019, curr-031, sci-033. That is 3.23% of the 217-card eligible subset (precision 96.77%).
The 0.85 floor removes zero of them. **All 7 are shared-prior; zero are independent double-
errors** — cross-referenced against R-classify's identical slipped-7 set. Of the 10 both-wrong
rows in cal#5, 8 are same-verdict (shared prior; 7 definitive→air, 1 non-def→held) and 2 are
divergent (independent double-error) — **both divergent ones were caught and held.** The gate's
only on-air leak is *correlated* error.

### (b) Conservative-hold tax: **4 good cards held, 0 wrong cards aired.**
Disagreement rate 4.3% (10/232 both-arm cards — the exact complement of the reports' 95.7%
"concurrence rate," which is verbatim agreement). 4 of those 10 held a card one arm had
correct (adv-026, person-020, pol-003, quote-005) = 1.7% of both-arm traffic. Not one
disagreement aired a wrong card. Favorable precision-for-recall trade.

### (c) DO THE ARMS ACTUALLY DIVERGE? — **No, not like independent engines.**
- Verbatim agreement 95.7% (222/232).
- Standalone accuracy near-identical: perplexity 92.7%, brave-claude 95.3%.
- **Error correlation: 12.4× the independence prediction.** P(A wrong)=0.073, P(B wrong)=0.047
  → if independent, expect ~0.8 both-wrong rows; **observed 10.** And 80% of shared errors are
  same-direction.
- When they diverge (10), brave-claude alone is right 7×, perplexity 1×, neither 2× — the
  divergences are single-engine-quality signal, not independent cross-checking.
- **Verdict:** the "different index AND different model → independent" premise is materially
  overstated. Both arms draw verdicts from the same prior-laden public web; that shared
  confounder (not index/model overlap) drives the correlation, and the 7-card false-confidence
  set is its signature.

---

## Top proposal (RED, not applied)

**R2 first (cost), R1 to fix the root.**
- **R2** — endorse R-classify's shape-detector (regex + small Haiku, caps eligibility on
  class-suspect claims). Cheapest, shape-targeted, catches the uncheckable-proof shape. My
  corpus's 11 control myths (that SHOULD air False) are its false-positive guard.
- **R1** — a third **skeptic arm** with an opposed disposition (name a specific unverifiability
  reason → trip the existing downgrade path). Directly attacks the (c) correlation root. Cost
  ~3.3× spend; must NOT be Claude-family (would re-correlate with brave-claude's Opus). Scaffold
  parked on `redteam/rconcurrence-analysis` (`src/adapters/verifier/concurrence/
  skeptic-gate.PARKED.js`, default-OFF, unwired).
- R3 (evidence-independence bar) is cheap but UNMEASURED — instrument citation-overlap first.
- R4 (floor→0.86) is hygiene only — catches 2 of 7, never ship alone.

---

## Next steps for the sitting
- Ratify or reject the 18-row corpus (currently provisional / drafts-excluded) via an operator
  reading + a concurrence run against the arms; do NOT fold labels into calibration math until
  ratified.
- Decide R2-vs-R1 ordering against the spend envelope; R2 needs the full-260 + my-18 validation
  run (hold all 5 predicted-slip, air all 11 controls, <2% recall loss).
- The (c) correlation number is the headline for the D18 enabling decision: concurrence is a
  strong precision instrument against single-engine flakiness and a **near-null instrument
  against shared-prior error** — the exact residual it was hoped to close.

**Do NOT push. Do NOT enable any proposal.**
