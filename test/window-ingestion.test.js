// W1.3 window hardening (DAYSPRINT 1a, post-11f25bc) — the full test suite for the
// rolling-window ingestion frame. The predicate (windowShouldExtract) shipped with
// predicate-level tests in test/core/utterance.test.js; THIS file covers everything
// around it: the trigger matrix, the state machine's wiring behavior (via
// src/core/window-sim.js — the same implementation tools/bench/window-replay.js runs),
// the window ↔ F2-dedupe interplay, the grounding-fence contract, and a replay
// regression pin on the 2026-08-14 run shape (1-word finals @2.3s) — synthesized
// inline, never read from gitignored logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WINDOW_WORDS, WINDOW_MIN_NEW_WORDS, WINDOW_EXTRACT_MS, WINDOW_TRAIL_SILENCE_MS,
  DUP_CLAIM_WINDOW_MS, windowShouldExtract, normalizeClaim, withinDupWindow,
} from "../src/core/utterance.js";
import { createWindowSim, replayWindow, windowCoverage, WINDOW_TICK_MS, WINDOW_BUFFER_WORDS } from "../src/core/window-sim.js";
import { groundedClaim } from "../src/core/grounding.js";

/* ================= 1. cadence-trigger matrix ================= */
// Exhaustive edge table for the three triggers behind the min-words floor. Columns:
// [newWords, msSinceExtract, msSinceLastWord, endsTerminal, expected, why]
const MATRIX = [
  // --- min-words floor gates EVERYTHING (no trigger can fire under it) ---
  [0, 999999, 999999, true, false, "empty window never extracts, even terminal + stale"],
  [WINDOW_MIN_NEW_WORDS - 1, 999999, 999999, true, false, "one under the floor blocks terminal"],
  [WINDOW_MIN_NEW_WORDS - 1, WINDOW_EXTRACT_MS, WINDOW_TRAIL_SILENCE_MS, false, false, "one under the floor blocks cadence AND silence"],
  // --- terminal: immediate once the floor is met, regardless of both clocks ---
  [WINDOW_MIN_NEW_WORDS, 0, 0, true, true, "sentence end extracts immediately at the floor"],
  [WINDOW_MIN_NEW_WORDS, WINDOW_EXTRACT_MS - 1, WINDOW_TRAIL_SILENCE_MS - 1, true, true, "terminal needs neither clock"],
  // --- cadence ceiling: fires at exactly WINDOW_EXTRACT_MS, not 1ms sooner ---
  [WINDOW_MIN_NEW_WORDS, WINDOW_EXTRACT_MS, 0, false, true, "cadence at the exact ceiling"],
  [WINDOW_MIN_NEW_WORDS, WINDOW_EXTRACT_MS - 1, 0, false, false, "1ms shy of the cadence ceiling"],
  [999, WINDOW_EXTRACT_MS - 1, 0, false, false, "a flood of new words does NOT beat the cadence clock"],
  // --- trailing silence: fires at exactly WINDOW_TRAIL_SILENCE_MS, not 1ms sooner ---
  [WINDOW_MIN_NEW_WORDS, 0, WINDOW_TRAIL_SILENCE_MS, false, true, "silence flush at the exact threshold"],
  [WINDOW_MIN_NEW_WORDS, 0, WINDOW_TRAIL_SILENCE_MS - 1, false, false, "1ms shy of the silence threshold"],
  // --- no trigger: mid-speech, mid-interval ---
  [999, WINDOW_EXTRACT_MS - 1, WINDOW_TRAIL_SILENCE_MS - 1, false, false, "no trigger active → hold"],
];
for (const [nw, mse, mslw, term, expected, why] of MATRIX) {
  test(`window matrix: (${nw}w, ${mse}ms-since-extract, ${mslw}ms-since-word, terminal=${term}) → ${expected} — ${why}`, () => {
    assert.equal(windowShouldExtract(nw, mse, mslw, term), expected);
  });
}

test("window matrix sanity: silence threshold sits under the cadence ceiling (a pause flushes before the next cadence would)", () => {
  assert.ok(WINDOW_TRAIL_SILENCE_MS < WINDOW_EXTRACT_MS);
});

/* ================= 2. state-machine wiring (window-sim) ================= */

test("wiring: terminal final extracts immediately with reason 'terminal'", () => {
  const sim = createWindowSim();
  const w = sim.addFinal("GDP grew four percent.", 1000);
  assert.ok(w, "terminal final at the floor must extract");
  assert.equal(w.reason, "terminal");
  assert.equal(w.text, "GDP grew four percent.");
});

