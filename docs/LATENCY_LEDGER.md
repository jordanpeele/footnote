# Latency ledger — sprint 02 phase 0 (2026-08-09)

Source of truth for optimization priority. Decomposed from the two field-session logs
(`eval/results/fieldtest-2026-08-08.jsonl`, manual airs, n≈51 verifies;
`eval/results/fieldtest-2026-08-09-pass2.jsonl`, test-air, n=9 — the machine-floor
session). Update the AFTER columns only from replay/bench runs on the same diet.

## The waterfall (machine path, operator-decide excluded)

| stage | 08-08 p50/p95 | pass-2 p50/p95 | notes |
|---|---|---|---|
| interim→final (STT endpointing wait) | 514 / 2,067 | 564 / 1,003 | UPPER-BOUND estimate — FT throttles interims to 400ms, so true wait is ≤ this |
| final→check_start | ~0 | ~0 | same tick |
| merge-window cost | 0 | 0 | P5-B join fires on the NEXT final's arrival; adds no wait to the primary path |
| **extract (Haiku)** | **989 / 3,860** | **779 / 1,895** | #2 block |
| extract→verify-start | 1 / 2 | 1 / 1 | **already immediate — "speculative verify" has nothing to win** |
| **verify (Perplexity)** | **2,975 / 5,715** | **2,629 / 2,921** | **#1 block — ~75% of machine time** |
| verify→gate→air (test-air) | — | 1 / 2 | **gates are free — latency work has no reason to touch them** |
| publish | 3 / 7 | 2 / 3 | in-memory; prod = +1 Redis RTT |
| air→render | 366 / 2,015 | 274 / 404 | idle tail already fixed (P4-F2); floor is the 400ms FAST poll |
| **spoken→screen** | — | **~3,500 / ~5,300** | measured end-to-end, pass-2 |

## Top 3 by absolute time (this order governs the sprint)

1. **Verify — 2.6–3.0s.** The block. Diet (prompt/response/search-context trim) and
   connection hygiene are the sanctioned levers; streaming buys nothing for air time
   (the card airs only on a complete, gated verdict) — evaluated, not pursued.
2. **Extract — 0.8–1.0s.** Bigger than the kickoff assumed. Static system prompt →
   Anthropic prompt caching is the obvious first lever; near-zero risk, measurable.
3. **STT finalization — ≤~0.55s p50.** Real but smallest of the three, and NOT
   benchmarkable without live audio — endpointing changes ship as a tunable with the
   tradeoff documented, measured next live session (rule 2 honored by not defaulting).

Render (~0.3s) is below all three; cheap wins only per L4.

## L2 · STT finalization — tunable shipped, default unchanged (2026-08-09)

`/control?ep=<ms>` (10–2000) now passes Deepgram's `endpointing` knob through to the
streaming WS. NOT defaulted: faster finals ⇄ higher split-final rate is a live-audio
tradeoff (the P5-B merge absorbs splits, so lower values are worth trying), and rule 2
forbids shipping an unmeasured default. Next live session: run one segment at `?ep=200`
and one stock, compare interim→final p50 and `stt_merge` rate on the dashboard, pick the
knee.

## L4 · render — done (2026-08-09)

- **Fonts self-hosted** (assets/fonts/, two OFL variable fonts, 66KB latin): the overlay
  and receipts pages were hotlinking Google Fonts — a third-party runtime call from the
  broadcast surface (violates the same rule that bans favicon hotlinking) and a
  first-paint dependency on fonts.googleapis.com availability mid-broadcast. Wired at
  C-workstream integration.
- Poll cadence left at FAST=400ms (already URL-tunable via `?poll=`); air→render p50 274ms
  is below every other stage — not worth churn.

## Hygiene closed this session

- **N4 residual CLOSED (control-side):** dismissals now push the queue snapshot
  immediately (`opBridge.pushNow`) instead of waiting out the 400ms debounce — the last
  window where a second-phone AIR could land on a just-dismissed card.
- **Upstash Lua merge verb LIVE-VALIDATED on prod Redis** (P5-E flagged caveat): activeAt
  stamps atomically; a live aired card survives a subsequent queue-push merge.

## Replay methodology (before/after evidence)

