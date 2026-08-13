// F2/F3 (field test 2026-08-08) — pure decision logic for claim-level dedupe and
// split-final merge. app.js mirrors this logic (classic script, can't import);
// test/utterance-sync.test.js keeps the copies honest — THIS file proves the logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUP_CLAIM_WINDOW_MS, MERGE_MAX_GAP_MS, MERGE_SHORT_WORDS,
  ASSEMBLE_SILENCE_MS, ASSEMBLE_MAX_FINALS, assemblyShouldFlush,
  normalizeClaim, withinDupWindow, shouldMergeFinals, pickSpokenSentence,
} from "../../src/core/utterance.js";

/* ================= normalizeClaim ================= */

test("normalizeClaim: lowercases and strips punctuation", () => {
  assert.equal(normalizeClaim("U.S. GDP Growth Was 4%!"), "us gdp growth was 4");
});

test("normalizeClaim: collapses runs of whitespace (spaces, tabs, newlines)", () => {
  assert.equal(normalizeClaim("  GDP\tgrowth \n was   4 "), "gdp growth was 4");
});

test("normalizeClaim: punctuation/case variants of the same claim produce the same key", () => {
  const a = normalizeClaim("GDP growth in the United States in 2025 was 4%.");
  const b = normalizeClaim("gdp growth in the united states, in 2025, was 4");
  assert.equal(a, b);
});

test("normalizeClaim: keeps unicode letters and digits (only punctuation dies)", () => {
  assert.equal(normalizeClaim("Café's naïve — 100€!"), "cafés naïve 100");
});

test("normalizeClaim: nullish and empty inputs → empty key", () => {
  assert.equal(normalizeClaim(null), "");
  assert.equal(normalizeClaim(undefined), "");
  assert.equal(normalizeClaim(""), "");
  assert.equal(normalizeClaim("?!... ,"), "");
});

/* ================= withinDupWindow (F2 window edges) ================= */

test("withinDupWindow: inside the window → duplicate", () => {
  assert.equal(withinDupWindow(1000, 1000), true);                              // same instant
  assert.equal(withinDupWindow(0, DUP_CLAIM_WINDOW_MS - 1), true);              // 1ms shy of the edge
});

test("withinDupWindow: at and past the window edge → not a duplicate", () => {
  assert.equal(withinDupWindow(0, DUP_CLAIM_WINDOW_MS), false);                 // exactly the window
  assert.equal(withinDupWindow(0, DUP_CLAIM_WINDOW_MS + 1), false);
});

test("withinDupWindow: no prior card, or a prior card 'in the future' → not a duplicate", () => {
  assert.equal(withinDupWindow(undefined, 5000), false);   // Map.get miss
  assert.equal(withinDupWindow(null, 5000), false);
  assert.equal(withinDupWindow(6000, 5000), false);        // clock weirdness fails safe (no drop)
});

/* ================= shouldMergeFinals (F3) ================= */

test("merge: the field-log GDP split — terminal prev + short next → merge", () => {
  // "GDP growth in the United States in 2025?" / "Was 4%." — neither extracts alone.
  assert.equal(shouldMergeFinals("GDP growth in the United States in 2025?", 1000, "Was 4%.", 2200), true);
});

test("merge: prev without sentence-terminal punctuation → merge even if next is long", () => {
  assert.equal(shouldMergeFinals(
    "GDP growth in the United States in 2025", 1000,
    "was four percent according to the bureau of economic analysis.", 3000), true);
});

test("merge: short next (≤ MERGE_SHORT_WORDS words) → merge even after a terminal prev", () => {
  const next = Array.from({ length: MERGE_SHORT_WORDS }, (_, i) => "w" + i).join(" ") + ".";
  assert.equal(shouldMergeFinals("Unemployment is at four percent.", 0, next, 500), true);
});

test("no merge: two complete sentences (terminal prev + long next) even when close in time", () => {
  assert.equal(shouldMergeFinals(
    "Unemployment is at four percent.", 1000,
    "The Federal Reserve kept interest rates steady yesterday afternoon.", 1500), false);
});

test("no merge: next one word past the short-fragment ceiling (with terminal prev)", () => {
  const next = Array.from({ length: MERGE_SHORT_WORDS + 1 }, (_, i) => "w" + i).join(" ") + ".";
  assert.equal(shouldMergeFinals("Unemployment is at four percent.", 0, next, 500), false);
});

test("merge gap edges: exactly MERGE_MAX_GAP_MS merges; 1ms over does not", () => {
  assert.equal(shouldMergeFinals("GDP was", 0, "Four percent.", MERGE_MAX_GAP_MS), true);
  assert.equal(shouldMergeFinals("GDP was", 0, "Four percent.", MERGE_MAX_GAP_MS + 1), false);
});

test("no merge: empty/nullish fragments or a negative gap", () => {
  assert.equal(shouldMergeFinals("", 0, "Was 4%.", 100), false);
  assert.equal(shouldMergeFinals("GDP growth was", 0, "", 100), false);
  assert.equal(shouldMergeFinals(null, 0, "Was 4%.", 100), false);
  assert.equal(shouldMergeFinals("GDP growth was", 500, "Was 4%.", 400), false);   // next "before" prev
});

