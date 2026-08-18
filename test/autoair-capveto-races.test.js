// NIGHTSPRINT R-cap/veto — red-team the auto-air path races under the NEW window
// architecture (windowExtract -> checkUtterance -> maybeAutoAir; more overlapping extracts
// => more concurrency at the gate). app.js is a classic script (no modules), so the gate
// logic can't be imported. This file does two things per race:
//   (1) a SOURCE-SCAN pin on the exact app.js line the race's safety depends on, so any
//       drift in the real gate fails the test (tripwire), and
//   (2) a DETERMINISTIC clock-driven MODEL that ports the arm/fire/veto/gen state machine
//       verbatim from those pinned lines, then drives the adversarial interleaving and
//       asserts the invariant holds (or fails, if the race were real).
//
// R72 (2026-08-18 operator ruling): the D18 session cap is GONE — with the toggle on, every
// settled card arms. The original RACE 1 (cap race) is therefore moot and removed; its
// replacement pins that the fire-time guard chain (streaming/gen/pending) survived the
// cap's removal. RACE 2 (veto), RACE 3 (double-air), and RACE 4 (stale generation) are
// unchanged in substance — under R72 they are MORE load-bearing, not less, since the veto
// window and the toggle are now the only control points.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../app.js", import.meta.url), "utf8");

/* ------------------------------------------------------------------ *
 * Deterministic fake clock + a faithful port of maybeAutoAir's timer.
 *
 * The single-threaded JS run-to-completion guarantee is the whole ballgame for races 2/4:
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
    autoAirCount: 0,       // counted at FIRE, reset on Start Stream — informational under R72 (no cap)
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

// airCard for the auto path: clears the pending timer, flips state to aired.
// Synchronous through the state flip — no await before the next queued timer can run.
function airCard(w, c) { if (c._auto) w.clearTimeout(c._auto); c.state = "aired"; c._autoAired = true; w.aired.push(c.id); }

// maybeAutoAir's arm+fire, ported verbatim from app.js (R72 form: no pre-gates, no cap —
// the toggle is checked before arming; every armed card fires unless vetoed/stale).
function armAutoAir(w, c) {
  c._armT = w.now;
  c._auto = w.setTimeout(() => {
    // the FIRE-time re-check — streaming && gen-match && still pending
    if (w.streaming && c._gen === w.gen && c.state === "pending") {
      w.autoAirCount++;                                     // increment AT FIRE (informational)
      airCard(w, c);
    }
  }, 4000);
}

// dismissCard's veto path: clear the timer, flip state.
// dismissCard ITSELF does not re-check state — the "un-air" protection lives in the CALLERS:
//   · the local UI never renders a SKIP/HOLD button on an aired card (cardEl), and
//   · the remote op:cmd branch guards `c.state !== "pending"` before calling in.
// dismissRequest models a real call site: it enforces that precondition, the way both do.
function dismissCard(w, c, action) {
  const veto = !!c._auto && c.state === "pending";
  if (c._auto) { w.clearTimeout(c._auto); c._auto = null; }
  c.state = action;
  return veto;
}
function dismissRequest(w, c, action) {
  if (!c || c.state !== "pending") return { applied: false, veto: false };   // op:cmd caller guard
  return { applied: true, veto: dismissCard(w, c, action) };
}

function mkCard(w, id) { return { id, _gen: w.gen, state: "pending", _auto: null, _autoAired: false }; }

/* ================================================================== *
 * R72 GUARD PIN (replaces the retired cap race)
 * The cap's removal must NOT have taken the fire-time guard chain with it: the timer
 * callback still requires streaming && current-gen && still-pending before airing.
 * ================================================================== */
