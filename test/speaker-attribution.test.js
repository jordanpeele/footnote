// W2 speaker attribution (2026-08-20): diarized per-word speaker ids → a card knows whose
// claim it's checking. The editorial rule under test: attribute ONLY when one speaker
// clearly owns the run (≥ SPEAKER_MIN_SHARE of diarized words, ≥ SPEAKER_MIN_WORDS known)
// — a mixed or thin run attributes to NOBODY. Mis-attribution on a broadcast graphic is
// worse than no attribution; same spirit as D17's speaker-framing rule.
// dominantSpeaker lives in the utterance MIRROR BLOCK (core = editing surface, app.js =
// byte-identical copy, test/utterance-sync.test.js pins the sync).
import test from "node:test";
import assert from "node:assert/strict";
import { dominantSpeaker, SPEAKER_MIN_SHARE, SPEAKER_MIN_WORDS } from "../src/core/utterance.js";

test("solo run attributes to its speaker", () => {
  assert.equal(dominantSpeaker([0, 0, 0, 0, 0]), 0);
  assert.equal(dominantSpeaker([1, 1, 1]), 1);
});

test("a clearly dominant speaker wins over a stray word", () => {
  // 9 of 10 = 90% ≥ the 80% floor
  assert.equal(dominantSpeaker([2, 2, 2, 2, 2, 2, 2, 2, 2, 0]), 2);
});

test("a mixed run attributes to NOBODY (the load-bearing case)", () => {
  // 60/40 two-voice exchange — attributing either would be a guess
  assert.equal(dominantSpeaker([0, 0, 0, 1, 1]), null);
  // exactly at the floor passes; one word under it fails
  assert.equal(dominantSpeaker([0, 0, 0, 0, 1]), 0, "4/5 = 80% meets SPEAKER_MIN_SHARE");
  assert.equal(dominantSpeaker([0, 0, 0, 1, 1, 0, 0, 1]), null, "5/8 = 62.5% is a guess");
});

test("thin runs never attribute (fewer than SPEAKER_MIN_WORDS diarized words)", () => {
  assert.equal(dominantSpeaker([1]), null);
  assert.equal(dominantSpeaker([1, 1]), null);
  assert.equal(dominantSpeaker([1, 1, 1]), 1, "exactly SPEAKER_MIN_WORDS attributes");
});

test("unknown-speaker words are excluded from the denominator, not counted against anyone", () => {
  // 4 diarized words all speaker 0 + 4 unknowns → still a confident solo attribution
  assert.equal(dominantSpeaker([0, null, 0, undefined, 0, null, 0, null]), 0);
  // all unknown → no attribution
  assert.equal(dominantSpeaker([null, null, null, null]), null);
  assert.equal(dominantSpeaker([]), null);
  assert.equal(dominantSpeaker(null), null);
});

test("tunables hold their documented values (share floor 0.8, min words 3)", () => {
  assert.equal(SPEAKER_MIN_SHARE, 0.8);
  assert.equal(SPEAKER_MIN_WORDS, 3);
});

test("speaker id 0 is a valid attribution (falsy-id regression guard)", () => {
  // Deepgram's first speaker is 0 — any `if (speaker)` truthiness bug would drop them
  assert.equal(dominantSpeaker([0, 0, 0]), 0);
  assert.notEqual(dominantSpeaker([0, 0, 0]), null);
});