test("merge: prev ending in ! or ? counts as sentence-terminal", () => {
  const longNext = "the bureau of economic analysis said so yesterday.";
  assert.equal(shouldMergeFinals("That is completely wrong!", 0, longNext, 500), false);
  assert.equal(shouldMergeFinals("Is that wrong?", 0, longNext, 500), false);
  assert.equal(shouldMergeFinals("That is, well", 0, longNext, 500), true);   // comma is not terminal
});

/* ================= F2 × F3 interaction ================= */

test("interaction: fragment and join extracting the same claim → second card is a duplicate", () => {
  // Simulates app.js's recentClaims flow for the GDP split where BOTH the second fragment
  // and the joined string extract the same claim (differing in case/punctuation):
  //   final A (t=0)      → no claim
  //   final B (t=1200)   → extract → claim X → card created, registered in recentClaims
  //   joined A+B (t≈1200)→ extract (~1s) → claim X′ (same claim, different surface form)
  const recentClaims = new Map();
  const fromFragment = "GDP growth in the US in 2025 was 4%.";
  // same claim, different surface form (case/punctuation) — normalizes to the same key
  const fromJoin = "gdp growth, in the US, in 2025 was 4%";
  // a genuinely different claim (different words → different key)
  const differentClaim = "GDP growth in the US in 2025 was 4 percent";

  const cardAt = 1200;
  recentClaims.set(normalizeClaim(fromFragment), cardAt);          // card #1 created
  const joinArrivesAt = cardAt + 1000;                             // join's extract returns ~1s later
  assert.equal(
    withinDupWindow(recentClaims.get(normalizeClaim(fromJoin)), joinArrivesAt),
    true,
    "join's re-extraction of the same claim must be dropped as duplicate");
  // and a claim with a different normalized key is NOT swallowed by the window:
  assert.equal(
    withinDupWindow(recentClaims.get(normalizeClaim(differentClaim)), joinArrivesAt),
    false);
});

test("interaction: same claim re-extracted after the window (new segment) is allowed again", () => {
  const recentClaims = new Map();
  const claim = "Unemployment is at four percent.";
  recentClaims.set(normalizeClaim(claim), 10_000);
  assert.equal(withinDupWindow(recentClaims.get(normalizeClaim(claim)), 10_000 + DUP_CLAIM_WINDOW_MS), false);
});

/* ================= pickSpokenSentence (D17 display framing) ================= */

test("D17 FS-1 replay: the four-minute-mile denial keeps its negation", () => {
  const spoken = "Okay. Let's try this. No woman has run a mile faster than four minutes.";
  const claim = "A woman has run a mile faster than four minutes";
  assert.equal(pickSpokenSentence(spoken, claim), "No woman has run a mile faster than four minutes.");
});

test("D17: filler-prefixed utterance trims to the claim-bearing sentence", () => {
  const spoken = "Okay. So let's try another one. The CEO of McDonald's is a man named Ronald McDonald.";
  const claim = "The CEO of McDonald's is a man named Ronald McDonald";
  assert.equal(pickSpokenSentence(spoken, claim), "The CEO of McDonald's is a man named Ronald McDonald.");
});

test("D17: single-sentence utterance returns itself", () => {
  assert.equal(pickSpokenSentence("Kinshasa is not the capital of Pakistan.", "Kinshasa is the capital of Pakistan"),
    "Kinshasa is not the capital of Pakistan.");
});

test("D17: no-overlap fallback returns the whole utterance trimmed", () => {
  assert.equal(pickSpokenSentence("  Something unrelated entirely.  ", "GDP growth was 4%"),
    "Something unrelated entirely.");
});

test("D17: split-negation denial falls back to the whole utterance (street Taiwan case)", () => {
  const spoken = "it says Taiwan has four locations. No. That's not";
  const claim = "Taiwan has four locations";
  assert.equal(pickSpokenSentence(spoken, claim, true), spoken);
});

/* ================= assemblyShouldFlush (W1.2 rolling assembler) ================= */

test("assembler: empty buffer never flushes", () => {
  assert.equal(assemblyShouldFlush(0, 0, 99999), false);
});

test("assembler: flushes on real silence, holds while finals keep arriving", () => {
  assert.equal(assemblyShouldFlush(2, 1000, 1000 + ASSEMBLE_SILENCE_MS), true, "silence elapsed → flush");
  assert.equal(assemblyShouldFlush(2, 1000, 1000 + ASSEMBLE_SILENCE_MS - 1), false, "1ms short → hold");
});

test("assembler: cap flushes regardless of timing", () => {
  assert.equal(assemblyShouldFlush(ASSEMBLE_MAX_FINALS, Date.now ? 5 : 5, 6), true);
});

test("assembler window is wider than the pair-join gap (session replay lesson)", () => {
  // 1800ms first guess flushed MID-THOUGHT (real intra-claim splits ran up to ~3.5s in
  // both sessions) and LOST claims the pair-join caught. The silence window must sit
  // above MERGE_MAX_GAP_MS so the assembler never separates what the pair-join would join.
  assert.ok(ASSEMBLE_SILENCE_MS > MERGE_MAX_GAP_MS, "silence window covers the merge gap");
});
