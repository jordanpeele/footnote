# Footnote eval — golden set + calibration harness

Adjudicated golden set and a dependency-free harness that measure the two stages of the
Footnote pipeline separately, then produce the per-category calibration report that decides
which claim categories earn auto-air (**Decision D3**). Person claims never auto-air
(**Decision D4**); attributed quotes are blocked until harness-v2-verified calibration
clears them (**Decision D11**). Both hardcoded in `report.js`.

## Layout

```
eval/
  golden/            adjudicated fixtures, one JSONL per category
  run.js             harness — hits the live /api/extract and /api/verify endpoints
  judge.js           meaning-level LLM judge (harness v2) — module + CLI
  judge-prompt.md    versioned judge prompt (v1); text between markers is sent verbatim
  .judge-cache.json  disk cache of judge verdicts (gitignored; auto-invalidates on prompt edit)
  report.js          calibration report v2 + auto-air eligibility per category
  ingest-session.js  drafts new golden entries from a /control session download
  ADJUDICATIONS.md   verdict re-adjudication audit trail (run #1 rulings + prompt-iteration record)
  results/           run outputs (gitignored — results are runs, not fixtures)
```

## Golden schema (one JSON object per line)

```json
{"id": "stat-001",
 "transcript_snippet": "spoken-style text with filler and hedges",
 "expected_extraction": "The atomic claim a perfect extractor produces." ,
 "category": "statistics",
 "ground_truth_verdict": "True",
 "adjudication_note": "why this ruling",
 "source_of_truth": "a named checkable authority"}
```

- `expected_extraction: null` means the correct behavior is **no extraction** (filler,
  opinion, question). `ground_truth_verdict` is null in those cases too.
- Categories: `statistics`, `historical_events`, `attributed_quotes`, `current_events`,
  `science_health`, `geography_civics`, `adversarial` (prompt injection in speech, gamed
  phrasing, trap claims), `person_claims` (named individuals — for these, the ROUTING
  ruling in the adjudication note ("D4 MUST-HOLD") matters as much as the verdict).
- Ground truths are chosen to be durable through at least 2027; current_events entries use
  explicit dated framing ("in 2022…") so they never rot into ambiguity.

## Running

```sh
node eval/run.js --limit 3 --extract-only          # cheap smoke test (default base = prod)
node eval/run.js --category statistics --limit 20  # one category, both stages
node eval/run.js --all --judge                     # full harness-v2 calibration run (~20 min)
node eval/run.js --base http://localhost:3000 --all
node eval/report.js                                 # report on the newest results file
```

Flags: `--base URL` (default `https://footnote-live.vercel.app`), `--category X`,
`--limit N` (default **10** — full runs are explicit via `--all`), `--extract-only`,
`--judge` (harness v2 — LLM judge on fuzzy/failed extractions; needs `ANTHROPIC_API_KEY`
in env or `.env.local`), `--delay MS` (override per-request pacing), `--out FILE`.

Cases are interleaved round-robin across categories, so a small `--limit` still samples a
spread rather than draining one file alphabetically.

**Rate limits are real**: the deployed API allows 40 extract/min and 20 verify/min per IP.
The harness paces itself under both (and honors `Retry-After` on 429), which is why a full
two-stage run over 260 cases takes on the order of 25-30 minutes. Don't run it in parallel
with a live demo session from the same IP — you'll starve the demo.

### What the two stages measure

- **Stage 1** posts `{text: transcript_snippet}` to `/api/extract` and scores the returned
  `claim` against `expected_extraction`.
- **Stage 2** posts the **expected** extraction (not the stage-1 output) to `/api/verify`.
  This deliberately isolates verifier performance from extractor performance — a bad
  extraction shouldn't count against the verifier's calibration numbers.

### Extraction scoring — token scorer (v1)

Normalized (case, trailing punctuation, whitespace), then: `exact` match →
`fuzzy-containment` (one string contains the other) → `fuzzy-overlap` (token-overlap
F1 ≥ 0.6). `null == null` passes as `null-null`; failures are labeled
`spurious-extraction` (extracted when it should have stayed silent), `missed-extraction`,
or `mismatch`. Exact and fuzzy are reported separately.

**Known limitation (now Decision D11):** token overlap cannot detect meaning inversion —
the extractor once returned "Einstein did NOT say X" for a claim asserting he did, and
fuzzy matching scored it a PASS at 0.828 F1. That is what the judge exists to catch.

### Extraction scoring — LLM judge (harness v2, `--judge`)

`eval/judge.js` sends the transcript snippet, expected extraction, and actual extraction
to `claude-haiku-4-5-20251001` (temperature 0) with the versioned prompt in
`eval/judge-prompt.md`, and gets back one line of JSON:

```json
{"match": "same_claim" | "polarity_inverted" | "different_claim" | "partial", "note": "one line"}
```

