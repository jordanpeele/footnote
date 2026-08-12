#!/usr/bin/env node
// Footnote calibration report v2 — consumes a results JSONL from eval/run.js and decides,
// per claim category, whether it earns auto-air (Decision D3). Dependency-free Node ESM.
//
//   node eval/report.js [eval/results/<stamp>.jsonl]   (defaults to newest file in eval/results/)
//
// v2 (harness v2, Decision D11): consumes BOTH scorers when present — token-F1 (v1) and
// the meaning-level LLM judge (eval/judge.js, runs with `node eval/run.js --judge`).
// Auto-air eligibility now requires both scorers clean at the bar: the existing precision
// gate (>= PRECISION_THRESHOLD at CONF_FLOOR on >= MIN_SCORED_AT_FLOOR samples) AND zero
// uninvestigated polarity inversions. Human-adjudicated rows (`"adjudicated": true`,
// edited in place in the results file after review) are treated as authoritative: their
// edited extract_pass/judge_match stand, and they no longer count as uninvestigated or
// as open disagreements.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---- TUNABLE thresholds (Decision D3) ----
const CONF_FLOOR = 0.85;            // the auto-air confidence floor used on air
const PRECISION_THRESHOLD = 0.95;   // required precision among verdicts at/above the floor
const MIN_SCORED_AT_FLOOR = 20;     // minimum scored samples at the floor before we trust the number

