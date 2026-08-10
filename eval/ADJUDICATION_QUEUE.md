# Human adjudication queue — everything blocking eval progress, one sitting

**What this is.** Every pending human-adjudication item from calibration re-run #2
(2026-08-07), the field test (2026-08-08), the pass-2 session (2026-08-09), and the
street session (2026-08-10), pulled into one document so you can clear them in a single
pass. Each item shows you the evidence and gives you checkboxes; where the answer is
obvious there's a pre-filled recommendation you only have to ratify.

**Why it matters — what clearing this unblocks:**

1. **The zero-inversions precondition.** No category can EVER become auto-air eligible
   while it has uninvestigated polarity inversions or open scorer disagreements
   (`report.js` hard rule). Run #2 left **13 uninvestigated inversions** and **31 open
   disagreements** across the categories. Until a human rules on each one with
   `"adjudicated": true`, even a category that someday hits 95% precision stays blocked.
2. **Golden-set growth.** 51 field drafts (20 unique claims) are sitting in
   `golden/drafts-2026-08-08-fieldtest.jsonl` with null ground truths and can't be
   scored until adjudicated. They include a **new failure class** (extractor
   prompt-echo) that should enter the adversarial set as regression cases.
   (Separate gap, not fixable from these drafts: polarity_traps is stuck at n=12 of the
   20 needed — new trap cases have to be authored.)
3. **An honest baseline before round-4 work.** The two-step-verify / dedupe / F1-guard
   work all needs a clean scoreboard to measure against.
4. **The stakes stopped being hypothetical on 2026-08-10.** Adjudication question 1A
   aired a display-incoherent card on the street (FS-1: a true spoken negation displayed
   as its canonical-positive text under a TRUE badge — a false sentence on air; see
   `docs/FIELD_TEST_2026-08-10_STREET.md`). D17 closed the display layer with the
   interim card-text-≠-spoken → SKIP rule; **1A still owns the canonical-form policy**
   that decides the real fix (P7-A). Every day 1A stays open, the SKIP rule is the only
   thing between a correct pipeline and an on-air lie.

**Honest time estimate: ~2 hours 10 minutes total.** Section 1 is one policy call plus 13
quick rulings (~25 min). Section 2 is mostly rubber-stamping the judge over the string
scorer (~20 min). Section 3 needs a few real source lookups — Norway's king, McDonald's
CEO, 2025 GDP growth (~30 min). Sections 4–5 (the pass-2 and street drafts) add ~40 min —
mostly ratify-ticking, and their two policy clusters are the SAME calls as 1A and 3.3,
made once. Mechanics at the end (~15 min). If you take the batch-ratify options where
offered, closer to 90.

How to use it: work top to bottom, tick boxes, jot one-line notes in this file. Then do
the "After adjudication — the mechanical steps" section at the bottom to move your
rulings into the actual data files.

---

## Section 1 — Polarity inversions (13 uninvestigated, all found concretely)

The calibration report headline says "6 polarity inversions" — those are the 6 in the
**polarity_traps** category (1A below). But the run actually flagged **13** inversions
across four categories, and the zero-uninvestigated-inversions rule is per-category, so
the other 7 (1B) block `adversarial`, `current_events`, and `geography_civics` just as
hard. All 13 are here; nothing needs to be pulled from elsewhere.

All rows live in `eval/results/2026-08-07T13-45-01.jsonl` (the run-#2 results file).

### ⚖️ The one policy call that decides most of 1A

The polarity_traps golden entries were **designed** so that `expected_extraction` states
the claim in **canonical positive form** even when the speaker negates it — e.g. the
speaker says "Nixon did NOT finish his second term," the golden expects the extraction
"Richard Nixon finished his second term" with ground truth **False**, and the aired card
("False — he resigned in 1974") then *agrees with the speaker*. The live extractor also
emits a separate `polarity` field the judge never sees.

The LLM judge compared extraction strings against the **transcript** and flagged
"inverted" wherever the negation was dropped — including cases where the actual
extraction matches the golden's own expected extraction almost word for word (pol-011 is
0.933 F1 against expected). So the real question is not "did the extractor blow it 6
times" but:

> **Is canonical-positive-form extraction (with polarity carried in a separate field)
> the correct contract, or must the extraction string itself preserve the speaker's
> negation?**

- ☐ **Canonical-positive is the contract** → pol-004, pol-005, pol-006, pol-007, pol-011
  are rightly extracted; rule them `same_claim` (judge lacked the polarity-field
  context). Consider adding a note to `judge-prompt.md` for future runs.
- ☐ **Extraction must preserve speaker polarity** → the inversions are real extractor
  failures; confirm them as `polarity_inverted` (they'll still count against
  judge-clean %, but as *investigated*, which unblocks the gate).
- Note: _______________________________________________

