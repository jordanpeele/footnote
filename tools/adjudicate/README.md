# Adjudication cockpit

The tool that makes the eval sitting cheap. For six rounds, clearing the human
adjudication queue (`eval/ADJUDICATION_QUEUE.md`) has been ~2h of hand-editing JSONL.
This walks the remaining work — Sections 3–5, the field-draft *graduation* (turning the
99 raw drafts in `eval/golden/drafts-*.jsonl` into proper golden entries) — one card at a
time with keyboard controls, and mechanically produces the file edits.

It does **not** touch Sections 1–2 (polarity inversions + scorer disagreements). Those
edit the *results* file, not the golden set, and follow the manual workflow in the queue
doc's "After adjudication" section.

It ALSO carries the **polarity micro-pass** — the 31 golden rows whose
`expected_polarity` Task 0 left UNSET because the negation reading was ambiguous
(commit 82feaba: "guessing labels would corrupt the eval"). Those cards rule on
EXISTING golden rows (they never append) and ride at the end of the graduation sitting
as their own cluster group — or run alone via `prep.js --polarity-only`, a ≤15-minute
sitting. See "Polarity micro-pass" below.

## The flow — 4 steps

```
1.  node tools/adjudicate/prep.js         # drafts-*.jsonl -> queue.json (dedupes repeats)
2.  npm start  →  open http://localhost:3000/adjudicate
3.  decide each card (keyboard), then click "Download graduations.json"
4.  node tools/adjudicate/apply.js ~/Downloads/graduations.json
```

`apply.js` reads `queue.json` and `graduations.json` from `tools/adjudicate/` by default;
pass the downloaded file's path as the first arg if it landed in `~/Downloads`.

### 1 · prep

`prep.js` reads **every** `eval/golden/drafts-*.jsonl` file (globbed — new session
ingests join the sitting automatically), dedupes by *normalized claim* (lowercase /
strip quotes / collapse whitespace / drop trailing period), and writes `queue.json`.
Repeats collapse with a count — the 26 "Peter Thiel is the president of the United
States" drafts become ONE card with `repeatCount: 26`, and cross-session repeats (e.g.
the Trump-president line) fold together too. Current run: **111 drafts → 68 unique claim
cards.** Null-extraction drafts (the F1 extractor-echo cases, opinion→null) can't dedup
by claim, so each keeps its own card.

Prep then merges **`hints.json`** — a transcription of the pre-filled recommendations
already written in `eval/ADJUDICATION_QUEUE.md` (R1–R32 + the §3.2/§3.3/§5.2 policy
clusters) plus factual run-log annotations for newer drafts. Hints only *fill* empty
suggestion slots and attach a display note; they are never ground truth and never
auto-applied. Finally the cards are sorted into **batchable clusters**: same suggested
category+verdict runs are contiguous (in golden-category order), policy families stay
together, unsuggested cards go last. The queue also carries `categoryStats` — each
golden category's current count vs the n≥30 target — and a `clusters` summary.

Each queue entry: `{ key, claim, canonical, sampleTranscript, repeatCount,
sourceDrafts[], suggestedCategory, suggestedVerdict, pipelineVerdict, hintNote?,
hintRef?, cluster }`. Suggested category/verdict come from an explicit `Recommend:` line
in a draft's note or from `hints.json` (the draft's own line wins); the ingest-shaped
notes only carry the live *pipeline* verdict, surfaced separately as `pipelineVerdict` —
a HINT, never ground truth.

### 2–3 · decide (the page)

Open `/adjudicate` (served by the self-host static server; the rewrite is the only server
change). One card at a time:

- **Verdict** — `t`=True `f`=False `m`=Misleading `n`=NeedsContext `u`=Unverifiable
- **Category** — number keys `1`–`9` (or click): person_claims, statistics,
  geography_civics, science_health, current_events, historical_events, adversarial,
  attributed_quotes, polarity_traps. Pills show `+N` where the category is under the
  n≥30 golden target.
- **Extraction** — editable textarea (clear it to graduate a null-verdict echo/opinion
  card); `e`/`o`/`i` jump the cursor into extraction/source/note, `Esc` jumps back out
- **Source of truth** + **note** — text fields; provenance (draft ids, repeat count) is
  appended to the note automatically
- **Enter** = accept & next · `a` = accept batch · `s` = skip · `b` = back ·
  `j` = next unresolved · `d` = download
