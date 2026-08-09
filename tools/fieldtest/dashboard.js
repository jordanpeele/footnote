#!/usr/bin/env node
/* Field-test live dashboard — tails the FOOTNOTE_FIELDTEST_LOG JSONL and prints one line
   per stage transition with per-claim latencies, rolling p50/p95, and inline anomaly flags.
   Usage:  node tools/fieldtest/dashboard.js [path-to-jsonl]
   Ctrl-C prints the end-of-session latency table. Read-only — touches nothing. */
import fs from "node:fs";

const LOG = process.argv[2] || process.env.FOOTNOTE_FIELDTEST_LOG || "eval/results/fieldtest-2026-08-08.jsonl";
const C = { dim: "\x1b[2m", red: "\x1b[31m", grn: "\x1b[32m", yel: "\x1b[33m", cyn: "\x1b[36m", mag: "\x1b[35m", b: "\x1b[1m", r: "\x1b[0m" };
const ts = (t) => new Date(t).toTimeString().slice(0, 8);
const pad = (s, n) => String(s).padEnd(n);

// rolling stats per stage
const stages = { extract: [], verify: [], decide: [], publish: [], air_render: [], total: [] };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };
const median = (a) => pct(a, 50);
function push(stage, v) {
  const a = stages[stage]; if (v == null || !isFinite(v) || v < 0) return "";
  const m = a.length >= 4 ? median(a) : null;
  a.push(v);
  return m && v > 2 * m ? ` ${C.red}⚑ slow (${v}ms vs p50 ${m}ms)${C.r}` : "";
}
const roll = () => Object.entries(stages).filter(([, a]) => a.length)
  .map(([k, a]) => `${k} p50 ${median(a)}${a.length >= 4 ? `/p95 ${pct(a, 95)}` : ""}`).join(" · ");

// correlation state
const byCid = new Map();          // cid -> {spoken, t0, claim, verifyAt, verdict, ...}
const byCardId = new Map();       // card id -> cid
const airs = [];                  // recent airs awaiting a render match
const finals = [];                // recent stt finals for dupe detection
let interims = 0, checks = 0, renders = 0;

function line(t, tag, msg, extra) { console.log(`${C.dim}${ts(t)}${C.r} ${tag} ${msg}${extra || ""}`); }

