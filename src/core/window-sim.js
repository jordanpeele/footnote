// W1.3 window hardening — the rolling-window state machine, extracted to ONE simulatable
// implementation. app.js owns the LIVE wiring (winWords / windowExtract / winTimer — it is
// a classic script and cannot import this); this module reproduces that wiring exactly so
// the bench tool (tools/bench/window-replay.js) and the regression tests
// (test/window-ingestion.test.js) exercise the same machine and cannot drift apart from
// each other. The DECISION predicate (windowShouldExtract) and its tunables live in
// src/core/utterance.js (mirror block) and are imported, never restated — tunable values
// and gate semantics stay in exactly one editing surface.
//
// If the app.js window wiring changes, change this in lockstep;
// test/window-ingestion.test.js pins the observable behavior (trigger reasons, window
// sizing, winLastSent suppression, coverage on the 2026-08-14 run shape).

import { WINDOW_WORDS, WINDOW_TRAIL_SILENCE_MS, windowShouldExtract } from "./utterance.js";

// Wiring constants (NOT tunables — they mirror the app.js wiring, outside the mirror block):
// the winTimer interval, and the winWords rolling-buffer cap (window text is the last
// WINDOW_WORDS of a WINDOW_BUFFER_WORDS buffer, exactly as app.js slices it).
export const WINDOW_TICK_MS = 400;
export const WINDOW_BUFFER_WORDS = 60;

/**
 * A step-drivable simulation of the client window state machine.
 * Mirrors app.js state {winWords, winNewWords, winLastAt, winLastExtract, winLastSent}
 * and the two entry points: the 400ms winTimer tick (cadence/silence) and the
 * stt_final ingest (terminal). All times are epoch-ms style numbers supplied by the caller.
 *
 * @param {{lastExtractAt?: number}} [opts] initial "last extract" clock (app.js sets
 *   Date.now() at stream start; the replay tool sets first-final-minus-10s)
 */
export function createWindowSim(opts) {
  const lastExtractAt = (opts && opts.lastExtractAt) || 0;
  let winWords = [], winNewWords = 0, winLastAt = lastExtractAt, winLastExtract = lastExtractAt, winLastSent = "";
  const windows = [];
  let suppressed = 0;   // winLastSent identical-window suppressions (fire consumed, nothing sent)

  // mirrors app.js windowExtract(): reset the trigger state FIRST (a suppressed fire still
  // consumes the new-word count and restarts the cadence clock), then send unless identical
  function extract(reason, now) {
    const text = winWords.slice(-WINDOW_WORDS).join(" ").trim();
    winNewWords = 0; winLastExtract = now;
    if (!text || text === winLastSent) { if (text) suppressed++; return null; }
    winLastSent = text;
    const w = { reason, text, at: now, words: text.split(/\s+/).length };
    windows.push(w);
    return w;
  }

  return {
    get windows() { return windows; },
    get suppressed() { return suppressed; },
    /** the winTimer path — cadence ceiling / trailing-silence flush */
    tick(now) {
      if (!winNewWords) return null;
      if (windowShouldExtract(winNewWords, now - winLastExtract, now - winLastAt, false))
        return extract(now - winLastAt >= WINDOW_TRAIL_SILENCE_MS ? "silence" : "cadence", now);
      return null;
    },
    /** the stt_final ingest path — buffer the words, extract immediately on sentence end */
    addFinal(text, now) {
      const tr = String(text == null ? "" : text).trim();
      const ws = tr.split(/\s+/).filter(Boolean);
      if (!ws.length) return null;
      winWords.push(...ws); if (winWords.length > WINDOW_BUFFER_WORDS) winWords = winWords.slice(-WINDOW_BUFFER_WORDS);
      winNewWords += ws.length; winLastAt = now;
      if (/[.!?]$/.test(tr) && windowShouldExtract(winNewWords, now - winLastExtract, 0, true))
        return extract("terminal", now);
      return null;
    },
    /** end-of-replay flush — unconditional if anything is pending. Replay-only reason:
     *  the live client has no "end of log"; its trailing words flush via the silence
     *  timer instead (winTimer keeps ticking until End Stream kills it). */
    flush(now) {
      if (!winNewWords) return null;
      return extract("end", now);
    },
  };
}

/**
 * Replay a list of finals through the window state machine on the real timeline,
 * ticking the timer between finals exactly as the live 400ms winTimer would.
 * @param {{t: number, text: string}[]} finals stt finals in arrival order
 * @returns {{windows: {reason: string, text: string, at: number, words: number}[], suppressed: number}}
 */
export function replayWindow(finals) {
  const sim = createWindowSim({ lastExtractAt: finals.length ? finals[0].t - 10000 : 0 });
  for (let i = 0; i < finals.length; i++) {
    const f = finals[i];
    // the 400ms timer ticks between the previous final and this one
    const prevT = i ? finals[i - 1].t : f.t;
    for (let tick = prevT + WINDOW_TICK_MS; tick < f.t; tick += WINDOW_TICK_MS) sim.tick(tick);
    sim.addFinal(f.text, f.t);
  }
  if (finals.length) sim.flush(finals[finals.length - 1].t + WINDOW_TRAIL_SILENCE_MS);
  return { windows: sim.windows, suppressed: sim.suppressed };
}

/**
 * Coverage accounting used by the replay tool's acceptance line: what fraction of the
 * session's unique (normalized) words appear in at least one extracted window.
 * @param {{text: string}[]} finals
 * @param {{text: string}[]} windows
 */
export function windowCoverage(finals, windows) {
  const norm = (w) => w.toLowerCase().replace(/[^\w]/g, "");
  const covered = new Set();
  for (const w of windows) for (const word of w.text.split(/\s+/)) covered.add(norm(word));
  const allWords = new Set(finals.flatMap((f) => f.text.split(/\s+/).filter(Boolean).map(norm)));
  const totalWords = finals.reduce((n, f) => n + f.text.split(/\s+/).filter(Boolean).length, 0);
  const coveredUnique = [...allWords].filter((w) => covered.has(w)).length;
  return { totalWords, uniqueWords: allWords.size, coveredUnique, ratio: coveredUnique / Math.max(1, allWords.size) };
}
