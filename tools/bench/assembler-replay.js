#!/usr/bin/env node
// W1.2 acceptance — replay a session's STT finals through the OLD pipeline (per-final
// word-min + F3 pair-join) and the NEW one (per-final + rolling assembler), then score
// how many of the session sheet's scripted claims survive intact in each.
//
//   node tools/bench/assembler-replay.js <harness.jsonl> <session-sheet.md>
//
// Finals stream: stt_final events when present; else reconstructed from the union of
// fragment-gate events (every dropped final carries `spoken`) and check_start events
// (every processed final) — together the complete final stream minus consecutive-dupe
// drops (session 2's log has zero stt_final events: they were emitted client-side, seq
// gaps prove it, but never landed in the sink — bug noted in the sprint report).
// "Intact" = ≥85% of a scripted claim's normalized tokens appear in one candidate
// utterance that the pipeline would actually check (≥6 words, or merged).
import { readFileSync } from "node:fs";
import { MERGE_MAX_GAP_MS, ASSEMBLE_SILENCE_MS, ASSEMBLE_MAX_FINALS, shouldMergeFinals, assemblyShouldFlush, normalizeClaim } from "../../src/core/utterance.js";

// STT-vs-sheet number equivalence: "ten percent" ⇄ "10%", "one hundred" ⇄ "100" — scoring
// only (the pipeline never rewrites); without it real matches score as misses.
const NUM = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", hundred: "100", thousand: "1000" };
function normTokens(s) {
  return normalizeClaim(s).replace(/(\d+)\s*%/g, "$1 percent").split(" ")
    .map((w) => NUM[w] || w).filter((w) => w.length > 1 || /\d/.test(w));
}

const [logPath, sheetPath] = process.argv.slice(2);
if (!logPath || !sheetPath) { console.error("usage: node tools/bench/assembler-replay.js <harness.jsonl> <sheet.md>"); process.exit(2); }

// ---- finals stream ----
const events = readFileSync(logPath, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
let finals = events.filter((e) => e.ev === "stt_final" && e.transcript).map((e) => ({ t: e.t, text: e.transcript }));
let source = "stt_final";
if (!finals.length) {
  source = "gate+check_start (reconstructed)";
  const seen = new Set();
  for (const e of events) {
    const text = e.ev === "gate" && e.outcome === "fragment" ? e.spoken : e.ev === "check_start" && !e.typed && !e.merged ? e.spoken : null;
    if (!text) continue;
    const k = e.t + "|" + text;
    if (seen.has(k)) continue;
    seen.add(k);
    finals.push({ t: e.t, text });
  }
  finals.sort((a, b) => a.t - b.t);
}

// ---- scripted claims from the sheet (same quote convention as tools/session-lint.js) ----
const claims = [];
for (const line of readFileSync(sheetPath, "utf8").split("\n")) {
  const re = /"([^"\n]+)"|“([^”\n]+)”/g;
  let m;
  while ((m = re.exec(line))) { const q = (m[1] || m[2] || "").trim(); if (q.split(/\s+/).length >= 4) claims.push(q); }
}

// ---- candidate builders ----
const words = (s) => s.split(/\s+/).filter(Boolean);
function oldPipeline(fs_) {
  const out = [];
  let prev = null;
  for (const f of fs_) {
    if (words(f.text).length >= 6) out.push(f.text);
    if (prev && shouldMergeFinals(prev.text, prev.t, f.text, f.t)) out.push(prev.text + " " + f.text);
    prev = f;
  }
  return out;
}
function newPipeline(fs_) {
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length >= 2) out.push(buf.map((x) => x.text).join(" ")); buf = []; };
  for (const f of fs_) {
    if (words(f.text).length >= 6) out.push(f.text);
    if (buf.length && f.t - buf[buf.length - 1].at > MERGE_MAX_GAP_MS) flush();
    // silence flush that the 300ms timer would have fired between the previous final and this one
    if (buf.length && assemblyShouldFlush(buf.length, buf[buf.length - 1].at, f.t)) flush();
    buf.push({ text: f.text, at: f.t });
    if (buf.length >= ASSEMBLE_MAX_FINALS) flush();
  }
  flush();
  return out;
}

// ---- scoring ----
function intactCount(cands) {
  const candToks = cands.map((c) => new Set(normTokens(c)));
  let n = 0;
  const hit = [];
  for (const claim of claims) {
    const toks = normTokens(claim);
    const ok = candToks.some((ct) => toks.filter((w) => ct.has(w)).length / toks.length >= 0.85);
    if (ok) { n++; hit.push(claim); }
  }
  return { n, hit };
}

const oldR = intactCount(oldPipeline(finals));
const newR = intactCount(newPipeline(finals));
console.log(`${logPath}\n  finals: ${finals.length} (${source}) · scripted claims: ${claims.length}`);
console.log(`  OLD (word-min + pair-join): ${oldR.n}/${claims.length} intact`);
console.log(`  NEW (word-min + assembler ${ASSEMBLE_SILENCE_MS}ms/${ASSEMBLE_MAX_FINALS}cap): ${newR.n}/${claims.length} intact`);
const gained = newR.hit.filter((c) => !oldR.hit.includes(c));
const lost = oldR.hit.filter((c) => !newR.hit.includes(c));
if (gained.length) console.log("  gained:", gained.map((c) => `"${c.slice(0, 50)}"`).join(" · "));
if (lost.length) { console.log("  LOST (regression):", lost.map((c) => `"${c.slice(0, 50)}"`).join(" · ")); process.exitCode = 1; }