function handle(e) {
  const t = e.t || e.srv_t;
  switch (e.ev) {
    case "dg_open": line(t, `${C.grn}◉ STT${C.r}`, `Deepgram connected (${e.auth}, ${e.sampleRate}Hz)`); break;
    case "dg_close": line(t, `${C.yel}◌ STT${C.r}`, `Deepgram closed code=${e.code}${e.gotResult ? "" : ` ${C.red}⚑ no transcript ever arrived${C.r}`}`); break;
    case "stt_interim": interims++; break;
    case "stt_final": {
      const dupe = finals.find((f) => f.tr === e.transcript && t - f.t < 10000);
      finals.push({ tr: e.transcript, t }); if (finals.length > 30) finals.shift();
      line(t, `${C.cyn}▸ FINAL${C.r}`, `"${e.transcript.slice(0, 90)}"`, dupe ? ` ${C.red}⚑ duplicate within 10s${C.r}` : "");
      break;
    }
    case "check_start": checks++; byCid.set(e.cid, { t0: t, spoken: e.spoken }); break;
    case "extract_done": {
      const s = byCid.get(e.cid) || {}; s.claim = e.claim; s.harm = e.harm_class; byCid.set(e.cid, s);
      const flag = push("extract", e.ms);
      if (e.status !== "ok") line(t, `${C.red}✗ EXTRACT${C.r}`, `${e.status} (${e.ms}ms)`);
      else if (e.claim) line(t, `${C.b}● CLAIM${C.r}`, `[${e.cid}] "${e.claim.slice(0, 80)}" ${C.dim}pol=${e.polarity} harm=${e.harm_class} ${e.ms}ms${C.r}`, flag);
      break;
    }
    case "gate": {
      const s = byCid.get(e.cid) || {};
      const miss = e.outcome === "no_claim" && e.words >= 8;
      line(t, `${C.dim}○ GATE${C.r}`, `[${e.cid}] ${e.outcome}${e.words ? ` (${e.words}w)` : ""} ${C.dim}"${(s.spoken || "").slice(0, 60)}"${C.r}`,
        miss ? ` ${C.yel}⚑ ${e.words}-word utterance gated null — checkable?${C.r}` : "");
      break;
    }
    case "verify_done": {
      const s = byCid.get(e.cid) || {}; s.verifyAt = t; s.verdict = e.verdict; byCid.set(e.cid, s);
      if (e.id != null) byCardId.set(e.id, e.cid);
      const flag = push("verify", e.ms);
      const tierF = e.ok && e.tier != null && e.tier <= 1 ? ` ${C.yel}⚑ low-tier source (t${e.tier})${C.r}` : "";
      const polF = e.polarity_conflict ? ` ${C.mag}⚑ POLARITY CONFLICT${C.r}` : "";
      const harmF = e.harm_class && e.harm_class !== "none" ? ` ${C.mag}◆ harm=${e.harm_class} (manual-only)${C.r}` : "";
      line(t, e.ok ? `${C.b}◈ VERDICT${C.r}` : `${C.red}✗ VERIFY${C.r}`,
        `[${e.cid}] ${e.ok ? `${e.verdict} conf=${e.confidence} tier=${e.tier ?? "—"} eligible=${e.autoAirEligible}` : "failed"} ${C.dim}${e.ms}ms${C.r}`,
        flag + tierF + polF + harmF);
      break;
    }
    case "autoair_armed": line(t, `${C.yel}⏱ AUTO${C.r}`, `[${e.cid}] auto-air armed — 4s veto window`); break;
    case "testair_fire": line(t, `${C.yel}⚡ TESTAIR${C.r}`, `[${e.cid}] test-air fired`); break;
    case "mark": {
      const cid = byCardId.get(e.id);
      if (["skipped", "held", "expired", "error", "paused", "stale_generation"].includes(e.action))
        line(t, `${C.dim}▪ ${e.action.toUpperCase()}${C.r}`, `[${cid || "card " + e.id}]${e.veto ? ` ${C.yel}(operator veto of auto-air)${C.r}` : ""}${e.operator ? " (from /op)" : ""}`);
      break;
    }
    case "air": {
      const s = e.cid ? byCid.get(e.cid) : null;
      const decideMs = s && s.verifyAt ? t - s.verifyAt : null;
      const flag = decideMs != null ? push("decide", decideMs) : "";
      airs.push({ t, cid: e.cid, claim: e.claim || "", t0: s && s.t0 });
      if (airs.length > 10) airs.shift();
      line(t, `${C.grn}${C.b}▶ AIR${C.r}`, `[${e.cid || e.id}] ${e.verdict}${e.auto ? " (auto)" : ""}${e.operator ? " (/op)" : ""}${e.test ? ` ${C.yel}[TEST]${C.r}` : ""}${decideMs != null ? ` ${C.dim}decide ${decideMs}ms${C.r}` : ""}`, flag);
      break;
    }
    case "publish": if (!e.pull) push("publish", e.ms); break;
    case "render": {
      renders++;
      const m = airs.findLast((a) => a.claim.slice(0, 120) === (e.claim || "") || Math.abs(a.t - t) < 6000);
      const lagMs = m ? t - m.t : null, totalMs = m && m.t0 ? t - m.t0 : null;
      const flag = lagMs != null ? push("air_render", lagMs) : "";
      if (totalMs != null) push("total", totalMs);
      line(t, `${C.grn}◼ RENDER${C.r}`, `overlay drew ${e.verdict}${e.test ? " [TEST]" : ""}${lagMs != null ? ` ${C.dim}air→render ${lagMs}ms${totalMs ? ` · spoken→screen ${totalMs}ms` : ""}${C.r}` : ""}`, flag);
      console.log(`${C.dim}   ↳ rolling: ${roll()}${C.r}`);
      break;
    }
  }
}

let off = 0, buf = "";
function drain() {
  let st; try { st = fs.statSync(LOG); } catch { return; }
  if (st.size < off) { off = 0; buf = ""; }          // truncated/rotated
  if (st.size === off) return;
  const fd = fs.openSync(LOG, "r"), b = Buffer.alloc(st.size - off);
  fs.readSync(fd, b, 0, b.length, off); fs.closeSync(fd); off = st.size;
  buf += b.toString("utf8");
  const lines = buf.split("\n"); buf = lines.pop();
  for (const l of lines) { if (!l.trim()) continue; try { handle(JSON.parse(l)); } catch {} }
}

console.log(`${C.b}Footnote field-test dashboard${C.r} — tailing ${LOG}\n${C.dim}waiting for events… (start the stream on /control)${C.r}`);
setInterval(drain, 300); drain();

process.on("SIGINT", () => {
  console.log(`\n${C.b}— session latency table —${C.r}`);
  for (const [k, a] of Object.entries(stages))
    if (a.length) console.log(`${pad(k, 12)} p50 ${pad(median(a) + "ms", 9)} p95 ${pad((a.length >= 4 ? pct(a, 95) : "—") + (a.length >= 4 ? "ms" : ""), 9)} n=${a.length}`);
  console.log(`${C.dim}checks=${checks} renders=${renders} interims=${interims}${C.r}`);
  process.exit(0);
});
