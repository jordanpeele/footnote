# Judge-disagreement analysis — calibrations 1–5 (2026-08-14, DAYSPRINT packet 3d)

**Scope.** Cross-calibration analysis of the two-scorer DISAGREEMENT mechanism (token-F1
vs the meaning-level LLM judge, harness v2 / Decision D11): rates, a taxonomy of the
actual cases, how past disagreements were ruled, and what scorer-clean status costs at
the eligibility gate. **Nothing in this document was applied.** The PROPOSALS section is
written-only; every candidate change needs its own ruling and validation before touching
`eval/`.

Sources read: `eval/run.js` (flagging logic, lines 281–296), `eval/report.js`
(scorer-clean gate, lines 98–158), `eval/judge.js` + `eval/judge-prompt.md` (v1),
`eval/ADJUDICATIONS.md`, `eval/adjudications.json` (35 standing rulings),
`eval/ADJUDICATION_QUEUE.md`, calibration reports 1–5 in `docs/`, and the raw results
in the main tree (read-only):

| run | file | rows | judged rows |
|---|---|---|---|
| cal #1 | `eval/results/2026-08-07T04-37-45.jsonl` | 173 | 125 |
| cal #2 | `eval/results/2026-08-07T13-45-01.jsonl` | 260 | 193 |
| cal #3 | `eval/results/run3-twostep-2026-08-09-final.jsonl` | 320¹ | 172 |
| cal #4 | `eval/results/calibration4-2026-08-11.jsonl` | 359¹ | 172 |
| cal #5 | `eval/results/calibration5-2026-08-14.jsonl` | 260 | 169 |