`tools/bench/` replays the field-log claims through the LOCAL live pipeline
(/api/extract, /api/verify) N passes and reports p50/p95 deltas; golden smoke
(fixed category subset, string scorer) must stay clean for any change that touches
a prompt or request shape. A change without both numbers reverts.

## L1 verify diet — results (2026-08-09)

Bench: `tools/bench/verify-bench.mjs` — fixed diet of 41 claims (29 distinct
`extract_done` claims from the two field logs + 12 goldens, ids hardcoded:
stat/sci/hist/geo/curr/adv 001+002), POSTed to a private port-3200 server,
~1.5s pacing. Raw rows in `tools/bench/results/*.jsonl`; drift diffed with
`tools/bench/diff-verdicts.mjs` (a candidate verdict counts as drift only if it
matches NO baseline pass for that claim). Baseline self-noise floor: 1/41 claims
(field-14, a Haiku refusal-text junk "claim") flipped NeedsContext↔Unverifiable
between the two baseline passes; goldens were 24/24 stable.

| experiment | decision | p50 (ms) | p95 (ms) | verdict drift vs baseline |
|---|---|---|---|---|
| **baseline** (unmodified adapter, 2 passes, n=82) | — | **2,602** | **3,524** | — (goldens 24/24) |
| a) `web_search_options:{search_context_size:"low"}` (n=41) | **REVERTED** | 2,600 (−2) | 3,100 (−424) | **field-03 Unverifiable→False** (real claim, subjective superlative — a commitment flip baseline was stable on both passes) + field-09 (junk claim); goldens 12/12 |
| b) `max_tokens: 300` (n=41) | **REVERTED** | 2,552 (−50) | 2,938 (−586) | **GOLDEN MISS stat-001 True→False** (1950 census) + field-20 False→Misleading + field-03; goldens 11/12 |
| c) prompt diet | **SKIPPED** | — | — | the system prompt is ~1.3k chars of exactly the load-bearing text (source-trust roster + verdict vocabulary/schema, protected per eval/ADJUDICATIONS.md); nothing meaningful to trim without touching it — accuracy-wins rule |
| d) connection reuse (undici keepAlive Agent) | **NO-OP (measured)** | — | — | no cold-vs-warm gap exists: pass-1 call1 2,612 vs median-rest 2,623; pass-2 call1 1,863 (FASTER than its 2,553 median); expA call1 2,442 vs 2,600. No handshake cost to remove; no change made (also keeps zero-deps) |

**Final kept configuration: the unmodified adapter.** `git diff
src/adapters/verifier/perplexity/index.js` is empty — every candidate either spent
accuracy (a, b) or had nothing to buy (c, d). Final gate on the kept config:
goldens 12/12 match ground truth (p50 2,518 / p95 2,975 on the golden subset),
`npm test` 111/111 green.

**Reading.** The p50 is search+generation bound at the vendor, not
transport/prompt/response bound: both request-shape levers moved p50 by <2%
(inside run-to-run noise) while introducing verdict drift — sonar-pro's verdicts
on borderline claims (subjective superlatives, junk extractor text, Misleading-vs-
False lines) are sensitive to ANY context/decode perturbation. The remaining
sanctioned lever for the 2.6s block is architectural (e.g. a faster model tier or
parallel verify+commit), not parameter diet — that is a different workstream with
a calibration bill, per D15.

**Bench spend:** ~180 sonar-pro verifies total (82 baseline + 41 expA + 41 expB +
12 final goldens + 4 smoke/stray) ≈ $2–3 (request fees ~$1.8 dominant, tokens
~$0.6). All runs logged in `tools/bench/results/` (gitignored).

## L1b · extract — measured no-ops, adapter unchanged (2026-08-09)
> **Fold-in note:** written to a separate file to avoid a write race with the verify
> lane's concurrent edits to `docs/LATENCY_LEDGER.md`. Fold this into the main ledger's
> extract row / notes when that file is free.

Bench: `tools/bench/extract-bench.mjs` — 30 hardcoded utterances from
`eval/results/fieldtest-2026-08-08.jsonl` stt_finals (15 field-claims + 15 field-nulls),
POST /api/extract on a local server (PORT 3300), ~600ms pacing, 2 passes per condition.
Raw runs in `tools/bench/results/extract-*.jsonl`.

## Numbers

