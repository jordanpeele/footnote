#!/usr/bin/env node
// SPRINT-02 L2 bench harness: replays a FIXED utterance diet through a target server's
// /api/extract and reports wall-latency percentiles + per-utterance outcomes, so
// extractor-adapter changes ship with BEFORE/AFTER numbers on identical inputs.
//
// Diet = 30 stt_final transcripts from eval/results/fieldtest-2026-08-08.jsonl,
// HARDCODED below for reproducibility: 15 that produced a claim in the field session
// and 15 that gated no_claim. (The field outcome seeds the balance only — acceptance
// is outcome parity between bench runs, judged by --compare, not vs the field log.)
//
// Usage:
//   node tools/bench/extract-bench.mjs --base http://localhost:3300 --passes 2 --label baseline
//   node tools/bench/extract-bench.mjs --base http://localhost:3300 --passes 2 --label lever-b \
//        --compare tools/bench/results/extract-baseline-<iso>.jsonl
//
// Output: JSONL to tools/bench/results/extract-<label>-<iso>.jsonl + printed p50/p95
// (overall and per pass — per-pass split is the cache-warmth tell). --compare diffs
// claim/null outcomes per utterance against a prior run's PASS 1 and flags wording
// drift (same utterance, both produced claims, different claim string).
// Pacing: ~600ms between call STARTS (matches live cadence; local servers fail open
// on rate limit without Upstash env).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---- args ----------------------------------------------------------------------------
const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const BASE = opt("base", "http://localhost:3300");
const PASSES = Number(opt("passes", "2"));
const LABEL = opt("label", "run");
const PACE_MS = Number(opt("pace", "600"));
const COMPARE = opt("compare", null);

// ---- diet: 30 fixed utterances from fieldtest-2026-08-08.jsonl ----------------------
// c01–c15 produced claims in the field session; n01–n15 gated no_claim.
const DIET = [
  { id: "c01", text: "The president of The United States is Donald Trump." },
  { id: "c02", text: "The king of Norway is named Harald Olofsen." },
  { id: "c03", text: "Mike Tyson is the most celebrated boxer of all time." },
  { id: "c04", text: "The president of The United States is Peter Thiel." },
  { id: "c05", text: "Elon Musk is the current mayor of New York City." },
  { id: "c06", text: "The CEO of McDonald's is a man named Ronald McDonald." },
  { id: "c07", text: "Okay. Let's try another one. The CEO of McDonald's is a man named Ronald McDonald." },
  { id: "c08", text: "Peter Thiel is the president of The United States." },
  { id: "c09", text: "GDP growth in The United States in 2025 was 4%." },
  { id: "c10", text: "GDP growth in 2025 in The United States was 5%." },
  { id: "c11", text: "a claim about AOC, for example, right, that Alexandria Ocasio Cortez is a communist." },
  { id: "c12", text: "Teal is the president of The United States." },
  { id: "c13", text: "United States GDP growth was 4%." },
  { id: "c14", text: "GDP growth was 4% in The United States in 2025." },
  { id: "c15", text: "Donald Trump is the vice president of The United States." },
  { id: "n01", text: "Okay. So there's a little bit of a log here." },
  { id: "n02", text: "Tripped up on my words there." },
  { id: "n03", text: "Let's see how it handles false claims." },
  { id: "n04", text: "Okay. So what we're building is called footnote" },
  { id: "n05", text: "It's an AI powered live streaming system." },
  { id: "n06", text: "specifically will fact check people in real time." },
  { id: "n07", text: "So here's another one. Let's try it." },
  { id: "n08", text: "How is it working is we're calling an audio transcription service." },
  { id: "n09", text: "And then what we're doing is taking that audio transcript," },
  { id: "n10", text: "and then actually fact checking based on that." },
  { id: "n11", text: "we're gonna try to keep building this." },
  { id: "n12", text: "Awesome. I'm gonna respond to comments right now." },
  { id: "n13", text: "We might as well try to keep something real about it." },
  { id: "n14", text: "yeah, if you believe in truth," },
  { id: "n15", text: "I now see a fact check." },
];

