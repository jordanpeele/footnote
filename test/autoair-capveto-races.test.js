// NIGHTSPRINT R-cap/veto — red-team the auto-air path races under the NEW window
// architecture (windowExtract -> checkUtterance -> maybeAutoAir; more overlapping extracts
// => more concurrency at the gate). app.js is a classic script (no modules), so — as with
// pilot-category.test.js and the conf-floor mirror — the gate logic can't be imported. This
// file does two things per race:
//   (1) a SOURCE-SCAN pin on the exact app.js line the race's safety depends on, so any
//       drift in the real gate fails the test (tripwire, same pattern as the R57 mirror), and
//   (2) a DETERMINISTIC clock-driven MODEL that ports the arm/fire/veto/gen state machine
//       verbatim from those pinned lines, then drives the adversarial interleaving and
//       asserts the invariant holds (or fails, if the race were real).
//
// Findings (see daysprint/handoffs/redteam-capveto.md): all four races are CLOSED by
// existing guards. These tests pin that closure so a future edit that reopens one trips CI.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../app.js", import.meta.url), "utf8");

/* ------------------------------------------------------------------ *
 * Deterministic fake clock + a faithful port of maybeAutoAir's timer.
 *
 * The single-threaded JS run-to-completion guarantee is the whole ballgame for races 1/2/4:
 * a fired setTimeout callback and a click handler CANNOT interleave mid-statement. The model
 * below preserves that — callbacks and operator acts run atomically, ordered by fire time —
 * so if the real code's ordering were unsafe, the model would expose it.
 * ------------------------------------------------------------------ */
