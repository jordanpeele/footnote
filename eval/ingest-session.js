#!/usr/bin/env node
// Footnote — drafts golden-set entries from a live /control session download.
//
//   node eval/ingest-session.js session.json [--out eval/golden/drafts-<stamp>.jsonl]
//
// The session JSON has entries shaped like {spoken, claim, verdict, confidence, ...}.
// This script maps them into the golden schema as DRAFTS ONLY: ground_truth_verdict is
// left null on purpose — a human must adjudicate every entry (assign the true verdict,
// pick the category, write the adjudication note, and name a source of truth) before the
// line moves into a category file under eval/golden/. Never trust the live model's own
// verdict as ground truth: that would just measure the model's agreement with itself.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const inPath = args.find((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
if (!inPath) { console.error("usage: node eval/ingest-session.js <session.json> [--out file.jsonl]"); process.exit(1); }

const raw = JSON.parse(readFileSync(inPath, "utf8"));
// session downloads may be a bare array or wrapped; take the first array we find
const entries = Array.isArray(raw) ? raw
  : raw.entries || raw.log || raw.items || raw.session ||
    Object.values(raw).find((v) => Array.isArray(v)) || [];
if (!entries.length) { console.error("no entries found in session file"); process.exit(1); }

const stamp = new Date().toISOString().slice(0, 10);
const lines = entries
  .filter((e) => (e.spoken || e.text || "").trim())
  .map((e, i) => JSON.stringify({
    id: `draft-${stamp}-${String(i + 1).padStart(3, "0")}`,
    transcript_snippet: (e.spoken || e.text || "").trim(),
    expected_extraction: (e.claim || "").trim() || null, // live extractor's output = a DRAFT, review it
    category: "UNCATEGORIZED", // human: assign one of the eval/golden/ categories
    ground_truth_verdict: null, // human adjudication required — do NOT copy the model verdict
    adjudication_note: `DRAFT from ${inPath.split("/").pop()} — live pipeline said ${e.verdict ?? "?"} @ conf ${e.confidence ?? "?"}. Human: adjudicate verdict, verify/fix the extraction, categorize, cite a source.`,
    source_of_truth: "",
  }));

const out = lines.join("\n") + "\n";
if (outPath) { writeFileSync(outPath, out); console.error(`${lines.length} draft(s) -> ${outPath}`); }
else process.stdout.write(out);