// ---- helpers -------------------------------------------------------------------------
function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}
function stats(msArr) {
  const s = [...msArr].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 50), p95: pct(s, 95), min: s[0], max: s[s.length - 1] };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- run -----------------------------------------------------------------------------
const rows = [];
for (let pass = 1; pass <= PASSES; pass++) {
  for (const item of DIET) {
    const t0 = Date.now();
    let row = { pass, id: item.id, text: item.text };
    try {
      const r = await fetch(BASE + "/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: item.text }),
      });
      const j = await r.json().catch(() => ({}));
      row.ms = Date.now() - t0;
      row.status = r.status;
      row.claim = j.claim ?? null;
      if (j.polarity) row.polarity = j.polarity;
      if (j.harm_class) row.harm_class = j.harm_class;
      if (j.rejected) row.rejected = j.rejected;
    } catch (e) {
      row.ms = Date.now() - t0;
      row.status = 0;
      row.claim = null;
      row.error = String(e && e.message);
    }
    rows.push(row);
    process.stdout.write(`p${pass} ${row.id} ${String(row.ms).padStart(5)}ms ${row.claim ? "CLAIM" : "null "} ${row.claim ? JSON.stringify(row.claim.slice(0, 60)) : ""}\n`);
    const spent = Date.now() - t0;
    if (spent < PACE_MS) await sleep(PACE_MS - spent);
  }
}

// ---- write results -------------------------------------------------------------------
const iso = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(ROOT, "tools", "bench", "results");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `extract-${LABEL}-${iso}.jsonl`);
fs.writeFileSync(outFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

// ---- report --------------------------------------------------------------------------
const ok = rows.filter((r) => r.status === 200);
const bad = rows.length - ok.length;
console.log(`\n== ${LABEL} @ ${BASE}  (${PASSES} pass(es), ${DIET.length} utterances, pace ${PACE_MS}ms) ==`);
const all = stats(ok.map((r) => r.ms));
console.log(`ALL     n=${all.n}  p50=${all.p50}ms  p95=${all.p95}ms  min=${all.min}  max=${all.max}${bad ? `  (${bad} non-200!)` : ""}`);
for (let pass = 1; pass <= PASSES; pass++) {
  const s = stats(ok.filter((r) => r.pass === pass).map((r) => r.ms));
  console.log(`pass ${pass}  n=${s.n}  p50=${s.p50}ms  p95=${s.p95}ms  min=${s.min}  max=${s.max}`);
}
const claimed = new Set(ok.filter((r) => r.pass === 1 && r.claim).map((r) => r.id));
console.log(`pass-1 outcomes: ${claimed.size} claims / ${DIET.length - claimed.size} null`);
console.log(`results → ${path.relative(ROOT, outFile)}`);

// ---- optional outcome-parity diff vs a baseline run ---------------------------------
if (COMPARE) {
  const base = new Map();
  for (const line of fs.readFileSync(COMPARE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.pass === 1) base.set(o.id, o);
  }
  let flips = 0, drift = 0, same = 0;
  console.log(`\n== outcome parity vs ${COMPARE} (pass 1 vs pass 1) ==`);
  for (const item of DIET) {
    const b = base.get(item.id);
    const a = ok.find((r) => r.pass === 1 && r.id === item.id);
    if (!b || !a) { console.log(`  ${item.id}: MISSING in one run`); flips++; continue; }
    const bNull = b.claim == null, aNull = a.claim == null;
    if (bNull !== aNull) {
      flips++;
      console.log(`  FLIP  ${item.id}: baseline=${bNull ? "null" : "claim"} now=${aNull ? "null" : "claim"}`);
    } else if (!bNull && b.claim !== a.claim) {
      drift++;
      console.log(`  DRIFT ${item.id}: "${b.claim}"  →  "${a.claim}"`);
    } else same++;
  }
  console.log(`parity: ${same} identical, ${drift} wording-drift, ${flips} claim/null flips`);
  console.log(flips === 0 && drift <= 2 ? "ACCEPT (0 flips, ≤2 drift)" : "REVERT (acceptance bar: 0 flips, ≤2/30 drift)");
}