// Structurally ineligible categories — hardcoded, not tunable, regardless of numbers.
//
// Decision D4: claims about named individuals NEVER auto-air, no matter how well the
// numbers calibrate — the downside (defaming a real person on a live broadcast) is
// unbounded and precision stats cannot price it.
//
// Decision D11: quotes ineligible until harness-v2-verified calibration clears them —
// the Einstein inversion (token-F1 scored "Einstein did NOT say X" as a 0.828 PASS
// against a claim asserting he did) means every pre-v2 quote calibration number is
// suspect. Lifting this block is an explicit decision after a clean judged run, not a
// threshold crossing.
const NEVER_ELIGIBLE = new Map([
  ["person_claims", { verdict: "NEVER", cls: "D4", reason: "Decision D4 — person claims never auto-air, regardless of calibration" }],
  ["attributed_quotes", { verdict: "BLOCKED", cls: "D11", reason: "Decision D11 — quotes ineligible until harness-v2-verified calibration clears them" }],
  // R51 (post-calibration-#4): adversarial met the numeric bar (96.9%) and is PERMANENTLY
  // manual-only anyway — auto-airing verdicts on adversarial input invites gaming as content.
  // Its eligibility stands as a calibration FACT; the category policy overrides it.
  ["adversarial", { verdict: "NEVER", cls: "R51", reason: "Ruling R51 — adversarial claims never auto-air; eligibility is a calibration fact only" }],
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "results");

function latestResults() {
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, m: statSync(join(RESULTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!files.length) { console.error("no result files in eval/results/ — run eval/run.js first"); process.exit(1); }
  return join(RESULTS_DIR, files[0].f);
}

const path = process.argv[2] || latestResults();
const rows = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// Standing human rulings persist ACROSS runs (calibration #4 finding: adjudicated:true lived
// only on the run-#2 file, so fresh runs re-flagged already-ruled inversions). The registry
// (eval/adjudications.json, mirrors ADJUDICATIONS.md) is merged onto any row that doesn't
// carry its own in-file adjudication — in-file edits win, the registry is the fallback.
try {
  const reg = JSON.parse(readFileSync(join(__dirname, "adjudications.json"), "utf8")).rulings || {};
  for (const r of rows) {
    if (r.adjudicated !== true && reg[r.id]) {
      r.adjudicated = true;
      r.adjudication = reg[r.id].adjudication;
      if (reg[r.id].extract_pass_override === true) r.extract_pass = true;
      r.adjudication_source = "registry";
    }
  }
} catch {}   // no registry file → nothing to merge

const cats = new Map();
for (const r of rows) {
  if (!cats.has(r.category)) cats.set(r.category, []);
  cats.get(r.category).push(r);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const f2 = (x) => (x == null ? " n/a" : x.toFixed(2));

const fileHasJudge = rows.some((r) => r.judged || r.judge_match != null);
console.log(`Footnote calibration report (v2) — ${path}`);
console.log(`cases: ${rows.length} | thresholds: conf floor ${CONF_FLOOR}, precision >= ${PRECISION_THRESHOLD}, n at floor >= ${MIN_SCORED_AT_FLOOR}`);
console.log(`judge scoring: ${fileHasJudge ? "present (harness v2)" : "ABSENT — token-F1 only; re-run with --judge for harness-v2 eligibility"}\n`);

const eligible = [], ineligible = []; // ineligible: {cat, cls, verdict, reason}
for (const [cat, rs] of [...cats.entries()].sort()) {
  // --- extraction: token scorer ---
  const exScored = rs.filter((r) => r.extract_match !== "http-error");
  const exPass = exScored.filter((r) => r.extract_pass);
  const exact = exScored.filter((r) => r.extract_match === "exact" || r.extract_match === "null-null").length;
  const fuzzy = exScored.filter((r) => r.extract_match?.startsWith("fuzzy")).length;

  // --- extraction: judge scorer (harness v2) ---
  // Exact/null-null passes skip the judge by design (they can't be inverted) and count as
  // meaning-clean. Judge-clean % = (exact passes + judged same_claim) / token-scored rows.
  const catHasJudge = rs.some((r) => r.judged || r.judge_match != null);
  const judged = rs.filter((r) => r.judge_match != null);
  const sameClaim = judged.filter((r) => r.judge_match === "same_claim").length;
  const inversions = judged.filter((r) => r.judge_match === "polarity_inverted");
  const uninvestigatedInversions = inversions.filter((r) => r.adjudicated !== true);
  const openDisagreements = rs.filter((r) => r.disagreement && r.adjudicated !== true);
  const judgeErrors = judged.filter((r) => r.judge_match === "judge_error").length;
  const judgeClean = exact + sameClaim;

  // --- verdicts (only rows that ran stage 2 and have ground truth) ---
  const vScored = rs.filter((r) => r.ground_truth_verdict && r.got_verdict != null);
  const vCorrect = vScored.filter((r) => r.verdict_pass);
  const confCorrect = vCorrect.map((r) => r.confidence).filter((c) => typeof c === "number");
  const confWrong = vScored.filter((r) => !r.verdict_pass).map((r) => r.confidence).filter((c) => typeof c === "number");

  // --- calibration at the auto-air floor ---
  const atFloor = vScored.filter((r) => typeof r.confidence === "number" && r.confidence >= CONF_FLOOR);
  const atFloorCorrect = atFloor.filter((r) => r.verdict_pass);
  const precisionAtFloor = atFloor.length ? atFloorCorrect.length / atFloor.length : null;

  console.log(`── ${cat} ${"─".repeat(Math.max(1, 46 - cat.length))}`);
  console.log(`  token      : ${pct(exPass.length, exScored.length)} pass (${exPass.length}/${exScored.length}) — exact/null ${exact}, fuzzy ${fuzzy}`);
  if (catHasJudge) {
    console.log(`  judge      : ${pct(judgeClean, exScored.length)} clean (${judgeClean}/${exScored.length}) — inversions ${inversions.length} (${uninvestigatedInversions.length} uninvestigated), disagreements ${openDisagreements.length} open${judgeErrors ? `, judge_error ${judgeErrors}` : ""}`);
  } else {
    console.log(`  judge      : no judge data (run with --judge)`);
  }
  if (vScored.length) {
    console.log(`  verdicts   : ${pct(vCorrect.length, vScored.length)} correct (${vCorrect.length}/${vScored.length})`);
    console.log(`  confidence : mean ${f2(mean(confCorrect))} when correct vs ${f2(mean(confWrong))} when wrong`);
    console.log(`  @floor ${CONF_FLOOR}: n=${atFloor.length}, precision ${precisionAtFloor == null ? "n/a" : pct(atFloorCorrect.length, atFloor.length)}`);
  } else {
    console.log(`  verdicts   : no stage-2 data (run without --extract-only to score)`);
  }

  // --- auto-air eligibility (Decision D3 gate + D4/D11 structural blocks) ---
  // Reason classes: D4 | D11 | below-bar | insufficient-n.
  let verdict, reason, cls = null;
  if (NEVER_ELIGIBLE.has(cat)) {
    ({ verdict, cls, reason } = NEVER_ELIGIBLE.get(cat));
  } else if (!vScored.length) {
    verdict = "NO DATA"; cls = "insufficient-n"; reason = "no scored verdicts in this results file";
  } else if (atFloor.length < MIN_SCORED_AT_FLOOR) {
    verdict = "INSUFFICIENT"; cls = "insufficient-n"; reason = `only ${atFloor.length} scored samples at floor (need ${MIN_SCORED_AT_FLOOR})`;
  } else if (precisionAtFloor < PRECISION_THRESHOLD) {
    verdict = "NOT ELIGIBLE"; cls = "below-bar"; reason = `precision ${pct(atFloorCorrect.length, atFloor.length)} at floor < ${PRECISION_THRESHOLD}`;
  } else if (!catHasJudge) {
    verdict = "NOT ELIGIBLE"; cls = "below-bar"; reason = "no judge scoring in this run — harness v2 requires both scorers (re-run with --judge)";
  } else if (uninvestigatedInversions.length > 0) {
    verdict = "NOT ELIGIBLE"; cls = "below-bar"; reason = `${uninvestigatedInversions.length} uninvestigated polarity inversion(s): ${uninvestigatedInversions.map((r) => r.id).join(", ")}`;
  } else if (openDisagreements.length > 0) {
    verdict = "NOT ELIGIBLE"; cls = "below-bar"; reason = `${openDisagreements.length} scorer disagreement(s) awaiting adjudication: ${openDisagreements.map((r) => r.id).join(", ")}`;
  } else {
    verdict = "ELIGIBLE"; reason = `both scorers clean — precision ${pct(atFloorCorrect.length, atFloor.length)} at floor on n=${atFloor.length}, zero uninvestigated inversions`;
  }
  console.log(`  AUTO-AIR   : ${verdict}${cls ? ` [${cls}]` : ""} — ${reason}\n`);
  if (verdict === "ELIGIBLE") eligible.push(cat);
  else ineligible.push({ cat, cls, verdict, reason });
}

// ── Task 0 · polarity slice (F-1) — over goldens carrying expected_polarity ─────────────
// The one wrong card ever aired (FS-8) was a polarity misclassification the verdict eval
// couldn't see. This measures the extractor's polarity field directly and, critically,
// separates the two failure directions:
//   • FS-8 class  — asserts labelled denies (R46 tripwire catches the no-negation subset)
//   • MIRROR class — denies labelled asserts (UNGUARDED; airs FALSE against someone right)
const polRows = rows.filter((r) => r.expected_polarity != null && r.got_polarity != null);
if (polRows.length) {
  const norm = (p) => (p === "suspect_denies" ? "denies" : p);
  const correct = polRows.filter((r) => norm(r.got_polarity) === r.expected_polarity);
  const fs8 = polRows.filter((r) => r.expected_polarity === "asserts" && norm(r.got_polarity) === "denies");
  const mirror = polRows.filter((r) => r.expected_polarity === "denies" && norm(r.got_polarity) === "asserts");
  const tripwireCaught = fs8.filter((r) => r.got_polarity === "suspect_denies" || r.got_tripwire === "negation" || r.polarity_no_negation);
  const tripwireMissed = fs8.filter((r) => !(r.got_polarity === "suspect_denies" || r.got_tripwire === "negation" || r.polarity_no_negation));
  console.log("─ polarity (F-1) ─".padEnd(50, "─"));
  console.log(`  scored          : ${polRows.length} (goldens with expected_polarity)`);
  console.log(`  polarity correct: ${pct(correct.length, polRows.length)}`);
  console.log(`  FS-8 class      : ${fs8.length} asserts→denies  (R46 tripwire would catch ${tripwireCaught.length}, MISS ${tripwireMissed.length}${tripwireMissed.length ? ": " + tripwireMissed.map((r) => r.id).join(", ") : ""})`);
  console.log(`  MIRROR class    : ${mirror.length} denies→asserts  (UNGUARDED — no tripwire${mirror.length ? ": " + mirror.map((r) => r.id).join(", ") : ""})`);
  console.log("");
}

// ── Task 0b · aired-verdict slice — over --aired runs ────────────────────────────────────
// The polarity slice above scores the extractor's polarity FIELD in isolation. This slice scores
// the end-to-end AIRED verdict: the verifier's verdict on the canonical claim mapped through the
// actual polarity (applyPolarity), compared to the DERIVED ground-truth aired verdict. It is the
// only place the eval sees the FS-8 combination — a CORRECT canonical verdict that nonetheless
// AIRS WRONG because polarity was misclassified. `aired_wrong_from_polarity` counts exactly that;
// it is the number that would have caught FS-8 on air.
const airedRows = rows.filter((r) => r.aired_pass != null && r.aired_verdict != null);
if (airedRows.length) {
  const airedCorrect = airedRows.filter((r) => r.aired_pass);
  const airedWrongFromPolarity = airedRows.filter((r) => r.aired_wrong_from_polarity);
  const conflicts = airedRows.filter((r) => r.polarity_conflict);
  // Aired wrong for OTHER reasons (verifier got the canonical verdict wrong too) — not the FS-8 class.
  const airedWrongOther = airedRows.filter((r) => !r.aired_pass && !r.aired_wrong_from_polarity);
  console.log("─ aired verdict (Task 0b) ─".padEnd(50, "─"));
  console.log(`  scored              : ${airedRows.length} (goldens with expected_polarity + ground_truth)`);
  console.log(`  aired accuracy      : ${pct(airedCorrect.length, airedRows.length)} (${airedCorrect.length}/${airedRows.length})`);
  console.log(`  AIRED WRONG (polarity): ${airedWrongFromPolarity.length}  ← canonical verdict CORRECT but aired result flipped — the FS-8 number${airedWrongFromPolarity.length ? ": " + airedWrongFromPolarity.map((r) => r.id).join(", ") : ""}`);
  console.log(`  aired wrong (verifier): ${airedWrongOther.length}  (canonical verdict also wrong — not a polarity fault)`);
  console.log(`  polarity conflicts  : ${conflicts.length}  (applyPolarity tripwire fired → held, never auto-aired)`);
  console.log("");
}

console.log("═".repeat(50));
console.log(`auto-air eligible : ${eligible.length ? eligible.join(", ") : "(none yet)"}`);
console.log(`held for operator :`);
for (const { cat, cls, verdict, reason } of ineligible) {
  console.log(`  ${cat.padEnd(20)} ${String(verdict).padEnd(13)} [${cls}] ${reason}`);
}
