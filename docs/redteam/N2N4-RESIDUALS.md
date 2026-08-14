# N2/N4 residual inventory — packet 5a (round-3 re-probe hardening)

**Scope:** the `op:"cmd"` **air** branch of `api/onair.js` (operator second-phone airs).
**Method:** line-by-line read of the current tree (this document trusts the code, not
`ROUND3-REPROBE.md`, which predates the append-then-elect fix), plus deterministic
interleaving/fault tests against the real handler (`test/op-air-residuals.test.js`,
using the memory adapter's `_setHook` seam). Line references are into this commit.

Findings context: N2 = operator double-air TOCTOU; N4 = stale phone snapshot airing a
just-held card (`docs/redteam/ROUND3-REPROBE.md` §N2/§N4).

---

## N2 — double-air TOCTOU

### As found (before this packet)

The core race was already closed by append-then-elect: append the cmd entry first
(`api/onair.js` L432), read the log back, elect the **deepest** matching entry
(arrival order is the only total order both racers agree on), loser answers `dup`
with the winner's `airedId`. Verified: the second appender is guaranteed to see the
winner (the store serializes appends) → exactly one publish + one aired-log row.

**Residual as found (documented in the old comment, confirmed real by reading):** the
overlay publish and the aired-log append happen **after** the cmd append, so a store
failing mid-sequence leaves an *air cmd entry whose publish never landed*, and the
record was **not self-describing** — a later retap found the orphan in the `prior`
scan and answered `dup` with an `airedId` that never aired, **permanently** (until the
queue snapshot expired). Worse than the comment implied: the ghost was not "equally
narrow" one-shot noise; it poisoned every subsequent retap for the card instance.

### What this packet changed (narrowing, no operator-facing semantic changes)

1. **Compensating marker — the record is now self-describing** (L455–459): after the
   publish *and* the aired-log append both land, the handler appends
   `{action:"air-landed", of:<cmd id>, airedId}` to the cmd log. An air entry with no
   marker and no matching aired-log row is a *provable half-air*. The marker append is
   deliberately **best-effort** (`try/catch`): a lost marker must not 502 a
   fully-landed air, and the aired log remains the confirmation fallback. `/control`
   ignores unknown cmd actions (`app.js` `opApplyCmd` has no branch → no-op), so the
   marker is invisible to every client.
2. **Confirmation-aware prior scan** (L395–418): a retap answers `dup` only when the
   prior is (a) marker-certified, (b) present in the aired log (covers lost markers
   and pre-marker logs), or (c) younger than `OP_AIR_INFLIGHT_GRACE_MS` (L110–118,
   90s — presumed a racer still in flight; the bound must exceed the platform's max
   function lifetime, because live-read-as-dead is the only direction that can
   double-publish). Priors that are none of these are dead half-airs → fall through.
3. **Self-heal on retap** (same lines + elect filter L434): dead half-airs are
   excluded from the election, so a retap past the grace **re-airs** the card with a
   fresh `airedId` instead of answering a ghost dup. Pinned in
   `test/op-air-residuals.test.js` ("publish dies" / "aired-log append dies").

### Remaining N2 residuals — honest inventory

| # | Window | Verdict |
|---|--------|---------|
| N2-a | **Ghost dup inside the grace.** A retap ≤90s after a mid-sequence store failure answers `dup` with an `airedId` that never aired. Undecidable server-side: an unconfirmed young entry is indistinguishable from a racer mid-flight, and electing against it risks a double publish. Self-heals on any retap after the grace. Pinned by test. | **NARROWED** (was permanent; now ≤90s, then heals) |
| N2-b | **Race-loser vouches for a winner that then dies.** The elect loser answers `dup` before the winner publishes; if the winner's store dies mid-sequence the loser has already reported success. Unfixable in-request (the loser cannot await the winner); converges via N2-a's heal on the next retap. | **DOCUMENTED-STUCK** (adapter contract: appendLog/readLog only, no cross-request signal) |
| N2-c | **`/control` consumes the orphan air cmd.** `cmds-read` feeds the raw log; on an air entry `/control` marks the card aired locally (`app.js` L1707–1716) with no landed check, drops it from the queue, and the heal in (3) becomes unreachable (retap → 409 card-gone). Result: control says AIRED, glass and receipts disagree. The record is now self-describing (no marker, no aired row) so the divergence is *auditable*, and `/op`'s render-ack stall ("NOT ON SCREEN") fires when armed — but closing it means control gating airs on `air-landed`, a control-side follow-up explicitly out of this packet's scope (operator semantics untouched). | **DOCUMENTED-STUCK** (server-side); closable control-side |
| N2-d | **Aired-log trim horizon.** Confirmation fallback (b) reads the room log (500 entries / 7 days). An air trimmed out reads as unconfirmed — but a re-air also requires the card pending in a live ≤180s snapshot, which cannot outlive the trim horizon. Theoretical only. | **DOCUMENTED** (unreachable in practice) |

## N4 — stale snapshot airing a just-held card

### As found (before this packet)

Two guards, both real and correct:

- **Guard 1 — snapshot freshness ceiling** (L378–382): airs 409 `{stale:true}` when
  `t - qseq > OP_AIR_MAX_SNAPSHOT_AGE_MS` (= the 180s snapshot TTL; deliberately not
  tighter — see the tunable comment L92–108 — because /control only pushes on queue
  mutations, so a quiet-but-live control legitimately leaves qseq minutes old). This
  buys TTL enforcement even on adapters that ignore `ttlSec` (the contract allows it).
- **Guard 2 — hold/skip recency scan** (L383–394): /op-originated HOLD/SKIPs are
  server-logged and matched by card instance (`spokenAt`, with a `t >= qseq`
  fallback), so a hold the backing snapshot can't yet reflect still rejects the air.

**Residuals as found:**

1. **Hold-vs-air append race (undocumented!).** The hold scan ran ONCE, before the
   air's own cmd append. A hold landing in the log between that scan and the publish
   (two phones on one key, or phone + Mac hotkey) sailed through — the held card
   aired even though the hold *won* the append race. Confirmed by forcing the
   interleaving in test before the fix.
2. **Control-LOCAL dismissals** (tunable comment L92–108): a dismissal on the Mac
   reaches the server only via the next snapshot push. The old comment claimed a
   "~400ms debounce" window — **stale**: `app.js` `dismissCard` (L697) now calls
   `opBridge.pushNow()` (L1747), a synchronous-intent push. The true window is the
   push RTT plus the silently-failed-push case (`opPushQueue` L1699 swallows errors),
   bounded by the 180s snapshot TTL / guard 1.

### What this packet changed

1. **Positional hold adjudication on the elect read-back** (L436–447): the read-back
   the elect already performs now re-runs the hold/skip scan **positionally** — a
   hold/skip serialized into the log *before* the winner's air entry (deeper in the
   newest-first list) wins deterministically: 409 `{stale:true}` from winner and
   loser alike (a loser answering dup would vouch for a publish the winner refuses).
   A hold serialized *after* the winner's entry lost the race — the card airs, then
   holds, consistent on /control (which applies cmds in log order: air → hold no-ops
   or hold → air no-ops match the server's outcome exactly). Append order is now the
   single authority for hold-vs-air, same as it is for air-vs-air. Residual (1) above
   is **closed** — pinned by the forced-interleave test.
2. **Corrected the stale tunable comment** (L104–108) to the pushNow reality.

### Remaining N4 residuals — honest inventory

| # | Window | Verdict |
|---|--------|---------|
| N4-a | Hold-vs-air race for holds that reach the cmd log before the air's append | **CLOSED** (append-order adjudication; deterministic test) |
| N4-b | Hold arriving after the air's cmd append | **NOT A RESIDUAL** — that ordering *is* "aired, then held"; server, /control, and overlay all agree |
| N4-c | **Control-LOCAL dismissal whose push hasn't landed** (RTT) or silently failed (best-effort push): the server never learns of the hold — the snapshot still lists the card pending and no cmd exists to scan. Architecturally invisible server-side; bounded by guard 1 (≤180s) and closable only control-side (confirm/retry the dismiss push). Boundary pinned by test so any future closure flips a deliberate assertion. | **DOCUMENTED-STUCK** (server-side); bounded 180s |

---

## Test coverage added (packet 5a)

`test/op-air-residuals.test.js` — real handler + memory adapter, deterministic via the
new `_setHook` seam (`src/adapters/state/memory-ws/index.js`: entry-point interception
on publish/get/appendLog/readLog only — `merge`/`registerRoom` excluded so their
await-free atomic bodies stay provably atomic; `hook === null` in production is a
no-op):

- N2 forced overlap (both racers past the prior scan before either appends) → one
  publish / one aired row / one marker / one dup.
- N2 publish-failure epoch → self-describing record; in-grace ghost dup pinned as a
  documented residual; post-grace retap heals with a fresh `airedId`.
- N2 aired-log-append failure → overlay/receipts divergence heals to exactly one row.
- N2 marker loss → air still 200s; aired-log fallback dedups the retap forever.
- N4 forced interleave (hold appends while the air is parked pre-append) → 409, no
  publish (this exact interleaving aired a held card before this packet).
- N4-c boundary (dismissal invisible to the server) → air succeeds, by design.