¹ includes unadjudicated draft rows that score nothing (cal-#4 report filed the
`drafts-*` exclusion; landed before cal #5).

**How a DISAGREEMENT is defined** (`run.js`): the judge runs on fuzzy/mismatch rows with
both sides non-null; a row is flagged when token-PASS meets judge
`polarity_inverted`/`different_claim`, or token-FAIL meets judge `same_claim`. Flags are
never auto-resolved; `report.js` blocks a category's auto-air eligibility while any flag
in it is un-adjudicated (in-file `adjudicated: true` or the `adjudications.json`
registry, merged by id).

---

## (a) Disagreement rate — per calibration and per category

### Per calibration

| | cal #1 | cal #2 | cal #3 | cal #4 | cal #5 |
|---|---|---|---|---|---|
| judged rows | 125 | 193 | 172 | 172 | 169 |
| DISAGREEMENT flags | 12 | 31 | 30 | 30 | 29 |
| **rate (flags / judged)** | **9.6%** | **16.1%** | **17.4%** | **17.4%** | **17.2%** |
| rate (flags / golden rows) | 6.9% | 11.9% | 11.5% | 11.5% | 11.2% |
| **first-seen (never flagged before)** | 12 | 19 | **0** | **0** | **1** |
| open after standing rulings | 12² | 0 | 0³ | 0 | **1 (geo-005)** |

² pre-registry; the Sections-1+2 sitting (2026-08-10) later ruled them all.
³ retroactively — at the time cal #3 ran, no adjudication pass existed and all 30 blocked.

**The headline trend: the raw flag rate is flat (~17% of judged rows, ~11% of the set)
but the *marginal* disagreement rate has collapsed — 19 new flags in cal #2, then 0, 0, 1
across cals #3–5.** The flag population is almost entirely the same recurring ids
re-flagged every run (the extractor re-paraphrases, the token scorer re-fails, the judge
re-passes) and re-absorbed by the registry. The cal #1→#2 jump is the golden-growth pass
(173→260): the new `*-025`…`*-033` cases are paraphrase-rich transcripts that the token
scorer systematically under-scores (see class A below). Steady state since: **~0.2% of
judged rows per run produce a genuinely new disagreement** (1 in the last ~510 judged
rows across three runs).

### Per category (flag counts per run; cal-#5 judged-row denominators shown)

| category | #1 | #2 | #3 | #4 | #5 | #5 rate |
|---|---|---|---|---|---|---|
| polarity_traps | 5 | 5 | 5 | 5 | 5 | 5/11 = 45% |
| geography_civics | 1 | 6 | 6 | 6 | 6 | 6/24 = 25% |
| current_events | 2 | 6 | 6 | 6 | 6 | 6/27 = 22% |
| statistics | 1 | 5 | 5 | 5 | 4 | 4/23 = 17% |
| adversarial | 1 | 3 | 3 | 3 | 3 | 3/20 = 15% |
| science_health | 1 | 3 | 3 | 3 | 3 | 3/18 = 17% |
| historical_events | 0 | 2 | 2 | 2 | 2 | 2/19 = 11% |
| person_claims | 1 | 1 | 0 | 0 | 0 | 0 |
| attributed_quotes | 0 | 0 | 0 | 0 | 0 | 0 |

polarity_traps' 45% is structural, not noise: the category is *designed* to make the
canonical-positive extraction contract collide with the judge's transcript-level polarity
rule (class B below) — the same 5 ids every run. Geography and current_events carry the
paraphrase-heavy golden additions. attributed_quotes has never produced a flag in five
runs (its misses are verifier-stage, not extraction-stage).

### Run-to-run churn is threshold jitter, not semantic change

Between cal #4 and cal #5, three flags disappeared (geo-012, curr-027, stat-027) and two
appeared (geo-005, curr-15 — the latter already registry-ruled). None of the churn
reflects a change in extractor semantics:

- **geo-012**: same faithful paraphrase both runs; F1 landed 0.55-ish (FAIL → flag) in #4
  and 0.706 (PASS → both agree, no flag) in #5.
- **curr-027**: F1 = **exactly 0.600** in cal #5 — passed by `>=` on the threshold
  boundary; flagged in #2–#4.
- **stat-027**: missed-extraction in #5 (null side → judge skipped, no flag possible).
- **geo-005**: F1 crossed 0.571 → 0.625 because the extractor appended three tokens
  ("in the world") — see section (d).

The 0.6 F1 boundary is a coin flip for paraphrase wording, and which side a case lands on
decides whether a scorer *disagreement* exists at all (both-fail rows are inversions/
misses, not disagreements). Flag existence is therefore partly an artifact of wording
variance in the thing being graded.

---

## (b) Taxonomy of the cal-#5 disagreement cases (29 flags, verbatim from the jsonl)

All 29 rows pulled from `eval/results/calibration5-2026-08-14.jsonl`. Four classes.

### Class A — token-scorer paraphrase blindness (18/29, 62%)

Pattern: token-FAIL (`mismatch`, F1 0.267–0.588) while the judge rules `same_claim`.
The extraction is a faithful paraphrase that carries extra transcript detail and/or
normalization mismatches ("U.S." vs "United States", "early nineties" vs "early-1990s",
"kids"/"hyper" vs "children"/"hyperactive"), which inflate the token union and crater F1.

| id | F1 | expected (gist) | got (gist) |
|---|---|---|---|
| stat-005 | 0.571 | >1B people live in the U.S. | "over a billion people living in the United States" |
| curr-006 | 0.583 | Titan imploded June 2023, Titanic dive | same + "five people aboard" |
| sci-010 | 0.500 | Sugar makes children hyperactive | "Sugar makes kids hyper" |
| adv-012 | 0.500 | COVID vaccines contain microchips | same + Bill Gates attribution |
| curr-015 | 0.476 | Biden won the 2024 election | same + "second term he was running for" |
| curr-019 | 0.500 | inflation ~9% in 2022 | same + "year over year, highest in four decades" |
| curr-023 | 0.522 | Tokyo Olympics held summer 2020 as scheduled | same + "during the pandemic" |
| stat-025 | 0.316 | U.S. has largest population of any country | "America has more people than any other country on Earth" |
| stat-028 | 0.560 | violent crime ~half early-90s peak | same, drops "U.S."/"peak" |
| sci-029 | 0.571 | MSG is dangerous to your health | "MSG is dangerous to the brain" (transcript: "poison for your brain") |
| stat-029 | 0.588 | smoking kills >1M Americans/yr | same, rephrased |
| curr-030 | 0.417 | 2020 most U.S. murders ever | same, rephrased |
| sci-030 | 0.267 | carrots improve eyesight | same + pilots detail |
| hist-032 | 0.583 | Marshall Plan rebuilt Western Europe | "pumped billions into Western Europe… rebuilt it" |
| adv-033 | 0.316 | tongue regions taste different flavors | tongue map: sweet front, bitter back |
| curr-033 | 0.545 | Trump survived assassination attempt, Butler PA | same + roof/ear details |
| geo-033 | 0.400 | 22nd Amendment limits presidents to two terms | same + "enacted after FDR" |
| hist-033 | 0.545 | Rosa Parks kept seat, feet tired | same + shift detail |

**Note this class is NOT a fuzzy-threshold artifact in the tunable sense.** Class-A F1
runs as low as 0.267 and expected-token recall as low as 0.33 (recomputed from the raw
strings with `run.js`'s own `tokens()`); no threshold value separates these from real
mismatches — the Einstein inversion scored 0.828, far above all of them. The token
scorer is *structurally* blind to paraphrase, exactly as the v1 README limitation says.
What the threshold DOES govern is flag *churn* at the boundary (geo-005/geo-012/
curr-027, section a).

### Class B — canonical-form contract vs the judge's transcript rule (8/29, 28%)

Pattern: token-PASS (got ≈ the golden's expected extraction, F1 0.64–0.93) while the
judge rules `polarity_inverted` — because the judge grades against the *transcript's*
spoken negation, which the canonical-positive extraction contract (ruled by Coby
2026-08-10, ADJUDICATIONS.md §1A) deliberately drops into the separate `polarity` field
the judge never sees.

Cases: **pol-004, pol-005, pol-006, pol-007, pol-011** (the five standing
polarity_traps), **adv-027, geo-030, geo-031** (the three `investigated_pol_pending`
cases, resolved 2026-08-11 when cal #4 recorded `got_polarity: "denies"` on all three).
Representative (pol-011, F1 0.933):

> snippet: "Mark Twain never said the coldest winter I ever spent was a summer in San
> Francisco, that one's fake"
> expected: "Mark Twain said 'the coldest winter…'" · got: "Mark Twain said the coldest
> winter…" · judge: "the transcript explicitly states Mark Twain 'never said' this
> quote, but both extractions assert he DID say it"

The judge's note is *semantically correct about the transcript* and *wrong about the
contract*. This is a systematic, predictable blind spot — not hallucination — and it is
the only class where the ruling has gone against the judge 8 out of 8 times. It will
recur every run until the judge prompt learns the contract (Proposal P2) because the
judge cache is keyed on (prompt, expected, actual, snippet) and the extractor re-words
these often enough to miss cache.

### Class C — genuine semantic disagreement: multi-claim sentences (2/29, 7%)

Pattern: the snippet contains two checkable claims; the extractor grabs one, the golden
expects the other; token overlap on the shared entity passes; the judge correctly says
`different_claim`.

- **geo-032** (ruled `different_claim` 2026-08-10, judge ratified): "the Pacific is the
  biggest ocean, bigger than all the land on Earth put together" — golden expects the
  largest-ocean claim, extractor took the bigger-than-all-land claim. F1 0.632.
- **geo-005** (OPEN — the only unruled disagreement in cal #5): section (d).

This is the one class that represents a real, current extractor behavior question
(claim *selection* in multi-claim utterances), and the judge has been right both times.

### Class D — judge quibble / hallucinated inversion (1/29, 3%)

- **geo-026** (ruled `same_claim`): expected "Congress can override a presidential veto
  with a simple majority" vs got the same + "of fifty percent plus one". Judge:
  "a simple majority is actually more than fifty percent… the phrasing inverts the
  mathematical relationship" — an invented inversion; the ruling called it "a semantic
  quibble, not an inversion." The only confirmed judge *reasoning* failure ever flagged
  as a disagreement. (cal #2's shaky curr-015 "running for" reasoning was the same
  flavor but on a both-fail row, so it never flagged; by cal #5 the judge ruled curr-015
  `same_claim` on its own.)

### Not in the flag population — but load-bearing context

The judge's real catches — **adv-007** ("zero evidence humans are causing climate
change" → "Humans are causing climate change"), **pol-002** (vague-pointer extraction),
**geo-029** (cal #2: "republic, NOT a democracy" → "America IS a democracy") — were
token-FAIL + judge-bad rows: *both* scorers failed, so no DISAGREEMENT fired. The
disagreement flag never fires on the cases that vindicate the judge most; it fires where
the scorers' blind spots differ. (cal #5 note: geo-029's extractor behavior did not
recur — this run it extracted "America is a republic, not a democracy", token-PASS +
judge `same_claim`.)

---

## (c) How disagreements were ruled — and whether rulings favor either scorer

31 distinct ids have ever carried a DISAGREEMENT flag; 30 are ruled (registry +
ADJUDICATIONS.md), 1 is open (geo-005). Rulings by class:

| class | n ruled | ruled for judge | ruled for token | ruling |
|---|---|---|---|---|
| A (token paraphrase blindness) | 19⁴ | **19** | 0 | `same_claim`, extract_pass → true (Section-2 batch-ratify + person-017/curr-015) |
| B (canonical-form contract) | 8 | 0 | **8** | `same_claim` under the §1A contract — judge uninformed, not wrong |
| C (multi-claim selection) | 1 | **1** | 0 | geo-032 `different_claim` — investigated extractor miss |
| D (judge quibble) | 1 | 0 | **1** | geo-026 `same_claim` |

⁴ the 21-row Section-2 batch minus geo-032 (class C) minus stat-027-style ids that
flagged in some runs only, plus person-017 and curr-015.

**Neither scorer is globally "systematically right" — but the ruling is almost perfectly
predicted by the disagreement's *shape*:**

- **token-FAIL + judge-`same_claim` → ruled for the judge 19/19 (100%).** The human has
  never once sided with the token scorer against a judge `same_claim` verdict.
- **token-PASS + judge-`polarity_inverted` → ruled against the judge 9/9** (8 class-B by
  contract + geo-026) — but 8 of the 9 are the *same policy fact* (the judge can't see
  the polarity field), not nine independent judge errors. Post-contract, the judge's
  true error rate on flagged disagreements is 1 case in five calibrations (geo-026).
- **token-PASS + judge-`different_claim` → ruled for the judge 1/1** (geo-032), with
  geo-005 open and shaped identically.

Implication: the *information* in a disagreement flag is concentrated in the
`different_claim`-on-token-PASS shape (class C) — the only shape whose resolution isn't
already determined by a standing pattern. Class A and class B flags have been 100%
predictable for three runs.

---

## (d) The cost of disagreement — what hinges on scorer-clean status

`report.js` blocks eligibility on two scorer-clean conditions *after* the numeric bars
(lines 149–152): uninvestigated inversions, then open disagreements. What that has
decided, run by run:

- **cal #2 / cal #3:** no adjudication pass existed; 13 inversions + 30–31 open
  disagreements failed condition 3 in every category *independent of any score*
  (cal #3's promotion verdict lists it as a standalone FAIL).
- **cal #4:** the first-ever ELIGIBLE categories (adversarial, science_health at 96.9%)
  emerged **only after the registry merge** — the addendum's headline is entirely a
  scorer-clean status change, zero new model behavior.
- **cal #5:** scorer-clean is the *sole* D3 blocker for exactly one category —
  geography_civics.

### The geo-005 case (verbatim, cal #5)

> snippet: "the Amazon river is in South America, mostly Brazil, um, biggest river by
> volume by far"
> expected: "The Amazon River is in South America."
> got: "The Amazon River is the biggest river by volume in the world."
> token: PASS (fuzzy-overlap, F1 0.625) · judge: `different_claim` — "Expected states
> location (South America); actual states a superlative ranking… different factual
> claims about different properties of the Amazon River." · verify (on the expected
> extraction, by harness design): True @ 0.99 ✓

Confirmed against `report.js` output on the cal-#5 file: geography_civics meets every
other D3 condition — precision@floor **96.4%** (≥95%), n=28 (≥20), judge present, **0**
uninvestigated inversions (geo-029/030/031 registry-ruled) — and reports
`NOT ELIGIBLE — 1 scorer disagreement(s) awaiting adjudication: geo-005`. **One unruled
row is holding the category's D3 eligibility.** (At the stricter R64-A-0d graduation bar
it stays "far" regardless: concurrence 93.3% < 95% and n@floor 28 < 30 — ruling geo-005
changes the D3 line of the report, not the graduation verdict.)

Three facts make geo-005 the cleanest specimen of flag-mechanics in the dataset:

1. **The extractor behavior is 3-run-stable and was never flagged before.** In cal #1
   and cal #4 the extractor made the *same* choice ("The Amazon River is the biggest
   river by volume.") — F1 0.571 → token-FAIL, judge said `partial`, both scorers
   failed, **no flag, no block**. In cal #5 the extraction gained "in the world," F1
   crossed 0.571 → 0.625, token flipped to PASS — and the identical semantic event
   became a category-blocking DISAGREEMENT.
2. **The judge label itself drifted** (`partial` in #1/#4 → `different_claim` in #5) on
   near-identical inputs. Only `different_claim`/`polarity_inverted` can flag on a
   token-PASS (`run.js` line 289: `partial` never flags), so the flag also depended on
   which side of the judge's own partial/different boundary the sample landed.
3. **Precedent exists and is exact.** geo-032 is the same shape (two claims in one
   sentence, extractor took the second/more extreme one, token passed on entity
   overlap), ruled `different_claim` — judge ratified, investigated extractor miss,
   `extract_pass_override: false`. Note the *substance* is a real extractor question:
   both Amazon claims are true and checkable, but claim-selection against the golden is
   an extraction miss under the geo-032 precedent. A future golden-lane option (out of
   this packet's lane): splitting multi-claim snippets or annotating acceptable
   alternate extractions.

Cost accounting for cal #5 overall: of 9 categories, 1 category-eligibility outcome
(geography_civics) hinges on scorer-clean status; the other 8 are decided by numeric
bars or class policy (D4/R51/D11). Historically the dependency has been much larger
(everything in #2–#3; the two headline eligibilities in #4) — the registry reduced
scorer-clean from a blanket blocker to a one-case marginal condition. The residual cost
is operational: every run re-flags ~28 known-ruled rows in the run log and the raw
jsonl, so the one new flag per run has to be found by diffing against the registry.

---

## PROPOSALS (written, NOT applied — ranked by evidence strength)

The judge/scorer machinery is RED for this packet; none of the below was implemented,
configured, or tested against live scoring. Each proposal names its evidence, its risk,
and the validation a future ruling would need. Replay validation is cheap for the token
scorer (`matchExtraction` is pure — all five results files can be re-scored offline with
zero API calls); judge-prompt changes cost a cache-invalidating re-judge (~170 Haiku
calls, well under $1, plus label-comparability across calibrations).

### P1 — Rule geo-005 `different_claim` at the next adjudication sitting (evidence: strongest)

**Change (a ruling, not code):** add geo-005 to `eval/adjudications.json` as
`{"adjudication": "different_claim", "extract_pass_override": false}` + an
ADJUDICATIONS.md entry citing the geo-032 precedent (same multi-claim-selection shape,
same token-pass-on-entity-overlap mechanism, judge ratified).
**Evidence:** section (d); geo-032 precedent is exact; the judge's `different_claim`
note is verifiably correct against the two strings; three runs of stable extractor
behavior.
**Effect:** geography_civics D3 line becomes ELIGIBLE at 96.4%/n=28 with scorers clean
(graduation verdict unchanged — still concurrence- and n-blocked at R64-A-0d).
**Risk:** low. The only alternative reading (the superlative claim is an acceptable
alternate extraction) would require amending the golden, which is the golden lane's
call, not the eval lane's; the ruling should note the option rather than exercise it.
**Validation:** human sitting reads the verbatim row, confirms the label, re-runs
`node eval/report.js eval/results/calibration5-2026-08-14.jsonl`, and confirms
geography flips to ELIGIBLE with 0 open disagreements — plus the standing rule that a
confirmed `different_claim` counts against judge-clean % as an investigated extractor
miss (as geo-032 does today).

### P2 — Judge-prompt v2: teach the canonical-positive contract (evidence: strong; risk: the highest here)

**Change (written for a future sitting):** bump `eval/judge-prompt.md` to v2, adding one
rule between rules 2 and 3, e.g.:

> "The expected_extraction is the contract. If the actual extraction asserts the same
> thing as the EXPECTED extraction, the label is same_claim even when both differ from
> the transcript — in this system a speaker's negation is deliberately carried in a
> separate polarity field you do not see, and the expected extraction is already stated
> in canonical positive form. Only compare against the transcript to disambiguate
> pronouns or elided context, or when actual and expected genuinely differ from each
> other."

**Ambiguity targeted (specific):** v1's rule 2 ("polarity is decisive… even if every
other token matches") plus snippet access pulls the judge to grade actual-vs-transcript;
all 8 class-B flags (pol-004/005/006/007/011, adv-027, geo-030, geo-031) are exactly
this, re-flagged every run since cal #1 and ruled `same_claim` 8/8 under the §1A
contract. ADJUDICATION_QUEUE.md §1A already sanctioned "consider adding a note to
judge-prompt.md" when the contract was ruled; it was never done.
**Effect:** removes the largest predictable flag class (28% of cal-#5 flags) at the
source; polarity_traps' judge-clean % becomes meaningful instead of permanently 45%
flagged-and-overridden.
**Risk: HIGH — this edits the judge's core inversion muscle.** A wording that
over-teaches "trust expected" could suppress real inversion catches where got ≠ expected
(adv-007, geo-029 class — the judge's whole reason to exist). Mitigation is exactly the
discriminator the rulings validate: the contract only applies when actual ≈ expected
*in the same direction*; adv-007-class bugs have actual ≠ expected and stay
`polarity_inverted` under the proposed text. Also: editing the prompt invalidates the
judge cache by design (re-judge cost) and breaks label comparability with cals #1–5 —
the changelog and the next calibration report must say so.
**Validation protocol (required before adoption):** a fixed judge-regression set run
with `--no-cache`, all from already-ruled rows: the 8 class-B cases must return
`same_claim`; adv-007, pol-002, geo-029(cal-#2 strings), geo-032, geo-005 must return
`polarity_inverted`/`different_claim` as ruled; geo-026 should return `same_claim`
(bonus, not required). Zero misses on the inversion side is a hard gate — per the
prompt's own philosophy, missing an inversion is far worse than over-flagging. Version
bump + changelog entry per the file's convention.

### P3 — Registry-aware flag surfacing in the harness (evidence: strong; risk: low)

**Change:** `run.js` (or a post-run step) consults `eval/adjudications.json` and tags
rows whose id carries a standing ruling as `disagreement: "RULED"` in the console line
(jsonl field unchanged, or an added `ruling_known: true` — report.js merge logic
untouched either way).
**Evidence:** 28 of cal-#5's 29 flags were registry-known noise; the one real item
(geo-005) had to be found by diffing. The cal-#4 report filed the same pain ("the
report re-flags the same inversions… they need porting to each new run") and the
registry fixed report.js but not the run-time surface.
**Risk:** low, but two cautions: (1) the registry rules by *id*, and a standing ruling
was made on a specific (expected, got) pair — if the extractor produces a *new* wording
for a ruled id, auto-tagging it RULED could mask a genuinely different failure. Safer
variant: tag RULED only when the got_extraction matches the wording the ruling examined
(store a normalized hash in the registry), else flag as new. (2) never auto-set
`adjudicated: true` at run time — surfacing, not resolving.
**Validation:** offline replay of all five results files; assert the RULED/OPEN split
matches what report.js computes today (28/1 on cal #5) and that a synthetic new-wording
row on a ruled id still surfaces as OPEN under the safer variant.

### P4 — Class-A standing pattern rule: pre-ratified judge on token-FAIL/`same_claim` with audit sampling (evidence: 19/19; risk: philosophical)

**Change (policy, for a sitting to rule):** adopt a standing rule — analogous to the
§1A canonical-positive contract — that the token-FAIL + judge-`same_claim` shape is
ratified for the judge by default, recorded as `adjudication_source: "pattern-A"`, with
a mandatory human audit of a sample (e.g. 20%, min 3) each run instead of case-by-case
rulings.
**Evidence:** 19/19 rulings for the judge on this shape across five calibrations,
including a 21-row batch-ratify the human already chose to do wholesale on 2026-08-10;
the shape is mechanically detectable; it is 62% of current flag volume.
**Risk:** this is the first crack in "never auto-resolved" (run.js's stated contract) —
a judge failure mode that *systematically* calls different claims same (e.g. after a
model swap in judge.js) would sail through. That is why the audit sample and a
model-pin guard (rule void if `MODEL` in judge.js changes until re-validated) must be
part of the ruling, and why P4 ranks below P2 despite stronger raw numbers: P2 removes
flags by making the judge right; P4 removes them by trusting it.
**Validation:** replay cals #2–5 under the rule: confirm every pattern-A auto-ratify
matches the existing human ruling (it will — that's the 19/19), confirm geo-032/geo-005
class-C flags are untouched, and write the audit procedure into eval/README.md's
disagreement workflow before first use.

### P5 — Do NOT tune the fuzzy-F1 threshold; instead surface boundary landings (evidence: moderate; the negative finding matters)

**Finding first:** the data kills the obvious proposal. Class-A F1 spans 0.267–0.588 —
no threshold passes them without passing everything (Einstein inverted at 0.828) — so
"adjust FUZZY_F1_THRESHOLD to fix the false disagreements" is not supported by any case
in five calibrations. What the threshold demonstrably does is *churn*: geo-005
(0.571→0.625, FAIL→PASS, silent→blocking), geo-012 (FAIL→0.706 PASS), curr-027 (0.600
exactly, passed by `>=`). Same semantics, different flag outcomes.
**Change:** leave the threshold at 0.6; have `run.js` record `extract_f1` on ALL
fuzzy/mismatch rows (it already does) and have `report.js` print a one-line
"boundary landings" note listing rows with F1 in [0.55, 0.65) — so a future geo-005
(flag existence decided by ±0.03 of F1) is visible as threshold-sensitive at reading
time, and a run-over-run flag appearance/disappearance can be attributed to jitter
without archaeology.
**Risk:** near zero (report-only).
**Validation:** replay all five files; confirm the boundary list catches geo-005,
geo-012, curr-027 and stays short (<5 rows/run).

### P6 — Surface `partial`-on-token-PASS in the report (evidence: weakest; risk: near zero)

**Change:** report.js prints a non-blocking count of token-PASS + judge-`partial` rows
per category (cal #5 has 6: quote-002, pol-003, geo-013, person-016, adv-019, hist-029).
These are silent today — `partial` never flags — yet geo-005's history shows the
judge's partial/different boundary is unstable, meaning a real different_claim can hide
under a `partial` label on a token-PASS and never surface anywhere.
**Evidence:** one observed label drift (geo-005: `partial` #1/#4 → `different_claim`
#5). Not enough to justify making `partial` block; enough to justify printing it.
**Risk:** report noise only; explicitly NOT proposing `partial` join `judgeBad` — that
would add ~6 flags/run on one case of evidence.
**Validation:** replay; confirm the line is informational and changes no eligibility
verdict on any of the five files.

---

## Bottom line

The two-scorer disagreement mechanism has converged: after the golden-growth pass, the
flag population is ~96% recurring, fully-ruled cases (registry-absorbed), the marginal
rate is ~1 new case per two runs, and rulings are near-perfectly predicted by
disagreement shape — judge always right on token-FAIL/`same_claim` (19/19) and on
multi-claim `different_claim` (1/1 + geo-005 pending), token right only where the judge
is structurally uninformed of the polarity contract (8/8) plus one true judge quibble.
The single open item, geo-005, is a threshold-jitter *flag* on top of a real,
3-run-stable claim-selection behavior with exact precedent (geo-032), and it is the only
thing between geography_civics and a clean D3 line. Rule it first (P1); teach the judge
the contract second (P2); everything else is noise reduction.
