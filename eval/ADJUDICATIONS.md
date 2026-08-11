# Verdict re-adjudications — calibration run #1 (2026-08-07)

**Scope.** Every case in `eval/results/2026-08-07T04-37-45.jsonl` where the stage-2 verify
verdict was scored WRONG against the golden ground truth — 13 cases (147/160 correct in the
run log). Each gets a ruling under the editorial spec, [HOW_FOOTNOTE_DECIDES.md](../HOW_FOOTNOTE_DECIDES.md)
(cited below as §n):

- **Ruling (a) — golden fixed.** The golden ground truth was mislabeled under the spec's own
  verdict definitions; the golden case is corrected (and says so in its `adjudication_note`).
  The run-#1 result is re-scored by implication on the next run.
- **Ruling (b) — case stands.** The golden label is right and the verifier erred; the miss
  counts against measured precision, as it should.

This file is the audit trail. Nothing here was edited to flatter the numbers: 3 golden
labels were fixed because the spec contradicted them, and 10 verifier misses stand.

Adjudicator: Claude (P3-I), against the spec as written. Standing rule from §9: the burden
is on any change to show it makes Footnote more accurate or more accountable.

---

## Rulings

### quote-002 — Armstrong's "one small step" (golden **True**, verify said **NeedsContext**, conf 0.98)
**Ruling: (b) — stands.** The claim as canonicalized is that Armstrong *said* the quote when
stepping onto the Moon. He did — the NASA transcript and the broadcast record exactly those
words; the surfaced source was the Library of Congress. The "for **a** man" dispute concerns
what Armstrong *intended* and whether an inaudible syllable exists in the audio — it does not
make the attribution incomplete or contested. §4: NeedsContext is for claims that are
"materially incomplete without additional facts"; a linguistics footnote is not material to
whether he said it. §3: T1 sourcing was in hand. Definitive evidence, hedged verdict —
**under-commitment**.