test("wiring: non-terminal final never extracts on ingest — only the timer path fires cadence/silence", () => {
  const sim = createWindowSim();
  assert.equal(sim.addFinal("GDP grew four percent and", 1000), null);
  // next tick 400ms later: neither clock has elapsed (extract clock started at 0 → 1400 < 3500)
  assert.equal(sim.tick(1400), null);
  // tick after the silence threshold: flushes with reason 'silence'
  const w = sim.tick(1000 + WINDOW_TRAIL_SILENCE_MS);
  assert.ok(w); assert.equal(w.reason, "silence");
});

test("wiring: cadence fires during continuous speech with reason 'cadence'", () => {
  const sim = createWindowSim();
  // finals every 500ms — msSinceLastWord at any tick stays < WINDOW_TRAIL_SILENCE_MS
  let t = 500;
  for (let i = 0; i < 10; i++) { sim.addFinal("word" + i, t); t += 500; }
  const w = sim.tick(t - 500 + 400);   // 400ms after the newest word: not silence, cadence clock long past
  assert.ok(w); assert.equal(w.reason, "cadence");
});

test("wiring: window text is capped at WINDOW_WORDS (last N of the rolling buffer)", () => {
  const sim = createWindowSim();
  const all = Array.from({ length: WINDOW_BUFFER_WORDS + 20 }, (_, i) => "w" + i);
  sim.addFinal(all.join(" ") + ".", 1000);
  const w = sim.windows[0];
  assert.equal(w.words, WINDOW_WORDS, "window never exceeds WINDOW_WORDS");
  assert.equal(w.text, all.slice(-WINDOW_WORDS).join(" ") + ".", "window is the NEWEST words — old words scroll out");
});

/* ---- winLastSent identical-window suppression ---- */

test("winLastSent: an identical re-fire is suppressed — no second send, fire still consumed", () => {
  const sim = createWindowSim();
  // 30 identical words fill the visible window exactly (Deepgram re-final shape)
  let t = 1000;
  for (let i = 0; i < 10; i++) { sim.addFinal("steady steady steady", t); t += 100; }
  const first = sim.tick(t + WINDOW_TRAIL_SILENCE_MS);
  assert.ok(first, "first fire sends");
  assert.equal(sim.windows.length, 1);
  // 3 more identical words → the last-30 slice is byte-identical to what was sent
  sim.addFinal("steady steady steady", t + 4000);
  const second = sim.tick(t + 8000);   // trigger is TRUE (3 new words, cadence long past)…
  assert.equal(second, null, "…but the identical window must not send again");
  assert.equal(sim.windows.length, 1, "exactly one window sent");
  assert.equal(sim.suppressed, 1, "the suppression is counted (window_summary accounting)");
});

test("winLastSent: a suppressed fire consumes new-word state (no re-fire loop on the next tick)", () => {
  const sim = createWindowSim();
  let t = 1000;
  for (let i = 0; i < 10; i++) { sim.addFinal("steady steady steady", t); t += 100; }
  sim.tick(t + WINDOW_TRAIL_SILENCE_MS);
  sim.addFinal("steady steady steady", t + 4000);
  sim.tick(t + 8000);   // suppressed — but winNewWords reset, cadence clock restarted
  assert.equal(sim.tick(t + 8400), null, "no new words since the suppressed fire → timer stays quiet");
  assert.equal(sim.suppressed, 1, "quiet ticks are not counted as suppressions");
});

test("winLastSent: new distinct words break the suppression and send again", () => {
  const sim = createWindowSim();
  let t = 1000;
  for (let i = 0; i < 10; i++) { sim.addFinal("steady steady steady", t); t += 100; }
  sim.tick(t + WINDOW_TRAIL_SILENCE_MS);
  sim.addFinal("rates were cut today.", t + 6000);   // terminal + distinct → window text differs
  assert.equal(sim.windows.length, 2);
  assert.equal(sim.windows[1].reason, "terminal");
  assert.ok(sim.windows[1].text.endsWith("rates were cut today."));
});

test("wiring: empty buffer never sends — tick and flush are no-ops", () => {
  const sim = createWindowSim();
  assert.equal(sim.tick(99999), null);
  assert.equal(sim.flush(99999), null);
  assert.equal(sim.addFinal("   ", 1000), null, "whitespace-only final is not ingested");
  assert.equal(sim.windows.length, 0);
});

