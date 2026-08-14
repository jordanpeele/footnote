# DAYSPRINT 3a handoff — golden growth: authored candidates for the non-science categories

**Goal met:** the two categories the sitting can't feed (packet 0b's gap table) now have
enough AUTHORED candidate cards in the cockpit queue to reach n≥30 on ratification —
authored as **drafts with provisional labels**, never as goldens. Rulings stay human.

## What to do with it (one command, same 0b flow)

```sh
node tools/adjudicate/prep.js && npm start   # open http://localhost:3000/adjudicate
```

The 30 authored cards arrive at the end of their category blocks in clusters labeled
**`AUTHORED · <category> · <verdict>`** (cluster bar + card badge both say AUTHORED).
Each card shows the authored evidence/trap note in the amber hint panel, pre-selects the
provisional verdict+category (amber, override-able), and pre-fills the cited source
(editable). **You are ratifying label+claim together** — Enter/batch per card, then
`apply.js` exactly as in the 0b handoff. Nothing graduates without your keystroke;
`resolved:false` rows are still refused by apply.

## The authored file — `eval/golden/drafts-authored-2026-08-14.jsonl` (30 rows)

### attributed_quotes — 12 candidates (golden 20 → 32 if all ratified)

| ids | mix | provisional verdicts |
|---|---|---|
| auth-quote-001,003,005,007,009 | true attributions (Churchill "The Few", Yogi Berra, Nietzsche, Edison 1%/99%, veni vidi vici) | True ×5 |
| auth-quote-002,004,006,008 | famous misattributions (Machiavelli "ends justify means", Wilde "be yourself", "play it again Sam", Darwin "coined survival of the fittest") | False ×4 |
| auth-quote-010,011,012 | **denial-phrased** (Vader misquote denied = right; Teddy Roosevelt big-stick denied = wrong; Einstein dice denied = wrong) | False, True, True (expected_polarity `denies`) |

### polarity_traps — 18 candidates (golden 12 → 30 exactly; R30/R31 field cards can push past)

| ids | trap type | provisional verdicts |
|---|---|---|
| auth-pol-001–004 | denial-of-false (Great Wall from Moon, Napoleon short, 10% brain, Declaration signed July 4) | False ×4, `denies` |
| auth-pol-005–010 | denial-of-true (water 100°C at sea level, Amazon, Hawaii 50th, Berlin Wall 1989, Australia country+continent, Alaska>Texas) | True ×6, `denies` |
| auth-pol-011–014 | double negatives (Sahara, Pluto 2006, Edison bulb overclaim, Columbus "1493") | True, True, **Misleading**, False — all net `asserts` |
| auth-pol-015–017 | negation-split / street-STT shapes (capital "not... Sydney", "Sharks are... not mammals", stuttered Eiffel "was not, hang on, was not") | False ×3, `denies` |
| auth-pol-018 | self-corrected negation (Lincoln first Republican president — retraction then assertion) | True, `asserts` |

Every row: spoken-cadence `transcript_snippet`, canonical (always-assertive)
`expected_extraction`, `expected_polarity`, provisional `ground_truth_verdict`, a
one-line checkable evidence cite, the trap explanation, and a
`Recommend: <Verdict> · <category>` line (that's what pre-seeds the cockpit suggestion —
same `parseNoteHints` path the queue-doc hints use).

**Verifiability discipline:** every claim checks against stable authorities (NASA, IAU,
National Archives, Britannica, Quote Investigator, Library of Congress, Census, NOAA,
primary speech/letter records); all durable through 2027+; no current events, no living
private persons (living public figures appear only in settled historical facts, matching
the existing golden convention). Adjudication notes for the pol cards follow the pol-house
format verbatim ("Verdict on canonical claim: X; applyPolarity(X, denies) → final on-air
verdict: Y") plus harm_class. Watch-outs flagged inside the notes: auth-pol-004
(NeedsContext defensible), auth-pol-013 (False defensible), auth-quote-012 ("with the
universe" embellishment nuance).

## Wiring (small surgery, all prep/display — zero editorial semantics)

prep.js already globs `drafts-*.jsonl` (0b), so the file joins the sitting with **zero
config**. The additions make authored cards first-class instead of anonymous:

- **`tools/adjudicate/lib.js`** — `dedupeDrafts` propagates `authored`,
  `expected_polarity`, the authored note (→ hint panel), and the cited source;
  `sittingCluster` prefixes `AUTHORED · `; `orderForSitting` keeps authored cards as
  their own contiguous trailing block per category (never interleaved into field
  clusters); `buildGoldenEntry` carries `expected_polarity` into the graduated golden
  row (run.js/report.js read it for the aired-verdict slice — dropping it would have
  silently degraded every graduated trap) and stamps `[ratified from AUTHORED candidate
  …]` provenance. Non-authored entries keep the exact 7-key schema.
- **`tools/adjudicate/prep.js`** — `authored_count` in queue.json + log line; header
  comment documents the convention.
- **`tools/adjudicate/adjudicate.js`** — card badge shows AUTHORED; source field
  pre-fills from the authored cite (editable). Two-line change.
- **`eval/run.js`** — `loadGolden` exported (unchanged behavior) so the drafts-exclusion
  contract is now **pinned functionally**.
- Docs: `tools/adjudicate/README.md` + `eval/README.md` describe the
  `drafts-authored-*.jsonl` convention.

To change a provisional polarity before the sitting, edit the row in the drafts file and
re-run prep — the cockpit ratifies polarity as part of the claim (it rides the queue
entry; there is deliberately no polarity picker in the page).

## Tests — green (287 tests: 285 pass, 2 pre-existing env-gated skips)

- **NEW `test/golden-drafts-exclusion.test.js`** — pins that `loadGolden` never loads any
  `drafts-*` row (checked against the actual staging ids, including `authored: true`
  rows) and that the grown categories' run sets contain no `auth-*` ids. The exclusion
  was previously only an inline filter + comment; now a refactor can't silently widen it.
- **`test/adjudicate.test.js`** — 3 new lib tests (authored propagation/cluster,
  contiguous-block ordering, polarity+provenance through `buildGoldenEntry`); prep e2e
  updated to 141 drafts → ~98 cards and asserts all 30 authored cards arrive marked,
  un-folded, hinted, sourced, polarity-carrying, and 12/18 split by category.

## Queue state after this packet

**141 drafts across 6 files → 98 cards in 29 clusters (97 hinted, 30 AUTHORED).**
Golden gaps: person_claims needs 10 (13 field cards suggest it — covered by the
sitting), attributed_quotes needs 10 (12 authored), polarity_traps needs 18 (18 authored
+ R30/R31). One full sitting closes all three categories.

## Housekeeping

- This worktree branched before packet 0b merged; **fast-forwarded to main `996a38b`**
  before starting so the wiring targets the real 0b cockpit (no merge commit needed).
- `tools/adjudicate/queue.json` regenerated locally (untracked, as before).

## Not touched (RED, per packet)

Golden category files (`eval/golden/<category>.jsonl`), `eval/ADJUDICATIONS.md`,
`eval/ADJUDICATION_QUEUE.md`, `eval/judge-prompt.md`, judge/report logic, results,
editorial semantics, allowlists, main tree.
