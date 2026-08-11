# Adjudication cockpit

The tool that makes the eval sitting cheap. For six rounds, clearing the human
adjudication queue (`eval/ADJUDICATION_QUEUE.md`) has been ~2h of hand-editing JSONL.
This walks the remaining work — Sections 3–5, the field-draft *graduation* (turning the
99 raw drafts in `eval/golden/drafts-*.jsonl` into proper golden entries) — one card at a
time with keyboard controls, and mechanically produces the file edits.

It does **not** touch Sections 1–2 (polarity inversions + scorer disagreements). Those
edit the *results* file, not the golden set, and follow the manual workflow in the queue
doc's "After adjudication" section.

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

`prep.js` reads the three `eval/golden/drafts-*.jsonl` files, dedupes by *normalized
claim* (lowercase / strip quotes / collapse whitespace / drop trailing period), and
writes `queue.json`. Repeats collapse with a count — the 26 "Peter Thiel is the president
of the United States" drafts become ONE card with `repeatCount: 26`, and cross-session
repeats (e.g. the Trump-president line) fold together too. Current run: **99 drafts → 60
unique claim cards.** Null-extraction drafts (the F1 extractor-echo cases, opinion→null)
can't dedup by claim, so each keeps its own card.

Each queue entry: `{ key, claim, canonical, sampleTranscript, repeatCount,
sourceDrafts[], suggestedCategory, suggestedVerdict, pipelineVerdict }`. The suggested
category/verdict come from an explicit `Recommend:` line in a draft's note if present
(the ingest-shaped notes only carry the live *pipeline* verdict, surfaced separately as
`pipelineVerdict` — a HINT, never ground truth).

### 2–3 · decide (the page)

Open `/adjudicate` (served by the self-host static server; the rewrite is the only server
change). One card at a time:

- **Verdict** — `t`=True `f`=False `m`=Misleading `n`=NeedsContext `u`=Unverifiable
- **Category** — number keys `1`–`9` (or click): person_claims, statistics,
  geography_civics, science_health, current_events, historical_events, adversarial,
  attributed_quotes, polarity_traps
- **Extraction** — editable textarea (clear it to graduate a null-verdict echo/opinion card)
- **Source of truth** + **note** — text fields; provenance (draft ids, repeat count) is
  appended to the note automatically
- **Enter** = accept & next · **s** = skip · **b** = back · **d** = download
- **Batch mode** — when a card's verdict+category match the *suggested* verdict+category
  of later unresolved cards, an "Accept all N like this" button appears (ratifies
  verdict+category across the group; each card keeps its own extraction/transcript)

A suggested verdict/category is pre-selected (amber outline) and can be overridden. The
page accumulates decisions in memory and downloads `graduations.json` — no server
endpoint, no state channel; fully client-side.

### 4 · apply

`apply.js` takes `graduations.json` and appends each decided card to
`eval/golden/<category>.jsonl` with a fresh sequential id continuing that file's
convention (`person-021`+, `stat-036`+, `adv-035`+ …). It re-reads the target file and
skips any claim already graduated (same normalized claim + category), so re-running on the
same `graduations.json` won't double-append. `--dry-run` prints what it would write.

After applying, per the queue doc's mechanics: delete each fully-graduated
`drafts-*.jsonl`, and run a calibration pass to pick up the new golden entries.

## Files

- `lib.js` — pure, testable logic (dedup, id allocation, graduation, idempotency);
  imported by prep.js, apply.js, **and** the page so the picker/graduation math can't drift
- `prep.js` — drafts → `queue.json`
- `apply.js` — `graduations.json` → `eval/golden/<category>.jsonl`
- `adjudicate.html` / `.js` / `.css` — the cockpit page
- tests: `test/adjudicate.test.js`
