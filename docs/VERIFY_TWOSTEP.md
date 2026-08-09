# Two-step verifier (`perplexity-twostep`) — P4-C, built dark

**Status: DARK.** Registered in `src/core/registry.js` but never the default. It runs only
when `FOOTNOTE_VERIFIER=perplexity-twostep` is set explicitly, and it stays that way until
it clears the promotion bar below. No route, overlay, or editorial code changed — it is a
drop-in `Verifier` (`src/core/interfaces/verifier.js`) behind the same
`finalizeVerification` policy layer (D5).

## Why it exists

Calibration runs #1 and #2 (`docs/CALIBRATION_REPORT_2_2026-08-07.md`) measured the
single-shot verifier at **84–94% verdict precision at the confidence floor** against the
95% auto-air bar. The dominant miss class is **under-commitment** — NeedsContext/Misleading
at 0.96–0.99 confidence where the evidence is definitive (Nixon, Armstrong, chimp DNA) —
plus a smaller class of confident-wrong on hard mid-tier claims. The permitted prompt
iteration was tried and **rejected** (`eval/ADJUDICATIONS.md`): commitment language fixed
the hedges but flipped genuinely-mid-tier controls to confident-wrong False.

The sanctioned next lever is structural, not prompt-tuning:

1. **Step 1 — evidence gathering** (search-focused `sonar-pro` call, same low-trust
   `search_domain_filter` as the single-shot adapter). Returns a numbered evidence block
   (`E1: … — outlet`), for and against, and is explicitly forbidden to render a verdict.
   All citations come from this call.
2. **Step 2 — verdict commitment** (reasoning-focused `sonar-pro` call: `disable_search:
   true`, `temperature: 0`). Judges the claim against ONLY the step-1 evidence block. The
   prompt requires: commit True/False when the bearing evidence lines all point one way
   (the under-commitment fix); NeedsContext only for genuine conflict or material
   incompleteness; the verdict must agree with its own correction sentence and must name
   the `evidence_lines` it rests on — a definitive verdict that can't cite lines becomes
   Unverifiable (the confident-wrong guards the rejected prompt iteration lacked).

Cost: ~2x single-shot latency and two API calls per verdict. Accepted — this is a
precision play, not a latency play. Credentials remain per-call on **both** steps
(D13/R8; `test/perplexity-twostep.test.js` enforces race-freedom and, statically, the
absence of env mutation).

## Running the calibration eval against it

The harness (`eval/run.js`) drives a **deployed base URL**'s `/api/verify`; the adapter is
selected server-side by the `FOOTNOTE_VERIFIER` env var (read at call time by
`src/core/registry.js`). So point the harness at a server that has the flag set — never at
production, which must stay on the single-shot default.

**Local (recommended):** the self-host server loads `.env.local` (needs
`PERPLEXITY_API_KEY` + `ANTHROPIC_API_KEY`; `--judge` also reads `ANTHROPIC_API_KEY` from
env or `.env.local`).

```sh
# terminal 1 — serve the pipeline with the dark adapter selected
FOOTNOTE_VERIFIER=perplexity-twostep npm start

# terminal 2 — full harness-v2 calibration run (260 cases, both stages, LLM judge)
node eval/run.js --base http://localhost:3000 --all --judge

# report — per-category precision at the floor + auto-air eligibility
node eval/report.js
```

Notes:
- Smoke it first: `node eval/run.js --base http://localhost:3000 --limit 6` (one spin
  through the categories) before committing to the ~25–30 min full run.
- Localhost has no Upstash env, so API rate limits fail open — but each verify now makes
  **two** Perplexity calls, so mind vendor-side rate limits; use `--delay` if 429s appear
  as `verify failed` upstream errors.
- Against a preview deployment instead, set `FOOTNOTE_VERIFIER=perplexity-twostep` on the
  preview environment only and pass `--base https://<preview>.vercel.app`. The harness's
  default base is production — always pass `--base` explicitly for this eval.
- Verdict precision is measured on stage 2 fed with the *expected* extraction, so this
  isolates the verifier — exactly what P4-C changes.

## Promotion bar (Decision D15 / the D3 gate as coded in `eval/report.js`)

Promotion to default requires, **per category**, at the auto-air confidence floor
(`CONF_FLOOR = 0.85`):

- **≥ 95% verdict precision** at the floor (`PRECISION_THRESHOLD = 0.95`);
- **n ≥ 30 scored cases per category** at the floor (report.js enforces ≥ 20 as its
  hard minimum; the D15 street-scope standard is 30 — run `--all`, don't sample);
- **both scorers clean** — token scorer AND the harness-v2 LLM judge (`--judge`), with
  zero uninvestigated polarity inversions (any `DISAGREEMENT` rows must get the human
  `"adjudicated": true` pass in the goldens / `eval/ADJUDICATIONS.md` first);
- and the regression guard from the rejected prompt iteration: the mid-tier controls
  (geo-019 Sahara, stat-017 divorce rate, adv-010 UFO) must NOT flip to confident
  definitive verdicts — precision that arrives by trading hedges for confident-wrong is a
  fail, not a pass.

Structural blocks are unaffected by any score: person_claims never auto-air (D4) and
attributed_quotes stay blocked pending D11.

**Until a full-run eval meets every condition above, `perplexity-twostep` stays dark:**
not the registry default, not set in any deployed environment, exercised only by explicit
`FOOTNOTE_VERIFIER=perplexity-twostep` eval/dev sessions. If the eval passes, flipping the
default is still its own decision (with the calibration report as the artifact), not an
automatic consequence.
