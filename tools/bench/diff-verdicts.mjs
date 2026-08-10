#!/usr/bin/env node
// L1 helper: diff two verify-bench JSONL result files by claim id — verdict drift,
// tier drift, citation-count movement, and p50/p95 delta. Baseline may be multi-pass;
// a candidate row counts as DRIFT only if its verdict matches NONE of the baseline
// passes for that id (baseline self-noise on a claim is not candidate drift).
//   node tools/bench/diff-verdicts.mjs <baseline.jsonl> <candidate.jsonl>
import fs from "node:fs";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) { console.error("usage: diff-verdicts.mjs <baseline.jsonl> <candidate.jsonl>"); process.exit(2); }
const load = (p) => fs.readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const A = load(aPath), B = load(bPath);

const byId = (rows) => {
  const m = new Map();
  for (const r of rows) { if (!m.has(r.id)) m.set(r.id, []); m.get(r.id).push(r); }
  return m;
};
const a = byId(A), b = byId(B);
const pct = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

let drift = 0;
for (const [id, brs] of b) {
  const ars = a.get(id);
  if (!ars) continue;
  const baseVerdicts = new Set(ars.map((r) => r.verdict));
  const baseTiers = new Set(ars.map((r) => r.tier));
  for (const br of brs) {
    const vDrift = !baseVerdicts.has(br.verdict);
    const tDrift = !baseTiers.has(br.tier);
    if (vDrift || tDrift) {
      drift++;
      console.log(`${vDrift ? "VERDICT-DRIFT" : "tier-drift"} ${id}: base={${[...baseVerdicts]}}/t{${[...baseTiers]}} -> ${br.verdict}/t${br.tier} (pass ${br.pass})`);
    }
  }
}
if (!drift) console.log("no drift (every candidate verdict+tier appears in baseline for that id)");

const la = A.filter((r) => r.http === 200).map((r) => r.ms);
const lb = B.filter((r) => r.http === 200).map((r) => r.ms);
const cA = A.reduce((s, r) => s + (r.n_citations || 0), 0) / A.length;
const cB = B.reduce((s, r) => s + (r.n_citations || 0), 0) / B.length;
console.log(`\nbaseline : p50=${pct(la, 50)} p95=${pct(la, 95)} n=${la.length} mean-cites=${cA.toFixed(1)}`);
console.log(`candidate: p50=${pct(lb, 50)} p95=${pct(lb, 95)} n=${lb.length} mean-cites=${cB.toFixed(1)}`);
console.log(`delta    : p50=${pct(lb, 50) - pct(la, 50)}ms p95=${pct(lb, 95) - pct(la, 95)}ms`);
const gm = B.filter((r) => r.ground_truth);
if (gm.length) console.log(`candidate goldens: ${gm.filter((r) => r.gt_match).length}/${gm.length} match ground truth`);
