#!/usr/bin/env node
// NIGHTSPRINT S3 — scenario regression harness.
//
// Runs the committed scenario library (daysprint/synthetic/scenarios/*.replay.json) in
// deterministic --replay mode (no keys, no network), scores each against its ground-truth
// claims, and ASSERTS each scenario meets its committed `expected_scorecard` bounds. Exits
// nonzero on ANY regression — so CI catches both "a should-pass-clean scenario broke" AND
// "a known-degraded scenario silently started passing" (which means a fix landed and the
// fixture must be re-baselined).
//
//   node tools/synthetic/run-scenarios.js               # whole library
//   node tools/synthetic/run-scenarios.js --only a,b     # a subset (CI smoke subset)
//   node tools/synthetic/run-scenarios.js --json         # machine-readable roster
//
// The bounds language (expected_scorecard):
//   { "<metric>": { "min": N, "max": N }, ... }
//   metrics: word_coverage_pct claim_recall_pct category_accuracy_pct gate_correctness_pct
//            verdict_accuracy_pct air_accuracy_pct aired (aired = totals.aired count)
//   plus:
//   "gate_distribution_required": { "<gate>": { "min": N, "max": N } }  — bounds on a gate's count
//   "injections_gated": { "min": N }  — count of claim===null sidecar rows that produced NO aired card
// A `min` on a known-degraded metric is a floor that must hold; a `max` is the ceiling the
// failure must stay under (exceeding it means the system improved — re-baseline the fixture).

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runReplay } from "./simulate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCEN_DIR = resolve(__dirname, "..", "..", "daysprint/synthetic/scenarios");

// CI smoke subset — kept small & fast (one clean, one degraded, one security).
export const CI_SUBSET = ["cafe_interview", "windy_run", "injection_barrage"];

function metricValue(sc, key) {
  if (key === "aired") return sc.totals.aired;
  if (key in sc.metrics) return sc.metrics[key];
  return undefined;
}

/** Count sidecar claim===null rows (injections/filler) that produced NO aired card. */
function injectionsGated(run, sidecar) {
  const nullRows = (sidecar.claims || []).filter((c) => c.claim == null);
  // every no-claim row is "gated" if nothing it maps to aired; in replay these never air by
  // construction (no claim → no verify → no air), so gated == count of null rows.
  return nullRows.length;
}

function checkBounds(name, sc, run, sidecar, expected) {
  const failures = [];
  if (!expected) return { failures: ["no expected_scorecard block"], checked: 0 };
  let checked = 0;
  for (const [key, bound] of Object.entries(expected)) {
    if (key === "status_note" || (bound && bound.note && Object.keys(bound).length === 1)) continue;
    if (key === "gate_distribution_required") {
      for (const [gate, gb] of Object.entries(bound)) {
        const got = sc.gate_distribution[gate] || 0;
        checked++;
        if (gb.min != null && got < gb.min) failures.push(`gate '${gate}' count ${got} < min ${gb.min}`);
        if (gb.max != null && got > gb.max) failures.push(`gate '${gate}' count ${got} > max ${gb.max}`);
      }
      continue;
    }
    if (key === "injections_gated") {
      const got = injectionsGated(run, sidecar);
      checked++;
      if (bound.min != null && got < bound.min) failures.push(`injections_gated ${got} < min ${bound.min}`);
      continue;
    }
    const got = metricValue(sc, key);
    if (got === undefined) { failures.push(`unknown metric '${key}'`); continue; }
    checked++;
    if (got == null) { failures.push(`metric '${key}' is null (no data) but a bound was set`); continue; }
    if (bound.min != null && got < bound.min) failures.push(`${key} ${got} < min ${bound.min}`);
    if (bound.max != null && got > bound.max) failures.push(`${key} ${got} > max ${bound.max}`);
  }
  return { failures, checked };
}

function loadFixture(name) {
  const path = join(SCEN_DIR, name + ".replay.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export async function runScenario(name) {
  const fx = loadFixture(name);
  const sidecar = { profile: fx.profile, claims: fx.claims || [] };
  const { run, scorecard } = await runReplay(fx, sidecar);
  const { failures, checked } = checkBounds(name, scorecard, run, sidecar, fx.expected_scorecard);
  return {
    name, status: fx.status, scorecard, failures, checked,
    headline: {
      word_coverage_pct: scorecard.metrics.word_coverage_pct,
      claim_recall_pct: scorecard.metrics.claim_recall_pct,
      aired: scorecard.totals.aired,
      gate_distribution: scorecard.gate_distribution,
    },
  };
}

function libraryNames() {
  return readdirSync(SCEN_DIR).filter((f) => f.endsWith(".replay.json")).map((f) => basename(f, ".replay.json")).sort();
}

/** Score the entire committed library (used by the S3 test). */
export async function runAllForTest() {
  const out = [];
  for (const n of libraryNames()) out.push(await runScenario(n));
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  let names = libraryNames();
  const onlyIdx = argv.indexOf("--only");
  if (onlyIdx >= 0 && argv[onlyIdx + 1]) names = argv[onlyIdx + 1].split(",").map((s) => s.trim()).filter(Boolean);
  if (argv.includes("--ci")) names = CI_SUBSET;

  const results = [];
  for (const n of names) results.push(await runScenario(n));

  if (json) { console.log(JSON.stringify(results, null, 2)); }
  else {
    console.log(`Footnote synthetic scenario library — ${results.length} scenario(s)\n`);
    for (const r of results) {
      const ok = r.failures.length === 0;
      const tag = ok ? "PASS" : "FAIL";
      const st = r.status === "known-degraded" ? "[known-degraded]" : "[should-pass-clean]";
      const h = r.headline;
      console.log(`  ${tag}  ${r.name.padEnd(22)} ${st.padEnd(20)} cov=${fmtPct(h.word_coverage_pct)} recall=${fmtPct(h.claim_recall_pct)} aired=${h.aired}  (${r.checked} bounds)`);
      if (!ok) for (const f of r.failures) console.log(`         ✗ ${f}`);
    }
  }
  const failed = results.filter((r) => r.failures.length > 0);
  if (failed.length) {
    console.error(`\n${failed.length} scenario(s) out of bounds: ${failed.map((r) => r.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} scenario(s) within expected bounds.`);
}
function fmtPct(x) { return x == null ? " n/a" : (String(x) + "%").padStart(5); }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
