// Category + gate-shape contract, post-D19 (2026-08-20 two-mode architecture).
// History: R57 moved the pilot's category scope into CODE; R72 (8/18) removed every gate;
// the 8/20 pilot-ledger reconciliation produced D19, which restores the earned stack as
// VERIFIED mode and gives "everything airs" a legitimate, disclosed home as OPEN mode —
// with D4 ABSOLUTE above both. These pins are the tripwire: moving any of this again is
// an edit this file must catch.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseExtraction } from "../src/adapters/extractor/anthropic-haiku/index.js";

const APP = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("parseExtraction passes through every closed-set category", () => {
  for (const cat of ["science_health", "politics_government", "economics_business", "history_geography", "sports_culture", "other"]) {
    const r = parseExtraction(`{"claim": "X is Y", "polarity": "asserts", "harm_class": "none", "category": "${cat}"}`);
    assert.equal(r.category, cat);
  }
});

test("unknown / missing / junk category collapses to 'other'", () => {
  assert.equal(parseExtraction('{"claim": "X", "polarity": "asserts", "harm_class": "none", "category": "finance"}').category, "other");
  assert.equal(parseExtraction('{"claim": "X", "polarity": "asserts", "harm_class": "none"}').category, "other");
  assert.equal(parseExtraction('{"claim": "X", "category": 42}').category, "other");
  assert.equal(parseExtraction("just a bare sentence with no json").category, "other");
});

test("D19/D4-ABSOLUTE pin: the harm-class hold is maybeAutoAir's FIRST act, above the mode switch", () => {
  const fn = APP.slice(APP.indexOf("function maybeAutoAir"), APP.indexOf("function maybeAutoAir") + 900);
  const holdIdx = fn.indexOf('c.harm_class === "person_private" || c.harm_class === "person_public" || c.harm_class === "quote_attribution"');
  const conflictIdx = fn.indexOf("if (c.polarity_conflict) return;");
  const toggleIdx = fn.indexOf('byId("autoAir")');
  const modeIdx = fn.indexOf('fcMode() === "verified"');
  assert.ok(holdIdx > 0 && conflictIdx > 0 && toggleIdx > 0 && modeIdx > 0, "all four gate stages must exist");
  assert.ok(holdIdx < toggleIdx && holdIdx < modeIdx, "D4 hold sits ABOVE the toggle and the mode switch — no setting may override");
  assert.ok(conflictIdx < toggleIdx && conflictIdx < modeIdx, "polarity-conflict hold likewise sits above both");
});

test("D19 pin: the R57 category gate exists and is scoped INSIDE the verified branch", () => {
  const fn = APP.slice(APP.indexOf("function maybeAutoAir"), APP.indexOf("function maybeAutoAir") + 1600);
  const modeIdx = fn.indexOf('if (fcMode() === "verified") {');
  const catIdx = fn.indexOf('if (c.category !== "science_health") return;');
  assert.ok(modeIdx > 0, "verified branch exists");
  assert.ok(catIdx > modeIdx, "category allowlist is VERIFIED-scoped — present, but not gating OPEN");
});

test("D19 pin: VERIFIED requires the concurrence verifier (fails closed on unknown)", () => {
  assert.match(APP, /activeVerifier !== "concurrence"/, "the posture check must exist");
  assert.match(APP, /let activeVerifier = null;/, "posture defaults to unknown → VERIFIED fails closed");
});

test("D19 pin: no global cap constant returns; VERIFIED cap is the clamped dial", () => {
  assert.doesNotMatch(APP, /AUTO_AIR_CAP\b/, "the old global cap must not return under that name");
  assert.match(APP, /VERIFIED_CAP_DEFAULT = 10/, "verified cap default is 10 as ruled");
  assert.match(APP, /Math\.min\(verifiedCapDial, VERIFIED_CAP_DEFAULT\)/, "the dial clamps ≤ default in VERIFIED (up only via OPEN)");
});
