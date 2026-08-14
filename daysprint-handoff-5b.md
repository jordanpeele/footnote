# DAYSPRINT handoff — packet 5b: sliding-window rate limiter

**Branch:** `worktree-agent-a7b9b818ffaa75d5e` (committed, NOT pushed)
**Status:** done — `npm test` green (255 tests, 253 pass, 2 pre-existing skips, 0 fail)

## What changed

### `api/_ratelimit.js` — fixed window → exact sliding log
The old limiter keyed an INCR counter on `floor(now/window)`, so a burst at the end of
window N plus a burst at the start of window N+1 let ~2x the budget through the seam.
Replaced with a sorted-set sliding log, one Upstash `/pipeline` call per request
(same round-trip count as the old `[INCR, EXPIRE]` pair):

```
ZREMRANGEBYSCORE rl:<name>:<ip> 0 <now-window>   # drop entries older than the window
ZADD             rl:<name>:<ip> <now> <uniq>     # record this request
ZREMRANGEBYRANK  rl:<name>:<ip> 0 -(limit+2)     # cap memory: keep newest limit+1
ZCARD            rl:<name>:<ip>                  # count = requests in window
EXPIRE           rl:<name>:<ip> <window+5>       # idle keys self-clean
```

**Why the exact log, not the two-fixed-window weighted approximation** (justified in the
module comment): both are one round trip on Upstash's `/pipeline` endpoint, and the
approximation is still adversarially gameable to ~2x (burst the last instant of the
previous window, pace the current one). The log's usual memory cost is neutralized by the
`ZREMRANGEBYRANK` cap — a flooding IP's key never exceeds `limit+1` members.

### Preserved (verified)
- **Export contract unchanged:** `rateLimit(req, res, name, limit, windowSec = 60) → bool`.
  **Zero route-file changes** — all five callers (`verify`, `extract`, `transcribe`,
  `dg-token`, `onair` r/w) untouched, budgets unchanged.
- **Fail-open posture** (docs/SELF_HOSTING.md spending-safety section stays true):
  no Upstash env → ungated; store non-2xx (`pipeline() → null`) → open; throw → open.
- **429 semantics unchanged:** `Retry-After: <windowSec>`, body
  `{ error: "rate limited", limit_per_min: <limit> }`.
- **Counting-rejected behavior preserved:** the old INCR counted denied requests; the
  ZADD does too, so a hammering IP stays limited until it backs off for a full window.
- Spend-gate / kill switch / auth / keys: untouched (`spendgate.js`, `route-inventory`
  ordering test all still green).

### New: `test/ratelimit.test.js` (10 tests)
Test seams added to `_ratelimit.js` — `_setPipeline(fn)` / `_setNow(fn)`, same pattern as
`spendgate.js`'s `_setFlagReader` (static ESM import, no module mocking). Fake in-memory
store speaks exactly the five pipelined commands with Redis rank/score-range semantics.
- **boundary burst** — 5+5 straddling t=60s; old limiter passed all 10, sliding admits 5
- steady-state under budget; budget exhaustion → exact 429 contract
- recovery after the window slides past; memory cap (≤ limit+1 members under flood)
- per-IP and per-route isolation
- fail-open ×3: pipeline→null, pipeline throws, keyless (skips if shell has Upstash env)

## Behavior deltas worth knowing
1. **Redis key shape changed:** `rl:<name>:<ip>:<windowIdx>` (string counter) →
   `rl:<name>:<ip>` (zset). Old counter keys expire on their own within ~65s of deploy;
   no migration needed. Anything externally inspecting `rl:*` keys should expect zsets.
2. **Slightly stricter at the seam by design:** an IP that used its full budget late in a
   minute no longer gets a fresh budget at the top of the next minute — that was the bug.
3. Coverage honesty: the fake store interprets the same command arrays; the live
   `/pipeline` path is covered only by the fail-open tests + prod probes (same posture as
   spendgate's documented gap).

## Files touched
- `api/_ratelimit.js` — rewrite (sliding log + test seams; export contract identical)
- `test/ratelimit.test.js` — new
- `daysprint-handoff-5b.md` — this file
