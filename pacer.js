/* Footnote on-air pacer — DISPLAY-LAYER choreography for consecutive airs (street
   auto-air UX). Problem: a new air used to replace the current lower-third mid-display —
   a flash-replace that reads as a glitch on a program feed. The pacer sits between
   "a card was aired" (decision layer — operator AIR, auto-air, TESTAIR, second-phone AIR:
   all identical here; this file never sees WHY a card airs) and "the card is painted":
     · a card on screen holds MIN_DWELL_MS before the next queued card may take over;
     · takeover is exit-animation → EXIT_MS gap → entrance — never two cards at once;
     · a burst queues FIFO; the queue is bounded (MAX_QUEUE) so the display can't drift
       unboundedly behind live — beyond the bound the OLDEST queued (never-shown) card is
       dropped from DISPLAY only (session log / receipts are upstream and unaffected);
     · a card's own countdown ending early (retire) promotes the next card immediately —
       the screen is empty, there is nothing left to dwell.
   Decision logic (eligibility, gates, caps, veto timing) lives elsewhere and is never
   consulted here.

   Loaded as a classic <script> by index.html + overlay.html (globalThis.FootnotePacer).
   The same file is ESM-importable for tests: no export statements — import for the side
   effect, read globalThis. Clock and timers are injectable for deterministic tests. */
(() => {
  // TUNABLE — minimum on-screen dwell before a queued card may take over
  // (6s of the 10s DEFAULT_HOLD_MS: enough to read verdict + claim + correction).
  const MIN_DWELL_MS = 6000;
  // TUNABLE — exit-animation gap between consecutive cards (covers the ~200-240ms CSS
  // fade-down in app.css/overlay.css with a small cushion).
  const EXIT_MS = 260;
  // TUNABLE — pacing-queue bound: depth 8 ≈ worst case ~48s behind live at min dwell,
  // and comfortably holds the largest burst the D18 session cap (10) can produce minus
  // the card on screen and the one entering.
  const MAX_QUEUE = 8;

  /**
   * Ms of dwell still owed before the current card may be replaced.
   * @param {number} nowMs
   * @param {number|null} shownAtMs when the current card painted (null → nothing showing)
   * @param {number} minDwellMs
   * @returns {number} 0 when takeover is allowed now
   */
  function dwellRemaining(nowMs, shownAtMs, minDwellMs) {
    if (shownAtMs == null) return 0;
    const elapsed = nowMs - shownAtMs;
    if (!(elapsed >= 0)) return minDwellMs;   // clock went backwards — owe the full dwell (conservative)
    return Math.max(0, minDwellMs - elapsed);
  }

  /**
   * Pure bounded-FIFO append: returns the new queue plus whatever was dropped (oldest
   * first) to respect maxQueue. Never mutates the input queue.
   * @template T
   * @param {T[]} queue
   * @param {T} item
   * @param {number} maxQueue
   * @returns {{queue: T[], dropped: T[]}}
   */
  function enqueue(queue, item, maxQueue) {
    const q = queue.concat([item]), dropped = [];
    while (q.length > Math.max(1, maxQueue)) dropped.push(q.shift());
    return { queue: q, dropped };
  }

  /**
   * The pacing state machine. The client supplies the paint/exit callbacks; the pacer
   * owns WHEN they run.
   *   render(card, durationMs, waitedMs) — paint now (waitedMs = time the card spent queued)
   *   exitStart()                        — begin the current card's exit animation; the
   *                                        pacer presents the next card EXIT_MS later
   *   onEvent(action, detail)            — optional pacing telemetry:
   *                                        present | queue | takeover | drop
   * Phases: idle (nothing on) | showing | exiting (exit anim running, next present armed).
   * @param {{render: Function, exitStart?: Function, onEvent?: Function,
   *          minDwellMs?: number, exitMs?: number, maxQueue?: number,
   *          now?: Function, setTimer?: Function, clearTimer?: Function}} opts
   */
  function createPacer(opts) {
    const render = opts.render;
    const exitStart = opts.exitStart || (() => {});
    const onEvent = opts.onEvent || (() => {});
    const minDwellMs = opts.minDwellMs != null ? opts.minDwellMs : MIN_DWELL_MS;
    const exitMs = opts.exitMs != null ? opts.exitMs : EXIT_MS;
    const maxQueue = opts.maxQueue != null ? opts.maxQueue : MAX_QUEUE;
    const now = opts.now || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    const setT = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearT = opts.clearTimer || ((t) => clearTimeout(t));

    let phase = "idle", current = null, shownAt = null, queue = [], timer = 0;

    function schedule(ms, fn) { clearT(timer); timer = setT(fn, ms); }
    function present(item) {
      phase = "showing"; current = item; shownAt = now();
      const waited = item.queuedAt != null ? Math.max(0, shownAt - item.queuedAt) : 0;
      render(item.card, item.durationMs, waited);
      onEvent("present", { card: item.card, queued: queue.length, waitedMs: Math.round(waited) });
      if (queue.length) schedule(minDwellMs, takeover);   // next in line takes over at dwell
    }
    function takeover() {
      if (!queue.length || phase === "exiting") return;
      if (phase === "showing") {
        phase = "exiting"; exitStart();
        onEvent("takeover", { card: queue[0].card, queued: queue.length });
        schedule(exitMs, () => { phase = "idle"; present(queue.shift()); });
      } else present(queue.shift());
    }
    /** A card was aired — display it now if the stage is free, else queue it. */
    function air(card, durationMs) {
      const item = { card, durationMs, queuedAt: now() };
      if (phase === "idle") { present(item); return; }
      const r = enqueue(queue, item, maxQueue);
      queue = r.queue;
      r.dropped.forEach((d) => onEvent("drop", { card: d.card, queued: queue.length }));
      onEvent("queue", { card, queued: queue.length });
      if (phase === "showing") schedule(dwellRemaining(now(), shownAt, minDwellMs), takeover);
      // phase "exiting": the armed present drains the queue FIFO — nothing to schedule
    }
    /** The current card's own countdown ended (client already faded it) — promote the next. */
    function retire() {
      if (phase !== "showing") return;
      phase = "idle"; current = null; shownAt = null; clearT(timer);
      if (queue.length) present(queue.shift());
    }
    /** Pull / stream boundary: flush everything, including queued (never-shown) cards. */
    function clear() {
      clearT(timer); timer = 0; queue = []; current = null; shownAt = null; phase = "idle";
    }
    const state = () => ({ phase, current: current ? current.card : null, queued: queue.length });
    return { air, retire, clear, state };
  }

  globalThis.FootnotePacer = { MIN_DWELL_MS, EXIT_MS, MAX_QUEUE, dwellRemaining, enqueue, createPacer };
})();
