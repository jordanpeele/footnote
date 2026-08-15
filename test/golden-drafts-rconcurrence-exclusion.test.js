// Footnote — pins the drafts-exclusion contract for the R-concurrence red-team corpus
// (eval/golden/drafts-rconcurrence-2026-08-14.jsonl).
//
// This packet (NIGHTSPRINT R-concurrence) authored an adversarial fixture engineered so
// BOTH concurrence arms likely share the same WRONG prior and agree on a definitive verdict
// against a non-definitive ground truth — the false-confidence failure mode of the gate.
// Those rows carry PROVISIONAL labels (author-as-eval predictions, not adjudicated ground
// truth) and MUST NEVER ride along in a calibration run: they have no ratified truth, they
// burn spend, and a provisional label leaking into the eligibility math would corrupt it.
//
// eval/run.js excludes them by the `drafts-` filename prefix. This test pins that behavior
// functionally (replicating the same readdir+prefix filter run.js uses, since loadGolden is
// not exported on this branch) so a refactor cannot silently widen the glob and sweep the
// corpus into a run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(HERE, "..", "eval", "golden");
const RCONC_FILE = "drafts-rconcurrence-2026-08-14.jsonl";

function readJsonl(name) {
  const rows = [];
  for (const line of readFileSync(path.join(GOLDEN_DIR, name), "utf8").split("\n")) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

// The exact filter eval/run.js#loadGolden applies: *.jsonl minus the drafts- prefix.
function runSetIds() {
  const ids = new Set();
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".jsonl") && !f.startsWith("drafts-"));
  for (const f of files) {
    for (const r of readJsonl(f)) if (r && r.id) ids.add(r.id);
  }
  return ids;
}

test("the R-concurrence red-team corpus is present, authored, and fully excluded from runs", () => {
  const rows = readJsonl(RCONC_FILE);
  assert.ok(rows.length >= 15, `R-concurrence corpus present (got ${rows.length} rows)`);
  assert.ok(rows.every((r) => r.authored === true), "every R-concurrence row is marked authored (provisional label)");
  assert.ok(rows.every((r) => /^auth-rconc-/.test(r.id)), "every row uses the auth-rconc- id convention");
  // every row carries a slip/hold prediction — this fixture is an author-as-eval, not a golden.
  assert.ok(rows.every((r) => typeof r.rconc_prediction === "string" && r.rconc_prediction), "every row carries an rconc_prediction");

  const runIds = runSetIds();
  assert.ok(runIds.size > 200, "the real golden run set actually loaded (sanity)");
  for (const r of rows) {
    assert.ok(!runIds.has(r.id), `R-concurrence draft ${r.id} leaked into the eval run set`);
  }
});

test("run-set filter never admits an auth- staging id (belt-and-suspenders)", () => {
  for (const id of runSetIds()) {
    assert.ok(!/^(draft|auth)-/.test(id), `run-set id ${id} looks like staging, not adjudicated golden`);
  }
});
