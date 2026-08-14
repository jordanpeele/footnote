# DAYSPRINT packet 3c handoff — R53 denial-watch line auto-computed

Branch: `worktree-agent-a61d347d6aae26321` (off `main` @ 2ce7ef1). Committed, NOT pushed.

## The number

**Cumulative polarity-applied auto-airs: 3 of the required 20 clean** — verified
against the real artifacts in the main tree (read-only), matching the hand-counted
line in the session-2 field report exactly.

Supporting cards (all session 1, `fieldtest-2026-08-12-d18pilot.jsonl`):

| cid | claim | aired verdict | polarity |
|---|---|---|---|
| u12 | Vitamin C cures the common cold | True | denies |
| u13 | Measles vaccine causes autism | True | denies |
| u16 | Sugar makes children hyperactive | True | denies |

Session 2 (`fieldtest-2026-08-12-d18pilot2.jsonl`): 0 (both auto-airs asserts).
Run test (`fieldtest-2026-08-14-runtest.jsonl`): 0 real auto-airs — its two
`auto:true` airs are `test:true` TESTAIR and are excluded from the machine-aired
ledger per R63. Pre-D18 logs (08-08/09/10): 0 auto-airs.

## What shipped

1. **`tools/fieldtest/session-summary.js`** — read-only CLI + exported pure
   functions. Takes harness JSONL logs and/or R20 session exports (chronological
   order; the LAST artifact is "this session") and emits paste-ready markdown:
   per-artifact totals (checked / aired / auto / manual / vetoes / testair), R54
   attention rollup, `window_summary` passthrough, export-latency p50s, and the
   R53 line in the field report's exact phrasing:
   `Denial-watch line (R53): **N polarity-applied auto-airs this session; cumulative M of the required 20 clean.**`
   - "Polarity-applied" = `auto:true`, non-TESTAIR air whose card polarity is
     `denies`/`suspect_denies` AND the aired verdict is True/False (the D11 flip
     actually landed; `applyPolarity` never flips the other verdicts).
   - Old harness logs (no polarity on the `air` event) are handled by joining
     `air.cid → extract_done.polarity`; new logs carry polarity on the event.
   - A conflicted card that somehow auto-aired would be counted AND flagged as a
     D4 anomaly, never silently dropped.
   - Pre-R53 R20 exports (no polarity on entries) report **unknown** with a
     warning instead of a silent 0 — undercount is surfaced, not hidden.
   - Counting only: the per-card zero-misses/"clean" judgment stays with the
     operator, per the packet and R53.

2. **Additive polarity telemetry (display/telemetry only, no behavior change)** in
   `app.js`:
   - both `FT.log("air", …)` sites (auto/local air + second-phone `/op` air) now
     carry `polarity` + `polarity_conflict`;
   - the SESSION entry (R20 export) now carries `polarity` + `polarity_conflict`;
   - `slimCard` (localStorage restore snapshot) carries `polarity` so a
     mid-session reload doesn't degrade the export's count.

3. **`test/session-summary.test.js`** — 5 tests on inline fixtures covering the
   predicate, every ledger exclusion (manual air, TESTAIR, asserts, null-claim),
   the extract-join fallback vs on-event polarity, first-tag-wins attention,
   window_summary passthrough, pre-R53-export "unknown" handling, and the
   this-session/cumulative/target split of the rendered line.

`npm test`: 250 tests, 248 pass, 0 fail, 2 skipped (pre-existing skips).

## Repro

```
node tools/fieldtest/session-summary.js \
  eval/results/fieldtest-2026-08-12-d18pilot.jsonl \
  eval/results/fieldtest-2026-08-12-d18pilot2.jsonl \
  eval/results/fieldtest-2026-08-14-runtest.jsonl
```

→ `0 polarity-applied auto-airs this session; cumulative 3 of the required 20 clean.`

## Notes for the dispatcher

- Cross-checked against both field reports: session 1 totals (20/13/10, 2 vetoes,
  3 polarity-applied) and session 2 (8/6/2, attention talking 2/2, cumulative 3)
  reproduce exactly from the raw logs.
- The R20 export does not mark TESTAIR (`session-2026-08-14-runtest.json` reports
  `autoAired: 2` for two watermarked test airs). The tool trusts the harness log
  for that split and shows `—` for exports; a future additive `test` flag on the
  SESSION entry would close this — left out here to keep the packet's additive
  surface to polarity only.
- Harness-derived "checked" = `extract_done` ok with a non-null claim; it matches
  `totalChecked` on all three sessions that have exports (20/8/4).