/* ================= 3. window ↔ F2 dedupe interplay ================= */
// Overlapping windows re-extracting the same claim is the DESIGNED steady state of W1.3
// (the window advances ~3 words per fire while showing the last 30 — consecutive windows
// share up to 27 words). F2 absorbs the overlap at card-creation time. This mirrors
// checkUtterance's F2 branch (app.js:515-532) at the logic level: gate outcome
// "duplicate_claim" → SESSION disposition "duplicate"; a card path registers the claim
// (force-created cards too — they still dedupe later repeats).
function f2CardPath(recentClaims, claim, now, force) {
  const key = normalizeClaim(claim);
  if (!force && withinDupWindow(recentClaims.get(key), now)) return "duplicate_claim";
  recentClaims.set(key, now);   // register at creation
  return "card";
}

test("interplay: consecutive overlapping windows extracting the same claim → exactly one card", () => {
  const recentClaims = new Map();
  // three windows, ~3.5s apart (cadence), all containing the same completed sentence —
  // the extractor canonicalizes each to the same claim modulo surface form
  const extractions = [
    { at: 10_000, claim: "GDP grew three percent last quarter." },
    { at: 13_500, claim: "GDP grew three percent last quarter" },     // punctuation drift
    { at: 17_000, claim: "gdp grew three percent, last quarter." },   // case/comma drift
  ];
  const dispositions = extractions.map((e) => f2CardPath(recentClaims, e.claim, e.at, false));
  assert.deepEqual(dispositions, ["card", "duplicate_claim", "duplicate_claim"]);
  assert.equal(dispositions.filter((d) => d === "card").length, 1, "exactly one card path");
});

test("interplay: a NEW claim entering the same overlapping window is not swallowed", () => {
  const recentClaims = new Map();
  assert.equal(f2CardPath(recentClaims, "GDP grew three percent last quarter", 10_000, false), "card");
  // the next window still contains the GDP sentence AND completes a new one
  assert.equal(f2CardPath(recentClaims, "GDP grew three percent last quarter", 13_500, false), "duplicate_claim");
  assert.equal(f2CardPath(recentClaims, "The Federal Reserve kept rates steady", 13_500, false), "card");
});

test("interplay: operator force (typed/retry) bypasses the dup gate but still registers", () => {
  const recentClaims = new Map();
  assert.equal(f2CardPath(recentClaims, "Unemployment is four percent", 1000, false), "card");
  assert.equal(f2CardPath(recentClaims, "Unemployment is four percent", 2000, true), "card", "deliberate operator act is never blocked");
  // the force-created card re-registered the claim → a later WINDOW repeat still dedupes
  assert.equal(f2CardPath(recentClaims, "Unemployment is four percent", 3000, false), "duplicate_claim");
});

test("interplay: past DUP_CLAIM_WINDOW_MS the same claim legitimately cards again (new segment)", () => {
  const recentClaims = new Map();
  assert.equal(f2CardPath(recentClaims, "Unemployment is four percent", 0, false), "card");
  assert.equal(f2CardPath(recentClaims, "Unemployment is four percent", DUP_CLAIM_WINDOW_MS - 1, false), "duplicate_claim");
  assert.equal(f2CardPath(recentClaims, "Unemployment is four percent", DUP_CLAIM_WINDOW_MS, false), "card");
});

/* ---- dup-gate accounting over a REAL window replay ---- */

test("accounting: duplicate_claim dispositions are EXPECTED under the window — overlap replay yields 1 card + N duplicates", () => {
  // replay the run-shape fixture (below) and simulate the extractor on every window:
  // whenever the completed GDP sentence is visible in the window text, it extracts.
  const SENTENCE = "GDP grew three percent last quarter.";
  const finals = runShapeFinals();
  const { windows } = replayWindow(finals);
  const containing = windows.filter((w) => w.text.includes(SENTENCE));
  assert.ok(containing.length >= 2, `overlap premise: the sentence must appear in ≥2 windows (got ${containing.length})`);
  const recentClaims = new Map();
  const dispositions = containing.map((w) => f2CardPath(recentClaims, SENTENCE, w.at, false));
  assert.equal(dispositions[0], "card");
  assert.deepEqual(dispositions.slice(1), Array(containing.length - 1).fill("duplicate_claim"),
    "every re-extraction inside the dup window is a duplicate disposition, not an error");
  // disposition-model note (app.js SESSION block): gate outcome "duplicate_claim" maps to
  // the terminal disposition "duplicate" (log-then-mark; never enqueued). A healthy field
  // log under W1.3 SHOULD show duplicate_claim gate events — their absence with high
  // window counts means overlap isn't reaching extraction (a regression, not cleanliness).
});