test("R72 pin: fire-time callback keeps the streaming/gen/pending guard chain (cap removed, guards intact)", () => {
  assert.match(
    APP,
    /setTimeout\(\(\) => \{ if \(streaming && c\._gen === gen && c\.state === "pending"\)/,
    "maybeAutoAir's timer must re-check streaming/gen/pending at FIRE — removing any reopens the veto/stale races",
  );
  assert.doesNotMatch(APP, /AUTO_AIR_CAP/, "R72: the session cap is gone — a cap reference reappearing means the ruling was partially reverted");
});

test("R72: arming N cards in the same tick fires ALL N (no cap — the toggle is the gate)", () => {
  const w = makeWorld();
  const N = 15;
  const cards = [];
  for (let i = 0; i < N; i++) { const c = mkCard(w, i + 1); cards.push(c); armAutoAir(w, c); }
  assert.equal(w.autoAirCount, 0, "count must NOT increment at arm time (vetoed cards don't count)");
  w.tick(4000);   // every armed timer comes due in the same advance
  assert.equal(w.aired.length, N, "every armed card airs — R72 has no session cap");
  assert.equal(w.autoAirCount, N, "the informational count reflects every machine air");
});

/* ================================================================== *
 * RACE 2 — VETO RACE (TOCTOU between veto clearing the timer and the callback checking state)
 * "can a card fire in the same tick the operator vetoes?"
 * Closed by single-threaded run-to-completion + clearTimeout ordering: dismissCard clears the
 * timer AND flips state atomically; a not-yet-fired timer is cleared and never runs; an
 * already-fired timer means the card is already aired (dismiss sees state!=="pending", records
 * no veto). There is no interleaving where BOTH air and veto register for one card.
 * ================================================================== */
test("RACE2 pin: dismiss clears the timer, the callback guards state===pending, and op:cmd guards the caller", () => {
  assert.match(APP, /if \(c\._auto\) \{ clearTimeout\(c\._auto\); c\._auto = null; \}/, "dismiss must clearTimeout the armed veto timer");
  assert.match(APP, /c\._gen === gen && c\.state === "pending"/, "the fire callback must require state===pending");
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
  assert.equal(w.autoAirCount, 0, "a vetoed card does NOT count as a machine air");
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
 * F2 dedupe (checkUtterance) must collapse them. The check-then-register is SYNCHRONOUS —
 * no `await` between the dup check and recentClaims.set — so within one checkUtterance it is
 * atomic. Two concurrent checkUtterance calls each `await`-resolve their /api/extract
 * independently; whichever runs the synchronous block second sees the first's registered
 * claim and is deduped. The gap that WOULD be exploitable (an await between check and
 * register) does not exist. This test pins the ordering AND models the concurrent interleaving.
 * ================================================================== */
test("RACE3 pin: F2 dedupe registers the claim with NO await between check and set", () => {
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
  // faithful port of the sync region, for a fixed normalized claim
  function syncCardRegion(norm, now) {
    if (within(recentClaims.get(norm), now)) return "deduped";
    recentClaims.set(norm, now);
    cards.push(norm);                                             // fcCards.unshift
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
 *   (a) endStream -> clearFactChecks clears every card's _auto, and
 *   (b) the fire callback guards `c._gen === gen` — even a timer that somehow
 *       survived belongs to the OLD gen and no-ops. Start Stream also resets autoAirCount.
 * We test the guard directly (belt) AND the fact that a surviving timer under a bumped gen is inert.
 * ================================================================== */
test("RACE4 pin: fire callback is gen-guarded and clearFactChecks clears armed timers", () => {
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
  assert.equal(w.autoAirCount, 0, "the new session's count is untouched by a stale fire");
});

test("RACE4: clearFactChecks (the belt) also prevents the stale fire", () => {
  const w = makeWorld();
  const c = mkCard(w, 1); armAutoAir(w, c);
  w.tick(2000);
  // endStream path: clear the armed timer then bump gen
  if (c._auto) { w.clearTimeout(c._auto); }
  w.gen = 2; w.streaming = true; w.autoAirCount = 0;
  w.tick(5000);
  assert.equal(w.aired.length, 0, "cleared timer never fires");
});
