# Red-teaming the concurrence gate — false confidence + the independence premise (2026-08-14)

NIGHTSPRINT R-concurrence packet. **ANALYSIS ONLY** — every mitigation in the PROPOSALS
section is RED (written, not applied); code is parked on a branch. This packet is the
complement to R-classify's `docs/redteam/SCI033_CLASS_2026-08-14.md`: that packet named and
quantified the *shape* (two engines sharing a prior); this one red-teams the *gate* directly —
how often concurrence is falsely confident, what its conservative holds cost, and whether the
two arms are actually the two independent engines the design advertises.

Sources read: `src/adapters/verifier/concurrence/index.js`,
`src/adapters/verifier/brave-claude/index.js`, `docs/R49_CONCURRENCE_REPORT_2026-08-12.md`,
`docs/CALIBRATION_REPORT_5_2026-08-14.md`, `docs/redteam/SCI033_CLASS_2026-08-14.md`, and the
canonical calibration data `eval/results/calibration5-2026-08-14.jsonl` (260 rows, read-only
in the main tree — this worktree computed against it directly). All counts below were
recomputed from the raw per-arm verdicts, not copied from the reports.

---

## The gate, in one paragraph

Concurrence runs two verifiers in parallel — arm A = `perplexity` (sonar index + sonar
verdict), arm B = `brave-claude` (Brave index + Opus verdict) — and merges by truth-table
(`mergeVerdicts`). **Only mutual definitive agreement** (both arms return the SAME True/False)
is `eligible: true`. Any disagreement downgrades to the less-committal verdict and strips
eligibility. A definitive both-arm agreement, at or above the 0.85 confidence floor, is what
D18 auto-air acts on. The gate's structural blind spot is stated plainly in its own header and
proven by R-classify: it catches *one engine wrong, the other disagrees*, and is blind to
*both engines wrong the same way*.

---

## (a) The false-confidence set: both arms agreed, both were wrong

**Definition used:** both arms returned the SAME definitive verdict (True/False) — the gate
read this as high-signal agreement, `eligible: true` — AND that merged verdict is wrong
against ground truth.

### The count: 7 false-confidence cards. All 7 would auto-air.

| id | category | both arms agreed | ground truth | conf | eligible | would air |
|---|---|---|---|---|---|---|
| stat-017 | statistics | **False** | Misleading | 0.90 | yes | **YES** |
| stat-030 | statistics | **False** | Misleading | 0.97 | yes | **YES** |
| hist-029 | historical | **False** | Misleading | 0.90 | yes | **YES** |
| hist-030 | historical | **False** | NeedsContext | 0.95 | yes | **YES** |
| geo-019 | geography | **False** | NeedsContext | 0.95 | yes | **YES** |
| curr-031 | current_ev | **True** | NeedsContext | 0.85 | yes | **YES** |
| sci-033 | science | **False** | Unverifiable | 0.85 | yes | **YES** |

**Within the eligible subset (217 mutual-definitive-agreement cards), 7 are wrong → a
false-confidence rate of 3.23%** (eligible-subset precision 96.77%). In the true auto-air
population (eligible AND ≥0.85 floor, 216 cards) the same 7 survive → **96.76% precision,
identical set.** The confidence floor removes *zero* of them: every one lands at or above 0.85.

### Cross-reference to R-classify's 7 slipped cards: are they shared-prior or independent-double-error?

R-classify named exactly these 7 as the cards that "slipped" in cal#5. This packet confirms
that finding from the raw data and answers the follow-on question it left open: **all 7 are
shared-prior cases; none is an independent double error.**

The proof is in the arm-level breakdown. Across the 232 both-arm rows there are exactly **10
rows where both arms are wrong.** Split them by whether the two wrong verdicts *match*:

