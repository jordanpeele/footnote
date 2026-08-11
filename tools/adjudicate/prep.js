#!/usr/bin/env node
// Footnote adjudication cockpit — PREP STEP.
//   node tools/adjudicate/prep.js [--out tools/adjudicate/queue.json]
//
// Reads the three field-draft files (eval/golden/drafts-*.jsonl), dedupes by normalized
// claim (the 26 "Peter Thiel is the president…" repeats collapse to ONE card, etc.), and
// writes tools/adjudicate/queue.json — the work list the browser page walks card by card.
// Pure dedup logic lives in lib.js; this file is just the I/O around it.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeDrafts } from "./lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const GOLDEN = path.join(ROOT, "eval", "golden");

const DRAFT_FILES = [
  "drafts-2026-08-08-fieldtest.jsonl",
  "drafts-2026-08-09-pass2.jsonl",
  "drafts-2026-08-10-street.jsonl",
];

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : path.join(HERE, "queue.json");

function readJsonl(file) {
  const rows = [];
  const text = readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    rows.push(JSON.parse(t));
  }
  return rows;
}

const allRows = [];
const sourceFiles = [];
for (const name of DRAFT_FILES) {
  const file = path.join(GOLDEN, name);
  if (!existsSync(file)) {
    console.error(`note: ${name} not present (already graduated?) — skipping`);
    continue;
  }
  sourceFiles.push(name);
  for (const r of readJsonl(file)) rows_push(r, name);
}
function rows_push(r, name) { r._sourceDraft = name; allRows.push(r); }

const entries = dedupeDrafts(allRows);
const queue = {
  generated_at: new Date().toISOString(),
  source_files: sourceFiles,
  draft_count: allRows.length,
  unique_count: entries.length,
  entries,
};

writeFileSync(outPath, JSON.stringify(queue, null, 2) + "\n");
console.error(`prep: ${allRows.length} drafts across ${sourceFiles.length} file(s) -> ${entries.length} unique claim card(s)`);
console.error(`      wrote ${path.relative(ROOT, outPath)}`);
