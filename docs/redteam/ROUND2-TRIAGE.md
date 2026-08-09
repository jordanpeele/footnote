# Red-team ROUND 2 — triage checklist (round-3 P3-D part 1)

Status key: **CLOSED round2-hotfix** (landed in `bc9bf9c`, verified in working tree) ·
**CLOSED this packet** (registry/editorial fixes + tests, this packet) · **WAVE-2** (app.js
work owned by the M5/M6/L2 agent) · **BACKLOG** (open; severity + rationale). Verification
tests live in `test/registry.test.js`, `test/prompt-sync.test.js`, `test/editorial.test.js`.

| # | Finding | Status |
|---|---------|--------|
| H1 | Legacy `/api/factcheck` (unmetered + editorial bypass) | **CLOSED round2-hotfix** — deletion landed in `bc9bf9c`. Residual **BACKLOG (MED)**: audit Vercel preview-deployment protection / rotate keys if old previews stay public. |
| H2 | Ghost auto-air after End Stream (no gen guard in `checkUtterance`) | **BACKLOG (HIGH)** — still open in working tree (verified 8/7: `checkUtterance` app.js L195 has no `myGen` check; `maybeAutoAir` L235 runs unconditionally). app.js is wave-2's file — **strongly recommend wave-2 takes this alongside M5/M6**; it is the highest-severity open item. |
| H3 | `*.gov.<cc>` privately registrable hosts got tier-3 | **CLOSED round2-hotfix** — curated `GOV_CC` allowlist in editorial.js; regression pinned (`cdc.gov.io → 1`, `gov.uk`/`service.gov.uk → 3`) in test/editorial.test.js. |
| M1 | `getAdapter` outside try hard-crashes onair/transcribe on bad env | **CLOSED round2-hotfix** — both routes now call it inside try (onair L39, transcribe L35) and 500 with clean JSON. |
| M2 | Stub adapters reachable in prod (silent on-air blackout) | **CLOSED this packet** — registry refuses `stub`/`_stub` when `NODE_ENV=production` unless `ALLOW_STUBS=1`; unknown-adapter error now names the env var. test/registry.test.js (6 tests, subprocess-isolated). |
| M3 | Overlay counts 200-with-garbage as healthy | **CLOSED round2-hotfix** — overlay.js sets `ok = true` only after a parsed response (commented `red-team M3`). |
| M4 | Held card wedges on glass after state TTL expiry (`seq:0`) | **CLOSED round2-hotfix** — overlay.js treats seq reset as a pull (commented `red-team M4`). |
| M5 | Reload-restored `checking` cards never enter the session log | **WAVE-2** (app.js). |
| M6 | Two /control tabs: last-writer-wins snapshot + id collisions | **WAVE-2** (app.js). |
| M7 | Nothing enforces prompt-file ↔ fallback sync | **CLOSED this packet** — test/prompt-sync.test.js asserts `prompts/extractor.md` body ≡ adapter `FALLBACK_PROMPT` via source extraction (brittle-by-design; future fix = export the const). |
| L1 | `rankCitations` throws on non-array citations | **CLOSED round2-hotfix** — `Array.isArray` guard in editorial.js (commented `red-team L1`). |
| L2 | `SESSION.summary()` p50/p95 without `n` | **WAVE-2** (app.js). |
| L3 | Shortener/blocklist evasion + 1-char display names ("Source: T") | **CLOSED this packet** — `SHORTENER_RE` (t.co, bit.ly, youtu.be, tinyurl.com, goo.gl, ow.ly, buff.ly + subdomains) → tier 0; `prettyName` < 3 chars falls back to full host (gov acronym path exempt: `va.gov` → "VA"). |
| L4 | `.slice(0, 240)` splits surrogate pairs (� on air) | **CLOSED this packet** — `truncateOnAir()` (exported) strips a trailing lone high surrogate; used for `correction`. Residual **BACKLOG (LOW)**: `slimCard`'s `.slice(0, 300)`s in api/onair.js (file not owned this packet) — reuse `truncateOnAir`. |
| L5 | Nested markdown survives `cleanText` (literal `**` on chyron) | **CLOSED this packet** — strip passes iterate to a fixpoint (bound 6). Known non-goal: `__init__`-style identifiers still get unbolded. |
| L6 | TOFU writeKey: 24h idle room seizure; register race lacks SETNX | **BACKLOG (LOW)** — upstash adapter read-only this packet; needs `SET NX` + TTL/re-registration policy decision (attacker needs the overlay URL; demo-scoped risk). |
| L7 | Verdict casing drift softened to Unverifiable | **CLOSED this packet** — case-insensitive normalization onto the canonical `VERDICTS` form (`"false"` → `"False"`); unknown values still fall back to Unverifiable. |

INFO items (I1–I7): no action this packet. I3 (upstream `detail` echo) and I4 (duplicate-domain
citations crowding the visible list) remain worthwhile BACKLOG-LOW candidates; I7 (inlined
`DG_KEY`) is already tracked for post-pitch rotation.
