#!/usr/bin/env node
// W1.3 acceptance — replay a session's (possibly shredded) finals through the rolling
// window and report coverage: what fraction of spoken words reach an extract, and what
// windows would have been handed to the extractor. With --live, each window is POSTed to
// the running self-host server's /api/extract (real Haiku) to show the claims that would
// have been recovered — the qualitative proof the run-test asked for.
//
//   node tools/bench/window-replay.js eval/results/fieldtest-2026-08-14-runtest.jsonl [--live]
import { readFileSync } from "node:fs";
import { replayWindow, windowCoverage } from "../../src/core/window-sim.js";

const logPath = process.argv[2];
const live = process.argv.includes("--live");
if (!logPath) { console.error("usage: node tools/bench/window-replay.js <harness.jsonl> [--live]"); process.exit(2); }

const events = readFileSync(logPath, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
let finals = events.filter((e) => e.ev === "stt_final" && e.transcript).map((e) => ({ t: e.t, text: e.transcript }));
if (!finals.length) {
  const seen = new Set();
  for (const e of events) {
    const text = e.ev === "gate" && e.outcome === "fragment" ? e.spoken : e.ev === "check_start" && !e.typed && !e.merged ? e.spoken : null;
    if (!text) continue;
    const k = e.t + "|" + text;
    if (seen.has(k)) continue;
    seen.add(k); finals.push({ t: e.t, text });
  }
  finals.sort((a, b) => a.t - b.t);
}

// ---- simulate the client window state machine over the finals' real timestamps ----
// (the machine itself lives in src/core/window-sim.js — one implementation shared with
// test/window-ingestion.test.js, so the regression pin and this tool can never disagree)
const { windows } = replayWindow(finals);
const { totalWords, ratio: covRatio } = windowCoverage(finals, windows);
console.log(`${logPath}: ${finals.length} finals · ${totalWords} words spoken`);
console.log(`windows extracted: ${windows.length} · unique-word coverage: ${Math.round(covRatio * 100)}% (run-test baseline: 27% of words ever reached a check)`);

if (live) {
  const out = [];
  for (const w of windows) {
    const r = await fetch("http://localhost:3000/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: w.text }) }).catch(() => null);
    const j = r && r.ok ? await r.json().catch(() => null) : null;
    if (j && j.claim) out.push({ claim: j.claim, category: j.category });
    await new Promise((res) => setTimeout(res, 1600));   // stay under the 40/min extract rate limit
  }
  const seenClaims = new Set();
  console.log(`\nclaims recovered by live extraction over the windows (${out.length} raw, deduped):`);
  for (const o of out) { const k = o.claim.toLowerCase(); if (seenClaims.has(k)) continue; seenClaims.add(k); console.log(`  · [${o.category}] ${o.claim}`); }
}
