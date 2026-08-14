# Daysprint handoff — packet 3b: negation micro-pass staged to ≤15 min

**Branch:** `worktree-agent-a2b8ca66b1803c8c4` (fast-forwarded onto main tip `61b31d8`
first, so this builds on packet 0b's cockpit). **Not pushed.**

## What this is

The standing queue item — the **31 golden rows whose `expected_polarity` Task 0 left
UNSET** (commit `82feaba`: "31 negation-ambiguous rows left UNSET on purpose — guessing
labels would corrupt the eval — flagged for a human micro-pass") — is now staged as a
one-sitting job inside the same adjudication cockpit as the graduation sitting.

Verified count: exactly 31 rows across 8 canonical files lack the field (260 rows − 212
asserts − 17 denies). The polarity_traps file and all drafts files are not involved.

## The sitting (est. **10–13 minutes**, budget 15)

```
node tools/adjudicate/prep.js --polarity-only     # micro-pass alone (31 cards, 4 clusters)
npm start  →  http://localhost:3000/adjudicate
# rule each card: 1=asserts 2=denies 3=ambiguous-drop · Enter=accept · a=rule family · s=skip
# download graduations.json, then:
node tools/adjudicate/apply.js ~/Downloads/graduations.json          # --dry-run first if you like
```

Without `--polarity-only`, plain `prep.js` appends the same 31 cards as their own
cluster group AFTER the graduation clusters — so the 0b graduation sitting (~35–40 min)
and this micro-pass can be one combined sitting (~50 min) or two separate ones; the 0b
flow in front is untouched either way.

Why ≤15 min is realistic: the 31 cards arrive in 4 ambiguity-family clusters, and the
two big families are one explicit batch ruling each (`a` = "Rule all N in this family"):

| cluster (sitting order) | n | shape |
|---|---|---|
| polarity · null-claim filler | 10 | `expected_extraction: null`; negation lives in filler/questions. quote-012, curr-013, curr-034, geo-017, geo-034, hist-034, sci-020, sci-034, stat-010, stat-034 |
| polarity · negation in supporting clause | 14 | claim positive-form; negation in a contrast/supporting/imperative/quoted clause. geo-001, geo-009, stat-002, stat-003, person-011, person-018, sci-010, sci-015, sci-023, sci-025, sci-029, hist-033, quote-007, quote-015 |
| polarity · negative-proposition claim | 4 | the claim STRING itself is negative — the Task-0 example class ("honey never goes bad"). adv-016, adv-026, sci-012, hist-029 |
| polarity · hedged / self-corrected | 3 | "I'm not saying it's true" / "wait no". adv-019, curr-003, curr-011 |

Each card shows: the utterance (from the live golden row), the recorded claim
(read-only), the golden verdict for context, the **two candidate readings**, and a
**neutral framing** of the ambiguity. Per the packet rule, **no card suggests an
answer** — the queue docs carry none for these rows. Documented precedents are
transcribed as facts and explicitly marked *not controlling* (pol-001's
"approving quotation is a net assertion", geo-029's recorded `denies` on the same
"X, not Y" shape as hist-029).

## What was built (plumbing = GREEN; golden values = RED, untouched)

- **`tools/adjudicate/polarity-cards.json`** — the 31 hint cards, transcription only.
  Cards hold ONLY `{id, category, family, readings[2], ambiguity}` (test-enforced — no
  suggestion fields can exist). Utterance/claim are joined from the live golden rows at
  prep time, never duplicated, so cards can't drift.
- **`lib.js`** — `POLARITY_RULINGS` (asserts/denies/ambiguous-drop, keys 1/2/3),
  `buildPolarityEntries()` (join + drop-already-ruled → prep is idempotent after apply),
  `applyPolarityToLine()` (pure surgical line edit).
- **`prep.js`** — appends the polarity block as its own trailing cluster group;
  `--polarity-only` emits the standalone 15-min queue. Counters: `polarity_count` is
  separate; `unique_count` stays graduation-only.
- **Cockpit** (`adjudicate.html/.js/.css`) — small mode branch, no redesign: on a
  polarity card the verdict row swaps to the three rulings, category/source hide, claim
  goes read-only, a blue panel shows ambiguity + readings, and batch (`a`) rules the rest
  of the current family. Autosave/ETA/partial-download all work unchanged.
- **`apply.js`** — `mode:"polarity"` decisions take a separate path: in-place line edit
  of `eval/golden/<category>.jsonl`. The field is appended before the closing brace in
  the files' exact hand-spaced style; **every other byte of the file is preserved**
  (test-asserted). `ambiguous-drop` writes an explicit `expected_polarity: null` +
  `polarity_note`, so a ruled-out row is distinguishable from a never-visited one;
  `run.js` skips both identically (`!= null` check) — the drop is behavior-preserving.
- **Safety (0b's explicit-resolution contract, extended):** only Enter/skip/batch set
  `resolved: true`; apply refuses `resolved: false`, refuses unknown rulings (a verdict
  string is not a ruling), never clobbers a row already carrying the key (also the
  idempotency), and polarity decisions can never reach the append path. Verified by
  dry-run against the real queue: unresolved card refused, zero golden writes.

**Tests: green** — 306 total (304 pass, 2 pre-existing skips), including 10 new:
rulings vocabulary, join/drop logic, line surgery (style + byte preservation + explicit
null + no-clobber), cards-file integrity (cards = exactly the unset rows, two readings
each, no suggestion keys), prep contiguity + `--polarity-only`, apply e2e + idempotency,
apply safety refusals, page wiring.

## Flag for the sitting (written here instead of built, per packet)

**Denies on a negative-proposition-claim row implies a companion edit.** For the 4 rows
in the `negative-proposition claim` family, the claim string carries the negation and
`ground_truth_verdict` is keyed to that negative string. Ruling `denies` alone would make
`deriveAired` flip a verdict that was never re-based to canonical-positive form (e.g.
adv-026: True on "Honey never spoils" + denies → expected-aired False, wrong). The
micro-pass deliberately writes ONLY the polarity field. So: if any of adv-016/adv-026/
sci-012/hist-029 gets ruled `denies`, that row also needs its `expected_extraction`
restated positive and `ground_truth_verdict` re-based — a follow-up hand edit (or skip
the card in the sitting and handle the row whole). `asserts` and `ambiguous-drop` carry
no such coupling. The readings on those 4 cards state this caveat verbatim. Note the
same string/field tension already exists in shipped rows (adv-007 is negative-form +
`denies`), so this is a pre-existing convention wrinkle, not one this pass introduced.

Minor doc gap, not touched: `eval/README.md`'s golden-schema section doesn't document
`expected_polarity` at all (the conventions live in run.js comments + the Task-0 commit).
Worth a paragraph whenever the schema docs are next edited.

## After the sitting

Re-running `prep.js` drops every ruled card automatically (the key — even explicit
null — removes it), so the queue self-empties. Then re-run calibration (`node eval/run.js
--all --judge --aired`) to pick the new labels up in the F-1 polarity slice; scored-n
rises from 193 toward 224 minus drops.
