#!/usr/bin/env node
// Footnote adjudication cockpit — PREP STEP.
//   node tools/adjudicate/prep.js [--out tools/adjudicate/queue.json]
//
// Reads EVERY field-draft file (eval/golden/drafts-*.jsonl — globbed, so new session
// ingests join the sitting automatically), dedupes by normalized claim (the 26 "Peter
// Thiel is the president…" repeats collapse to ONE card, etc.), merges the sitting
// hints (tools/adjudicate/hints.json — transcribed queue-doc recommendations + run-log
// annotations; suggestions only, never ground truth), sorts the cards into batchable
// clusters (same suggested category+verdict contiguous; policy families together), and
// writes tools/adjudicate/queue.json — the work list the browser page walks card by
// card. It also counts each golden category file and annotates how many adjudicated
// cards the category still needs to reach the n>=30 target. Pure logic lives in lib.js;
// this file is just the I/O around it.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dedupeDrafts, applyHints, orderForSitting, sittingCluster, categoryNeeds, CATEGORIES,
} from "./lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const GOLDEN = path.join(ROOT, "eval", "golden");

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

// Every drafts file present joins the sitting (they get deleted as they graduate).
const draftFiles = readdirSync(GOLDEN).filter((n) => /^drafts-.*\.jsonl$/.test(n)).sort();
if (!draftFiles.length) console.error("note: no drafts-*.jsonl present under eval/golden — empty queue");

const allRows = [];
for (const name of draftFiles) {
  for (const r of readJsonl(path.join(GOLDEN, name))) {
    r._sourceDraft = name;
    allRows.push(r);
  }
}

let entries = dedupeDrafts(allRows);

// Sitting hints (optional file): transcribed recommendations from the queue doc plus
// factual run-log annotations. Fill-only; the human ratifies everything in the cockpit.
const hintsPath = path.join(HERE, "hints.json");
let hintCount = 0;
if (existsSync(hintsPath)) {
  const hints = JSON.parse(readFileSync(hintsPath, "utf8")).hints || [];
  applyHints(entries, hints);
  hintCount = entries.filter((e) => e.hintNote || e.suggestedVerdict || e.suggestedCategory).length;
}

// Cluster-contiguous order so one ruling (batch-accept) covers each same-suggestion run.
entries = orderForSitting(entries);
for (const e of entries) e.cluster = sittingCluster(e);

const clusters = [];
for (const e of entries) {
  const last = clusters[clusters.length - 1];
  if (last && last.label === e.cluster) last.count += 1;
  else clusters.push({ label: e.cluster, count: 1 });
}

// Golden-set gap per category: current adjudicated count vs the n>=30 target.
const counts = {};
for (const c of CATEGORIES) {
  const file = path.join(GOLDEN, c.name + ".jsonl");
  counts[c.name] = existsSync(file) ? readJsonl(file).length : 0;
}
const categoryStats = categoryNeeds(counts);

const queue = {
  generated_at: new Date().toISOString(),
  source_files: draftFiles,
  draft_count: allRows.length,
  unique_count: entries.length,
  hinted_count: hintCount,
  categoryStats,
  clusters,
  entries,
};

writeFileSync(outPath, JSON.stringify(queue, null, 2) + "\n");
console.error(`prep: ${allRows.length} drafts across ${draftFiles.length} file(s) -> ${entries.length} unique claim card(s) in ${clusters.length} cluster(s), ${hintCount} hinted`);
for (const s of categoryStats.filter((s) => s.needed > 0)) {
  console.error(`      golden gap: ${s.category} ${s.current}/${s.target} (needs ${s.needed})`);
}
console.error(`      wrote ${path.relative(ROOT, outPath)}`);