- **Who gets judged:** every case where token scoring says pass-fuzzy OR fail with both
  sides non-null. `exact`/`null-null` passes skip the judge — identical strings can't be
  inverted. Null-sided failures (`missed-extraction`, `spurious-extraction`) have no
  meaning to compare and stay token-scored only.
- **Both scores are recorded** per result row: the token score (`extract_pass`,
  `extract_match`, `extract_f1`) and the judge verdict (`judge_match`, `judge_note`).
  A `judged: true` marker on every row of a `--judge` run lets the report distinguish
  "run without the judge" from "nothing needed judging".
- **Disagreements are never auto-resolved.** A token-pass the judge calls
  `polarity_inverted` or `different_claim` — or a token-fail the judge calls
  `same_claim` — gets `"disagreement": "DISAGREEMENT"` on the row and blocks eligibility
  until a human adjudicates (see workflow below).
- **Cache:** verdicts are cached in `eval/.judge-cache.json`, keyed on a hash of the
  prompt text + inputs, so re-runs don't re-pay. Editing the prompt (inside the
  BEGIN/END markers of `judge-prompt.md`) automatically invalidates the cache.
  `judge_error` results (unparseable output, upstream failure) are never cached.
- **CLI for spot checks:** `node eval/judge.js "<expected>" "<actual>" ["<snippet>"]`.

### Disagreement workflow (human adjudication)

1. Run `node eval/report.js` — ineligible categories list the row ids of uninvestigated
   inversions and open disagreements.
2. Open the results JSONL, find the row, and rule on it against the golden entry and the
   transcript. Edit the row's verdict fields to whatever is actually correct
   (`extract_pass` and/or `judge_match`) and add `"adjudicated": true` plus, ideally, a
   short `"adjudication_note"`.
3. Re-run `node eval/report.js`. Rows with `"adjudicated": true` are treated as
   authoritative: their edited values stand, and they no longer count as uninvestigated
   inversions or open disagreements. (An adjudicated row *confirming* an inversion still
   counts against judge-clean % — it's a real extractor failure, just an investigated one.)

## Reading the report (v2)

Per category, `report.js` prints:

- **token** — v1 pass rate, split exact/null vs fuzzy.
- **judge** — judge-clean % (exact passes + judged `same_claim`, over token-scored rows),
  inversion count (with how many are uninvestigated), open disagreement count, and any
  `judge_error` rows. Prints "no judge data" for runs made without `--judge`.
- **verdicts** — fraction of stage-2 verdicts matching the adjudicated ground truth.
- **confidence** — mean confidence on correct vs incorrect verdicts. Healthy calibration
  means a visible gap (wrong answers arrive at lower confidence). If wrong verdicts are as
  confident as right ones, the confidence floor protects nothing.
- **@floor** — precision among verdicts with confidence ≥ `CONF_FLOOR` (0.85), which is
  exactly the population auto-air would have aired.
- **AUTO-AIR** — `ELIGIBLE` requires BOTH scorers clean at the bar: precision at the
  floor ≥ 0.95 on ≥ 20 scored samples (constants at the top of `report.js`, tunable)
  AND judge data present AND zero uninvestigated polarity inversions AND zero open
  scorer disagreements. Every ineligible category is listed with a reason class:
  - `D4` — `person_claims` is structurally `NEVER` — a great score on 20 samples cannot
    price a defamation event.
  - `D11` — `attributed_quotes` is structurally `BLOCKED` — quotes ineligible until
    harness-v2-verified calibration clears them (an explicit decision, not a threshold).
  - `below-bar` — precision under the bar, missing judge data, uninvestigated
    inversions, or open disagreements.
  - `insufficient-n` — not enough scored samples at the floor (or no stage-2 data).

Caveats when reading numbers: verdict scoring is strict single-label, but several golden
entries note a defensible second label (e.g. Misleading vs NeedsContext on "Columbus
discovered America") — check the `adjudication_note` before treating a miss as a bug.
Confidence comes from the verifier model itself and drifts with Perplexity model updates;
re-run before trusting an old report.

## Growing the set from live sessions

Tomorrow's session log is the best source of new cases — real spoken cadence, real
extractor behavior. The `/control` session download is JSON with entries like
`{spoken, claim, verdict, confidence, ...}`. Mapping into the golden schema is a **manual
adjudication step** — the converter only drafts:

```sh
node eval/ingest-session.js session-2026-08-07.json --out eval/golden/drafts-aug7.jsonl
```

Mapping: `spoken` → `transcript_snippet`; `claim` → `expected_extraction` (as a draft —
fix it if the live extractor got it wrong, null it if nothing should have been extracted);
`category` → you assign; `ground_truth_verdict` → **left null on purpose, a human must
adjudicate against a real source** (never copy the model's live verdict — that would
measure self-agreement, not accuracy); write the `adjudication_note` and `source_of_truth`.
Then move finished lines into the right `eval/golden/<category>.jsonl` and delete the
drafts file.
