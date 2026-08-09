// P4-F1 grounding gate tests. The reject cases are the FOUR REAL prompt-echo failures
// from the 2026-08-08 field test (eval/golden/drafts-2026-08-08-fieldtest.jsonl, ids
// 009/018/032/038), verbatim; the allow cases are legitimate pairs from the same session,
// verbatim — so the gate is calibrated against exactly what the live pipeline produced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groundedClaim } from "../src/core/grounding.js";

// ---- the four real prompt echoes → rejected ----
const ECHOES = [
  ["draft-009",
    "and then actually fact check them",
    "I'm ready to extract checkable claims from live speaker sentences. However, I don't see a speaker's sentence in your message to extract from.\n\nPlease provide the speaker's statement, and I will:\n1. Extract the single checkable factual claim (if one exists)\n2. Return it as a JSON object with claim, polarity, and harm_class fields\n\nWhat did the speaker say?"],
  ["draft-018",
    "You talk to a stranger and someone says,",
    "I'm ready to extract a checkable claim from a speaker's sentence. Please provide the sentence or quote you'd like me to analyze."],
  ["draft-032",
    "you talk to a stranger about socioeconomics, and they say,",
    "I'm ready to extract a checkable claim from a speaker's sentence. However, I don't see a complete sentence in your message — it ends with \"and they say,\" but there's no actual quote or statement that follows.\n\nPlease provide the speaker's complete sentence, and I'll extract the checkable claim (or reply NONE if there isn't one)."],
  ["draft-038",
    "So imagine you're talking to someone about socioeconomics. They make a claim like,",
    "I'm ready to extract a checkable factual claim from a speaker's sentence. Please provide the actual statement or quote from the speaker, and I'll respond with either a single-line JSON object or the word NONE."],
];
for (const [id, utterance, claim] of ECHOES) {
  test(`field-test echo ${id} is rejected`, () => {
    const g = groundedClaim(claim, utterance);
    assert.equal(g.ok, false);
    assert.ok(g.reason, "rejection carries a server-side reason");
  });
}

// ---- legitimate field-test pairs (verbatim transcript_snippet → expected_extraction) → allowed ----
const LEGIT = [
  ["draft-001", "The president of The United States is Donald Trump.",
    "Donald Trump is the president of the United States"],
  ["draft-004", "The president of The United States is Peter Thiel.",
    "Peter Thiel is the president of the United States"],
  ["draft-011", "Okay. Let's try another one. The CEO of McDonald's is a man named Ronald McDonald.",
    "The CEO of McDonald's is a man named Ronald McDonald"],
  ["draft-016", "GDP growth in The United States in 2025 was 4%.",
    "GDP growth in the United States in 2025 was 4%"],
  ["draft-025", "a claim about AOC, for example, right, that Alexandria Ocasio Cortez is a communist.",
    "Alexandria Ocasio-Cortez is a communist"],
  ["draft-029", "and they make a claim, like, GDP growth in The United States was 5% in",
    "GDP growth in the United States was 5%"],
  ["draft-045", "GDP growth in The US was 4%.",
    "GDP growth in the US was 4%"],
  ["draft-002", "The king of Norway is named Harald Olofsen.",
    "The king of Norway is named Harald Olofsen"],
];
for (const [id, utterance, claim] of LEGIT) {
  test(`legitimate pair ${id} is allowed`, () => {
    assert.deepEqual(groundedClaim(claim, utterance), { ok: true });
  });
}

// ---- documented canonicalizations must survive the gate ----
test('"the United States" substituted for spoken "The US" is allowed', () => {
  assert.equal(groundedClaim(
    "GDP growth in the United States was 4%",
    "GDP growth in The US was 4%."
  ).ok, true);
});

// ---- edge cases ----
test("empty claim is rejected", () => {
  assert.equal(groundedClaim("", "The sky is blue today.").ok, false);
  assert.equal(groundedClaim("   ", "The sky is blue today.").ok, false);
});
test("claim identical to utterance is allowed", () => {
  const s = "Mike Tyson is the most celebrated boxer of all time.";
  assert.equal(groundedClaim(s, s).ok, true);
});
test("claim with a number absent from the utterance is rejected", () => {
  const g = groundedClaim(
    "GDP growth in the United States in 2025 was 7%",
    "GDP growth in The United States in 2025 was 4%."
  );
  assert.equal(g.ok, false);
  assert.match(g.reason, /number/);
});
test("spelled-out spoken numbers ground numeric claims", () => {
  assert.equal(groundedClaim(
    "GDP growth in the United States was 5%",
    "GDP growth in The United States was five percent."
  ).ok, true);
});