- **Batch mode** — when a card's verdict+category match the *suggested* verdict+category
  of later unresolved cards, an "Accept all N like this" button appears (ratifies
  verdict+category across the group; each card keeps its own extraction/transcript).
  Because prep sorts same-suggestion runs contiguously, one `a` usually clears the whole
  cluster and lands you on the next one.
- **Cluster bar** — shows which cluster you're in, your position in it, and the target
  category's golden gap. The amber **hint note** under it is the queue-doc
  recommendation (with its R-number) or the run-log annotation for newer drafts.
- **Progress** — header shows resolved/remaining plus a remaining-time estimate from
  your own pace. Decisions **autosave to localStorage** (keyed to the queue's
  `generated_at`) — a reload resumes mid-sitting; "reset sitting" in the footer starts
  over. "Download so far" in the header exports a partial `graduations.json` any time.

A suggested verdict/category is pre-selected (amber outline) and can be overridden. Only
cards you **explicitly resolve** (Enter / skip / batch) are downloaded — a merely-visited
card with a pre-seeded suggestion never reaches `graduations.json`, and `apply.js`
additionally refuses any decision marked `resolved: false`. The page accumulates
decisions client-side and downloads `graduations.json` — no server endpoint, no state
channel.

### 4 · apply

`apply.js` takes `graduations.json` and appends each decided card to
`eval/golden/<category>.jsonl` with a fresh sequential id continuing that file's
convention (`person-021`+, `stat-036`+, `adv-035`+ …). It re-reads the target file and
skips any claim already graduated (same normalized claim + category), so re-running on the
same `graduations.json` won't double-append. `--dry-run` prints what it would write.

After applying, per the queue doc's mechanics: delete each fully-graduated
`drafts-*.jsonl`, and run a calibration pass to pick up the new golden entries.

## Polarity micro-pass (the 31 UNSET `expected_polarity` rows)

`polarity-cards.json` holds one transcription-only card per unset row: the two candidate
readings and a NEUTRAL framing of what makes the negation ambiguous. **No card carries a
suggested ruling** — the queue docs carry none for these rows, so none was invented
(precedent cites like pol-001's "approving quotation is a net assertion" or geo-029's
recorded label are marked *not controlling*). Prep joins each card to its LIVE golden row
by id (utterance/claim come from the golden file, never the card) and drops any card
whose row already carries the `expected_polarity` key — so the block empties itself after
an apply, and re-running prep is naturally idempotent.

On a polarity card the cockpit swaps the ruling row: **`1`=asserts `2`=denies
`3`=ambiguous-drop** (verdict/category/source are hidden; the claim is read-only —
the ruling edits an existing row, nothing else about it is editable). The blue panel
shows the ambiguity framing + both readings; the note field flows into the row's
`polarity_note`. Cards arrive clustered by ambiguity *family* (null-claim filler ·
negation in supporting clause · negative-proposition claim · hedged/self-corrected), and
batch (`a`) rules the rest of the current family at once. Sitting cost: ~31 cards, two
batchable families ≈ **10–13 minutes**.

`apply.js` routes `mode: "polarity"` decisions down a separate path: a **surgical
in-place line edit** of `eval/golden/<category>.jsonl` — the field is appended before the
row's closing brace exactly like the 229 already-labeled rows, and every other byte of
the file is preserved. `asserts`/`denies` write the value; `ambiguous-drop` writes an
**explicit `expected_polarity: null` + `polarity_note`** so a ruled-out row is
distinguishable from a never-visited one (run.js skips both identically — its check is
`!= null`). Safety mirrors graduations: `resolved: false` refused, unknown rulings
refused, an already-ruled row is never clobbered (which is also the idempotency).
The golden VALUES are the operator's rulings alone — nothing here decides them.

## Files

- `lib.js` — pure, testable logic (dedup, hints, sitting order, category gaps, id
  allocation, graduation, idempotency); imported by prep.js, apply.js, **and** the page
  so the picker/graduation math can't drift
- `prep.js` — drafts → `queue.json` (glob + hints + clustering + golden-gap stats +
  the polarity block; `--polarity-only` for the standalone micro-pass sitting)
- `hints.json` — transcribed queue-doc recommendations + run-log annotations
  (suggestions only; the human ratifies everything)
- `polarity-cards.json` — transcription-only ambiguity cards for the 31 unset
  `expected_polarity` rows (two readings + neutral framing; NO suggested rulings)
- `apply.js` — `graduations.json` → `eval/golden/<category>.jsonl` (append for
  graduations; surgical in-place `expected_polarity` writes for polarity rulings)
- `adjudicate.html` / `.js` / `.css` — the cockpit page
- tests: `test/adjudicate.test.js`
