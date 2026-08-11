// Task 0b — aired-verdict derivation, tested in ISOLATION (no server, no network).
//
// deriveAired() (exported from eval/run.js) is the pure crux of the aired-verdict eval: given the
// golden's ground-truth CANONICAL verdict + expected polarity and the model's actual canonical
// verdict + actual polarity, it computes what SHOULD air vs what WOULD air, and — critically — flags
// the FS-8 signature: a CORRECT canonical verdict that airs WRONG purely because polarity was
// misclassified. That flag is the number that would have caught FS-8.
//
// Golden convention under test (from polarity_traps.jsonl adjudication_notes): ground_truth_verdict
// is the verdict on the CANONICAL assertive claim, NOT the aired verdict — so the expected aired
// verdict must be derived via applyPolarity(ground_truth, expected_polarity).

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAired } from "../eval/run.js";
import { applyPolarity } from "../src/core/polarity.js";

// ── The FS-8 case ────────────────────────────────────────────────────────────────────────
// Speaker ASSERTED a false claim ("Women have XY sex chromosomes"). Canonical verdict = False
// (correct). Expected polarity = asserts, so the card SHOULD air False. But the extractor
// misclassified polarity as "denies" → applyPolarity(False, denies) = True → aired True (WRONG).
// The verifier was RIGHT about the canonical claim; the error is entirely polarity.
test("FS-8: correct canonical verdict but wrong polarity → aired wrong, flagged as polarity fault", () => {
  const d = deriveAired({
    ground_truth_verdict: "False",   // canonical claim is false — verifier got this right
    expected_polarity: "asserts",    // speaker asserted it → should air False
    got_verdict: "False",            // verifier: correct
    got_polarity: "denies",          // MISCLASSIFIED → flips
  });
  assert.equal(d.expected_aired_verdict, "False", "asserts leaves ground truth unchanged");
  assert.equal(d.aired_verdict, "True", "denies flips the correct False to an aired True");
  assert.equal(d.aired_pass, false, "aired result does not match what should have aired");
  assert.equal(d.aired_wrong_from_polarity, true, "canonical was correct → the fault is polarity (FS-8)");
});

// ── The correct case ─────────────────────────────────────────────────────────────────────
// Same underlying claim, but the extractor got polarity right this time. Aired result matches.
test("correct polarity on the same claim → aired right, not flagged", () => {
  const d = deriveAired({
    ground_truth_verdict: "False",
    expected_polarity: "asserts",
    got_verdict: "False",
    got_polarity: "asserts",   // correct
  });
  assert.equal(d.aired_verdict, "False");
  assert.equal(d.aired_pass, true);
  assert.equal(d.aired_wrong_from_polarity, false);
});

// ── pol-006 convention check: ground_truth is the CANONICAL verdict, aired is derived ──────
// "Nixon didn't finish his second term" — expected_extraction "Nixon finished his second term",
// ground_truth_verdict False (canonical), expected_polarity denies → should air True.
test("pol-006 convention: expected aired verdict is derived, not the raw ground truth", () => {
  const d = deriveAired({
    ground_truth_verdict: "False",   // verdict on the CANONICAL positive claim
    expected_polarity: "denies",     // speaker denied it (and was right)
    got_verdict: "False",            // verifier agrees the positive form is false
    got_polarity: "denies",          // extractor got polarity right
  });
  assert.equal(d.expected_aired_verdict, "True", "applyPolarity(False, denies) = True is what should air");
  assert.equal(d.aired_verdict, "True");
  assert.equal(d.aired_pass, true, "raw ground truth False ≠ aired True — comparing to raw would falsely fail");
  assert.equal(d.aired_wrong_from_polarity, false);
});

// ── suspect_denies (R46 tripwire) normalizes to denies for derivation ──────────────────────
test("suspect_denies behaves as denies in derivation", () => {
  const plain = deriveAired({ ground_truth_verdict: "True", expected_polarity: "denies", got_verdict: "True", got_polarity: "denies" });
  const suspect = deriveAired({ ground_truth_verdict: "True", expected_polarity: "denies", got_verdict: "True", got_polarity: "suspect_denies" });
  assert.equal(suspect.aired_verdict, plain.aired_verdict);
  assert.equal(suspect.aired_pass, plain.aired_pass);
});

