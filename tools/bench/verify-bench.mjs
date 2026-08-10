#!/usr/bin/env node
// SPRINT-02 L1 bench harness: replays a FIXED claim diet through a target server's
// /api/verify and reports wall-latency percentiles + a verdict table, so adapter
// changes ship with BEFORE/AFTER numbers on identical inputs.
//
// Diet = distinct extract_done claims from the two field logs (dedupe, order of first
// appearance) + 12 goldens (ids HARDCODED below for reproducibility — first two cases
// of each of six categories: the "first of each category + 6 more evenly" rule).
//
// Usage:
//   node tools/bench/verify-bench.mjs --base http://localhost:3200 --passes 2 --label baseline
//   node tools/bench/verify-bench.mjs --subset goldens   # verdict-quality gate only
//
// Output: JSONL to tools/bench/results/<label>-<iso>.jsonl + printed p50/p95 and
// verdict table. Pacing: ~1.5s between call STARTS (local servers fail open on rate
// limit — no Upstash env — but Perplexity itself is paced).
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
const BASE = opt("base", "http://localhost:3200");
const PASSES = Number(opt("passes", "1"));
const LABEL = opt("label", "run");
const SUBSET = opt("subset", "all"); // all | field | goldens
const PACE_MS = Number(opt("pace", "1500"));

// ---- diet: field-log claims ----------------------------------------------------------
const FIELD_LOGS = [
  "eval/results/fieldtest-2026-08-08.jsonl",
  "eval/results/fieldtest-2026-08-09-pass2.jsonl",
];
function fieldClaims() {
  const seen = new Set();
  const out = [];
  for (const rel of FIELD_LOGS) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.ev === "extract_done" && o.claim && !seen.has(o.claim)) {
        seen.add(o.claim);
        out.push({ id: "field-" + String(out.length + 1).padStart(2, "0"), kind: "field", claim: o.claim, polarity: o.polarity || "asserts" });
      }
    }
  }
  return out;
}

// ---- diet: 12 goldens, ids hardcoded (fixed seed) ------------------------------------
// First case of each of statistics/science_health/historical_events/geography_civics/
// current_events/adversarial + 6 more evenly = the SECOND case of each same category.
const GOLDEN_IDS = [
  "stat-001", "sci-001", "hist-001", "geo-001", "curr-001", "adv-001",
  "stat-002", "sci-002", "hist-002", "geo-002", "curr-002", "adv-002",
];
const GOLDEN_FILES = ["statistics", "science_health", "historical_events", "geography_civics", "current_events", "adversarial"];
function goldenClaims() {
  const byId = new Map();
  for (const f of GOLDEN_FILES) {
    const text = fs.readFileSync(path.join(ROOT, "eval", "golden", f + ".jsonl"), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      byId.set(o.id, o);
    }
  }
  return GOLDEN_IDS.map((id) => {
    const g = byId.get(id);
    if (!g) throw new Error("golden id not found: " + id);
    return { id, kind: "golden", claim: g.expected_extraction, polarity: "asserts", ground_truth: g.ground_truth_verdict };
  });
}

// ---- run -----------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function main() {
  let diet = [];
  if (SUBSET === "all" || SUBSET === "field") diet.push(...fieldClaims());
  if (SUBSET === "all" || SUBSET === "goldens") diet.push(...goldenClaims());

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(ROOT, "tools", "bench", "results", `${LABEL}-${stamp}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath);

  console.log(`bench: ${diet.length} claims x ${PASSES} pass(es) -> ${BASE}/api/verify`);
  console.log(`log: ${path.relative(ROOT, outPath)}\n`);

  const rows = [];
  for (let pass = 1; pass <= PASSES; pass++) {
    for (const c of diet) {
      const t0 = Date.now();
      let rec = { label: LABEL, pass, id: c.id, kind: c.kind, claim: c.claim };
      try {
        const r = await fetch(`${BASE}/api/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ claim: c.claim, polarity: c.polarity }),
        });
        rec.ms = Date.now() - t0;
        rec.http = r.status;
        const j = await r.json().catch(() => ({}));
        rec.verdict = j.verdict ?? null;
        rec.confidence = j.confidence ?? null;
        rec.tier = j.source?.tier ?? null;
        rec.source_url = j.source?.url ?? null;
        rec.n_citations = Array.isArray(j.citations) ? j.citations.length : 0;
        rec.correction_len = (j.correction || "").length;
        rec.autoAirEligible = j.autoAirEligible ?? null;
        if (c.ground_truth) { rec.ground_truth = c.ground_truth; rec.gt_match = j.verdict === c.ground_truth; }
      } catch (e) {
        rec.ms = Date.now() - t0;
        rec.error = String(e && e.message);
      }
      rows.push(rec);
      out.write(JSON.stringify(rec) + "\n");
      const short = c.claim.replace(/\s+/g, " ").slice(0, 60);
      console.log(`p${pass} ${c.id.padEnd(9)} ${String(rec.ms).padStart(5)}ms  ${String(rec.verdict || rec.error || "HTTP" + rec.http).padEnd(13)} conf=${rec.confidence ?? "-"} tier=${rec.tier ?? "-"} cites=${rec.n_citations ?? "-"}  ${short}`);
      const spent = Date.now() - t0;
      if (spent < PACE_MS) await sleep(PACE_MS - spent);
    }
  }
  out.end();

  // ---- summary -----------------------------------------------------------------------
  const ok = rows.filter((r) => r.http === 200 && !r.error);
  const lat = ok.map((r) => r.ms);
  console.log(`\n== ${LABEL} summary (${ok.length}/${rows.length} ok) ==`);
  console.log(`p50=${pct(lat, 50)}ms  p95=${pct(lat, 95)}ms  mean=${Math.round(lat.reduce((a, b) => a + b, 0) / (lat.length || 1))}ms`);
  for (let pass = 1; pass <= PASSES; pass++) {
    const pl = ok.filter((r) => r.pass === pass).map((r) => r.ms);
    if (pl.length) console.log(`  pass ${pass}: p50=${pct(pl, 50)}ms p95=${pct(pl, 95)}ms n=${pl.length}  (call1=${pl[0]}ms, median rest=${pct(pl.slice(1), 50)}ms)`);
  }
  const vt = {};
  for (const r of ok) vt[r.verdict] = (vt[r.verdict] || 0) + 1;
  console.log("verdicts:", JSON.stringify(vt));
  const tiers = {};
  for (const r of ok) tiers["t" + r.tier] = (tiers["t" + r.tier] || 0) + 1;
  console.log("tiers:", JSON.stringify(tiers), " mean cites:", (ok.reduce((a, r) => a + (r.n_citations || 0), 0) / (ok.length || 1)).toFixed(1));
  const gold = ok.filter((r) => r.ground_truth);
  if (gold.length) {
    const hits = gold.filter((r) => r.gt_match).length;
    console.log(`goldens: ${hits}/${gold.length} match ground truth`);
    for (const r of gold.filter((x) => !x.gt_match)) console.log(`  MISS ${r.id} pass${r.pass}: got ${r.verdict}, truth ${r.ground_truth}`);
  }
  // stable per-claim verdict map (pass 1) for drift diffing between runs
  console.log("\nverdict map (pass 1):");
  for (const r of rows.filter((x) => x.pass === 1)) console.log(`  ${r.id}\t${r.verdict || "ERR"}\t${r.tier ?? "-"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