### pol-003 — same Armstrong claim via polarity trap (golden **True**, verify said **NeedsContext**, conf 0.96)
**Ruling: (b) — stands.** Identical claim, identical reasoning to quote-002. The polarity
trap part (extractor must not adopt the speaker's "he never said that") was handled; the
verifier then hedged a T1-supported attribution. **Under-commitment.**

### quote-005 — Gandhi "be the change" (golden **False**, verify said **Misleading**, conf 0.94)
**Ruling: (b) — stands.** The claim attributes an exact quote. Quote scholarship (and the
verifier's own correction) is unambiguous: Gandhi is not reliably documented saying that
line; the closest verified passage is a longer, different 1913 statement. §4 False: "the
claim, as stated, is contradicted by qualifying sources" — a misattributed quote is the
textbook case. Misleading requires *true elements* deployed to create a false impression;
"he said that" contains no true element about the utterance. Also noted: the surfaced source
was code-tier-1 ("Quotecatalog"), which under §3 cannot support any definitive verdict —
a mid-tier verdict on a T4 source is doubly under the floor. Mid-verdict where the evidence
is definitive — **under-commitment** (in Misleading clothing rather than NeedsContext).

### pol-006 — "Nixon finished his second term" (golden **False**, verify said **NeedsContext**, conf 0.99)
**Ruling: (b) — stands.** The flagship hedge. The verifier's own correction reads: "he did
not finish it because he resigned in 1974" — a definitive contradiction, sourced to the
National Archives (T1), delivered under a NeedsContext label at 0.99 confidence. §4: False
"does not assert the speaker lied — only that the statement is wrong," so there was no
reason to soften. **Under-commitment**, the purest specimen in the run.

### stat-008 — "sharks kill more Americans than lightning" (golden **False**, verify said **True**, conf 0.91)
**Ruling: (b) — stands.** Golden is correct and uncontested: lightning kills roughly 20
Americans a year, sharks about one (NOAA; ISAF). The verifier answered True while its own
correction stated the reverse ("much more likely to be killed by lightning than by sharks") —
a verdict/evidence polarity error inside the verifier, not a hedge. Counts against
precision. **Hard miss** (not part of the under-commitment pattern).

### hist-011 — "Columbus discovered America" (golden was **NeedsContext**, verify said **False**, conf 0.99)
**Ruling: (a) — golden fixed to False.** §4 says NeedsContext applies to a claim that "is
true or partially true but materially incomplete." The load-bearing word is *discovered*,
and qualifying sources contradict it outright: the Americas were inhabited for millennia,
Norse expeditions reached North America around 1000 AD, and Columbus never set foot on the
North American mainland. The golden entry's own note listed exactly this evidence — evidence
of falsity, filed under a context label. The verifier's False, with a correction supplying
the context, is the spec-compliant card. Golden corrected; Misleading noted as the
defensible second label (per the pre-existing README caveat).

### sci-013 — human/chimp DNA "98 to 99 percent" (golden **True**, verify said **NeedsContext**, conf 0.96)
**Ruling: (b) — stands.** The claim carries "about," and the canonical figure (~98.8%
sequence identity, Smithsonian/NIH — the golden note anticipated exactly this) sits inside
the stated range. Methodological variance (indel-inclusive comparisons yield lower numbers)
is real but does not make an "about 98–99%" claim materially incomplete — it is what "about"
is for. §4: the statement alone would not misinform. Definitive support, hedged verdict —
**under-commitment**.

### quote-018 — "'Yes we can' was Obama's 2008 campaign slogan" (golden **True**, verify said **False**, conf 0.97)
**Ruling: (b) — stands.** The verifier's correction concedes the substance: "Yes, we can"
was "a widely used chant and later rallying cry associated with his campaign" — it was the
slogan of the 2008 NH-primary speech and the will.i.am campaign anthem, and is described as
an Obama 2008 campaign slogan by qualifying sources. The claim does not assert it was the
*only* or *official* slogan; ruling it False on the "Change we can believe in" technicality
contradicts the claim as stated rather than as lawyered. §4 False requires the claim as
stated to be contradicted; it isn't. **Hard miss** (definitive verdict in the wrong
direction — the inverse failure mode of the hedges; D11 keeps this category blocked
regardless).

### quote-019 — Patrick Henry "give me liberty" (golden **NeedsContext**, verify said **True**, conf 0.96)
**Ruling: (b) — stands (golden confirmed).** The snippet asserts "word for word, that's on
the record" — and that is precisely what the record does not support: the speech text was
reconstructed by William Wirt in 1817, ~42 years later, with no contemporaneous transcript.
§4 NeedsContext fits exactly: partially true (the attribution is traditional and
uncontested as tradition) but the statement alone would misinform (there is no verbatim
record). The verifier **over-committed** to True. This case is the standing control for any
commitment-tuning of the verify prompt: a fix for hedging that flips this case to True is
worse than the disease.

### curr-019 — "inflation hit nine percent in 2022" (golden **True**, verify said **NeedsContext**, conf 0.98)
**Ruling: (b) — stands.** The canonicalized claim is "reached about nine percent in 2022."
CPI-U hit 9.1% year-over-year in June 2022 (BLS — the verifier's own surfaced source, T1).
"Reached" asserts a peak touched, not an annual average; the verifier's correction concedes
the 9.1% peak while hedging on the 8.0% calendar-year average nobody claimed. §4: the
statement alone would not misinform. **Under-commitment.**

### geo-019 — "Sahara is the largest desert" (golden was **Misleading**, verify said **NeedsContext**, conf 0.99)
**Ruling: (a) — golden fixed to NeedsContext.** Under §4, Misleading requires "true elements
**deployed** to create a false impression (cherry-picked baseline, misattributed cause,
technically-true framing)" — an intent-and-framing verdict. A speaker repeating the common
schoolroom near-fact is not deploying anything; the claim is partially true (largest *hot*
desert) and materially incomplete (Antarctica and the Arctic are larger by the scientific
definition) — which is §4's definition of NeedsContext, and the golden note itself flagged
NeedsContext as defensible. The verifier's NeedsContext-plus-qualifier card is the correct
output. Golden corrected.

### hist-019 — "Emancipation Proclamation immediately freed all enslaved people" (golden was **Misleading**, verify said **False**, conf 0.99)
**Ruling: (a) — golden fixed to False.** The claim is universally quantified — *every*
enslaved person, *immediately*. Qualifying sources (National Archives) contradict it as
stated: the Proclamation applied only to areas in rebellion, exempted the border states and
Union-held territory, and nationwide abolition came with the 13th Amendment in 1865. §4
Misleading covers technically-true framing; "freed every enslaved person immediately" is not
technically true under any reading. The verifier's False with the scope correction is the
right card. Golden corrected; Misleading noted as the defensible second label.

### person-020 — "Oprah was the first Black woman billionaire in America" (golden **True**, verify said **NeedsContext**, conf 0.86)
**Ruling: (b) — stands.** Forbes — the recognized authority on billionaire rankings, and the
verifier's own surfaced source — reported in 2003 that Winfrey had become the first Black
woman billionaire. The verifier's hedges ("does 'first' mean first to reach the status,"
"does 'in America' mean North America") manufacture ambiguity the claim doesn't contain;
"the early two thousands" framing in the snippet even dates it. §4: the statement alone
would not misinform. **Under-commitment.** (D4: person claims never auto-air regardless —
this case calibrates the verifier, not the gate.)

---

## Tally and pattern verdict

| ruling | cases |
|---|---|
| (a) golden fixed | hist-011 (NeedsContext→False), geo-019 (Misleading→NeedsContext), hist-019 (Misleading→False) — **3** |
| (b) stands — under-commitment (hedged where evidence was definitive) | quote-002, pol-003, quote-005, pol-006, sci-013, curr-019, person-020 — **7** |
| (b) stands — hard miss / over-commitment | stat-008 (True vs its own evidence), quote-018 (False where True), quote-019 (True where NeedsContext) — **3** |

**Pattern verdict: (b) under-commitment threshold met — 7 cases ≥ 4, across five
categories** (quotes, polarity, science, current events, person claims). The signature is
consistent: the verifier assembles definitive T1–T3 evidence, writes a correction that
states the definitive answer, then labels the card NeedsContext (or Misleading) at 0.86–0.99
confidence. Per the P3-I mandate this authorized exactly one commitment-targeted iteration
of the Perplexity verify prompt (v2), gated on a 6-claim live spot-check with genuinely
mid-tier controls.

Two of the three (a)-fixes ran in the *verifier's* favor and one (geo-019) was
verdict-neutral mid-tier relabeling — the fixes follow the spec text, not the score. The
three hard misses stand as the strongest argument that 94–95% measured precision was real,
not an artifact of harsh goldens.

---

## Prompt iteration v2 — attempted, spot-checked, REJECTED (adapter stays at v1)

The authorized iteration was made (commitment rule: "when the evidence from qualifying
sources is definitive, verdict True or False; NeedsContext is for genuinely
contested/incomplete framing, not hedging") and put through the live 6-claim gate —
3 previously-hedged cases, 3 controls that must stay mid-tier. Two wordings were tried
(a blunt "do not soften to NeedsContext/Misleading" draft, then a softer direction-anchored
one that explicitly restated the §4 mid-tier definitions). Results, adapter called
directly with the production model (sonar-pro):

| case | claim | golden | run #1 (v1) | v2 draft 1 | v2 draft 2 | v1 re-test (same day) |
|---|---|---|---|---|---|---|
| pol-006 | Nixon finished his second term | False | NeedsContext 0.99 | **True 0.99** (correction said the opposite) | **True 0.99** (correction factually wrong) | **False 0.99** ✓ |
| curr-019 | inflation reached ~9% in 2022 | True | NeedsContext 0.98 | True 0.98 ✓ | True 0.99 ✓ | — |
| sci-013 | humans/chimps share ~98-99% DNA | True | NeedsContext 0.96 | True 0.97 ✓ | True 0.98 ✓ | — |
| geo-019 CONTROL | Sahara largest desert | NeedsContext | NeedsContext ✓ | **False 0.98** ✗ | **False 0.98** ✗ | NeedsContext 0.98 ✓ |
| stat-017 CONTROL | half of marriages end in divorce | Misleading | Misleading ✓ | **False 0.98** ✗ | **False 0.97** ✗ | NeedsContext 0.96 (mid-tier ✓) |
| adv-010 CONTROL | neighbor saw a UFO | Unverifiable | Unverifiable ✓ | **False 0.95** ✗ | Unverifiable 0.72 ✓ | NeedsContext 0.86 |

**Ruling: rejected.** Both wordings flipped genuinely-mid-tier controls to a confident
definitive False — the exact overconfidence trade the gate exists to catch — and both
produced a True on the Nixon claim *against the evidence in their own corrections* (draft 2's
correction was itself factually wrong). Meanwhile the same-day v1 re-test returned False on
Nixon, meaning part of the run-#1 hedging is model variance, not a stable prompt defect. A
fact-checker that airs confident False on "the Sahara is the largest desert" is worse than
one that hedges on Nixon; §9 puts the burden on the change to show it makes Footnote more
accurate, and it showed the opposite. The adapter prompt stays at v1; the under-commitment
gap stays visible in measured precision, where it belongs. Next credible lever (out of this
packet's scope): a two-step verify (evidence retrieval, then a separate verdict call bound
to the §4 definitions) rather than harder exhortation inside one prompt.

Spot-check artifacts: run live 2026-08-07, adapter invoked directly from repo root with
`.env.local` credentials; v1 re-test used the committed adapter (`git show HEAD`).


---

## Section 1 adjudication — 2026-08-10 (canonical-positive contract ruled by Coby)

**1A policy call: canonical-positive extraction IS the contract** (claim string in positive form; asserts/denies carried in the separate polarity field, mapped by applyPolarity, displayed by D17). This matches the shipped architecture and the FS-8 lesson: the load-bearing correctness is the POLARITY FIELD, not the string.

**Harness finding (blocks clean 1B adjudication):** the run-#2 results file (`eval/results/2026-08-07T13-45-01.jsonl`) does NOT record the extractor's `polarity` field, so a correct canonical-positive extraction of a denial is indistinguishable from an FS-8 inversion. Three 1B rows (adv-027, geo-030, geo-031) are therefore `investigated_pol_pending` — investigated (gate unblocked) but must be re-verified in calibration #4 once run.js records `got_polarity`. This is Sprint-0 build task #0.

- **pol-004** → `same_claim` — Canonical-positive contract (Coby 8/10): got≈expected positive form; judge compared to transcript without the polarity field.
- **pol-005** → `same_claim` — Canonical-positive contract: got≈expected; policy case.
- **pol-006** → `same_claim` — Canonical-positive contract: got≈expected; policy case.
- **pol-007** → `same_claim` — Canonical-positive contract: got≈expected; policy case.
- **pol-011** → `same_claim` — Canonical-positive contract: got 0.933 F1 vs expected; clearest policy case.
- **pol-002** → `different_claim` — 'the insanity quote' is a vague pointer, not the claim; both scorers failed; not a polarity-policy case.
- **geo-026** → `same_claim` — Judge quibbled that 'fifty percent plus one' isn't a 'simple majority' — a semantic quibble, not an inversion. got≈expected.
- **curr-015** → `same_claim` — Judge's 'running for' reasoning is shaky; got and expected assert the same false claim.
- **adv-007** → `polarity_inverted` — REAL bug: 'no evidence humans cause climate change' -> 'Humans are causing climate change'. Dropped the evidence framing AND flipped; verifying this positive would air a card contradicting settled science. Confirmed inversion (FS-8 class).
- **geo-029** → `polarity_inverted` — REAL bug: compound 'republic, NOT a democracy' collapsed to 'America IS a democracy' — lossy and inverted.
- **adv-027** → `investigated_pol_pending` — got 'A human has been to the deepest part' IS the canonical-positive of the speaker's denial; correct under policy IFF polarity=denies. Harness didn't record it. Re-verify in calib #4.
- **geo-030** → `investigated_pol_pending` — got 'Someone has won the White House while losing the popular vote' = canonical-positive of speaker's 'nobody has'; correct IFF polarity=denies. Unrecorded. Re-verify in calib #4.
- **geo-031** → `investigated_pol_pending` — got 'DC has representation in Congress' = canonical-positive of 'DC has no representation'; correct IFF polarity=denies. Unrecorded. Re-verify in calib #4.

## Section 2 adjudication — 2026-08-10 (batch-ratify)

**Ratified the LLM judge over the v1 string scorer on all 21 token-fail/judge-same_claim rows** (extract_pass -> true): stat-005, curr-006, sci-010, adv-012, geo-012, person-017, curr-019, curr-023, stat-025, curr-027, stat-027, stat-028, sci-029, stat-029, curr-030, sci-030, hist-032, adv-033, curr-033, geo-033, hist-033. All are faithful paraphrases the crude token scorer missed on wording.

- **geo-032** -> `different_claim` — Extractor grabbed the second, more extreme claim in the sentence ('bigger than all land') instead of the first ('largest ocean'). Judge correct; token scorer passed on overlap. Investigated extractor miss.
