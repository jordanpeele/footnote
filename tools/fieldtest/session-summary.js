#!/usr/bin/env node
/* Field-report skeleton numbers + the R53 denial-watch line — computed, not hand-counted.
   Usage:  node tools/fieldtest/session-summary.js <artifact...> [--target 20]
   Artifacts (given in CHRONOLOGICAL order; the LAST one is "this session"):
     · harness JSONL logs   (eval/results/fieldtest-*.jsonl — the FOOTNOTE_FIELDTEST_LOG)
     · R20 session exports  (footnote-session-*.json / session-*.json)
   Emits markdown ready to paste into a field report: per-artifact totals
   (checked/aired/auto/vetoed), the R54 attention rollup, window_summary passthrough,
   and the R53 denial-watch line — polarity-applied auto-airs (auto:true, non-TESTAIR
   airs whose card polarity was denies/suspect_denies with a True/False verdict, i.e.
   the flip actually applied) this session + cumulative across every artifact given,
   against the n≥20 target. This automates the COUNTING only; the "zero misses / clean"
   judgment on each card stays with the operator (R53).
   Read-only — touches nothing. TESTAIR airs (test:true) are excluded from every
   machine-aired number per R63 (watermarked, outside the machine-aired ledger). */
import fs from "node:fs";
import path from "node:path";

const DENIAL_TARGET_DEFAULT = 20;   // R53: cumulative polarity-applied auto-airs, n≥20 with zero misses
const DENIES = new Set(["denies", "suspect_denies"]);

/* "Polarity-applied" means the D11 flip actually landed on the aired verdict: the card's
   polarity was a denial reading AND the verdict is True/False (applyPolarity only flips
   those — Misleading/NeedsContext/Unverifiable pass through unflipped). A conflicted card
   (R50 signal disagreement / suspect tripwire) can NEVER auto-air per D4 — if one shows up
   here anyway, it is counted AND flagged as an anomaly rather than silently dropped. */
export function isPolarityApplied(polarity, verdict) {
  return DENIES.has(polarity) && (verdict === "True" || verdict === "False");
}

/* ---------- harness JSONL ---------- */
export function parseJsonl(text) {
  return text.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function summarizeHarness(events) {
  const polByCid = new Map(), conflictByCid = new Map(), attnById = new Map(), vetoIds = new Set();
  let checked = 0;
  let windowSummary = null;
  for (const e of events) {
    if (e.ev === "extract_done" && e.status === "ok" && e.claim) { checked++; if (e.cid) polByCid.set(e.cid, e.polarity || null); }
    else if (e.ev === "verify_done" && e.cid) conflictByCid.set(e.cid, !!e.polarity_conflict);
    else if (e.ev === "attention" && e.id != null && !attnById.has(e.id)) attnById.set(e.id, e.state);   // first tag wins (R54)
    else if (e.ev === "mark" && e.veto && e.id != null) vetoIds.add(e.id);
    else if (e.ev === "veto_window" && e.outcome === "vetoed" && e.id != null) vetoIds.add(e.id);
    else if (e.ev === "window_summary") windowSummary = { ...e };
  }
  if (windowSummary) for (const k of ["ev", "t", "seq", "page", "srv_t"]) delete windowSummary[k];

  const airs = [], seenAirIds = new Set();
  for (const e of events) {
    if (e.ev !== "air") continue;
    if (e.id != null && seenAirIds.has(e.id)) continue;   // one ledger row per card
    if (e.id != null) seenAirIds.add(e.id);
    // Prefer polarity ON the air event (post-R53 harness); fall back to the extract join for older logs.
    const polarity = e.polarity !== undefined ? e.polarity : (e.cid ? polByCid.get(e.cid) ?? null : null);
    const conflict = e.polarity_conflict !== undefined ? !!e.polarity_conflict : !!(e.cid && conflictByCid.get(e.cid));
    airs.push({ id: e.id ?? null, cid: e.cid ?? null, claim: e.claim || "", verdict: e.verdict ?? null, auto: e.auto === true, test: e.test === true, polarity, conflict });
  }
  const real = airs.filter((a) => !a.test);            // R63: TESTAIR is outside the machine-aired ledger
  const auto = real.filter((a) => a.auto);
  const polarityApplied = auto.filter((a) => isPolarityApplied(a.polarity, a.verdict));
  const anomalies = polarityApplied.filter((a) => a.conflict)
    .map((a) => `conflicted card auto-aired (${a.cid ?? a.id}) — D4 says this must be impossible; investigate`);

  const attention = auto.length ? { watching: 0, talking: 0, away: 0, uncaptured: 0 } : null;
  if (attention) auto.forEach((a) => { const s = a.id != null && attnById.has(a.id) ? attnById.get(a.id) : "uncaptured"; attention[s] = (attention[s] || 0) + 1; });

  return {
    kind: "harness", checked, aired: real.length, autoAired: auto.length, manualAirs: real.length - auto.length,
    testAirs: airs.length - real.length, vetoed: vetoIds.size, attention, windowSummary,
    polarityApplied, polarityKnown: true, anomalies,
  };
}

/* ---------- R20 session export ---------- */
export function summarizeExport(json) {
  const s = (json.session && json.session.summary) || {};
  const entries = json.entries || [];
  const auto = entries.filter((e) => e.autoAired);
  // Pre-R53 exports don't carry polarity on entries — report that honestly instead of counting 0.
  const polarityKnown = auto.length === 0 || auto.some((e) => e.polarity !== undefined);
  const polarityApplied = auto.filter((e) => isPolarityApplied(e.polarity, e.verdict))
    .map((e) => ({ id: e.id, cid: null, claim: e.claim || "", verdict: e.verdict ?? null, polarity: e.polarity, conflict: !!e.polarity_conflict }));
  return {
    kind: "export",
    checked: s.totalChecked ?? entries.length,
    aired: s.aired ?? entries.filter((e) => e.aired).length,
    autoAired: s.autoAired ?? auto.length,
    manualAirs: (s.aired ?? 0) - (s.autoAired ?? 0),
    testAirs: null,   // the export doesn't mark TESTAIR — the harness log is authoritative for that split
    vetoed: s.vetoed ?? entries.filter((e) => e.vetoed).length,
    attention: s.attention || null, windowSummary: null, latency: s.latency || null,
    polarityApplied, polarityKnown, anomalies: [],
  };
}

export function summarizeArtifact(name, text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") ) {
    try {
      const json = JSON.parse(text);
      if (json && (json.entries || json.session)) return { name, ...summarizeExport(json) };
    } catch { /* multi-line JSONL that happens to start with { falls through */ }
  }
  return { name, ...summarizeHarness(parseJsonl(text)) };
}

