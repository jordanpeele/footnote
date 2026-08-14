// F2/F3 (field test 2026-08-08) — pure decision logic for the two utterance-level guards:
//   F2: claim-level dedupe (same claim re-extracted from interleaved finals must not card twice)
//   F3: split-final merge (Deepgram endpointing splits one thought across two finals)
// app.js is a classic script (no modules) so it CANNOT import this file — it carries a
// byte-identical copy of the MIRROR BLOCK below (test/prompt-sync pattern);
// test/utterance-sync.test.js fails the build if the copies ever drift.

/* ===== MIRROR BLOCK (utterance guards) — keep byte-identical with the copy in app.js;
   test/utterance-sync.test.js compares them (indentation-insensitive). ===== */
// TUNABLE — F2 dedupe: a claim that already produced a card this recently is dropped.
const DUP_CLAIM_WINDOW_MS = 60000;
// TUNABLE — F3 merge: max gap between two finals for them to be considered one thought.
const MERGE_MAX_GAP_MS = 3500;
// TUNABLE — F3 merge: a final this short (in words) is presumed a continuation fragment.
const MERGE_SHORT_WORDS = 4;
// TUNABLE — W1.2 assembler: silence that ends a spoken thought (flush the joined buffer).
// 3600 = just past MERGE_MAX_GAP_MS: replay of BOTH sessions showed real intra-claim
// splits arriving up to ~3.5s apart (session-1 vitamin-C denial 2.2s; session-2 bones
// fragments 3.5s) — an 1800ms first guess flushed mid-thought and LOST claims the old
// pair-join caught. Inter-claim pauses in both sessions were >5s, so 3.6s separates
// thoughts safely. Endpointing bench refines; replay tool re-verifies any change.
const ASSEMBLE_SILENCE_MS = 3600;
// TUNABLE — W1.2 assembler: max finals joined into one utterance (runaway-buffer cap).
const ASSEMBLE_MAX_FINALS = 6;
// TUNABLE — W1.3 window: words of rolling transcript context handed to each extract.
const WINDOW_WORDS = 30;
// TUNABLE — W1.3 window: minimum NEW words since the last extract before another fires.
const WINDOW_MIN_NEW_WORDS = 3;
// TUNABLE — W1.3 window: cadence ceiling — extract at least this often during speech.
const WINDOW_EXTRACT_MS = 3500;
// TUNABLE — W1.3 window: trailing silence that flushes the last words of a thought.
const WINDOW_TRAIL_SILENCE_MS = 1500;
/**
 * Canonical claim key for dedupe: lowercase, punctuation stripped, whitespace collapsed.
 * @param {string|null|undefined} claim extracted claim text
 * @returns {string} normalized key ("" for empty/nullish input)
 */
