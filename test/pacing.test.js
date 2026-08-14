// STREET AUTO-AIR UX — on-air pacing queue (display layer). /pacer.js is a classic
// <script> shared by index.html (control's local lower-third) and overlay.html (OBS);
// it has no export statements, so tests import it for the side effect and read
// globalThis.FootnotePacer. Clock + timers are injected, so every timing assertion here
// is deterministic (no real sleeps).
//
// The broadcast invariants under test:
//   · a card on screen holds MIN_DWELL before a queued card may take over;
//   · takeover is exit → gap → entrance — an exit ALWAYS separates consecutive paints
//     (the "never two cards colliding / no flash-replace" assertion);
//   · bursts queue FIFO, bounded, oldest queued dropped beyond the bound (display only);
//   · natural retire promotes the next card immediately (empty stage = nothing to dwell);
//   · clear (pull / stream boundary) flushes queued cards.
import { test } from "node:test";
import assert from "node:assert/strict";

await import("../pacer.js");
const P = globalThis.FootnotePacer;

// ---- deterministic clock + timer wheel -----------------------------------------------
function makeClock() {
  let t = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        t = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      t = end;
    },
  };
}

// pacer + a paint/exit event log with timestamps
function rig(opts = {}) {
  const clock = makeClock();
  const log = [];
  const pacer = P.createPacer({
    render: (card, durationMs, waitedMs) => log.push({ ev: "render", at: clock.now(), card, durationMs, waitedMs }),
    exitStart: () => log.push({ ev: "exit", at: clock.now() }),
    onEvent: (action, d) => log.push({ ev: action, at: clock.now(), card: d.card, queued: d.queued }),
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    ...opts,
  });
  return { clock, log, pacer, renders: () => log.filter((e) => e.ev === "render") };
}

// ---- pure helpers --------------------------------------------------------------------
test("dwellRemaining: empty stage owes nothing; mid-dwell owes the remainder", () => {
  assert.equal(P.dwellRemaining(1000, null, 6000), 0);
  assert.equal(P.dwellRemaining(1000, 1000, 6000), 6000);   // just painted
  assert.equal(P.dwellRemaining(5000, 1000, 6000), 2000);   // 4s in → 2s owed
  assert.equal(P.dwellRemaining(7000, 1000, 6000), 0);      // dwell satisfied
  assert.equal(P.dwellRemaining(99999, 1000, 6000), 0);
});

test("dwellRemaining: a backwards clock owes the full dwell (conservative)", () => {
  assert.equal(P.dwellRemaining(500, 1000, 6000), 6000);
});

test("enqueue: bounded FIFO, drops oldest first, never mutates the input", () => {
  const q0 = ["a", "b"];
  const r1 = P.enqueue(q0, "c", 3);
  assert.deepEqual(r1.queue, ["a", "b", "c"]);
  assert.deepEqual(r1.dropped, []);
  assert.deepEqual(q0, ["a", "b"], "input untouched");
  const r2 = P.enqueue(r1.queue, "d", 3);
  assert.deepEqual(r2.queue, ["b", "c", "d"]);
  assert.deepEqual(r2.dropped, ["a"]);
  // degenerate bound still keeps the newest card
  const r3 = P.enqueue(["x"], "y", 0);
  assert.deepEqual(r3.queue, ["y"]);
  assert.deepEqual(r3.dropped, ["x"]);
});

// ---- state machine -------------------------------------------------------------------
test("single air paints immediately with its duration (no queue ceremony)", () => {
  const { pacer, renders } = rig();
  pacer.air({ id: 1 }, 10000);
  assert.equal(renders().length, 1);
  assert.equal(renders()[0].at, 0);
  assert.equal(renders()[0].durationMs, 10000);
  assert.equal(renders()[0].waitedMs, 0);
  assert.equal(pacer.state().phase, "showing");
});

test("burst of 3: min-dwell spacing, exit precedes every takeover, FIFO order", () => {
  const { clock, log, pacer, renders } = rig();
  pacer.air({ id: 1 }, 10000);
  pacer.air({ id: 2 }, 10000);
  pacer.air({ id: 3 }, 10000);
  clock.advance(30000);
  const r = renders();
  assert.deepEqual(r.map((x) => x.card.id), [1, 2, 3]);
  // card 1 at t0; card 2 after dwell + exit gap; card 3 one full slot later
  assert.equal(r[0].at, 0);
  assert.equal(r[1].at, P.MIN_DWELL_MS + P.EXIT_MS);
  assert.equal(r[2].at, 2 * (P.MIN_DWELL_MS + P.EXIT_MS));
  // waitedMs is the real shelf time each queued card burned
  assert.equal(r[1].waitedMs, P.MIN_DWELL_MS + P.EXIT_MS);
  assert.equal(r[2].waitedMs, 2 * (P.MIN_DWELL_MS + P.EXIT_MS));
  // NO-COLLISION invariant: between any two consecutive renders there is an exit,
  // and it starts EXIT_MS before the later render (the entrance never overlaps the exit)
  for (let i = 1; i < r.length; i++) {
    const exits = log.filter((e) => e.ev === "exit" && e.at > r[i - 1].at && e.at <= r[i].at);
    assert.equal(exits.length, 1, `exactly one exit between render ${i - 1} and ${i}`);
    assert.equal(r[i].at - exits[0].at, P.EXIT_MS);
  }
});

