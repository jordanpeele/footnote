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
//
// AUTHORED candidates: drafts files whose rows carry `authored: true` (convention:
// drafts-authored-*.jsonl) are author-written claim+provisional-label pairs, not session
// ingests. The glob picks them up like any drafts file; lib.js routes them into their
// own AUTHORED-prefixed clusters with the evidence note in the hint panel — the operator
// ratifies label+claim together, exactly like the rest of the sitting.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  dedupeDrafts, applyHints, orderForSitting, sittingCluster, categoryNeeds, CATEGORIES,
  buildPolarityEntries,
} from "./lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const GOLDEN = path.join(ROOT, "eval", "golden");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : path.join(HERE, "queue.json");
// --polarity-only: emit JUST the polarity micro-pass (the <=15-min sitting on its own);
// default is graduation cards first, polarity block appended as its own cluster group.
const polarityOnly = args.includes("--polarity-only");

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
// The sci-033-class corpus (drafts-sci033-class-*.jsonl) is red-team analysis fodder for
// the RED sci-033 DISPOSITION decision, NOT graduation candidates — ratifying class probes
// is tangled with how we decide to handle the class, so it does not belong in the routine
// graduation sitting. It stays excluded from eval runs (drafts- prefix) and lives in
// docs/redteam/SCI033_CLASS for the disposition. Everything else drafts-* is graduation fodder.
// Red-team disposition corpora (drafts-sci033-class-*, drafts-rconcurrence-*) are evidence
// for RED disposition decisions (the sci-033 class handling; the concurrence-independence
// question), NOT graduation candidates — ratifying class probes is entangled with those
// rulings. They stay excluded from eval runs (drafts- prefix) and live in docs/redteam/.
const REDTEAM_CORPUS = /^drafts-(sci033-class|rconcurrence)-/;
const draftFiles = readdirSync(GOLDEN).filter((n) => /^drafts-.*\.jsonl$/.test(n) && !REDTEAM_CORPUS.test(n)).sort();
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

// Polarity micro-pass block (tools/adjudicate/polarity-cards.json): the negation-ambiguous
// golden rows Task 0 left with expected_polarity UNSET. Cards join against the LIVE golden
// rows by id (claim/transcript come from the golden file, never the cards); rows already
// carrying the field — including an explicit-null ambiguous-drop — fall out, so this block
// empties itself after apply. Appended AFTER the graduation clusters as its own group
// (or emitted alone with --polarity-only).
let polarityEntries = [];
let polarityInfo = null;
const cardsPath = path.join(HERE, "polarity-cards.json");
if (existsSync(cardsPath)) {
  const cards = JSON.parse(readFileSync(cardsPath, "utf8")).cards || [];
  const goldenById = new Map();
  for (const name of readdirSync(GOLDEN).filter((n) => n.endsWith(".jsonl") && !n.startsWith("drafts-"))) {
    for (const r of readJsonl(path.join(GOLDEN, name))) goldenById.set(r.id, r);
  }
  const built = buildPolarityEntries(cards, goldenById);
  polarityEntries = built.entries;
  polarityInfo = built;
  if (built.missing.length) console.error(`warn: polarity cards with no golden row: ${built.missing.join(", ")}`);
}

const gradCount = entries.length;
if (polarityOnly) entries = polarityEntries;
else entries = entries.concat(polarityEntries);

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

const authoredCount = entries.filter((e) => e.authored).length;

const queue = {
  generated_at: new Date().toISOString(),
  source_files: draftFiles,
  draft_count: polarityOnly ? 0 : allRows.length,
  unique_count: polarityOnly ? 0 : gradCount,   // graduation cards only — polarity counted apart
  hinted_count: polarityOnly ? 0 : hintCount,
  authored_count: polarityOnly ? 0 : authoredCount,
  polarity_count: polarityEntries.length,
  polarity_already_ruled: polarityInfo ? polarityInfo.alreadyRuled.length : 0,
  categoryStats,
  clusters,
  entries,
};

writeFileSync(outPath, JSON.stringify(queue, null, 2) + "\n");
if (polarityOnly) {
  console.error(`prep (--polarity-only): ${polarityEntries.length} polarity card(s) in ${clusters.length} cluster(s)` +
    (polarityInfo && polarityInfo.alreadyRuled.length ? ` (${polarityInfo.alreadyRuled.length} already ruled, dropped)` : ""));
} else {
  console.error(`prep: ${allRows.length} drafts across ${draftFiles.length} file(s) -> ${gradCount} unique claim card(s), ${hintCount} hinted` +
    ` + ${polarityEntries.length} polarity card(s) — ${entries.length} total in ${clusters.length} cluster(s)`);
  if (authoredCount) console.error(`      ${authoredCount} AUTHORED candidate card(s) (provisional labels — ratify label+claim together)`);
  if (polarityInfo && polarityInfo.alreadyRuled.length) {
    console.error(`      polarity: ${polarityInfo.alreadyRuled.length} card(s) already ruled in the goldens — dropped from the queue`);
  }
}
for (const s of categoryStats.filter((s) => s.needed > 0)) {
  console.error(`      golden gap: ${s.category} ${s.current}/${s.target} (needs ${s.needed})`);
}
console.error(`      wrote ${path.relative(ROOT, outPath)}`);