/* ---------- the R53 line ---------- */
export function denialWatch(artifacts, target = DENIAL_TARGET_DEFAULT) {
  const last = artifacts[artifacts.length - 1];
  const cumulative = artifacts.reduce((n, a) => n + a.polarityApplied.length, 0);
  return {
    thisSession: last ? last.polarityApplied.length : 0,
    cumulative, target,
    unknownArtifacts: artifacts.filter((a) => !a.polarityKnown).map((a) => a.name),
    line: `Denial-watch line (R53): **${last ? last.polarityApplied.length : 0} polarity-applied auto-airs this session; cumulative ${cumulative} of the required ${target} clean.**`,
  };
}

/* ---------- markdown ---------- */
const fmtCard = (c) => `${c.cid ?? "id " + c.id} "${(c.claim || "").slice(0, 60)}" → ${c.verdict} (${c.polarity})`;
export function renderMarkdown(artifacts, target = DENIAL_TARGET_DEFAULT) {
  const out = [];
  out.push(`# Session summary — generated ${new Date().toISOString().slice(0, 10)}`, "");
  for (const a of artifacts) {
    out.push(`## ${path.basename(a.name)} (${a.kind === "export" ? "R20 export" : "harness log"})`, "");
    out.push(`| checked | aired | auto-aired | manual airs | vetoes | testair |`);
    out.push(`|---|---|---|---|---|---|`);
    out.push(`| ${a.checked} | ${a.aired} | **${a.autoAired}** | ${a.manualAirs} | ${a.vetoed} | ${a.testAirs ?? "—"} |`, "");
    if (a.attention) {
      const t = a.attention;
      out.push(`- Attention (R54, over auto-aired cards): watching ${t.watching || 0} · talking ${t.talking || 0} · away ${t.away || 0} · **uncaptured ${t.uncaptured || 0}**`);
    }
    if (a.windowSummary) out.push(`- window_summary: \`${JSON.stringify(a.windowSummary)}\``);
    if (a.latency && a.latency.extract) out.push(`- Latency p50: extract ${a.latency.extract.p50}ms · verify ${a.latency.verify?.p50}ms · spoken→air ${a.latency.spokenToAir?.p50 ?? "—"}ms`);
    if (a.polarityApplied.length) out.push(`- Polarity-applied auto-airs: ${a.polarityApplied.length} — ${a.polarityApplied.map(fmtCard).join("; ")}`);
    else out.push(a.polarityKnown ? `- Polarity-applied auto-airs: 0` : `- Polarity-applied auto-airs: **unknown** — export predates polarity-on-entry (R53); count from the session's harness log instead`);
    for (const an of a.anomalies) out.push(`- ⚠ ANOMALY: ${an}`);
    out.push("");
  }
  const dw = denialWatch(artifacts, target);
  out.push(`## Denial-watch (R53)`, "");
  out.push(dw.line, "");
  const support = artifacts.filter((a) => a.polarityApplied.length)
    .map((a) => `${path.basename(a.name)}: ${a.polarityApplied.map((c) => c.cid ?? "id " + c.id).join(", ")}`);
  out.push(`- Supporting cards: ${support.length ? support.join(" · ") : "none yet"}`);
  out.push(`- "This session" = last artifact given (pass artifacts in chronological order).`);
  if (dw.unknownArtifacts.length) out.push(`- ⚠ Not countable (no polarity recorded): ${dw.unknownArtifacts.map((n) => path.basename(n)).join(", ")} — cumulative may undercount; use those sessions' harness logs.`);
  out.push(`- Counting is automated; the zero-misses / "clean" judgment per card remains the operator's (R53).`);
  return out.join("\n") + "\n";
}

/* ---------- CLI ---------- */
const isMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const ti = args.indexOf("--target");
  const target = ti >= 0 ? Number(args.splice(ti, 2)[1]) : DENIAL_TARGET_DEFAULT;
  if (!args.length) {
    console.error("usage: node tools/fieldtest/session-summary.js <harness.jsonl|session-export.json ...> [--target 20]\n(artifacts in chronological order; the last one is \"this session\")");
    process.exit(2);
  }
  const artifacts = args.map((f) => summarizeArtifact(f, fs.readFileSync(f, "utf8")));
  process.stdout.write(renderMarkdown(artifacts, target));
}
