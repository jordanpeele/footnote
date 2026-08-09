# Human adjudication queue — everything blocking eval progress, one sitting

**What this is.** Every pending human-adjudication item from calibration re-run #2
(2026-08-07) and the field test (2026-08-08), pulled into one document so you can clear
them in a single pass. Each item shows you the evidence and gives you checkboxes; where
the answer is obvious there's a pre-filled recommendation you only have to ratify.

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

**Honest time estimate: ~90 minutes total.** Section 1 is one policy call plus 13 quick
rulings (~25 min). Section 2 is mostly rubber-stamping the judge over the string scorer
(~20 min). Section 3 needs a few real source lookups — Norway's king, McDonald's CEO,
2025 GDP growth (~30 min). Mechanics at the end (~15 min). If you take the batch-ratify
options where offered, closer to 60.

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
