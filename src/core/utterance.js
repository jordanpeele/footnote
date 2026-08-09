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
/* ===== END MIRROR BLOCK ===== */

export { DUP_CLAIM_WINDOW_MS, MERGE_MAX_GAP_MS, MERGE_SHORT_WORDS, normalizeClaim, withinDupWindow, shouldMergeFinals };