Then confirm each case individually (a blanket call is fine, but eyeball each — pol-002
and the 1B cases don't reduce to the policy call):

### 1A — the 6 polarity_traps inversions

**pol-002** — token: FAIL (mismatch, F1 0.444) · judge: polarity_inverted · verify: False ✓ (golden False)
- Transcript: "and by the way Einstein never actually said that insanity quote, that whole thing is made up"
- Expected extraction: "Einstein said insanity is doing the same thing over and over and expecting different results."
- Got: "Einstein said the insanity quote"
- Judge's reason: transcript asserts Einstein NEVER said it; both extractions assert he did.
- Wrinkle: even under canonical-positive policy, "the insanity quote" is a vague
  pointer, not the claim — both scorers failed this one, so there's no scorer
  *disagreement*, just an inversion to rule on.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**pol-004** — token: PASS (fuzzy-overlap 0.706) · judge: polarity_inverted · DISAGREEMENT · verify: False ✓
- Transcript: "look, unemployment did NOT hit fifty percent during the Great Depression, that number is way off"
- Expected: "U.S. unemployment reached 50 percent during the Great Depression." (golden False)
- Got: "Unemployment hit fifty percent during the Great Depression"
- Got ≈ expected; judge flagged the dropped negation vs the transcript. Pure policy-call case.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**pol-005** — token: PASS (fuzzy-overlap 0.8) · judge: polarity_inverted · DISAGREEMENT · verify: True ✓
- Transcript: "the US population did not grow between 2010 and 2020, it was basically flat or shrinking"
- Expected: "The U.S. population grew between 2010 and 2020." (golden True)
- Got: "US population grew between 2010 and 2020"
- Got ≈ expected. Pure policy-call case.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**pol-006** — token: PASS (fuzzy-containment) · judge: polarity_inverted · DISAGREEMENT · verify: False ✓
- Transcript: "and remember, Nixon didn't finish his second term, he was gone before it ended"
- Expected: "Richard Nixon finished his second term as president." (golden False)
- Got: "Nixon finished his second term"
- Got ≈ expected. Pure policy-call case.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**pol-007** — token: PASS (fuzzy-overlap 0.824) · judge: polarity_inverted · DISAGREEMENT · verify: True ✓
- Transcript: "Obama didn't win the popular vote in 2012, he only got there through the electoral college"
- Expected: "Barack Obama won the popular vote in the 2012 presidential election." (golden True)
- Got: "Obama won the popular vote in 2012"
- Got ≈ expected. Pure policy-call case.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**pol-011** — token: PASS (fuzzy-overlap 0.933) · judge: polarity_inverted · DISAGREEMENT · verify: False ✓
- Transcript: "Mark Twain never said the coldest winter I ever spent was a summer in San Francisco, that one's fake"
- Expected: "Mark Twain said 'the coldest winter I ever spent was a summer in San Francisco.'" (golden False)
- Got: "Mark Twain said the coldest winter I ever spent was a summer in San Francisco"
- Got is nearly identical to expected. The clearest policy-call case of the six.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

### 1B — 7 more inversions blocking other categories

**adv-007** (blocks adversarial) — token: FAIL (mismatch 0.429) · judge: polarity_inverted · verify: False
- Transcript: "there is literally zero evidence, zero, that humans are causing climate change, none, look into it"
- Expected: "There is no evidence that humans cause climate change." (golden False)
- Got: "Humans are causing climate change"
- Here the negation-drop is REAL and consequential: the extractor turned the speaker's
  denialist claim into its opposite. The verify verdict (False on "humans are causing
  climate change") would have aired a card contradicting settled science. Both scorers
  agree it failed; you're ruling on the inversion label. Likely confirm.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**adv-027** (blocks adversarial) — token: PASS (fuzzy-overlap 0.667) · judge: polarity_inverted · DISAGREEMENT · verify: False
- Transcript: "I'm just asking questions here, but isn't it weird that no human being has ever actually been to the deepest part of the ocean?"
- Expected: "No human has ever reached the deepest part of the ocean." (golden False)
- Got: "A human being has been to the deepest part of the ocean"
- Extractor flipped the JAQ-style negative claim to its positive. Unlike the pol-traps
  cases, here got ≠ expected — the golden itself wanted the negative preserved. Likely
  confirm inversion (or rule it consistent with your Section-1A policy if you decide
  canonical-positive extends here).
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**curr-015** (blocks current_events) — token: FAIL (mismatch 0.556) · judge: polarity_inverted · verify: False ✓
- Transcript: "Biden won the 2024 election, um, he got the second term he was running for"
- Expected: "Joe Biden won the 2024 U.S. presidential election." (golden False)
- Got: "Biden won the 2024 election and got a second term"
- Judge's inversion reasoning is shaky here (it argued about "running for" semantics);
  got and expected assert the same false claim. Plausibly `same_claim` — read the judge
  note in the row before ruling.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**geo-026** (blocks geography_civics) — token: PASS (fuzzy-overlap 0.727) · judge: polarity_inverted · DISAGREEMENT · verify: False ✓
- Transcript: "Congress can override a veto with a simple majority, fifty percent plus one and the veto's dead"
- Expected: "Congress can override a presidential veto with a simple majority." (golden False)
- Got: "Congress can override a veto with a simple majority of fifty percent plus one"
- The judge's stated reason is a quibble about whether "fifty percent plus one" IS a
  simple majority — not a polarity inversion at all. Likely `same_claim` (judge error).
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**geo-029** (blocks geography_civics) — token: FAIL (mismatch 0.5) · judge: polarity_inverted · verify: NeedsContext ✗ (golden Misleading)
- Transcript: "America is not a democracy, people need to learn this, it's a republic, not a democracy, look it up"
- Expected: "The United States is a republic, not a democracy." (golden Misleading)
- Got: "America is a democracy"
- Real inversion: extractor collapsed "republic, NOT a democracy" into "IS a democracy."
  Likely confirm. (The verify miss on this row is a separate, non-blocking issue.)
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**geo-030** (blocks geography_civics) — token: PASS (fuzzy-overlap 0.636) · judge: polarity_inverted · DISAGREEMENT · verify: False ✓
- Transcript: "nobody has ever won the White House while losing the popular vote, never happened, the system prevents it"
- Expected: "No U.S. president has ever won the presidency while losing the popular vote." (golden False)
- Got: "Someone has won the White House while losing the popular vote"
- Extractor stated the opposite of both speaker and golden. But note: the verifier's
  False on the extracted positive... actually the extracted claim is TRUE (five
  presidents have) — stage 2 runs on the *expected* extraction, which is why the verdict
  still scored. As an extraction, this is the speaker's claim inverted. Likely confirm.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

**geo-031** (blocks geography_civics) — token: PASS (fuzzy-overlap 0.667) · judge: polarity_inverted · DISAGREEMENT · verify: False ✗ (golden NeedsContext)
- Transcript: "DC has no representation in Congress, none, seven hundred thousand people and zero representation"
- Expected: "Washington, D.C. has no representation in Congress." (golden NeedsContext)
- Got: "DC has representation in Congress"
- Straight negation drop against both speaker and golden. Likely confirm.
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

---

## Section 2 — Open scorer disagreements (22 remaining)

Run #2 flagged 31 disagreements; 9 of them are the DISAGREEMENT-flagged inversions you
just ruled in Section 1 (pol-004/005/006/007/011, adv-027, geo-026, geo-030, geo-031).
These are the other 22. The pattern in 21 of them is identical: **the token scorer
failed on wording (mismatch, F1 < 0.6) while the LLM judge read both strings and ruled
`same_claim`** — i.e., the extraction was a faithful paraphrase and the v1 string scorer
is just too crude. Adjudicating these means ratifying the judge (set
`"extract_pass": true`, keep `judge_match`, add `"adjudicated": true`).

**Batch option:** skim the 21 table rows below; if you agree with the judge on all of
them, tick this box and apply the batch edit in the mechanics section.
- ☐ **Ratify the judge (`same_claim`, extract_pass → true) on all 21 token-fail/judge-pass rows**

Or rule row by row (verdict column shown only as context — verify scoring is separate):

| # | id | claim (expected) | got (gist) | judge note (gist) | ruling |
|---|----|------------------|-----------|-------------------|--------|
| 1 | stat-005 | More than one billion people live in the U.S. | "over a billion people living in the United States" | equivalent quantification | ☐ same ☐ inverted ☐ different |
| 2 | curr-006 | Titan submersible imploded June 2023 (Titanic dive) | same + "five people aboard" | complementary detail | ☐ same ☐ inverted ☐ different |
| 3 | sci-010 | Sugar makes children hyperactive | "Sugar makes kids hyper" | synonyms | ☐ same ☐ inverted ☐ different |
| 4 | adv-012 | COVID-19 vaccines contain microchips | same + Bill Gates attribution (in transcript) | added attribution, same core | ☐ same ☐ inverted ☐ different |
| 5 | geo-012 | Federal government has three branches | same + names the branches | added detail from transcript | ☐ same ☐ inverted ☐ different |
| 6 | person-017 | Bezos founded Amazon in 1994 | same + garage/books | added detail | ☐ same ☐ inverted ☐ different |
| 7 | curr-019 | U.S. inflation reached ~9% in 2022 | same + "highest in four decades" | supporting context | ☐ same ☐ inverted ☐ different |
| 8 | curr-023 | Tokyo Olympics held summer 2020 as scheduled | same, minor wording | same claim | ☐ same ☐ inverted ☐ different |
| 9 | stat-025 | U.S. has the largest population of any country | "more people than any other country on Earth" | identical claim | ☐ same ☐ inverted ☐ different |
| 10 | curr-027 | Aug 2023 Maui fires destroyed much of Lahaina | "wiped out the historic town of Lahaina" | "much of" vs "the" — minor | ☐ same ☐ inverted ☐ different |
| 11 | stat-027 | Median U.S. household income ~$500k/yr | same, rephrased | identical | ☐ same ☐ inverted ☐ different |
| 12 | stat-028 | Violent crime ~half of early-90s peak | same, omits "U.S."/"peak" | core preserved | ☐ same ☐ inverted ☐ different |
| 13 | sci-029 | MSG in food is dangerous to health | "MSG is dangerous to the brain" | faithful to transcript ("poison for your brain") | ☐ same ☐ inverted ☐ different |
| 14 | stat-029 | Smoking kills >1M Americans/yr | same, rephrased | equivalent | ☐ same ☐ inverted ☐ different |
| 15 | curr-030 | 2020 had most U.S. murders in history | same, rephrased | faithful paraphrase | ☐ same ☐ inverted ☐ different |
| 16 | sci-030 | Eating carrots improves eyesight | same + pilots detail | added detail | ☐ same ☐ inverted ☐ different |
| 17 | hist-032 | Marshall Plan helped rebuild Western Europe | "pumped billions into Western Europe... rebuilt it" | same claim | ☐ same ☐ inverted ☐ different |
| 18 | adv-033 | Different parts of tongue taste different flavors | tongue map: sweet front, bitter back | more specific, same claim | ☐ same ☐ inverted ☐ different |
| 19 | curr-033 | Trump survived assassination attempt, Butler PA, July 2024 | same + roof/ear details | same core | ☐ same ☐ inverted ☐ different |
| 20 | geo-033 | 22nd Amendment limits presidents to two terms | same + "enacted after FDR" | added context from transcript | ☐ same ☐ inverted ☐ different |
| 21 | hist-033 | Rosa Parks refused seat because feet were tired | same + shift detail | faithful paraphrase | ☐ same ☐ inverted ☐ different |

**The 22nd is the odd one out — rule it individually:**

**geo-032** — token: PASS (fuzzy-overlap 0.632) · judge: **different_claim** · DISAGREEMENT · verify: True ✓
- Transcript: "the Pacific is the biggest ocean, bigger than all the land on Earth put together actually"
- Expected: "The Pacific Ocean is the largest ocean on Earth." (golden True)
- Got: "The Pacific Ocean is bigger than all the land on Earth put together"
- The extractor grabbed the second (more extreme, also checkable) claim in the sentence
  instead of the first. The judge is right that it's a different claim; the token scorer
  passed on word overlap. Likely ratify the judge (`different_claim` — an investigated
  extractor miss, counts against judge-clean but stops blocking).
- ☐ same_claim ☐ polarity_inverted ☐ different_claim
- Note: _______________________________________________

---

## Section 3 — Field-test drafts (51 drafts → 20 unique claims)

Source: `eval/golden/drafts-2026-08-08-fieldtest.jsonl`. All have
`ground_truth_verdict: null` per the drafts contract — nothing here was auto-ruled. The
live pipeline's verdicts are shown as context only; **never copy them as ground truth
without checking a real source** (that would measure self-agreement).

Repeats are collapsed below; each group graduates as **one** canonical golden entry
(note the repeat count in its `adjudication_note` — the repetition itself is field data
about the dupe-guard bug F2).

### 3.1 — Ready-to-ratify recommendations (tick to accept, or overrule)

**R1 · "Peter Thiel is the president of the United States" — ×26 repeats**
(ids draft-...-004, 007, 008, 012, 013, 014, 015, 017, 020, 021, 022, 023, 024, 026, 027, 028, 031, 034, 037, 040, 042, 044, 046, 047, 048, 050 — pipeline: False @0.99 all 26)
- Recommend: **ground_truth False · category person_claims** (named individual → D4
  MUST-HOLD routing note) · source: whitehouse.gov / AP. Collapse to ONE entry,
  `adjudication_note` records "repeated ×26 in field test (dupe-guard F2 evidence)".
- ☐ Ratify ☐ Overrule: _____________

**R2 · "Donald Trump is the president of the United States"** (draft-001 — pipeline True @0.99)
- Recommend: **True · person_claims** (D4 note) · source: whitehouse.gov.
- ☐ Ratify ☐ Overrule: _____________

**R3 · "Donald Trump is the vice president of the United States"** (draft-036 — pipeline False @0.99)
- Recommend: **False · person_claims** (D4 note) · source: whitehouse.gov.
- ☐ Ratify ☐ Overrule: _____________

**R4 · "The king of Norway is named Harald Olofsen"** (draft-002 — pipeline False @0.99)
- Recommend: **False · person_claims** · source: royalcourt.no (the king is Harald V;
  "Olofsen" is not his name). Verify the source yourself before ratifying.
- ☐ Ratify ☐ Overrule: _____________

**R5 · "Elon Musk is the current mayor of New York City" — ×2** (drafts 005, 010 — pipeline False @0.99 both)
- Recommend: **False · person_claims** (D4) · source: nyc.gov. Durability note: "current"
  claims rot — consider rewriting the snippet with a dated frame ("in 2026") per the
  golden durability rule, or accept as-is with a review date.
- ☐ Ratify ☐ Overrule: _____________

**R6 · "The CEO of McDonald's is a man named Ronald McDonald" — ×2** (drafts 006, 011 — pipeline False @0.99 both)
- Recommend: **False · adversarial** (gag/trap claim — tests whether the pipeline keeps
  a straight face) or person_claims; source: McDonald's corporate leadership page.
- ☐ Ratify as adversarial ☐ Ratify as person_claims ☐ Overrule: _____________

**R7 · The dated-GDP family — recommend False · statistics · source BEA (bea.gov).**
2025 U.S. real GDP growth was nowhere near 4–5% — confirm the actual figure at BEA and
cite it in each note. Five entries (keep the phrasing variants — they're free
paraphrase-robustness tests, but consider whether five near-duplicates over-weight one
fact in the category):
- "GDP growth in the United States in 2025 was 4%" — ×2 (016, 039) ☐ Ratify ☐ Overrule
- "GDP growth in the United States in 2025 was 5%" (019) ☐ Ratify ☐ Overrule
- "GDP growth was 4% in the United States in 2025" (035) ☐ Ratify ☐ Overrule
- "GDP growth in 2025 was 4%" — ×2 (041, 043) ☐ Ratify ☐ Overrule
- Note: _______________________________________________

**R8 · The no-year GDP family — recommend NeedsContext · statistics.**
No time reference → not checkable as stated; the field report called these "good
NeedsContext exemplars." NOTE the pipeline was *inconsistent* on the identical claim —
that's a calibration data point worth preserving in the notes:
- "GDP growth in the US was 4%" — ×3 (045 False @0.98 · 049 **NeedsContext** @0.96 · 051 False @0.97) ☐ Ratify ☐ Overrule
- "United States GDP growth was 4%" (033 — False @0.98) ☐ Ratify ☐ Overrule
- "GDP growth in the United States was 5%" (029 — **Misleading** @0.97) ☐ Ratify ☐ Overrule
- Policy sub-question: is the right label NeedsContext (incomplete) or Misleading
  (unanchored stat)? Pick one and apply it to all three entries for consistency.
- ☐ NeedsContext ☐ Misleading — Note: _____________

**R9 · "Alexandria Ocasio-Cortez is a communist"** (draft-025 — pipeline False @0.98)
- Recommend: **False · person_claims** (D4 MUST-HOLD — this is exactly the defamation-
  adjacent shape D4 exists for) · source: her own stated affiliation (Democratic
  Socialists of America / campaign materials) — she identifies as a democratic
  socialist, not a communist. Defensible second label: NeedsContext (political labels
  are contested speech). Your call as editor.
- ☐ Ratify False ☐ NeedsContext ☐ Overrule: _____________

**R10 · "Mike Tyson is the most celebrated boxer of all time."** (draft-003 — pipeline Unverifiable @0.94)
- Two defensible rulings — pick one:
  - ☐ **expected_extraction: null** — "most celebrated" is opinion/superlative; correct
    behavior is no extraction (README: opinion → null). Category adversarial or
    person_claims.
  - ☐ **ground_truth Unverifiable** — keep the extraction, ratify the pipeline's field
    behavior (it extracted, then correctly said Unverifiable). Category person_claims.
- Note: _______________________________________________

### 3.2 — SPECIAL FLAG: the 4 prompt-echo drafts (NEW failure class — F1, HIGH)

Drafts **009, 018, 032, 038**. In each, the operator's *meta-speech about claims* ("and
they make a claim, like,") made the extractor return its own assistant preamble as the
claim — e.g. draft-018: snippet "You talk to a stranger and someone says," →
"expected_extraction": *"I'm ready to extract a checkable claim from a speaker's
sentence. Please provide..."*. Each echo burned a verify call and entered the operator
queue live. This is field bug **F1 (HIGH)** and exactly what D8 (speech is adversarial)
predicted — a viewer could induce it on purpose.

**Proposed handling (recommendation — you ratify or amend):**
- `expected_extraction: null` (correct behavior = extract nothing from meta-speech)
- `ground_truth_verdict: null` (follows from null extraction per the schema)
- `category: adversarial`
- `adjudication_note`: "extractor echo — F1 field bug 2026-08-08; live extractor
  returned its own preamble as the claim; regression case for the F1 output-grounding
  guard"
- These four become the golden set's first *extractor-echo* regression cases: once the
  F1 guard exists, the harness will prove it stays fixed.

- draft-009 ("and then actually fact check them") ☐ Ratify ☐ Overrule
- draft-018 ("You talk to a stranger and someone says,") ☐ Ratify ☐ Overrule
- draft-032 ("you talk to a stranger about socioeconomics, and they say,") ☐ Ratify ☐ Overrule
- draft-038 ("So imagine you're talking to someone about socioeconomics. They make a claim like,") ☐ Ratify ☐ Overrule
- Note: _______________________________________________

### 3.3 — SPECIAL FLAG: the STT-drift case (policy call needed)

**draft-030 · "Teal is the president of the United States"** (pipeline False @0.99)
- The operator said "Thiel"; Deepgram heard "Teal" (field bug F8, proper-noun drift).
  The claim that entered the pipeline is about the literal string "Teal".
- **The policy question: what is golden ground truth for a misheard claim — the heard
  string or the intended one?**
  - ☐ **Keep "Teal" as heard** → the entry tests end-to-end robustness to STT noise
    (ground_truth False — no president named Teal; category adversarial, note "STT
    drift: 'Thiel' misheard; verifier handled the garbage string correctly in the
    field"). This preserves what actually happened.
  - ☐ **Correct to "Thiel"** → the entry duplicates R1 and the STT lesson is lost;
    the F8 fix (nova-3 `keyterm` prompting with show names) is tracked separately.
  - ☐ **Drop the draft** → treat it as noise, rely on F8's keyterm fix.
- Whichever you pick becomes precedent for every future mishear — write the rule down
  in the note so the next ingest doesn't re-litigate it: _____________

---

## Section 4 — Pass-2 drafts (9 drafts, 9 unique claims)

Source: `eval/golden/drafts-2026-08-09-pass2.jsonl` (the 2026-08-09 test-air /
machine-floor session). All `ground_truth_verdict: null` per the drafts contract; the
live pipeline's verdicts are context only — never copy them as ground truth without a
real source.

### 4.1 — Ready-to-ratify recommendations (tick to accept, or overrule)

**R11 · The absurd-president family — 3 entries, recommend False · person_claims**
- "Muhammad Ali is the president of Kenya" (draft-001 — pipeline False @0.99) · source:
  State House Kenya (the president is William Ruto)
- "Reggie Watts is the president of Afghanistan" (draft-002 — False @0.99) · source:
  AP/BBC country profile (no recognized president; Taliban administration)
- "The president of Kenya is named Reggie Watts" (draft-005 — False @0.99) · same source
  as the first
- All three name public figures → D4 routing note per R1's convention.
- ☐ Ratify all 3 ☐ Overrule: _____________

**R12 · "GDP growth in 2023 was 4%"** (draft-003 — False @0.99)
- The mirror of R8: that family had no YEAR, this one has no COUNTRY. Recommend: apply
  whatever label R8's policy sub-question picks (NeedsContext vs Misleading) so the
  unanchored-stat rule is ONE rule, not two. (If read as U.S.: 2023 real GDP growth was
  ~2.9% per BEA — False on the merits either way; the label question is what the entry
  tests.)
- ☐ Same label as R8 ☐ False ☐ Overrule: _____________

**R13 · "GDP growth in the United States in 2019 was 4%"** (draft-004 — False @0.99)
- Recommend: **False · statistics** · source BEA (2019 real GDP growth ~2.3%). Dated,
  complete, durable — the cleanest GDP entry yet; joins the R7 family.
- ☐ Ratify ☐ Overrule: _____________

**R14 · "Gold is worth more than silver." — ×2 across sessions** (pass-2 draft-006 True
@0.98 · street draft-2026-08-10-004 True @0.98)
- Recommend: **True · statistics** · source: LBMA/COMEX spot (per-ounce price; has held
  for centuries — durability fine). Collapse both drafts to ONE entry; note the
  cross-session repeat.
- ☐ Ratify ☐ Overrule: _____________

**R15 · "Whales on average weigh six tons."** (draft-007 — False @0.97)
- Two defensible rulings, R10-style — pick one:
  - ☐ **NeedsContext** — "whales on average" is unanchored across species spanning ~1 to
    ~150 tons; the average is ill-defined as stated.
  - ☐ **False** — ratify the pipeline; under any reasonable reading six tons is far off.
- Note: _______________________________________________

**R16 · The Newton family — 2 entries, recommend False · historical_events**
- "Isaac Newton invented black hole geometry" (draft-008 — False @0.97) · source: black
  hole geometry is general relativity (Schwarzschild 1916) — two centuries after Newton.
- "Isaac Newton invented algebra" (draft-009 — False @0.97) · source: al-Khwarizmi, 9th
  century — algebra predates Newton by ~800 years.
- ☐ Ratify both ☐ Overrule: _____________

---

## Section 5 — Street drafts (39 drafts → 35 unique, ~18 rulings after grouping)

Source: `eval/golden/drafts-2026-08-10-street.jsonl` — the 2026-08-10 street session.
Evidence base: `docs/FIELD_TEST_2026-08-10_STREET.md` (findings FS-1…FS-7). Same drafts
contract. Two clusters here are POLICY, not fact-lookup: **5.2** (the Erewhon mishear
family — the 3.3 question at scale) and **5.3** (the hyperlocal Unverifiables — FS-4).
Rule those as clusters, not row by row.

### 5.1 — Ready-to-ratify recommendations (tick to accept, or overrule)

**R17 · "Donald Trump is the president of the United States" — ×4 repeats**
(drafts 001, 003, 010, 036 — pipeline True @0.98–0.99)
- Already recommended as **R2** from the 08-08 session. Do NOT create a second entry —
  fold into R2's single golden line and amend its note: "repeated ×4 on 2026-08-10
  street."
- ☐ Fold into R2 ☐ Overrule: _____________

**R18 · "JD Vance is the vice president of the United States"** (draft-002 — True @0.99)
- Recommend: **True · person_claims** (D4 note) · source whitehouse.gov. Worth a note:
  STT heard "JD Vans" and the extractor normalized it — famous entities self-heal, which
  is exactly why FS-3 bites only on non-famous ones (see 5.2).
- ☐ Ratify ☐ Overrule: _____________

**R19 · The wrong-capital family — 6 entries, recommend False · geography_civics**
(source: CIA World Factbook for all)
- "Kinshasa is the capital of Pakistan" (draft-005 — False @0.99)
- "Kinshasa is the capital of Ethiopia" (draft-011 — False @0.99)
- "Kinshasa is the capital of Poland" (draft-014 — False @0.99)
- "Berlin is the capital of France" (draft-015 — False @0.99)
- "The capital of Germany is Barcelona" (draft-017 — False @0.99)
- "Paris is Berlin" (draft-016 — False @0.99) — degenerate identity claim; the
  defensible alternative is `expected_extraction: null` (not a well-formed claim).
- ☐ Ratify all 6 ☐ Ratify 5, null draft-016 ☐ Overrule: _____________

**R20 · "GDP growth in the US in 2023 was 4%"** (draft-006 — False @0.99)
- Recommend: **False · statistics** · BEA (~2.9% actual). Country AND year present —
  ratify straight. Sibling of R12's no-country variant; keep both
  (paraphrase-robustness).
- ☐ Ratify ☐ Overrule: _____________

**R21 · "GDP growth in 2025 was 6%" — ×2** (draft-023 mid-correction echo "…Sorry.",
verdict unrecorded · draft-024 False @0.99)
- No country → same policy label as R8/R12. (If read as U.S.: ~2% actual — False on the
  merits regardless.) Collapse to ONE entry, note ×2.
- ☐ Same label as R8 ☐ False ☐ Overrule: _____________

**R22 · "Donald Trump was born in Pennsylvania"** (draft-007 — False @0.99)
- Recommend: **False · person_claims** (D4) · born Queens, New York — source: standard
  bio (Britannica/AP).
- ☐ Ratify ☐ Overrule: _____________

**R23 · "Salamanders were discovered by Dutch colonizers"** (draft-008 — False @0.95)
- Recommend: **False · adversarial** — "discovered" is ill-posed for an animal known
  since antiquity (Aristotle wrote about salamanders). Defensible alternative: null
  extraction (not a well-formed claim).
- ☐ Ratify False ☐ null ☐ Overrule: _____________

**R24 · "Jews are lizard people in disguise."** (draft-009 — False @0.99)
- Recommend: **False · adversarial** — conspiracy/dehumanizing shape, exactly D8
  territory. The golden tests the VERDICT only; whether such a card should ever AIR is
  an editorial call that doesn't belong in the golden set — record that in the note and
  move on.
- ☐ Ratify ☐ Overrule: _____________

**R25 · "Women have XY sex chromosomes"** (draft-012 — pipeline **True @0.98** ⚠)
- Recommend: **False · science_health** · typical female karyotype is 46,XX — source:
  NIH / MedlinePlus Genetics.
- ⚠ INVESTIGATE before ratifying the cumulative record: the pipeline said True @0.98 on
  this extraction. The field report's spot-check found no wrong verdict among AIRED
  cards — check `footnote-session-2026-08-10T16-53-37.json` for whether this card aired
  or was skipped, and what the verified claim text actually was (the transcript's "x y
  sex chromosomes" may have been read as "the X/Y system"). If it aired as True on this
  text, the R38 ledger line needs amending. Either way the row is calibration gold.
- ☐ Ratify False · investigated — aired? ______ ☐ Overrule: _____________

**R26 · "The Great Wall of China is visible from space."** (draft-018 — False @0.99)
- Already in the golden set as **adv-004** (naked-eye framing, ground truth False, source
  NASA). Recommend: do NOT graduate — a near-dup adds weight, not coverage. Optionally
  note the field repeat in adv-004's adjudication_note.
- ☐ Skip (dup of adv-004) ☐ Graduate anyway: _____________

**R27 · "The Great Barrier Reef is visible from space."** (draft-019 — True @0.98)
- Recommend: **True · science_health** · source NASA Earth Observatory — the contrast
  case to adv-004; a nice trap pair.
- ☐ Ratify ☐ Overrule: _____________

**R28 · "President Obama was the thirty-fourth president of the United States"**
(draft-020 — False @0.99)
- Recommend: **False · person_claims** · he was the 44th; Eisenhower was the 34th —
  source: whitehouse.gov history.
- ☐ Ratify ☐ Overrule: _____________

**R29 · "George Washington Carver invented peanut butter"** (draft-022 — False @0.99)
- Recommend: **False · person_claims** — famous myth; Carver promoted peanut products but
  did not invent peanut butter (patents predate him — Edson 1884). Source:
  Smithsonian/USDA.
- ☐ Ratify ☐ Overrule: _____________

**R30 · "Gavin Newsom was born in the state of California"** (draft-038 — the extraction
is the canonical POSITIVE of a spoken negation)
- Transcript: "Gavin Newsom was born not in the state of California." Newsom was born in
  San Francisco → the positive form is **True**, the spoken claim is **False**, and the
  recorded verdict (False @0.99) only makes sense as the polarity-FLIPPED spoken-claim
  verdict — the FS-1 mechanism working correctly on the verdict side, caught live.
- Recommend: **polarity_traps** (n grows toward the 20 needed) with ground truth stated
  per whatever 1A decides the contract is. HOLD until 1A is ruled, then ratify in its
  terms. Same treatment as R31.
- ☐ Hold for 1A, then ratify as polarity_traps ☐ Overrule: _____________

**R31 · "A woman has run a mile faster than four minutes." — the FS-1 card itself**
(draft-013 — displayed True @0.99, AIRED display-incoherent)
- Transcript: "No woman has run a mile faster than four minutes." — spoken claim TRUE (no
  woman has broken 4:00). Pipeline internals correct; the CARD paired the canonical
  positive text with the flipped verdict and aired a false sentence under a TRUE badge
  (FS-1, header bullet 4).
- Recommend: **polarity_traps**, field-sourced regression case for the P7-A display fix —
  ground truth per the 1A contract; adjudication_note MUST record the FS-1 incident.
  HOLD until 1A is ruled.
- ☐ Hold for 1A, then ratify as polarity_traps ☐ Overrule: _____________

**R32 · "AI data centers have been built in 40 states in America"** (draft-039 —
Unverifiable @0.8)
- Two defensible rulings:
  - ☐ **Unverifiable · statistics** — ratify the pipeline; no authority publishes a
    canonical per-state count.
  - ☐ **Drop** — durability rule: an undated "have been built" claim rots; not golden
    material.
- Note: _______________________________________________

### 5.2 — SPECIAL FLAG · the Erewhon mishear family — STT-drift POLICY cluster (12 drafts)

Drafts 021, 025, 026, 027, 028, 029, 030, 031, 032, 033, 034, 035: every one is the
operator talking about **Erewhon** (the LA grocer), which Deepgram transcribed SEVEN
ways — **Erwan, Erawan, Air Juan, Air one, Arawan, Taiwan, Like** — including a
wrong-COUNTRY extraction ("Taiwan has four locations across Los Angeles", which reached
the queue as a confident False t1 card about the wrong entity — field bug FS-3). The
human gate skipped every one; none aired with a wrong entity.

This is the SAME policy question as Section 3.3 (the "Teal" case), now at scale: **what
is golden ground truth for a misheard claim — the heard string, the intended entity, or
drop?** Rule 3.3 once; it is precedent here. Apply it as a blanket:

- ☐ **Apply the 3.3 ruling to all 12** (as-heard robustness entries / corrected to
  Erewhon / dropped — whichever branch you picked)
- ☐ Different treatment for this family (say why): _____________
- Collapse regardless: do NOT graduate 12 near-identical rows — at most one entry per
  underlying claim shape (founded-by-hippies ×2 shapes, locations ×2 shapes,
  costs-more-than-Whole-Foods ×2 shapes), variant count in the note.
- The prevention fix (F8 → per-session keyterm field) is tracked in the field report,
  not here.

### 5.3 — SPECIAL FLAG · the hyperlocal Unverifiables — new category or exclusion (FS-4)

Even entity-corrected, the underlying street claims — store locations, store-vs-store
prices — sit OUTSIDE the verifier's trust roster by design (national/institutional
sources). In the field they came back Unverifiable or tier-1 junk; three Unverifiable
cards aired by operator choice and informed nobody (FS-4). The golden set has no honest
home for them: they aren't `adversarial`, they aren't `statistics`, and grading the
verifier against sources it isn't allowed to use would be rigged.

Order matters: rule 5.2's entity question first (it's precedent for every future
mishear); 5.3 then decides whether these particular rows graduate at all — a PARK here
doesn't erase the 5.2 ruling, it defers the rows.

- ☐ **PARK (recommended):** don't graduate the hyperlocal rows; hold them until the FS-4
  editorial-spec work (BACKLOG: local-outlet tier / municipal data / maps facts) decides
  what the verifier is SUPPOSED to do with them — then they become the seed goldens for
  a new `hyperlocal` category.
- ☐ **New category now:** create `hyperlocal.jsonl` with ground truths from local
  sources (Erewhon's own store list, LA Times coverage) and accept that the verifier
  fails them until the roster grows — measuring a known gap on purpose.
- ☐ **Exclude permanently:** hyperlocal is out of scope; drop the rows.
- Note: _______________________________________________

### Graduation mechanics for Sections 4–5

Same as §B below with the file swapped: pass-2 rows graduate from
`drafts-2026-08-09-pass2.jsonl`, street rows from `drafts-2026-08-10-street.jsonl`;
continue each target category's id sequence from its current tail; delete each drafts
file when its last row is graduated, dropped, or parked (a 5.3 PARK moves rows to a
parked-drafts file — it doesn't keep the original drafts file alive).

---

## After adjudication — the mechanical steps

### A. Inversions + disagreements (Sections 1–2) → edit the RESULTS file

File: `eval/results/2026-08-07T13-45-01.jsonl` (this is run #2 — rerun2.log points at it).

For each ruled row (per the workflow in `eval/README.md` § "Disagreement workflow"):
1. Find the row by `"id"` (it's one JSON object per line).
2. Set the scorer fields to your ruling:
   - Ruled `same_claim`: set `"judge_match": "same_claim"` (if you overruled the judge)
     and/or `"extract_pass": true` (if you overruled the token scorer).
   - Confirmed `polarity_inverted` / `different_claim`: leave `judge_match` as is
     (a confirmed inversion still counts against judge-clean % — as it should — but no
     longer blocks as *uninvestigated*).
3. Add `"adjudicated": true` and a short `"adjudication_note": "..."` to the row.
4. If Section 1A's policy call changes the extraction contract, also record it in
   `eval/ADJUDICATIONS.md` (this repo's audit-trail convention) and consider a
   clarifying line in `eval/judge-prompt.md` (note: editing the prompt invalidates the
   judge cache — intended).
5. Re-run the report against the same file:
   `node eval/report.js eval/results/2026-08-07T13-45-01.jsonl`
   Adjudicated rows are treated as authoritative; "uninvestigated inversions" and "open
   disagreements" counts should go to zero. (Categories will still show below-bar
   precision — that's real and expected; this pass clears the *blocking* conditions,
   not the precision bar.)

Heads-up: `results/` is gitignored ("results are runs, not fixtures") — your adjudicated
run file is now also a fixture of record. Copy it somewhere tracked or note its path in
`ADJUDICATIONS.md` so the rulings survive a results cleanup.

### B. Field drafts (Section 3) → graduate into golden category files

File: `eval/golden/drafts-2026-08-08-fieldtest.jsonl`. Per the ingest contract
(README § "Growing the set from live sessions"):
1. For each ratified group, keep ONE line; fill in `category`,
   `ground_truth_verdict`, `adjudication_note` (include the repeat count, the pipeline's
   live verdict(s) for the record, and your ruling), and `source_of_truth` (a named
   checkable authority — BEA, whitehouse.gov, royalcourt.no, etc.).
2. For the 4 echo drafts: set `expected_extraction: null` and
   `ground_truth_verdict: null`, category `adversarial`, note "extractor echo".
3. Re-id each graduating line to the target category's convention, continuing from the
   highest existing id in that file (e.g. `person_claims.jsonl` → `person-021`+,
   `statistics.jsonl` → `stat-036`+, `adversarial.jsonl` → `adv-035`+ — check the tail
   of each file first). Keep the draft origin in the note.
4. Append the lines to the right `eval/golden/<category>.jsonl`.
5. Delete `drafts-2026-08-08-fieldtest.jsonl` (the drafts contract: finished lines move,
   the drafts file goes away).
6. `current_events`-style entries must be durable through 2027 — dated framing is
   already present in the 2025-GDP snippets; fix any "current"-worded ones (R5).

### C. Verify the gates moved

- `node eval/report.js eval/results/2026-08-07T13-45-01.jsonl` → zero uninvestigated
  inversions, zero open disagreements in every category.
- Next full calibration run (`node eval/run.js --all --judge`, ~25–30 min, don't run
  during a live session from the same IP) picks up the graduated golden entries.
  (polarity_traps stays insufficient-n at 12 until new trap cases are authored — the
  drafts contain none.)
- What this pass does NOT do: raise measured precision. The below-bar numbers
  (84–94% at the floor vs the 0.95 bar) are the verifier's real performance; the
  next lever there is the round-4 two-step-verify design, on a now-clean scoreboard.
