// Footnote — pins the drafts-exclusion contract of the eval harness.
//
// eval/golden/drafts-*.jsonl are UNADJUDICATED staging: session ingests awaiting the
// cockpit sitting, and — since packet 3a — AUTHORED candidate files
// (drafts-authored-*.jsonl) whose labels are PROVISIONAL until the operator ratifies
// them. Neither may ever ride along in an eval run: they have no adjudicated ground
// truth, they burn spend (calibration #4 burned ~$2 exactly this way), and a
// provisional label leaking into calibration numbers would corrupt the auto-air
// eligibility math. run.js excludes them by filename prefix; this test pins that
// behavior functionally (via the exported loadGolden) so a refactor can't silently
// widen the glob.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGolden } from "../eval/run.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(HERE, "..", "eval", "golden");

function draftRows() {
  const rows = [];
  for (const f of readdirSync(GOLDEN_DIR).filter((n) => n.startsWith("drafts-") && n.endsWith(".jsonl"))) {
    for (const line of readFileSync(path.join(GOLDEN_DIR, f), "utf8").split("\n")) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

test("loadGolden never loads drafts-*.jsonl rows (incl. the AUTHORED candidate file)", () => {
  const drafts = draftRows();
  assert.ok(drafts.length >= 141, `drafts staging present (got ${drafts.length} rows) — precondition for the exclusion check`);
  assert.ok(drafts.some((r) => r.authored === true), "AUTHORED candidate rows present in staging");

  const loadedIds = new Set(loadGolden(null).map((c) => c.id));
  assert.ok(loadedIds.size > 200, "golden set actually loaded");
  for (const d of drafts) {
    assert.ok(!loadedIds.has(d.id), `draft row ${d.id} leaked into the eval run set`);
  }
  // belt-and-suspenders: no loaded id uses a draft/authored id convention
  for (const id of loadedIds) {
    assert.ok(!/^(draft|auth)-/.test(id), `loaded id ${id} looks like staging, not golden`);
  }
});

test("loadGolden category filter still excludes drafts for the categories being grown", () => {
  for (const category of ["attributed_quotes", "polarity_traps"]) {
    const ids = loadGolden(category).map((c) => c.id);
    assert.ok(ids.length > 0, `${category} goldens load`);
    assert.ok(ids.every((id) => !/^auth-/.test(id)), `${category}: no authored candidates in run set`);
  }
});