| condition | passes×30 | p50 | p95 | outcome parity vs baseline (pass 1) |
|---|---|---|---|---|
| baseline (adapter as committed) | 2 | **681ms** | 1,885ms | — (15 claims / 15 null) |
| baseline extra passes (probe runs) | 1+1 | 716 / 647ms | 1,887 / 1,812ms | 30/30 identical |
| lever B: `max_tokens` 300→160 | 2 | 673ms | 1,468ms | **30 identical, 0 drift, 0 flips** |

## Lever A — Anthropic prompt caching: **NO-OP, prompt too short to cache**

- `count_tokens` (claude-haiku-4-5-20251001): system prompt + minimal message =
  **825 tokens** (~834 with a real utterance).
- Haiku 4.5's minimum cacheable prefix is **4,096 tokens** (per current Anthropic docs;
  note: NOT 2,048 — that figure applies to Sonnet 4.6-class models). 825 ≪ 4,096.
- Verified empirically, not just from docs: 3 consecutive direct Messages calls with the
  exact adapter request shape plus `system: [{type:"text", text: PROMPT,
  cache_control: {type:"ephemeral"}}]` returned
  `cache_creation_input_tokens: 0, cache_read_input_tokens: 0` every time — the API
  silently declines to cache below the minimum. No cache write, no cache read, no
  latency effect possible.
- **Decision: adapter left untouched** (still plain-string `system`, no `cache_control`).
  Revisit only if the extractor prompt ever grows ~5× (>4,096 tokens) — then the block
  form + `cache_control` becomes the first lever again.

## Lever B — max_tokens tightness + temperature

- `temperature: 0` was **already set** in the committed adapter — nothing to change.
- Measured output tokens on the diet (temporary env-flagged usage logging, since
  removed): NONE replies = 5 tokens; claim replies = 32–40 tokens. Cap is 300.
- Tested `max_tokens: 160`: outcome parity perfect (30/30 identical strings, 0
  claim/null flips), but latency unchanged — p50 681→673ms (~1%, inside run-to-run
  noise; the two extra baseline passes spanned 647–716ms p50 on their own). Mechanically
  expected: `max_tokens` is a stop-ceiling, Haiku ends at `end_turn` (≤40 tokens) long
  before either cap, so the cap can't shorten generation.
- **Decision: reverted to `max_tokens: 300`.** Zero measured benefit, and 300's headroom
  protects long `quote_attribution` claims (a truncated JSON envelope on live TV is the
  one failure mode this knob can create — instant-revert class).

## Net result

**No adapter change shipped.** Extract p50 on this diet measured 647–716ms across four
independent passes (below the 779–989ms field p50 — field numbers include live-session
network conditions). Neither sanctioned lever moves it:

- The extract floor here is Haiku inference + TTFB on a ~860-token uncached prompt.
- Paths that could actually cut it (out of scope for this task, for the ledger's
  option list): grow-and-cache is backwards; a smaller prompt (fewer instruction tokens
  → less prefill), streaming-with-early-parse (claim JSON is one line — first `}` ends
  it), or a faster/cheaper model tier if one appears below Haiku.

## L2 · endpointing A/B — RESOLVED: keep the default (2026-08-10 live session)

`?ep=200` vs stock, same speaker/mic/room: finals p50 **704ms vs 564ms** (+140ms
SLOWER) with split/merge rate down ~33% (0.25 vs 0.375 merges/final). Deepgram's
default is already the fast end of the curve; higher endpointing buys intactness
at a latency price — and the P5-B merge already recovers splits for free, so the
default wins on BOTH axes. Decision: no default change, ever, absent new evidence;
the `?ep=` hatch stays for experiments. Also this session: F2 dedupe FIELD-FIRED
(duplicate suppressed live), 3/3 verdicts correct, air→render p50 306ms.

Cumulative field record (R38, AMENDED post-ratification — see FS-8): 4 sessions ·
102 checks · **1 wrong-verdict card aired** (street 08-10: "Women have XY sex
chromosomes" ✓ TRUE — extractor emitted polarity=denies on an ASSERTION with no
negation in the transcript; the flip inverted a correct False into an aired True;
found by the P7-E adjudication prep, confirmed against the session record) ·
1 display-incoherent pairing (FS-1, closed by D17 — which does NOT close the FS-8
class; that closure is polarity-classification quality, orchestrator ruling pending).