/* ================= 4. grounding-fence contract (server-side, P4-F1) ================= */
// CONTRACT: windowExtract() POSTs the WINDOW TEXT as `text` to /api/extract; api/extract.js
// runs groundedClaim(claim, text) against that exact window — not the raw finals, not the
// stream history. Grounding is stateless per request; it fences hallucination only.
// Overlap/repetition across windows is F2's job (client-side), never grounding's.
const WINDOW_TEXT = "The unemployment rate in June was four percent. GDP grew three percent last quarter.";

test("grounding contract: a claim assembled ACROSS 1-word finals grounds against the joined window", () => {
  // no single final of the run shape contains this claim (each was one word) — the window is
  // the grounding utterance, which is exactly why W1.3 sends the window and not the final
  const g = groundedClaim("The unemployment rate in June was 4 percent", WINDOW_TEXT);
  assert.equal(g.ok, true, `spelled-number + overlap must ground (got ${g.reason})`);
});

test("grounding contract: a number the window never carried is rejected (hallucination fence)", () => {
  const g = groundedClaim("GDP grew 7 percent last quarter", WINDOW_TEXT);
  assert.equal(g.ok, false);
  assert.match(g.reason, /^ungrounded-number:7/);
});

test("grounding contract: assistant-voice echo is rejected regardless of window content", () => {
  const g = groundedClaim("I'm ready to extract checkable claims", WINDOW_TEXT);
  assert.equal(g.ok, false);
  assert.match(g.reason, /^assistant-voice:/);
});

test("grounding contract: an off-window claim fails lexical overlap (window is the ONLY grounding source)", () => {
  const g = groundedClaim("Mount Everest is the tallest mountain in Africa", WINDOW_TEXT);
  assert.equal(g.ok, false);
  assert.match(g.reason, /^low-overlap:/);
});

/* ================= 5. replay regression pin — 2026-08-14 run shape ================= */
// The run test that motivated W1.3: 244 finals, median ONE word (@~2.3s cadence), 73% of
// spoken words never reached a check (27% coverage). Fixture: the same shape synthesized
// inline — 29 one-word finals, 2.3s apart, four terminal-punctuated sentences. The pin:
// the window machine must keep coverage ≥ 95% on this shape with a sane window count.
function runShapeFinals() {
  const words = ("The unemployment rate in June was four percent. " +
    "GDP grew three percent last quarter. " +
    "The Federal Reserve kept rates steady. " +
    "Inflation fell to two point one percent in July.").split(" ");
  return words.map((w, i) => ({ t: 1000 + i * 2300, text: w }));   // 1-word finals @2.3s
}

test("replay pin: run-shape coverage ≥ 95% (run-test baseline was 27%)", () => {
  const finals = runShapeFinals();
  assert.equal(finals.length, 29);
  finals.forEach((f) => assert.equal(f.text.split(/\s+/).length, 1, "fixture premise: every final is ONE word"));
  const { windows } = replayWindow(finals);
  const cov = windowCoverage(finals, windows);
  assert.ok(cov.ratio >= 0.95, `coverage regressed: ${(cov.ratio * 100).toFixed(1)}% < 95%`);
});

test("replay pin: window count stays within sane bounds (no starvation, no flood)", () => {
  const finals = runShapeFinals();
  const { windows, suppressed } = replayWindow(finals);
  // 29 words ÷ WINDOW_MIN_NEW_WORDS is the hard ceiling (a fire needs ≥3 new words);
  // the floor guards starvation — the 67s session must produce a steady stream of windows.
  const ceiling = Math.floor(29 / WINDOW_MIN_NEW_WORDS) + 1;   // +1: the end-of-log flush is unconditional
  assert.ok(windows.length <= ceiling, `${windows.length} windows > ceiling ${ceiling} — trigger is firing under the min-words floor`);
  assert.ok(windows.length >= 6, `${windows.length} windows < 6 — the cadence/silence path is starving`);
  assert.equal(suppressed, 0, "distinct rolling text on this shape should never hit the winLastSent suppressor");
  for (const w of windows) {
    assert.ok(w.words <= WINDOW_WORDS, `window of ${w.words} words exceeds WINDOW_WORDS`);
    assert.ok(["terminal", "cadence", "silence", "end"].includes(w.reason), `unknown trigger reason ${w.reason}`);
  }
  // the final flush exists (replay-only "end"; live, the silence timer plays this role) —
  // without it the last sub-3-word tail of the session would be lost
  assert.equal(windows[windows.length - 1].reason, "end");
  assert.ok(windows[windows.length - 1].text.endsWith("July."), "the session's last words are covered");
});

test("replay pin: timer granularity matches the live client (400ms winTimer)", () => {
  assert.equal(WINDOW_TICK_MS, 400);
  assert.equal(WINDOW_BUFFER_WORDS, 60);
});