function normalizeClaim(claim) {
  return String(claim == null ? "" : claim)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
/**
 * F2 — is a claim first carded at `createdAt` still a duplicate at `nowAt`?
 * @param {number|null|undefined} createdAt epoch ms of the prior card's creation, if any
 * @param {number} nowAt epoch ms of the would-be new card
 * @returns {boolean} true → drop the new card as a duplicate
 */
function withinDupWindow(createdAt, nowAt) {
  return createdAt != null && nowAt - createdAt >= 0 && nowAt - createdAt < DUP_CLAIM_WINDOW_MS;
}
/**
 * F3 — should two consecutive STT finals ALSO be checked as one joined utterance?
 * True when they arrived close together AND the boundary looks like a split thought:
 * the earlier final didn't end in sentence-terminal punctuation, or the later one is a
 * short fragment ("Was 4%.").
 * @param {string|null|undefined} prev earlier final transcript
 * @param {number} prevAt epoch ms the earlier final arrived
 * @param {string|null|undefined} next later final transcript
 * @param {number} nowAt epoch ms the later final arrived
 * @returns {boolean} true → also run the joined check
 */
function shouldMergeFinals(prev, prevAt, next, nowAt) {
  const p = String(prev == null ? "" : prev).trim();
  const n = String(next == null ? "" : next).trim();
  if (!p || !n) return false;
  const gap = nowAt - prevAt;
  if (!(gap >= 0 && gap <= MERGE_MAX_GAP_MS)) return false;
  const unterminated = !/[.!?]$/.test(p);
  const shortNext = n.split(/\s+/).filter(Boolean).length <= MERGE_SHORT_WORDS;
  return unterminated || shortNext;
}
/**
 * W1.2 (walkable-rig sprint) — rolling final-assembler flush predicate. Session 2's
 * routed/bonded audio made Deepgram finalize at micro-gaps, shredding one spoken claim
 * across 2-5 finals; the pair-join (shouldMergeFinals, retained above for reference and
 * tests but no longer called by the client) couldn't reconstruct them — splits arrived
 * pre-punctuated, and pairs aren't enough. The assembler buffers consecutive finals and
 * flushes the JOINED utterance when the thought actually ends.
 * Flush when: the buffer hit the cap, OR real silence has passed since the last final.
 * @param {number} count finals currently buffered
 * @param {number} lastAt epoch ms of the newest buffered final
 * @param {number} nowAt epoch ms now
 * @returns {boolean} true → flush (join + check as merged when count >= 2)
 */
function assemblyShouldFlush(count, lastAt, nowAt) {
  if (count <= 0) return false;
  if (count >= ASSEMBLE_MAX_FINALS) return true;
  return nowAt - lastAt >= ASSEMBLE_SILENCE_MS;
}
/**
 * W1.3 (run-test 2026-08-14) — rolling-WINDOW extraction predicate. The run proved the
 * final is not a unit of meaning: 244 finals, median ONE word, 73% of spoken words never
 * reached a check. The window frame: keep a running transcript of the last ~N words and
 * extract claims from the WINDOW on a cadence, letting F2 dedupe absorb the overlap and
 * the grounding gate reject anything not actually said. Supersedes the final-assembler
 * (whose wiring is retired; predicate retained above for reference/tests).
 * Extract when: enough NEW words arrived since the last extract AND (the newest final
 * ended a sentence, OR the cadence interval elapsed, OR real silence set in).
 * @param {number} newWords words arrived since the last window extract
 * @param {number} msSinceExtract ms since the last window extract
 * @param {number} msSinceLastWord ms since the newest word arrived
 * @param {boolean} endsTerminal newest final ended with . ! or ?
 * @returns {boolean} true → extract the window now
 */
function windowShouldExtract(newWords, msSinceExtract, msSinceLastWord, endsTerminal) {
  if (newWords < WINDOW_MIN_NEW_WORDS) return false;
  if (endsTerminal) return true;
  if (msSinceExtract >= WINDOW_EXTRACT_MS) return true;
  return msSinceLastWord >= WINDOW_TRAIL_SILENCE_MS;
}
/**
 * D17 — pick the claim-bearing sentence from a (possibly filler-prefixed) utterance:
 * best content-word overlap with the canonical claim wins; whole utterance is the
 * fallback. Used to render the SPEAKER'S framing (denials keep their negation).
 * @param {string} spoken the utterance that produced the claim
 * @param {string} claim the canonical (positive-form) claim
 * @returns {string} the sentence to display
 */
/**
 * R46 — does the text contain an explicit negation token? Deterministic consistency
 * check for the polarity tripwire (extractor says "denies" but the speaker's words
 * carry no negation → the flip is suspect) and the D17 split-negation fallback.
 * @param {string} text
 * @returns {boolean}
 */
function hasNegation(text) {
  return /\b(no|not|never|isn't|wasn't|aren't|doesn't|don't|didn't|hasn't|haven't|won't|can't|cannot)\b|n't\b/i.test(String(text));
}
function pickSpokenSentence(spoken, claim, preferNegation) {
  const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9%]+/).filter((w) => w.length >= 3));
  const cw = words(claim);
  let best = null, bestScore = 0;
  for (const sent of String(spoken).split(/(?<=[.!?])\s+/)) {
    let n = 0; words(sent).forEach((w) => { if (cw.has(w)) n++; });
    if (n > bestScore) { bestScore = n; best = sent.trim(); }
  }
  // A denial whose picked sentence lost its negation (split across sentences — field case:
  // "it says X. No. That's not") falls back to the whole utterance, which carries it.
  if (preferNegation && best && !hasNegation(best) && hasNegation(spoken)) return String(spoken).trim();
  return best || String(spoken).trim();
}
/* ===== END MIRROR BLOCK ===== */

export { DUP_CLAIM_WINDOW_MS, MERGE_MAX_GAP_MS, MERGE_SHORT_WORDS, ASSEMBLE_SILENCE_MS, ASSEMBLE_MAX_FINALS, WINDOW_WORDS, WINDOW_MIN_NEW_WORDS, WINDOW_EXTRACT_MS, WINDOW_TRAIL_SILENCE_MS, normalizeClaim, withinDupWindow, shouldMergeFinals, assemblyShouldFlush, windowShouldExtract, pickSpokenSentence, hasNegation };
