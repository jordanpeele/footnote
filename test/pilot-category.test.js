// Category contract, post-R72 (2026-08-18 operator ruling). History: R57 moved the D18
// pilot's category scope from protocol into CODE after session 2's breach ("Silver is
// worth more than bronze" machine-aired). R72 supersedes R57: the category ALLOWLIST is
// GONE — when the operator enables Auto-air, every settled check airs after the veto
// window, regardless of category. What this file still pins:
//   - parseExtraction emits `category` from the closed six-value set (the extractor's
//     classification contract is unchanged — categories remain in the session record)
//   - unknown / missing / junk category collapses to "other" (parse-layer integrity)
//   - app.js maybeAutoAir carries NO category gate — a category check reappearing in the
//     gate means R72 was quietly reverted, and this test failing on that edit is the tripwire
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseExtraction } from "../src/adapters/extractor/anthropic-haiku/index.js";

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
  // unparseable envelope → bare-claim fallback still classifies as "other"
  assert.equal(parseExtraction("just a bare sentence with no json").category, "other");
});

test("R72: app.js maybeAutoAir carries no category gate (reverting the ruling is an edit this test must catch)", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /c\.category !== "science_health"/, "the R57 category gate must stay gone (R72)");
  assert.doesNotMatch(app, /PILOT_CATEGORY_ALLOWLIST/, "no allowlist reference may return to app.js (R72)");
  // the toggle is the whole gate: maybeAutoAir's first act is the checkbox check
  assert.match(app, /function maybeAutoAir\(c\) \{\s*\n\s*if \(!byId\("autoAir"\)\.checked\) return;/, "the Auto-air toggle is the first and only pre-arm gate");
});
