// R46 regression replay — the field-session polarity cases, embedded as fixtures
// (eval/results/*.jsonl is gitignored, so CI replays from these verbatim copies).
// The tripwire must catch EXACTLY the FS-8 card (denies with no negation in the
// utterance) and none of the legitimate denials; D17 display must stay faithful.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasNegation, pickSpokenSentence } from "../src/core/utterance.js";
import { applyPolarity } from "../src/core/polarity.js";

// verbatim from the four field sessions (2026-08-08 → 2026-08-10-street)
const FIELD_DENIALS = [
  { name: "FS-8 chromosomes (the aired wrong verdict — MUST TRIP)",
    spoken: "Women biologically have x y sex chromosomes.",
    claim: "Women have XY sex chromosomes", trips: true },
  { name: "four-minute mile (FS-1 — legitimate denial)",
    spoken: "No woman has run a mile faster than four minutes.",
    claim: "A woman has run a mile faster than four minutes.", trips: false },
  { name: "street Taiwan (split negation — legitimate denial)",
    spoken: "it says Taiwan has four locations. No. That's not",
    claim: "Taiwan has four locations", trips: false },
  { name: "Newsom born-not (legitimate denial)",
    spoken: "Gavin Newsom was born not in the state of California.",
    claim: "Gavin Newsom was born in the state of California", trips: false },
];

for (const c of FIELD_DENIALS) {
  test(`R46 tripwire replay: ${c.name}`, () => {
    const trips = !hasNegation(c.spoken);   // extractor said denies; tripwire = no negation token
    assert.equal(trips, c.trips);
  });
}

test("R46: suspect_denies routes to conflict with verdict UN-flipped (the FS-8 chain, corrected)", () => {
  // verifier correctly falsifies the canonical claim; the suspect flip must NOT invert it
  const out = applyPolarity("False", "suspect_denies");
  assert.deepEqual(out, { verdict: "False", conflict: true });
});

test("R46: legitimate denies still flips cleanly", () => {
  assert.deepEqual(applyPolarity("False", "denies"), { verdict: "True", conflict: false });
});

for (const c of FIELD_DENIALS.filter((c) => !c.trips)) {
  test(`D17 replay: ${c.name} displays the speaker's words`, () => {
    const display = pickSpokenSentence(c.spoken, c.claim, true);
    assert.ok(hasNegation(display), `display lost the negation: ${display}`);
  });
}