function makeWorld() {
  const w = {
    now: 0,
    timers: [],            // { at, fn, id, cleared }
    nextTimerId: 1,
    streaming: true,
    gen: 1,
    AUTO_AIR_CAP: 10,      // app.js L1254 (pinned below)
    autoAirCount: 0,       // counted at FIRE, reset on Start Stream (app.js L1251-1255)
    aired: [],             // ids that reached airCard via the auto path
  };
  w.setTimeout = (fn, ms) => { const id = w.nextTimerId++; w.timers.push({ at: w.now + ms, fn, id, cleared: false }); return id; };
  w.clearTimeout = (id) => { const t = w.timers.find((x) => x.id === id); if (t) t.cleared = true; };
  // advance the clock, firing due timers in fire-time order, each RUN TO COMPLETION before the next
  w.tick = (ms) => {
    const target = w.now + ms;
    for (;;) {
      const due = w.timers.filter((t) => !t.cleared && t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      due.cleared = true; w.now = due.at; due.fn();
    }
    w.now = target;
  };
  return w;
}

// airCard (app.js L703-712) for the auto path: clears the pending timer, flips state to aired.
// Synchronous through the state flip — no await before the next queued timer can run.
function airCard(w, c) { if (c._auto) w.clearTimeout(c._auto); c.state = "aired"; c._autoAired = true; w.aired.push(c.id); }

// maybeAutoAir's arm+fire, ported verbatim from app.js L754-766. Pre-gate harm/category/conf
// checks are elided (they gate WHICH cards reach here, not the cap/veto/gen races); every card
// passed in is already gate-eligible, which is the adversarial worst case (max concurrency).
function armAutoAir(w, c) {
  if (w.autoAirCount >= w.AUTO_AIR_CAP) return;            // app.js L754: ARM-time cap check (guard, no increment)
  c._armT = w.now;
  c._auto = w.setTimeout(() => {
    // app.js L760: the FIRE-time re-check — streaming && gen-match && still pending && UNDER CAP
    if (w.streaming && c._gen === w.gen && c.state === "pending" && w.autoAirCount < w.AUTO_AIR_CAP) {
      w.autoAirCount++;                                     // app.js L761: increment AT FIRE
      airCard(w, c);
    }
  }, 4000);
}

// dismissCard's veto path, ported from app.js L687-692: clear the timer, flip state.
// dismissCard ITSELF does not re-check state — the "un-air" protection lives in the CALLERS:
//   · the local UI never renders a SKIP/HOLD button on an aired card (cardEl L620-622), and
//   · the remote op:cmd branch guards `c.state !== "pending"` before calling in (L1718).
// dismissRequest models a real call site: it enforces that precondition, the way both do.
function dismissCard(w, c, action) {
  const veto = !!c._auto && c.state === "pending";
  if (c._auto) { w.clearTimeout(c._auto); c._auto = null; }
  c.state = action;
  return veto;
}
function dismissRequest(w, c, action) {
  if (!c || c.state !== "pending") return { applied: false, veto: false };   // app.js L1718 caller guard
  return { applied: true, veto: dismissCard(w, c, action) };
}

function mkCard(w, id) { return { id, _gen: w.gen, state: "pending", _auto: null, _autoAired: false }; }

/* ================================================================== *
 * RACE 1 — CAP RACE
 * "the window firing multiple extracts fast can ARM more than AUTO_AIR_CAP timers before
 *  autoAirCount catches up (count increments at FIRE, not ARM)."
 * Closed by the FIRE-time re-check `autoAirCount < AUTO_AIR_CAP` (app.js L760): armed timers
 * fire in order on the single thread; each increments before the next runs, so the (cap+1)th
 * callback sees the count at cap and no-ops. N>cap timers armed simultaneously => exactly cap fire.
 * ================================================================== */
test("RACE1 pin: fire-time callback re-checks the cap before incrementing (app.js L760)", () => {
  assert.match(
    APP,
    /setTimeout\(\(\) => \{ if \(streaming && c\._gen === gen && c\.state === "pending" && autoAirCount < AUTO_AIR_CAP\)/,
    "maybeAutoAir's timer must re-check `autoAirCount < AUTO_AIR_CAP` at FIRE — removing it reopens the cap race",
  );
  assert.match(APP, /if \(autoAirCount >= AUTO_AIR_CAP\) \{/, "arm-time cap guard must exist (app.js L754)");
});

test("RACE1: arming CAP+5 eligible cards in the same tick fires EXACTLY the cap (no breach)", () => {
  const w = makeWorld();
  const N = w.AUTO_AIR_CAP + 5;   // 15 cards, all eligible, all arm before any fires
  const cards = [];
  for (let i = 0; i < N; i++) { const c = mkCard(w, i + 1); cards.push(c); armAutoAir(w, c); }
  // all N timers are armed simultaneously — count is still 0 (increment is at FIRE)
  assert.equal(w.autoAirCount, 0, "count must NOT increment at arm time (vetoed cards don't consume the cap)");
  const armed = w.timers.filter((t) => !t.cleared).length;
  assert.equal(armed, N, "all CAP+5 timers armed before any fired — the adversarial worst case");
  w.tick(4000);   // every armed timer comes due in the same advance
  assert.equal(w.aired.length, w.AUTO_AIR_CAP, `exactly ${w.AUTO_AIR_CAP} cards may auto-air`);
  assert.equal(w.autoAirCount, w.AUTO_AIR_CAP, "count settles at the cap, never above");
  // the surplus cards stayed pending — the cap held, they become manual
  assert.equal(cards.filter((c) => c.state === "pending").length, 5, "surplus cards remain manual (pending)");
});

/* ================================================================== *
 * RACE 2 — VETO RACE (TOCTOU between veto clearing the timer and the callback checking state)
 * "can a card fire in the same tick the operator vetoes?"
 * Closed by single-threaded run-to-completion + clearTimeout ordering: dismissCard clears the
 * timer AND flips state atomically; a not-yet-fired timer is cleared and never runs; an
 * already-fired timer means the card is already aired (dismiss sees state!=="pending", records
 * no veto). There is no interleaving where BOTH air and veto register for one card.
 * ================================================================== */
test("RACE2 pin: dismiss clears the timer, the callback guards state===pending, and op:cmd guards the caller (app.js L690,L760,L1708/L1718)", () => {
  assert.match(APP, /if \(c\._auto\) \{ clearTimeout\(c\._auto\); c\._auto = null; \}/, "dismiss must clearTimeout the armed veto timer");
  assert.match(APP, /c\.state === "pending" && autoAirCount < AUTO_AIR_CAP/, "the fire callback must require state===pending");
  // the "can't un-air a fired card" protection lives in the op:cmd callers — both air and
  // skip/hold refuse anything not still pending. Removing these reopens the late-veto un-air.
  const airGuard = /cmd\.action === "air"\) \{\s*if \(!c \|\| c\.state !== "pending"\) return;/;
  const dismissGuard = /cmd\.action === "skip" \|\| cmd\.action === "hold"\) \{\s*if \(!c \|\| c\.state !== "pending"\) return;/;
  assert.match(APP, airGuard, "op:cmd air must guard c.state===pending (idempotent, can't un-actioned)");
  assert.match(APP, dismissGuard, "op:cmd skip/hold must guard c.state===pending before dismissCard (can't un-air a fired card)");
});

test("RACE2: operator veto BEFORE the timer is due — card never airs, veto recorded", () => {
  const w = makeWorld();
  const c = mkCard(w, 1); armAutoAir(w, c);
  w.tick(2000);                                   // 2s into the 4s window
  const r = dismissRequest(w, c, "skipped");      // operator SKIPs (via a real call site)
  w.tick(5000);                                   // let the (now-cleared) timer's due time pass
  assert.equal(r.applied && r.veto, true, "a live-timer dismissal records a veto");
  assert.equal(c.state, "skipped", "card is skipped, not aired");
  assert.equal(w.aired.length, 0, "the timer must not fire after clearTimeout");
  assert.equal(w.autoAirCount, 0, "a vetoed card does NOT consume the cap (D18 semantics)");
});

test("RACE2: the fire and the veto cannot BOTH register (no double-outcome, either order)", () => {
  // Order A: timer fires first (4s), then a remote op:cmd skip lands on the already-aired card.
  // The caller guard (c.state!=="pending") makes it a no-op — the fired air stands, no un-air.
  {
    const w = makeWorld();
    const c = mkCard(w, 1); armAutoAir(w, c);
    w.tick(4000);                                 // timer fires -> aired
    const r = dismissRequest(w, c, "skipped");    // too late — caller refuses a non-pending card
    assert.equal(c.state, "aired", "already aired; late skip is refused, cannot un-air");
    assert.equal(r.applied, false, "the op:cmd caller guard drops the late skip");
    assert.equal(r.veto, false, "no veto recorded — the window had already closed by firing");
    assert.equal(w.aired.length, 1);
  }
  // Order B: operator skips at the exact due tick — clearTimeout wins, callback never runs.
  {
    const w = makeWorld();
    const c = mkCard(w, 1); armAutoAir(w, c);
    // the click handler runs first, clears the timer; the cleared timer is then skipped by the clock.
    const r = dismissRequest(w, c, "held");
    w.tick(4000);
    assert.equal(r.applied && r.veto, true);
    assert.equal(c.state, "held");
    assert.equal(w.aired.length, 0, "cleared timer at the boundary does not fire");
  }
});

/* ================================================================== *
 * RACE 3 — DOUBLE-AIR UNDER THE WINDOW (two overlapping windows extract the same claim)
 * F2 dedupe (app.js L516 check, L531 register) must collapse them. The check-then-register is
 * SYNCHRONOUS — no `await` between L516 and L531 — so within one checkUtterance it is atomic.
 * Two concurrent checkUtterance calls each `await`-resolve their /api/extract independently;
 * whichever runs the synchronous L515-L533 block second sees the first's registered claim and
 * is deduped. The gap that WOULD be exploitable (an await between check and register) does not
 * exist. This test pins the ordering AND models the concurrent interleaving.
 * ================================================================== */
test("RACE3 pin: F2 dedupe registers the claim with NO await between check and set (app.js L516->L531)", () => {
  // extract the checkUtterance body from the dup-window check to the recentClaims.set
  const check = APP.indexOf('if (!opts.force && withinDupWindow(recentClaims.get(normClaim)');
  const set = APP.indexOf('recentClaims.set(normClaim, Date.now());');
  assert.ok(check > 0 && set > check, "F2 check and register lines must both exist, in order");
  const between = APP.slice(check, set);
  // the dup branch returns; on the NON-dup path there must be no `await` before registration,
  // otherwise a second concurrent extract could slip past the check before the first registers.
  const afterDupReturn = between.slice(between.indexOf("return;") + 1);
  assert.ok(!/\bawait\b/.test(afterDupReturn),
    "no `await` may sit between the F2 dup check and recentClaims.set — that gap would reopen double-air");
});

test("RACE3: two concurrent same-claim extracts collapse to ONE card (second is deduped)", () => {
  // Model checkUtterance's F2 window: check recentClaims, and on the non-dup path register
  // synchronously. Both calls have already awaited extract; they run the sync block in some order.
  const recentClaims = new Map();
  const DUP_MS = 15000;
  const within = (at, now) => at != null && now - at < DUP_MS;
  const cards = [];
  // faithful port of app.js L515-L533 (sync region), for a fixed normalized claim
  function syncCardRegion(norm, now) {
    if (within(recentClaims.get(norm), now)) return "deduped";   // L516
    recentClaims.set(norm, now);                                  // L531
    cards.push(norm);                                             // L533 fcCards.unshift
    return "carded";
  }
  const norm = "the vaccine is 95% effective";
  // adversarial: both windows' extracts resolve at the same instant; run the sync regions back-to-back
  const r1 = syncCardRegion(norm, 1000);
  const r2 = syncCardRegion(norm, 1000);   // same tick, same claim — the overlapping-window case
  assert.equal(r1, "carded");
  assert.equal(r2, "deduped", "the second overlapping-window extract of the same claim must dedupe");
  assert.equal(cards.length, 1, "exactly one card reaches maybeAutoAir — no double-air");
});

/* ================================================================== *
 * RACE 4 — STALE-GENERATION (End Stream mid-veto-window, then Start Stream)
 * "does a stale timer fire into the new session?" H2 lineage. Closed TWICE over:
 *   (a) endStream -> clearFactChecks clears every card's _auto (app.js L770), and
 *   (b) the fire callback guards `c._gen === gen` (app.js L760) — even a timer that somehow
 *       survived belongs to the OLD gen and no-ops. Start Stream also resets autoAirCount.
 * We test the guard directly (belt) AND the fact that a surviving timer under a bumped gen is inert.
 * ================================================================== */
test("RACE4 pin: fire callback is gen-guarded and clearFactChecks clears armed timers (app.js L760,L770)", () => {
  assert.match(APP, /c\._gen === gen/, "the auto-air fire callback must be generation-guarded (H2 closure)");
  assert.match(APP, /fcCards\.forEach\(\(c\) => c\._auto && clearTimeout\(c\._auto\)\);/, "clearFactChecks must clear every armed veto timer");
});

test("RACE4: a timer armed in the old session does NOT fire into the new one (gen guard)", () => {
  const w = makeWorld();
  const c = mkCard(w, 1); armAutoAir(w, c);        // armed at gen 1
  w.tick(2000);                                    // 2s into the veto window
  // End Stream: gen bumps, streaming false. (In app.js clearFactChecks ALSO clears the timer;
  // here we deliberately DON'T clear it, to prove the gen guard alone is sufficient — belt.)
  w.gen = 2; w.streaming = false;
  // Start Stream: streaming true again for the WRONG stream, count reset (the exact H2 setup)
  w.streaming = true; w.autoAirCount = 0;
  w.tick(5000);                                    // the stale timer comes due inside the new session
  assert.equal(w.aired.length, 0, "the stale timer must NOT air into the new session");
  assert.equal(c.state, "pending", "the dead card never aired");
  assert.equal(w.autoAirCount, 0, "the new session's cap is untouched by a stale fire");
});

test("RACE4: clearFactChecks (the belt) also prevents the stale fire", () => {
  const w = makeWorld();
  const c = mkCard(w, 1); armAutoAir(w, c);
  w.tick(2000);
  // endStream path: clear the armed timer (app.js L770) then bump gen
  if (c._auto) { w.clearTimeout(c._auto); }
  w.gen = 2; w.streaming = true; w.autoAirCount = 0;
  w.tick(5000);
  assert.equal(w.aired.length, 0, "cleared timer never fires");
});