- **8 rows: both arms wrong AND agreed on the same verdict** (the shared-prior signature).
  Of these 8, **7 are definitive** (True/False) → those are exactly the 7 false-confidence
  cards above, all eligible, all would air. The 8th (sci-030, "studies show carrots improve
  night vision") is a shared *non-definitive* error — both arms returned NeedsContext against a
  Misleading ground truth, merged at 0.425, **held below the floor**. Same shared-prior
  mechanism, but the shared verdict wasn't definitive so the gate never marked it eligible.
- **2 rows: both arms wrong but on DIFFERENT verdicts** — the independent-double-error case:
  - `curr-030`: A=NeedsContext, B=Unverifiable, GT=Misleading → merged Unverifiable, **held**.
  - `stat-031`: A=True, B=Unverifiable, GT=NeedsContext → merged Unverifiable, **held**.
  Because the arms disagreed, the conservative merge downgraded both to non-definitive and
  stripped eligibility. **Neither reached air.** Independent double-errors cost nothing on
  air *precisely because they are independent* — divergent errors trip the disagreement
  downgrade, which is the whole point of the gate.

**Verdict for (a): 7/7 slipped cards are shared-prior. The gate's only on-air failure mode is
correlated error. When the two arms err independently, the gate catches it every time (2/2
held). The gate is not leaky against random error — it is leaky against *shared* error, and
that is the entire residual risk surface.**

---

## (b) The conservative-hold tax: what disagreement costs in good cards

When arms disagree, `mergeVerdicts` picks the less-committal verdict and sets
`eligible: false` — the card is held for the human operator, never auto-aired. That
conservatism is the source of the gate's precision; the tax is the good cards it holds.

### Disagreement rate: 4.3% (10 of 232 both-arm cards)

This is the exact complement of the reports' 95.7% "concurrence rate" — that headline number
IS the verbatim-agreement rate. The 10 divergent cards, in full:

| id | arm A (perplexity) | arm B (brave-claude) | merged | GT | good card held? |
|---|---|---|---|---|---|
| adv-026 | NeedsContext | True | NeedsContext | True | **yes** |
| curr-030 | NeedsContext | Unverifiable | Unverifiable | Misleading | no (both wrong) |
| geo-029 | False | Misleading | Misleading | Misleading | no (B correct, held-but-right verdict) |
| geo-031 | Misleading | NeedsContext | NeedsContext | NeedsContext | no |
| person-007 | False | Unverifiable | Unverifiable | Unverifiable | no |
| person-020 | False | True | NeedsContext | True | **yes** |
| pol-003 | Misleading | True | Misleading | True | **yes** |
| quote-005 | NeedsContext | False | NeedsContext | False | **yes** |
| quote-019 | NeedsContext | True | NeedsContext | NeedsContext | no |
| stat-031 | True | Unverifiable | Unverifiable | NeedsContext | no (both wrong) |

### The tax: 4 good cards held (1.7% of both-arm cards)

Four cards — adv-026 ("honey never spoils", GT True), person-020, pol-003, quote-005 — had
**one arm carrying the correct definitive verdict** that, if concurred, would have aired
correctly; the disagreement held them for the operator instead. That is the price of the
gate's precision: **1.7% of both-arm traffic is a correct-but-held card.**

Notably, this tax is *cheap and well-spent*: of the 10 disagreements, 4 held a card where one
arm was right, 4 held a card where the merge landed on a defensible/correct non-definitive
verdict, and 2 held a genuine both-wrong case. **Not one disagreement aired a wrong card.**
The conservative hold never cost precision — it only ever cost recall, and only on 4 cards.
The gate is trading ~2% recall for the ~3% precision lift concurrence buys over a single
engine. That is a favorable trade for a live-TV auto-air posture where a wrong card is far
more expensive than a held one.

---

## (c) Do the two engines actually diverge? — the independence premise, tested

The gate's entire value proposition (concurrence header; VERIFY_CONCURRENCE.md; R49) is that
arm B uses a **different search index (Brave) AND a different verdict model (Opus)** than arm A
(sonar index + sonar model), so their errors are *independent* and mutual agreement is
therefore strong evidence. If they move together, that premise is weaker than advertised — and
the false-confidence set is the direct consequence.

### The arms rarely diverge, and their errors are strongly correlated.

- **Verbatim agreement: 95.7%** (222/232). The arms return the *identical* verdict string
  19 times out of 20.
- **Standalone accuracy is nearly identical:** arm A (perplexity) 92.7% (215/232), arm B
  (brave-claude) 95.3% (221/232) on the both-arm rows. Two "independent" engines converging on
  almost the same accuracy is the first tell of a shared prior, not independence.
- **Error correlation — the headline finding.** Recompute the independence baseline: P(A
  wrong) = 0.073, P(B wrong) = 0.047. If the two arms erred *independently*, the expected rate
  of both-wrong rows is 0.073 × 0.047 ≈ 0.0035 → **~0.8 rows out of 232.** The **observed**
  both-wrong count is **10.** That is a **12.4× excess over the independence prediction.**
  Their mistakes are not independent draws; they are correlated by roughly an order of
  magnitude.
- **And the correlated errors are the same-direction kind:** of those 10 both-wrong rows, 8
  are the *same wrong verdict* (shared prior), only 2 are divergent (independent). So the arms
  don't just err on the same claims — they err the same *way* 80% of the time they both err.

### When they DO diverge, arm B (Brave+Opus) is the better arm.

Of the 10 divergences: arm B alone correct = 7, arm A alone correct = 1, neither correct = 2.
The Opus-verdict arm is doing most of the real disambiguation work; the divergences are mostly
"perplexity is shaky, brave-claude is right," which is a *single-engine-quality* signal, not
the *two-independent-engines-cross-checking* signal the design markets.

### Verdict for (c): the "two independent engines" premise is materially overstated.

The arms agree 95.7% of the time, hit near-identical standalone accuracy, and their errors are
**12.4× more correlated than independence would predict**, with 80% of shared errors being the
same-direction (shared-prior) kind. Different index + different model buys *less* independence
than the design assumes, because both engines draw verdicts from the *same public web*, which
carries the same cultural priors ("this framing is debunked," "these superlatives are bunk")
into both — a shared confounder that no amount of index/model diversity removes. Concurrence's
agreement is real signal on the 95%+ of claims where the web is unambiguous, but on exactly the
nuance-collapse and uncheckable-proof claims where it matters, the two engines are close to a
single engine wearing two hats. **The gate is a strong precision instrument against
single-engine flakiness and a near-null instrument against shared-prior error — which is
precisely the residual failure it was hoped to close.**

---

## (2) Adversarial corpus — engineered shared-wrong-prior claims

Authored fixture: `eval/golden/drafts-rconcurrence-2026-08-14.jsonl` (18 rows, `drafts-`
prefix → auto-excluded from runs by `eval/run.js`'s prefix filter; exclusion pinned by
`test/golden-drafts-rconcurrence-exclusion.test.js`). Every row is `authored: true` with a
provisional label and a `rconc_prediction` (slip / air-correct / borderline).

**This corpus OVERLAPS R-classify's `drafts-sci033-class-*.jsonl` and cross-references it
rather than duplicating it.** R-classify's corpus is built around the *uncheckable-proof /
private-entity* shape (internal studies, private polls, first-person anecdotes) — 18 rows,
mostly Unverifiable. This packet's corpus targets a different lever of the same gate: the
**shared-wrong-prior definitive-commitment** mode, and — crucially — pairs each predicted-slip
case with a **control** where the same shared prior points at the *correct* answer, to isolate
"the class is not myths-per-se, it is nuance-collapse." The two commercial-superlative rows
(auth-rconc-006, -017) are explicitly noted as overlapping auth-sci033-001/013/014 and are
cross-referenced, not re-litigated.

### Predictions (author-as-eval)

**Predicted to SLIP (both arms commit False/True, eligible, wrong)** — the false-confidence
mode. Each mirrors a confirmed cal#5 slip:

| id | claim | GT | mirrors |
|---|---|---|---|
| auth-rconc-001 | "half of all marriages end in divorce" | Misleading | stat-017 (confirmed slip) |
| auth-rconc-005 | "vitamin C prevents the common cold" | Misleading | nuance-collapse (small real effect) |
| auth-rconc-012 | "detox teas flush toxins out" | Misleading | commercial-wellness nuance-collapse |
| auth-rconc-015 | "organic food has way more nutrients" | Misleading | commercial-consensus nuance-collapse |
| auth-rconc-018 | "the American Revolution ended in 1776" | NeedsContext | hist-030 (confirmed slip) |

**Predicted to AIR-CORRECT (controls)** — widely-repeated myths whose honest verdict genuinely
IS False, so shared-prior agreement is *right* and should air: auth-rconc-002 (sugar→hyper),
-003 (Great Wall from space), -004 (goldfish memory), -007 (Einstein failed math), -008 (tongue
map), -009 (coffee stunts growth), -010 (antibiotics cure colds), -011 (bulls hate red), -013
(swallow 8 spiders/yr), -014 (lightning never twice), -016 (knuckle-cracking→arthritis). These
exist to prove a blunt "held all myths" detector would over-trigger; a correct fix must NOT
sweep these into a hold.

**Predicted BORDERLINE (held iff at least one arm returns Unverifiable)** — commercial
uncheckable-proof, overlapping R-classify: auth-rconc-006 ("clinically proven metabolism
boost"), auth-rconc-017 ("#1 dermatologist recommended").

The predicted-slip rows are the actionable finding: **the class is reproducible by
construction.** Any claim that is (i) culturally-sticky enough that the public web overwhelmingly
"debunks" it, but (ii) carries a real partial truth (Misleading) or a technically-incomplete
element (NeedsContext), will drive both arms to the same over-committed definitive verdict. The
controls confirm the trigger is *nuance-collapse*, not *myth*.

*(These are predictions authored without spending against the live arms — the corpus is
drafts-excluded and unadjudicated. Ratification requires an operator sitting + a concurrence
run; do NOT fold these labels into calibration math until then.)*

---

## (3) PROPOSALS — how to harden concurrence (RED; written, not applied)

Ranked by (class-coverage × good-card-preservation ÷ cost/risk). None applied. This packet
deliberately does NOT re-derive R-classify's P1 class-detector in detail — it endorses it and
adds the concurrence-gate-specific angle. Any code is parked on branch
`redteam/rconcurrence-analysis` behind default-OFF flags.

### R1 (top pick) — a third, deliberately-disagreeing SKEPTIC arm (break the monoculture)

The (c) finding is the argument: the two arms are 12.4× more error-correlated than independent,
because both draw verdicts from the same web with the same priors. Adding a *fourth* engine of
the same disposition would not help — it would correlate too. The fix that attacks the *root*
is an arm with an **opposed disposition**: a third verifier prompted to steelman the claim's
*unverifiability / context-dependence* — "is the load-bearing source private or interested? is
this a true element in a misleading frame? is this a technically-incomplete milestone rather
than the whole fact?" If this skeptic arm returns Unverifiable/NeedsContext/Misleading while
the two committed arms agree definitively, treat it as a disagreement → downgrade → hold.

- **Evidence it would work:** all 7 slipped cards share the property that a skeptic *could*
  name a specific reason to hold (sci-033: proof is private; stat-017/stat-030/hist-029:
  Misleading frame; hist-030/geo-019/curr-031: technically-incomplete framing). The skeptic
  doesn't need to be *right about the verdict* — it only needs to introduce enough
  disagreement to trip the existing downgrade path, which already provably works (2/2
  independent-error holds in (b)).
- **Cost/risk:** +~1 verifier per check → ~3.3× single-engine spend; and the recall danger —
  a skeptic can steelman doubt onto genuinely-settled True/False cards, re-introducing the
  wimp-out failure the current prompts were built to fix (it would threaten the 11 control
  myths in my corpus that *should* air False). Mitigations: (i) require the skeptic to name a
  *specific* unverifiability reason before its dissent counts as a disagreement — a bare
  "could be more nuanced" does not downgrade; (ii) **do not draw the skeptic from the Claude
  family** — brave-claude's verdict model is already Opus; a Claude skeptic shares that
  model's prior and re-imports the correlation problem (this is the open independence question
  R-classify's P2 also flagged). A sonar-family or Gemini-family skeptic is preferable.
- **Validation a ruling needs:** run the 3-arm gate over the full 260 + this packet's 18
  drafts; require it to hold all 5 predicted-slip rows AND air all 11 control myths, at
  <2% recall loss on the ~200 good auto-air cards. Rule on the cost envelope first — 3.3×
  spend may be a non-starter for anything but the capped auto-air pilot.

### R2 — R-classify's class-detector (P1), endorsed as the cheaper first move

R-classify's P1 — a regex + small-Haiku pre-verifier that tags class-suspect claims and *caps
eligibility* to the non-definitive floor — is cheaper (one Haiku call, not a full verifier arm)
and targets the claim *shape* rather than confidence, so it catches all 7 regardless of how
certain the arms are. This packet's controls (the 11 myths that must air) are exactly the
false-positive guard its validation needs: the detector must condition on
"load-bearing source is private/interested/unindexed" or "true-element-in-misleading-frame,"
NOT on "is a familiar myth," or it will hold the controls. **Ship order: R2 first (cheap,
shape-targeted), R1 only if R2's Haiku classifier can't separate the nuance-collapse sub-shape
(stat-017/hist-029 carry no self-report marker) at acceptable false-positive cost.** R1 and R2
are complementary — R2 catches the uncheckable-proof shape by marker; R1 catches the
nuance-collapse shape by disposition.

### R3 — "agree WITH independent evidence," not merely "agree" (raise the eligibility bar)

Today eligibility = mutual definitive verdict agreement. A stronger bar: eligibility ALSO
requires the two arms' *citations* to be non-overlapping and each to independently support the
verdict — i.e. agreement must rest on *different* evidence, not the same three debunk pages both
searches surfaced. The gate already unions citations (`dedupe` in concurrence merge); this would
add a check that the union has ≥2 *distinct-domain* high-trust sources contributed by *each*
arm. Rationale: the shared-prior failures happen because both searches return the *same*
secondary "X is bunk" pages. If we require evidentiary independence, not just verdict agreement,
the shared-prior cases lose eligibility because their agreement is evidence-degenerate.

- **Evidence:** untested here — the cal5 rows don't carry per-arm citation domains in a form I
  could diff (the merged `citations` are unioned before serialization). This is a hypothesis
  with a clear validation path, not a measured win.
- **Cost/risk:** near-zero added spend (post-hoc citation check), but likely a real recall
  tax — many *correct* agreements also rest on overlapping canonical sources (both arms cite
  Britannica for a settled fact), so this could hold good cards. Needs measurement of the
  citation-overlap distribution on correct vs wrong eligible cards before it can be ranked
  above R2.
- **Validation:** instrument concurrence to log per-arm citation domains, re-run cal, measure
  distinct-domain overlap for the 7 wrong vs the 210 correct eligible cards. If the wrong set
  is systematically more overlapping, this is a cheap high-value gate; if not, drop it.

### R4 — floor raise to 0.86 (hygiene only, NOT a fix)

Catches the two 0.85 stragglers (sci-033, curr-031) at the cost of 1 good 0.85 card. Leaves 5
of 7 airing (they sit at 0.90–0.97). Documented per R-classify's P3 so a sitting doesn't
mistake it for a solution. Include only as belt-and-suspenders alongside R1/R2. Confidence
cannot separate this class — the whole signature of shared-prior error is *high, agreeing
confidence*.

### Ranking summary

| # | proposal | class coverage | good-card cost | spend | rank rationale |
|---|---|---|---|---|---|
| R2 | class-detector (endorse R-classify P1) | uncheckable-proof shape (all) | needs FP guard (my controls) | +1 Haiku | cheapest shape-targeted; ship first |
| R1 | skeptic third arm | all 7 (disposition breaks monoculture) | recall risk on settled cards | +1 verifier (~3.3×) | attacks the (c) root; costliest |
| R3 | evidence-independence bar | shared-prior (hypothesis) | unknown recall tax | ~0 | cheap but UNMEASURED; instrument first |
| R4 | floor → 0.86 | 2 of 7 | 1 card | 0 | hygiene, never alone |

---

## Bottom line

- **False-confidence count: 7** (both arms agreed a definitive verdict, both wrong, all 7
  eligible + at/above the 0.85 floor → all 7 would auto-air). 3.23% of the eligible subset.
- **All 7 are shared-prior; zero are independent double-errors.** The gate's only on-air leak
  is *correlated* error; both independent double-errors in cal#5 were caught and held.
- **Conservative-hold tax: 4 good cards held (1.7% of both-arm traffic), 0 wrong cards aired**
  from disagreement — a favorable precision-for-recall trade.
- **The arms do NOT diverge like two independent engines: 95.7% verbatim agreement, 12.4×
  more error-correlated than independence predicts, 80% of shared errors same-direction.** The
  "different index AND different model" independence premise is materially overstated because
  both arms draw verdicts from the same prior-laden public web. That shared confounder — not
  any index/model overlap — is the mechanism, and the false-confidence set is its signature.
- **Top proposal: R2 (endorse R-classify's shape-detector) first for cost, R1 (skeptic third
  arm) to attack the correlation root.** Both parked, neither applied.
