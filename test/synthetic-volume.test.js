// NIGHTSPRINT S4 — volume-run aggregation unit test (CI-safe, keyless, deterministic).
//
// volume-run.js is a SCRIPT (hundreds of runs — not part of `npm test`). This test guards the
// one piece of it CI must not let rot: the aggregation that turns per-run failures into the
// ranked FAILURE CATALOG. It exercises aggregate()/coverageBaseline() on a tiny fixed input and
// pins the ranking invariant (impact = severity × frequency, sorted descending), so a future edit
// that breaks the ranking math fails the build without needing to run the whole volume sweep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, coverageBaseline } from "../tools/synthetic/volume-run.js";

// hand-built run set: three runs, a mix of failure types with known severities.
const RUNS = [
  { scenario: "windy_run", class: "base", status: "known-degraded",
    headline: { cov: 39.5, recall: 25, aired: 1 },
    failures: [
      { scenario: "windy_run", type: "claim_missed", severity: 4, detail: "x" },
      { scenario: "windy_run", type: "claim_missed", severity: 4, detail: "y" },
      { scenario: "windy_run", type: "coverage_drop", severity: 3, detail: "cov 39%" },
    ] },
  { scenario: "sci033", class: "base", status: "known-degraded",
    headline: { cov: 100, recall: 100, aired: 4 },
    failures: [
      { scenario: "sci033", type: "wrong_air_false_on_air", severity: 10, detail: "aired wrong" },
    ] },
  { scenario: "cafe_interview", class: "base", status: "should-pass-clean",
    headline: { cov: 100, recall: 57.1, aired: 4 },
    failures: [] },
];

test("S4 aggregate ranks by impact = severity × frequency, descending", () => {
  const agg = aggregate(RUNS);
  // impacts: claim_missed = 4×2 = 8 ; wrong_air = 10×1 = 10 ; coverage_drop = 3×1 = 3
  assert.equal(agg.ranked[0].type, "wrong_air_false_on_air", "highest single-hit severity leads");
  assert.equal(agg.ranked[0].impact, 10);
  assert.equal(agg.ranked[1].type, "claim_missed");
  assert.equal(agg.ranked[1].impact, 8);
  assert.equal(agg.ranked[1].count, 2);
  assert.equal(agg.ranked[2].type, "coverage_drop");
  assert.equal(agg.ranked[2].impact, 3);
  // monotonic non-increasing impact
  for (let i = 1; i < agg.ranked.length; i++) assert.ok(agg.ranked[i - 1].impact >= agg.ranked[i].impact, "ranked by impact");
  assert.equal(agg.totalFailures, 4);
  assert.equal(agg.totalRuns, 3);
});

test("S4 aggregate attributes each failure to its scenario", () => {
  const agg = aggregate(RUNS);
  const cm = agg.ranked.find((g) => g.type === "claim_missed");
  assert.deepEqual(cm.scenarios, [["windy_run", 2]], "both claim_missed hits belong to windy_run");
  const wa = agg.ranked.find((g) => g.type === "wrong_air_false_on_air");
  assert.deepEqual(wa.scenarios, [["sci033", 1]]);
});

test("S4 coverageBaseline reports only base runs, keyed by scenario", () => {
  const cov = coverageBaseline(RUNS);
  assert.equal(cov.windy_run.word_coverage_pct, 39.5);
  assert.equal(cov.windy_run.claim_recall_pct, 25);
  assert.equal(cov.windy_run.aired, 1);
  assert.equal(cov.windy_run.status, "known-degraded");
  assert.ok("cafe_interview" in cov, "a zero-failure base run still appears in the baseline");
});

test("S4 a variant (non-base) run is excluded from the coverage baseline", () => {
  const withVariant = [...RUNS, { scenario: "windy_run", class: "shred", status: "variant-shred", headline: { cov: 10, recall: 0, aired: 0 }, failures: [] }];
  const cov = coverageBaseline(withVariant);
  // the base windy_run number is preserved, not overwritten by the variant's 10%
  assert.equal(cov.windy_run.word_coverage_pct, 39.5);
});
