# DAYSPRINT handoff — packet 5a: N2/N4 residual hardening

**Branch:** `daysprint/5a-n2n4-residuals` (committed, NOT pushed)
**Tests:** `npm test` green — 250 pass / 0 fail / 2 pre-existing skips (was 243/0/2; +7 new)
**Untouched by contract:** room auth / TOFU semantics, operator command meanings, all
operator-facing response shapes and status codes for previously-defined cases.

## Residual verdicts (detail + line refs in `docs/redteam/N2N4-RESIDUALS.md`)

| Item | Verdict |
|------|---------|
| N2 core double-air TOCTOU | already CLOSED (append-then-elect) — re-verified, now under a *forced*-interleave test instead of Promise.all roulette |
| N2 partial failure: cmd logged, publish never landed | **NARROWED** — record now self-describing (`air-landed` compensating marker + aired-log fallback); the old *permanent* ghost-dup poisoning is gone: a retap past `OP_AIR_INFLIGHT_GRACE_MS` (90s) re-airs (self-heal). Remaining ghost window ≤90s, pinned by test |
| N2 race-loser vouching for a winner that then dies mid-sequence | **DOCUMENTED-STUCK** (loser cannot await the winner under the appendLog/readLog-only adapter contract); converges via the retap heal |
| N2 /control consuming the orphan air cmd (marks card aired, heal unreachable) | **DOCUMENTED-STUCK server-side**; closable control-side by gating `opApplyCmd` airs on the marker — deliberate follow-up, out of this packet's semantics-untouched scope |
| N4 guard 1 (snapshot freshness ceiling) + guard 2 (hold/skip recency scan) | already in place — re-verified, tests kept green |
| N4 hold-vs-air append race (hold lands between the air's pre-scan and publish — undocumented before this packet) | **CLOSED** — positional adjudication on the elect read-back: append order is now the single authority; a hold serialized before the air's entry 409s the air deterministically (forced-interleave test) |
| N4 control-LOCAL dismissal (push RTT / silently-failed push) | **DOCUMENTED-STUCK server-side** (the server never learns of it); bounded by the 180s freshness ceiling; boundary pinned by test. Stale "~400ms debounce" claim in the tunable comment corrected — `dismissCard` uses `pushNow()` since the earlier N4 fix |

## What changed

- `api/onair.js`
  - air branch: confirmation-aware prior scan (marker → aired-log → in-flight grace →
    else dead half-air falls through to re-air); dead epochs excluded from the elect;
    positional hold/skip re-scan on the elect read-back; best-effort `air-landed`
    marker appended only after publish + aired-log append both land.
  - new tunable `OP_AIR_INFLIGHT_GRACE_MS = 90_000` (commented: must exceed max
    function lifetime; live-read-as-dead is the only double-publish direction).
  - corrected the stale N4 tunable commentary (debounce → pushNow reality).
- `src/adapters/state/memory-ws/index.js`: minimal `_setHook` test seam — entry-point
  interception (throw = fault injection; returned Promise = parked verb for
  deterministic interleaving) on publish/get/appendLog/readLog only; `merge` and
  `registerRoom` excluded so their await-free atomic bodies stay atomic; no-op when
  unset (production).
- `test/op-air-residuals.test.js` (new, 7 tests): forced N2 overlap; publish-death
  epoch (self-description + in-grace ghost pinned + post-grace heal); aired-log-append
  death (receipts heal, exactly one row); marker loss (200 preserved, aired-log
  fallback dedups forever); forced N4 hold-first interleave (409, no publish); N4-c
  invisible-dismissal boundary pin.
- `docs/redteam/N2N4-RESIDUALS.md` (new): current-truth residual inventory with line
  refs — written from the code, supersedes ROUND3-REPROBE.md's N2/N4 sections.

## Compatibility notes for the next packet

- `air-landed` is a new cmd-log action: `/control` `opApplyCmd` no-ops unknown actions
  (verified, `app.js` L1701–1733) and dedups by id; `/op` never reads the cmd feed.
  Pre-marker cmd logs stay correct via the aired-log confirmation fallback.
- One extra store write per operator air (the marker), one extra log read only when
  unconfirmed priors exist. Upstash adapter unchanged — all logic rides the existing
  StateChannel verbs.
- If a future packet wants N2-c closed: have `opApplyCmd` treat an `air` entry as
  provisional until its `air-landed` marker (or a queue-read `renderedId`) arrives.
