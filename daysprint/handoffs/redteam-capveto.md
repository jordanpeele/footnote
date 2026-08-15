# NIGHTSPRINT R-cap/veto — Red-team the auto-air path races (window architecture)

**Branch:** `worktree-agent-a7692025b2bd26eb8`
**Scope:** the auto-air gate under the NEW rolling-window ingestion (`windowExtract → checkUtterance → maybeAutoAir`), which produces more overlapping extracts and therefore more concurrency at the gate.
**Test:** `test/autoair-capveto-races.test.js` (10 tests, all passing). Each race gets (1) a **source-scan pin** on the exact app.js line its safety depends on — a tripwire that fails if a future edit removes the guard — and (2) a **deterministic fake-clock model** that ports the arm/fire/veto/gen state machine verbatim from those lines and drives the adversarial interleaving.

**Bottom line: all four races are CLOSED.** No GREEN-class bug was found to fix. Nothing needed to be parked RED — no fix touches `AUTO_AIR_CAP` or gate constants, because no fix was needed. The tests are the deliverable: they pin the closure so a regression that reopens any race trips CI.

Note on repo state: the prompt referenced `test/op-air-residuals.test.js`, `test/pacing.test.js`, `docs/redteam/N2N4-RESIDUALS.md`, and a "packet 5a air-landed marker" — none exist in this worktree. This worktree predates them. The N2/N4 server-side residuals are covered by the existing `test/op-cmd.test.js` (append-then-elect + stale-snapshot 409). The four races in the prompt are all client-side (app.js `maybeAutoAir`/`dismissCard`/`checkUtterance`) and are addressed directly.

---

## RACE 1 — Cap race — **CLOSED**  (severity if real: HIGH — cap breach, a D-constant)

**Attack:** the window fires multiple extracts fast; each eligible card arms a 4s veto timer. `autoAirCount` increments at **FIRE** (app.js L761), not at **ARM**. So N > `AUTO_AIR_CAP` timers can be armed simultaneously while the count is still below the cap. If they all fire, that's `N` auto-airs — a cap breach.

**Why it's closed:** the fire callback re-checks the cap *at fire time* before incrementing:
```js
// app.js L760-761
c._auto = setTimeout(() => { if (streaming && c._gen === gen && c.state === "pending" && autoAirCount < AUTO_AIR_CAP) {
  autoAirCount++; c._autoAired = true; ...
```
JS is single-threaded with run-to-completion: armed timers fire in order, each callback runs `autoAirCount++` **atomically** before the next callback runs (no `await` between the check and the increment). Once the count reaches the cap, every remaining callback sees `autoAirCount < AUTO_AIR_CAP` as false and no-ops. The arm-time check at L754 is only an optimization; the fire-time re-check is load-bearing.

**Proof (`RACE1`):** arm `AUTO_AIR_CAP + 5` (15) eligible cards in the same tick — all 15 timers armed, count still 0 — then advance the clock 4s so all come due. Result: **exactly 10 air**, count settles at 10, the surplus 5 stay `pending` (manual). Deliberate D18 semantic confirmed: vetoed cards do NOT consume the cap (count is a FIRE counter).

**RED boundary respected:** the fix that *would* be tempting — moving the increment to arm time — changes `AUTO_AIR_CAP` accounting semantics (D18: "vetoed cards don't consume the cap"). That is RED. It is also unnecessary, because the fire-time re-check already holds the invariant. No change made.

---

## RACE 2 — Veto race (TOCTOU) — **CLOSED**  (severity if real: HIGH — un-air / double-outcome)

**Attack:** can a card fire in the same tick the operator vetoes? Is there a TOCTOU between the veto clearing `c._auto` and the timer callback checking `c.state`?

**Why it's closed:** two layers.
1. `dismissCard` (app.js L690) clears the timer and flips `c.state` synchronously; a not-yet-due timer is cleared and never runs. A fired timer and a click handler cannot interleave mid-statement (run-to-completion).
2. `dismissCard` itself does **not** re-check state — it flips `c.state = action` unconditionally. The "can't un-air a fired card" protection lives in the **callers**:
   - the local UI never renders a SKIP/HOLD button on an aired card (`cardEl` L620-622 swaps the action buttons for the AIRED chip), and
   - the remote `op:cmd` branch guards `c.state !== "pending"` **before** calling `dismissCard` (L1718; matching air-branch guard L1708).

   This is a real, findable subtlety: my first model called `dismissCard` without the caller precondition and it flipped an aired card back to `skipped` (a local un-air). That interleaving is **structurally unreachable** in the real code because neither call site will invoke it on a non-pending card. The test now pins BOTH `op:cmd` guards.

