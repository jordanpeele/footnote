#!/usr/bin/env node
// Footnote adjudication cockpit — APPLY STEP.
//   node tools/adjudicate/apply.js [graduations.json] [--queue tools/adjudicate/queue.json]
//                                  [--golden-dir eval/golden] [--dry-run]
//
// Takes the graduations.json the browser page downloaded and mechanically appends each
// decided card into eval/golden/<category>.jsonl with a fresh sequential id (continuing
// each file's existing convention — person-021+, stat-036+, …). Idempotent-ish: it
// re-reads the target file and skips any claim already graduated (same normalized claim
// + category), so re-running on the same graduations.json won't double-append.
//
// A decision from the page is { key, verdict, category, extraction?, note?,
// source_of_truth?, skip? }. `key` ties back to the queue entry (provenance/transcript).
// Skipped decisions are ignored. Decisions with a null verdict graduate as null-extraction
// echo/opinion cases (schema: no verdict ⇒ no claim).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGoldenEntry, nextId, prefixForCategory, alreadyGraduated } from "./lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const gradPath = args.find((a) => !a.startsWith("--")) || path.join(HERE, "graduations.json");
const qIdx = args.indexOf("--queue");
const queuePath = qIdx >= 0 ? args[qIdx + 1] : path.join(HERE, "queue.json");
const gIdx = args.indexOf("--golden-dir");
const goldenDir = gIdx >= 0 ? path.resolve(args[gIdx + 1]) : path.join(ROOT, "eval", "golden");

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

if (!existsSync(gradPath)) { console.error(`apply: ${gradPath} not found — download graduations.json from /adjudicate first`); process.exit(1); }
if (!existsSync(queuePath)) { console.error(`apply: ${queuePath} not found — run prep.js first`); process.exit(1); }

const grad = JSON.parse(readFileSync(gradPath, "utf8"));
const decisions = Array.isArray(grad) ? grad : (grad.decisions || []);
const queue = JSON.parse(readFileSync(queuePath, "utf8"));
const queueByKey = new Map(queue.entries.map((e) => [e.key, e]));

// Group live golden-file state so we allocate ids and dedup per file, and so ids stay
// sequential across multiple decisions landing in the same category in one apply run.
const fileCache = new Map(); // category -> { path, entries: [...] }
function loadCategory(category) {
  if (fileCache.has(category)) return fileCache.get(category);
  const file = path.join(goldenDir, category + ".jsonl");
  const entry = { path: file, entries: readJsonl(file) };
  fileCache.set(category, entry);
  return entry;
}

const wrote = [];
const skipped = [];
for (const d of decisions) {
  if (d.skip) { skipped.push({ key: d.key, why: "skipped in cockpit" }); continue; }
  if (!d.category || !prefixForCategory(d.category)) { skipped.push({ key: d.key, why: `unknown category ${d.category}` }); continue; }
  const qe = queueByKey.get(d.key);
  if (!qe) { skipped.push({ key: d.key, why: "no matching queue entry" }); continue; }

  const cat = loadCategory(d.category);
  const prefix = prefixForCategory(d.category);
  const existingIds = cat.entries.map((e) => e.id);
  const id = nextId(prefix, existingIds);
  const golden = buildGoldenEntry(d, qe, id);

  if (alreadyGraduated(golden, cat.entries)) { skipped.push({ key: d.key, why: `already graduated in ${d.category}` }); continue; }

  cat.entries.push(golden); // so the next decision in this category gets the next id + dedup sees it
  wrote.push({ id, category: d.category, claim: golden.expected_extraction, verdict: golden.ground_truth_verdict });
}

if (!dryRun) {
  for (const [, cat] of fileCache) {
    if (!cat.entries.length) continue;
    const out = cat.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    writeFileSync(cat.path, out);
  }
}

console.error(`apply${dryRun ? " (dry-run)" : ""}: ${wrote.length} entr(ies) appended, ${skipped.length} skipped`);
for (const w of wrote) console.error(`  + ${w.id} [${w.verdict}] ${JSON.stringify(w.claim)}`);
for (const s of skipped) console.error(`  · skip ${s.key || "?"}: ${s.why}`);
