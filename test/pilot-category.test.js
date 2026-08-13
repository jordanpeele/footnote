// R57 (post-pilot-session-2): the D18 category scope moves from protocol into CODE.
// Session 2's breach — "Silver is worth more than bronze" (economics) machine-aired
// because scope was protocol-only and the operator improvised — must replay as: never
// arms. Contract pinned here:
//   - parseExtraction emits `category` from the closed six-value set
//   - unknown / missing / junk category collapses to "other" (fail-safe: "other" is
//     never allowlisted, so an unclassifiable claim is structurally unable to auto-air)
//   - PILOT_CATEGORY_ALLOWLIST is exactly ["science_health"] — expanding it is an
//     orchestrator decision, and this test failing on an edit is the tripwire
//   - the maybeAutoAir gate in app.js mirrors the tunable verbatim (source-scan, same
//     pattern as the conf-floor mirror)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseExtraction } from "../src/adapters/extractor/anthropic-haiku/index.js";
import { PILOT_CATEGORY_ALLOWLIST } from "../src/core/tunables.js";

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
  // unparseable envelope → bare-claim fallback must also be pilot-ineligible
  assert.equal(parseExtraction("just a bare sentence with no json").category, "other");
});

test("PILOT_CATEGORY_ALLOWLIST is exactly ['science_health'] (expanding it is a ruling, not an edit)", () => {
  assert.deepEqual(PILOT_CATEGORY_ALLOWLIST, ["science_health"]);
});

test("session-2 breach replay: the silver claim's category can never satisfy the gate", () => {
  // The extractor's own classification of the breach claim is economics_business; even if
  // it ever mislabeled, only exactly "science_health" passes the maybeAutoAir gate.
  const silver = parseExtraction('{"claim": "Silver is worth more than bronze.", "polarity": "asserts", "harm_class": "none", "category": "economics_business"}');
  assert.equal(PILOT_CATEGORY_ALLOWLIST.includes(silver.category), false, "economics can never arm");
  // session-1 science cards: unchanged
  const sci = parseExtraction('{"claim": "Smoking increases the risk of lung cancer.", "polarity": "asserts", "harm_class": "none", "category": "science_health"}');
  assert.equal(PILOT_CATEGORY_ALLOWLIST.includes(sci.category), true, "science_health still arms");
});

test("app.js maybeAutoAir mirrors the allowlist (change both together)", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  // the R57 gate line must exist inside maybeAutoAir and must check the same category
  assert.match(app, /if \(c\.category !== "science_health"\) return;/, "app.js carries the R57 category gate");
  for (const cat of PILOT_CATEGORY_ALLOWLIST) {
    assert.match(app, new RegExp(`c\\.category !== "${cat}"`), `app.js mirror covers allowlisted category ${cat}`);
  }
});