**Proof (`RACE2`, three tests):**
- veto at t=2s (mid-window): timer cleared, card `skipped`, nothing airs, `veto=true` recorded, cap untouched.
- Order A (fire then late remote skip): card is `aired`; the op:cmd caller guard drops the skip (`applied=false`), no un-air, no spurious veto.
- Order B (skip at the exact due tick): `clearTimeout` wins, the cleared timer never fires.

**GREEN-class note (display, not a bug):** if the op:cmd caller guards at L1708/L1718 were ever removed, a late remote skip *would* locally flip an aired card's state and mis-record it. The pin test is the tripwire. No change needed today — the guards are present.

---

## RACE 3 — Double-air under overlapping windows — **CLOSED**  (severity if real: MEDIUM — duplicate on-air)

**Attack:** two overlapping windows extract the same claim; do both reach `maybeAutoAir` before the F2 dedupe registers?

**Why it's closed:** F2 dedupe checks `recentClaims` (app.js L516) and registers the normalized claim (L531) with **no `await` between the two lines**. Within one `checkUtterance` invocation the check→register region is synchronous/atomic. Two concurrent `checkUtterance` calls each `await`-resolve their `/api/extract` independently; whichever runs the synchronous L515-533 block **second** sees the first call's registered claim and takes the `duplicate_claim` branch (L516-523). The only interleaving that would defeat this is an `await` sitting between the check and the register — which does not exist.

**Proof (`RACE3`, two tests):**
- Source-scan pin: extract the app.js slice from the F2 check to `recentClaims.set` and assert no `await` on the non-dup path.
- Model: run the ported sync card-region for the same normalized claim twice back-to-back (the overlapping-window case) — first `carded`, second `deduped`, exactly one card created.

Consistent with the S2 `--real` observation that a single-window dedupe already collapses per-final + join extractions of the same claim into one card; the adversarial two-window version collapses for the same structural reason.

---

## RACE 4 — Stale-generation (End Stream mid-window → Start Stream) — **CLOSED**  (severity if real: HIGH — stale air into a new broadcast)

**Attack:** End Stream during the 4s veto window bumps `gen` and makes `streaming` briefly false; Start Stream sets `streaming` true again for the WRONG stream (the exact H2 lineage setup). Does a stale timer fire into the new session?

**Why it's closed:** double protection.
1. `endStream → clearFactChecks` clears every card's `_auto` timer (app.js L770: `fcCards.forEach((c) => c._auto && clearTimeout(c._auto))`).
2. Even if a timer somehow survived, the fire callback guards `c._gen === gen` (L760). The card was armed at the old gen; after the bump it can never satisfy the guard. Start Stream also resets `autoAirCount = 0`, but the stale timer can't touch it.

**Proof (`RACE4`, three tests):**
- Source-scan pin: `c._gen === gen` in the callback AND the `clearFactChecks` clear-loop both present.
- Gen guard alone (belt off): arm at gen 1, tick 2s, bump `gen=2`, End then Start (`streaming` true, count reset), tick past the due time — **nothing airs**, card stays `pending`, new session's cap untouched.
- clearFactChecks (belt on): clearing the timer also prevents the fire.

---

## Summary table

| Race | Status | Guard that closes it | Severity if reopened |
|------|--------|----------------------|----------------------|
| 1 — Cap | CLOSED | fire-time `autoAirCount < AUTO_AIR_CAP` re-check (L760) | HIGH (cap breach, D-constant) |
| 2 — Veto TOCTOU | CLOSED | `clearTimeout` + caller `state!=="pending"` guards (L690, L1708/L1718) | HIGH (un-air/double-outcome) |
| 3 — Double-air | CLOSED | F2 check→register atomic, no await (L516→L531) | MEDIUM (duplicate on-air) |
| 4 — Stale-gen | CLOSED | gen guard (L760) + clearFactChecks clear (L770) | HIGH (stale air into new session) |

**Parked RED:** none. No fix was required; the only fix that *would* touch a gate constant (moving the cap increment to arm time) is both RED and unnecessary.

**Deliverable:** `test/autoair-capveto-races.test.js` — 10 tests, part of `npm test` (255 total, 253 pass, 2 pre-existing skips, 0 fail).