// ── Verifier-wrong (not polarity) is NOT counted as an FS-8 polarity fault ──────────────────
test("aired wrong because the verifier got the canonical verdict wrong is not a polarity fault", () => {
  const d = deriveAired({
    ground_truth_verdict: "True",    // canonical is actually True
    expected_polarity: "asserts",
    got_verdict: "False",            // verifier WRONG on canonical
    got_polarity: "asserts",         // polarity correct
  });
  assert.equal(d.aired_pass, false, "aired result is wrong");
  assert.equal(d.aired_wrong_from_polarity, false, "the fault is the verifier, not polarity");
});

// ── polarity_conflict tripwire is surfaced ─────────────────────────────────────────────────
test("an unknown polarity value surfaces polarity_conflict from applyPolarity", () => {
  const d = deriveAired({ ground_truth_verdict: "True", expected_polarity: "asserts", got_verdict: "True", got_polarity: "negates" });
  assert.equal(d.polarity_conflict, true, "applyPolarity flags the conservative tripwire");
  assert.equal(d.aired_verdict, "True", "conflict leaves the verdict unchanged (held upstream, not flipped)");
});

// ── Report counting: the 'would have aired wrong' count aggregates correctly ────────────────
// Mirrors eval/report.js's aired slice: it filters recorded rows on r.aired_wrong_from_polarity to
// produce the FS-8 number. Build a mixed batch of hand-built rows and assert the count.
test("report-style aggregation counts exactly the polarity-caused aired failures (the FS-8 number)", () => {
  const cases = [
    // FS-8: correct canonical, wrong polarity → aired wrong from polarity  ✗(polarity)
    { ground_truth_verdict: "False", expected_polarity: "asserts", got_verdict: "False", got_polarity: "denies" },
    // another FS-8-shaped one, denies row: correct canonical True, got asserts → flips ✗(polarity)
    { ground_truth_verdict: "True", expected_polarity: "denies", got_verdict: "True", got_polarity: "asserts" },
    // correct end to end                                                    ✓
    { ground_truth_verdict: "False", expected_polarity: "asserts", got_verdict: "False", got_polarity: "asserts" },
    // verifier wrong (not polarity)                                         ✗(verifier, not counted)
    { ground_truth_verdict: "True", expected_polarity: "asserts", got_verdict: "False", got_polarity: "asserts" },
    // correct denies row aired right                                        ✓
    { ground_truth_verdict: "False", expected_polarity: "denies", got_verdict: "False", got_polarity: "denies" },
  ];

  // Simulate what run.js records onto each result row, then aggregate like report.js does.
  const rows = cases.map((c) => {
    const d = deriveAired(c);
    return { aired_verdict: d.aired_verdict, aired_pass: d.aired_pass, aired_wrong_from_polarity: d.aired_wrong_from_polarity };
  });

  const airedRows = rows.filter((r) => r.aired_pass != null && r.aired_verdict != null);
  const airedCorrect = airedRows.filter((r) => r.aired_pass);
  const airedWrongFromPolarity = airedRows.filter((r) => r.aired_wrong_from_polarity);
  const airedWrongOther = airedRows.filter((r) => !r.aired_pass && !r.aired_wrong_from_polarity);

  assert.equal(airedRows.length, 5);
  assert.equal(airedCorrect.length, 2, "two rows aired correctly");
  assert.equal(airedWrongFromPolarity.length, 2, "exactly two polarity-caused aired failures — the FS-8 number");
  assert.equal(airedWrongOther.length, 1, "one aired failure came from the verifier, not polarity");
});

// ── Sanity: deriveAired stays consistent with applyPolarity directly ───────────────────────
test("aired_verdict equals applyPolarity(got_verdict, got_polarity).verdict", () => {
  for (const gv of ["True", "False", "Misleading", "Unverifiable"]) {
    for (const gp of ["asserts", "denies", null]) {
      const d = deriveAired({ ground_truth_verdict: "True", expected_polarity: "asserts", got_verdict: gv, got_polarity: gp });
      assert.equal(d.aired_verdict, applyPolarity(gv, gp).verdict);
    }
  }
});
