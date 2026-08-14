# DAYSPRINT 0b handoff — graduation sitting prep

**Goal met:** wake up, run one command, clear the whole graduation sitting in ≤45 min.

## How to open it (the one command)

```sh
node tools/adjudicate/prep.js && npm start
```

then open **http://localhost:3000/adjudicate** and start pressing keys. When you reach
the end (or any time, via the header "Download so far" button):

```sh
node tools/adjudicate/apply.js ~/Downloads/graduations.json   # add --dry-run first if you like
```

Decisions autosave to localStorage — closing the tab or reloading mid-sitting resumes
where you left off ("reset sitting" in the footer starts over).

## Sitting time estimate: ~35–40 minutes (68 cards)

The queue is pre-sorted into 24 contiguous clusters; same-suggestion runs fall to a
single `a` (batch-accept, recorded **per card** with each card's own extraction and
provenance). Budget, walking the queue in order:

| block | cards | how it goes | est. |
|---|---|---|---|
| person_claims · True (R2+R17, R18) | 2 | one `a` | 1 min |
| person_claims · False (R1, R3–R5, R9, R11, R22, R28, R29) | 11 | batch the obvious; eyeball Norway/AOC sources | 7 min |
| statistics (R14, R7 family, R8 family, R12, R21) | 12 | batch R7; make the R8 NeedsContext-vs-Misleading policy pick ONCE, it covers R12/R21 too | 7 min |
| geography_civics · False (R19 capitals) | 5 | one `a` | 1 min |
| science_health (R27, R25 ⚠investigate) | 2 | R25 wants the session-log check first | 3 min |
| historical_events (R16 Newton) + adversarial · False (R23, R24) | 4 | two quick batches | 2 min |
| adversarial — §3.2 echo family | 4 | one ruling; clear the extraction on each (`e`, clear, Enter) | 3 min |
| polarity_traps (R30, R31/FS-1) | 2 | 1A already ruled (canonical-positive, 8/10) — write the notes carefully, FS-1 must be recorded | 4 min |
| §3.3 Teal — STT-mishear policy call | 1 | rule once; it's precedent for the next block | 2 min |
| §5.2 Erewhon family (+§5.3 PARK) | 10 | apply the 3.3 ruling as a blanket; PARK recommended → mostly `s` | 4 min |
| single policy cards (R6, R10, R15, R19-"Paris is Berlin", R26 skip-dup, R32) | 6 | one call each | 5 min |
| NEW: d18pilot2 + run-test cards | 8 | no prior recommendations — rule fresh against real sources | 7 min |
| unassigned ("JD Vance is the vice president of Uganda") | 1 | not in the queue doc; rule fresh | 1 min |

Then `apply.js` + deleting fully-graduated drafts files: ~3 min. Total lands ~40 min
with slack inside the 45.

## Card counts and golden gaps by category

Queue: **111 drafts across 5 files → 68 unique cards** (67 carry a hint). Suggested-
category supply vs. the n≥30 golden target:

| category | golden now | needs for n≥30 | cards suggesting it in this queue |
|---|---|---|---|
| person_claims | 20 | **10** | 13 (covers the gap if ratified) |
| statistics | 35 | 0 | 12 |
| geography_civics | 34 | 0 | 5 (+1 policy: "Paris is Berlin") |
| science_health | 35 | 0 | 2 |
| current_events | 35 | 0 | 0 |
| historical_events | 35 | 0 | 2 |
| adversarial | 34 | 0 | 6 |
| attributed_quotes | 20 | **10** | 0 — must be authored; this sitting can't close it |
| polarity_traps | 12 | **18** | 2 (R30, R31) — still ~16 short; new trap cases must be authored (queue doc's original bar for traps was 20) |

The ~19 policy/unassigned cards land wherever your rulings put them (echo→adversarial,
Erewhon→3.3-dependent/PARK, new cards→your call).

## What changed (all GREEN — prep/display/ergonomics; zero editorial semantics)

**Queue prep (`tools/adjudicate/prep.js`, `lib.js`):**
- prep now **globs** `eval/golden/drafts-*.jsonl` instead of a hardcoded three-file
  list — new session ingests join the sitting automatically.
- new pure lib functions: `applyHints` (fill-only suggestion merge), `orderForSitting`
  (cluster-contiguous sort: golden-category order → suggested verdict → repeat count;
  policy families grouped by queue-doc ref; unsuggested last), `sittingCluster`,
  `categoryNeeds` (n≥30 gap math).
- `queue.json` now carries `categoryStats`, a `clusters` summary, and per-entry
  `cluster`/`hintNote`/`hintRef`.

**`tools/adjudicate/hints.json` (new):** a **transcription** of the recommendations
already written in `eval/ADJUDICATION_QUEUE.md` (R1–R32 + §3.2/§3.3/§5.2 clusters,
each tagged with its R-number) plus factual annotations from the new run logs (verdict/
conf/aired/auto-aired, the polarity_conflict on "Gold is red…", the STT truncation on
"…is Herbert"). Where the queue doc offers two defensible rulings or an open policy
call, **no verdict is suggested** — the note states the choice. Hints are amber
suggestions in the UI; nothing applies without your keystroke. R30/R31 notes carry the
fact that the 1A hold is already resolved (canonical-positive contract, ADJUDICATIONS.md
8/10) so you don't re-litigate it mid-sitting.

**Cockpit (`adjudicate.html/js/css`):**
- cluster bar (cluster label, position in cluster, target category's golden gap);
  category pills show `+N` when under target; amber hint-note panel with queue-doc ref.
- progress: resolved/remaining + **remaining-time estimate** from your own pace
  (batch counts as one pace-mark; >2 min gaps ignored as breaks).
- **localStorage autosave/resume** keyed to the queue's `generated_at`; footer
  "reset sitting"; header "Download so far" for partial exports.
- keyboard: `a` accept-batch, `j` jump to next unresolved, `e`/`o`/`i` focus
  extraction/source/note, `Esc` leaves a field; Enter/skip now auto-hop over
  already-resolved (batch-cleared) cards.
- **safety tightening:** decisions carry an explicit `resolved` flag set only by
  Enter/skip/batch. Downloads include only resolved cards — a merely-visited card with
  a pre-seeded suggestion can no longer leak into `graduations.json` — and `apply.js`
  additionally refuses `resolved: false` rows.

**New drafts (existing ingest convention, via `eval/ingest-session.js`):**
- `eval/golden/drafts-2026-08-12-d18pilot2.jsonl` — 8 rows from
  `session-2026-08-12-d18pilot2.json` (water-boils ×4 fold to one card; Vance-Kentucky;
  smoking/lung-cancer and silver>bronze were AUTO-aired).
- `eval/golden/drafts-2026-08-14-runtest.jsonl` — 4 rows from
  `session-2026-08-14-runtest.json`; the run-test event log
  (`fieldtest-2026-08-14-runtest.jsonl`) corroborates all 4 settled verdicts and
  contributed the tier/polarity_conflict annotations in hints.json. Both read from the
  main tree read-only; nothing was written there.
- `ingest-session.js` gained `--stamp YYYY-MM-DD` so draft ids match the session date.
- Cross-session folding works: "Donald Trump is the president…" is ONE card with
  `repeatCount: 6` spanning 08-08, 08-10 (×4), and 08-12.

**Docs/tests:** `tools/adjudicate/README.md` updated to the new flow. `npm test` green —
250 tests (8 new/updated: applyHints, orderForSitting, categoryNeeds, clustered-queue
e2e, hints.json integrity — every hint must land on a real card with legal
verdict/category values — apply.js unresolved-guard, page wiring). Cockpit also
smoke-tested in a real browser: batch, Enter, ETA, and reload-resume all exercised.

## Not touched (RED, per packet)

Golden labels, editorial policy semantics, allowlists, `eval/ADJUDICATION_QUEUE.md`,
`eval/ADJUDICATIONS.md`, judge prompt, results files, main tree. Sections 1–2 of the
queue doc were already adjudicated (see ADJUDICATIONS.md 8/10–8/12) — this sitting is
the Sections 3–5 graduation plus the two new sessions.
