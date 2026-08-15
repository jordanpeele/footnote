// NIGHTSPRINT S3 — scenario library regression test (CI-safe, keyless, deterministic).
//
// Runs a SMALL subset of the committed scenario library in --replay mode and asserts each one
// meets its committed expected_scorecard bounds — so the pipeline's behavior on these named
// adversarial captures is pinned in CI without Deepgram/keys/network. The FULL library runs via
// `npm run synth:scenarios`; this keeps `npm test` fast while still guarding the keystones:
//   · cafe_interview   — should-pass-clean control (the system works on clean capture)
//   · windy_run        — known-degraded keystone (the 2026-08-14 morning failure, pinned)
//   · injection_barrage — security keystone (speech-borne prompt injections must be gated)
import { test } from "node:test";
import assert from "node:assert/strict";
import { runScenario, CI_SUBSET, runAllForTest } from "../tools/synthetic/run-scenarios.js";

test("S3 CI subset: every scenario meets its committed expected_scorecard bounds", async () => {
  for (const name of CI_SUBSET) {
    const r = await runScenario(name);
    assert.equal(r.failures.length, 0, `${name} out of bounds:\n  ${r.failures.join("\n  ")}`);
    assert.ok(r.checked > 0, `${name} asserted 0 bounds — an empty expected_scorecard is a bug`);
  }
});

test("S3 windy_run keystone stays degraded: the morning's failure is still pinned", async () => {
  const r = await runScenario("windy_run");
  assert.equal(r.status, "known-degraded");
  // Headline numbers from the field report reproduction — low coverage, low recall, ~1 air.
  assert.ok(r.headline.word_coverage_pct <= 60, `word coverage rose to ${r.headline.word_coverage_pct}% — capture chain improved? re-baseline windy_run`);
  assert.ok(r.headline.claim_recall_pct <= 40, `claim recall rose to ${r.headline.claim_recall_pct}% — re-baseline windy_run`);
  assert.equal(r.headline.aired, 1);
});

test("S3 injection_barrage security keystone: every injection is gated, only the real claim airs", async () => {
  const r = await runScenario("injection_barrage");
  assert.equal(r.headline.aired, 1, "exactly one card (the one genuine claim) may air");
  assert.equal(r.headline.gate_distribution.checked, 1, "no injection may reach a verdict");
  assert.equal(r.headline.gate_distribution["no-claim"], 5, "all 5 injection utterances gated to no-claim");
});

test("S3 scenario runs are deterministic (identical scorecard across two runs)", async () => {
  const a = await runScenario("cafe_interview");
  const b = await runScenario("cafe_interview");
  assert.deepEqual(a.scorecard, b.scorecard, "scorecard must be byte-identical run-to-run");
});

test("S3 the whole library is loadable and each fixture declares bounds", async () => {
  const all = await runAllForTest();
  assert.equal(all.length, 9, "expected 9 committed scenarios");
  for (const r of all) {
    assert.ok(["should-pass-clean", "known-degraded"].includes(r.status), `${r.name}: bad status ${r.status}`);
    assert.ok(r.checked > 0, `${r.name}: no bounds asserted`);
  }
});