test("air after dwell already satisfied: immediate takeover (exit gap only)", () => {
  const { clock, pacer, renders } = rig();
  pacer.air({ id: 1 }, 10000);
  clock.advance(8000);              // 8s > 6s dwell — card 1 has earned its keep
  pacer.air({ id: 2 }, 10000);
  clock.advance(1000);
  const r = renders();
  assert.equal(r.length, 2);
  assert.equal(r[1].at, 8000 + P.EXIT_MS);
});

test("retire with a queued card presents it immediately (empty stage = no dwell owed)", () => {
  const { clock, pacer, renders } = rig();
  pacer.air({ id: 1 }, 2000);       // short natural window (e.g. overlay resume remainder)
  pacer.air({ id: 2 }, 10000);
  clock.advance(2000);
  pacer.retire();                   // client's countdown ended + faded card 1
  const r = renders();
  assert.equal(r.length, 2);
  assert.equal(r[1].at, 2000);
  // and the dwell timer armed for card 2's slot must not double-fire later
  clock.advance(30000);
  assert.equal(renders().length, 2);
});

test("retire on an empty stage is a no-op (clear/pull paths reach it at phase idle)", () => {
  const { clock, pacer, renders } = rig();
  pacer.retire();
  pacer.air({ id: 1 }, 10000);
  clock.advance(10000);
  pacer.retire();
  pacer.retire();
  assert.equal(renders().length, 1);
  assert.equal(pacer.state().phase, "idle");
});

test("clear flushes queued cards — nothing paints after a pull", () => {
  const { clock, pacer, renders } = rig();
  pacer.air({ id: 1 }, 10000);
  pacer.air({ id: 2 }, 10000);
  pacer.air({ id: 3 }, 10000);
  pacer.clear();
  clock.advance(60000);
  assert.equal(renders().length, 1, "only the pre-pull card ever painted");
  assert.equal(pacer.state().phase, "idle");
  assert.equal(pacer.state().queued, 0);
});

test("clear during the exit gap cancels the armed present", () => {
  const { clock, pacer, renders } = rig();
  pacer.air({ id: 1 }, 10000);
  pacer.air({ id: 2 }, 10000);
  clock.advance(P.MIN_DWELL_MS + 100);   // exit started at 6000; present armed for 6260
  pacer.clear();
  clock.advance(60000);
  assert.equal(renders().length, 1);
});

test("queue bound: oldest queued drops (display only), newest survive, drop event fires", () => {
  const { clock, log, pacer, renders } = rig({ maxQueue: 2 });
  pacer.air({ id: 1 }, 10000);
  pacer.air({ id: 2 }, 10000);
  pacer.air({ id: 3 }, 10000);
  pacer.air({ id: 4 }, 10000);      // bound 2 → card 2 (oldest queued, never shown) drops
  const drops = log.filter((e) => e.ev === "drop");
  assert.equal(drops.length, 1);
  assert.equal(drops[0].card.id, 2);
  clock.advance(60000);
  assert.deepEqual(renders().map((x) => x.card.id), [1, 3, 4]);
});

test("hold card (durationMs null) still yields after dwell when a card queues behind it", () => {
  const { clock, pacer, renders } = rig();
  pacer.air({ id: 1 }, null);       // hold: stays until pulled…
  pacer.air({ id: 2 }, 10000);      // …unless a consecutive air queues — dwell still paces it
  clock.advance(10000);
  const r = renders();
  assert.equal(r.length, 2);
  assert.equal(r[0].durationMs, null);
  assert.equal(r[1].at, P.MIN_DWELL_MS + P.EXIT_MS);
});

test("defaults are the broadcast tunables (6s dwell / 260ms exit / bound 8)", () => {
  assert.equal(P.MIN_DWELL_MS, 6000);
  assert.equal(P.EXIT_MS, 260);
  assert.equal(P.MAX_QUEUE, 8);
});

// ---- wiring guard: both display surfaces load the pacer before their app script -------
test("index.html and overlay.html load pacer.js before the page script", async () => {
  const { readFileSync } = await import("node:fs");
  for (const [page, appScript] of [["index.html", "app.js"], ["overlay.html", "overlay.js"]]) {
    const html = readFileSync(new URL("../" + page, import.meta.url), "utf8");
    const pacerAt = html.search(/<script src="\/?pacer\.js"><\/script>/);
    const appAt = html.indexOf(appScript);
    assert.ok(pacerAt >= 0, `${page} loads pacer.js`);
    assert.ok(pacerAt < appAt, `${page}: pacer.js precedes ${appScript}`);
  }
});
