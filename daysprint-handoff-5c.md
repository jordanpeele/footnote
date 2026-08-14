# DAYSPRINT handoff — packet 5c: spend dashboard groundwork (2026-08-14)

**Branch:** `daysprint-5c/spend-dashboard-groundwork` (committed, NOT pushed)
**Scope honored:** counting + surfacing only. Spend GATING (kill switch, ceilings,
`MONTHLY_SPEND_CEILING_USD`) untouched — a test now pins that spendmeter exports nothing
gate-shaped.

## What shipped

### 1. `src/core/spendmeter.js` — additive per-call spend metering
- `tick(route, vendor)` — called by every costed route immediately before the vendor call
  (attempts, not successes: the spend is committed when the request leaves).
- **Static price table** (`PRICE_TABLE`, keyed `route:vendor`) with per-line provenance
  comments — this file is the one obvious place to update on a vendor reprice:
  - `extract:anthropic-haiku` **$0.001** (ledger L1b token counts × Haiku 4.5 list $1/$5 per MTok)
  - `verify:perplexity` **$0.013** (ledger L1 bench residual: ~$2.4 / ~180 sonar-pro verifies)
  - `verify:perplexity-twostep` **$0.026** (2× sonar-pro; dark adapter, priced for completeness)
  - `verify:brave-claude` **$0.05** (R49 residual ≈$0.058 vs list-price build-up ≈$0.04; lowest-confidence row — adapter never run live)
  - `verify:polarity-signal` **$0.001** (one small Haiku call, R50)
  - `transcribe:deepgram` **$0.0002** (nova-3 pre-recorded ≈$0.0043/min × ~2.2s window; the latency ledger has no Deepgram figure — vendor list price, checked 2026-08-14)
  - `dg-token:deepgram` **$0** (mint is free; counted as the proxy for client streaming sessions, honestly priced zero rather than guessing minutes)
- **Storage:** in-process counters (always; global-correct on self-host per D1, per-warm-
  instance on Vercel, labeled as such) + optional store-backed daily rollup when Redis is
  configured — same `isConfigured()` pattern as spendgate, fire-and-forget, fail-SILENT,
  integer micro-USD via `HINCRBY` into `spend:<YYYYMMDD>` hashes (TTL ~40 days).
- Unpriced pairs (stub adapters) are still **counted**, at $0, flagged `unpriced: true`.

### 2. Route wiring (all four D14 costed routes)
- `api/extract.js` — `tick("extract", extractor.name)`
- `api/verify.js` — concurrence fans out to **both arms** (`FOOTNOTE_CONCURRENCE_A/B`,
  defaults perplexity + brave-claude) since concurrence spend ≈ A + B; the R50 polarity
  signal ticks its own `verify:polarity-signal` line when it runs. Single-engine verifiers
  tick their adapter name. Tick sits after the room cap (a 429'd request spends nothing).
- `api/transcribe.js` — `tick("transcribe", stt.name)` after all validation.
- `api/dg-token.js` — `tick("dg-token", stt.name)` (spend-by-proxy counting).

### 3. Surfaces
- **`GET /api/admin?op=spend`** (same ADMIN_TOKEN gate, admin stays D14-"free"):
  `{ est: true, note, process: {since, total_est_usd, by}, today: {day, total_est_usd, by} | null }`.
  Works identically with or without a store (`today` null storeless). Unknown-op error
  string now names `spend`.
- **Fieldtest dashboard** (`tools/fieldtest/dashboard.js`): new `spend` harness event →
  compact `$ SPEND est $0.0130 verify:perplexity · session est $0.013` line + a session
  total in the Ctrl-C summary. Events reach the FT log via a server-side `ftAppend` inside
  spendmeter — direct JSONL append when `FOOTNOTE_FIELDTEST_LOG` is set (routes run in the
  same process as the self-host server, so this IS the server-side twin of the
  `/__fieldtest/log` browser sink; env never set on Vercel → no-op there).
- **`/op` untouched** (glance strip frozen per 0c).

### 4. Honesty rule
Every surface labels figures as estimates: `est: true` + note on the admin body, "est."
prefixes on the dashboard lines, `est_usd` field names, ESTIMATE-blocked comments in the
price table. A test asserts the labeling.

## Tests
`test/spendmeter.test.js` (13 tests): meter accumulation + return value, unpriced-vendor
counting, price-table sanity (every costed route priced; default adapters + concurrence
arms priced; figures finite/non-negative), FT spend-event shape, admin op=spend auth
(401) + shape (200, est-labeled, `today` present) + error-string, no-gating-exports scope
guard, snapshot shape. Tests strip KV/Upstash env before dynamic import so a dev shell
with live store creds can never make unit tests write to prod Redis (`today` becomes
deterministically null). **`npm test`: 259 tests, 257 pass, 0 fail, 2 pre-existing
env-conditional skips.** Smoke-verified end-to-end: stub extract through the real route →
snapshot + FT log line → dashboard renders.

## Known limits / next steps (for a future packet, not this one)
- Store rollup unit-untested (fire-and-forget pipeline; exercised via `?op=spend` against
  prod — same coverage-honesty stance as spendgate's live path).
- `dg-token` streaming minutes are invisible server-side; a real figure needs the client
  to report session duration (or Deepgram usage API polling).
- Vercel `process` tallies are per-warm-instance; the store rollup is the cross-instance
  truth there. A `MONTHLY_SPEND_CEILING_USD` comparison on the admin body (still
  informational, not enforcing) would be a natural, tiny follow-up.
- brave-claude price is the lowest-confidence row; recalibrate on first live run.
