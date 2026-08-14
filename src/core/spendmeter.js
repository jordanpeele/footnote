// Footnote — per-call spend METERING (counting + surfacing only; enforcement lives in
// spendgate.js and is untouched by this module). A BYOK tool should show its owner what
// it is spending as it spends: every costed route ticks this meter with (route, vendor)
// and the meter attributes an ESTIMATED USD figure from the static price table below.
//
// HONESTY RULE: everything this module reports is an ESTIMATE from list prices and bench
// residuals — never a bill. Every surface carries `est: true` / an "est." label, and this
// file is the one obvious place to update when a vendor reprices.
//
// Storage, two tiers (same posture as spendgate):
//   1. In-process counters — always on, zero deps. Correct-as-global on self-host (D1:
//      npm start is one process). On serverless they are per-warm-instance tallies —
//      still useful ("this process"), labeled as such on the admin surface.
//   2. Optional store-backed daily rollup — when the Upstash adapter isConfigured()
//      (same pattern as spendgate), each tick fire-and-forgets an HINCRBY into a
//      per-UTC-day hash. Fail-SILENT: metering must never add latency or failure modes
//      to a broadcast path. Amounts are stored as integer micro-USD to keep the
//      increments atomic and drift-free.
//
// Field-test surfacing: when FOOTNOTE_FIELDTEST_LOG is set (self-host only — the env is
// never set on Vercel), each tick appends a {ev:"spend"} JSONL event directly to the log
// file. The routes run in the same process as src/server/index.js's ftSink there, so a
// direct append IS the server-side ftSink pattern (the HTTP /__fieldtest/log endpoint
// exists for browser clients; server code doesn't need the loopback hop). The fieldtest
// dashboard (tools/fieldtest/dashboard.js) renders these as a compact SPEND line.
import fs from "node:fs";
import { isConfigured, pipeline } from "../adapters/state/upstash/index.js";

/* ---------------------------------------------------------------------------------------
 * PRICE TABLE — static per-call USD estimates, keyed "route:vendor".
 *
 * PROVENANCE (update figures here when vendors reprice; each line cites its source):
 *
 *   extract:anthropic-haiku      ≈ $0.001/call
 *     docs/LATENCY_LEDGER.md L1b: prompt+utterance ≈ 860 input tokens, replies 5–40
 *     output tokens. Haiku 4.5 list price $1/MTok in, $5/MTok out (claude-api reference,
 *     checked 2026-08-14): 860×$1e-6 + 40×$5e-6 ≈ $0.0011 → 0.001.
 *
 *   verify:perplexity            ≈ $0.013/call   (sonar-pro)
 *     docs/LATENCY_LEDGER.md L1 bench spend: ~180 sonar-pro verifies ≈ $2–3 total
 *     ("request fees ~$1.8 dominant, tokens ~$0.6") → ~$2.4/180 ≈ $0.013.
 *
 *   verify:perplexity-twostep    ≈ $0.026/call
 *     Two sonar-pro calls per verify (P4-C split, docs/VERIFY_TWOSTEP.md) → 2× the
 *     single-call figure. DARK adapter — priced for completeness.
 *
 *   verify:brave-claude          ≈ $0.05/call
 *     Derived two ways, figure sits between them: (a) R49 eval residual
 *     (docs/R49_CONCURRENCE_REPORT_2026-08-12.md: ~$5 / 69 concurrence checks ≈ $0.072
 *     per check, minus the perplexity arm $0.013 and Haiku signal $0.001 → ≈$0.058);
 *     (b) list prices: one Brave Web Search query (Base plan $5/1000 ≈ $0.005) + one
 *     claude-opus-4-8 call ($5/MTok in, $25/MTok out; ~2K in + ≤1024 out incl. adaptive
 *     thinking ≈ $0.035) → ≈$0.04. LOWEST-CONFIDENCE row (adapter has never run live).
 *
 *   verify:polarity-signal       ≈ $0.001/call
 *     The R50 independent polarity read is one small Haiku call (src/core/
 *     polarity-signal.js) — same order as the extractor call.
 *
 *   transcribe:deepgram          ≈ $0.0002/call
 *     Deepgram nova-3 pre-recorded list price ≈ $0.0043/min (deepgram.com pricing,
 *     checked 2026-08-14 — the latency ledger has no Deepgram figure). api/transcribe.js
 *     caps a window at ~2.2s of Opus audio → 0.037min × $0.0043 ≈ $0.00016 → 0.0002.
 *
 *   dg-token:deepgram            = $0/call at mint
 *     Minting a streaming token is free; the real spend is the browser's streaming
 *     session (nova-3 streaming list ≈ $0.0077/min) which this server never sees
 *     per-call. Counted (mints are the best server-side proxy for streaming sessions)
 *     but priced 0 rather than guessing minutes — honesty over coverage.
 * ------------------------------------------------------------------------------------- */
export const PRICE_TABLE = {
  "extract:anthropic-haiku": 0.001,
  "verify:perplexity": 0.013,
  "verify:perplexity-twostep": 0.026,
  "verify:brave-claude": 0.05,
  "verify:polarity-signal": 0.001,
  "transcribe:deepgram": 0.0002,
  "dg-token:deepgram": 0,
};

/** Estimated USD for one call on route via vendor; null when the pair is unpriced
 *  (e.g. a stub adapter in tests — the call is still COUNTED, at $0, flagged unpriced). */
export function priceFor(route, vendor) {
  const v = PRICE_TABLE[`${route}:${vendor}`];
  return typeof v === "number" ? v : null;
}

// ---- tier 1: in-process counters --------------------------------------------------------
const startedAt = Date.now();
const counters = new Map();   // "route:vendor" -> { calls, estUsd, unpriced }

/** TEST HOOK ONLY — clear the in-process counters. */
export function _reset() { counters.clear(); }

/**
 * Record one vendor call ATTEMPT on a costed route. Called immediately before the
 * adapter/vendor call — attempts, not successes, because the spend is committed when the
 * request leaves the building (an upstream 5xx after we paid the request fee still spent).
 * Never throws, never awaits: metering must be invisible to the request path.
 * @param {string} route  api route basename (matches ROUTE_CLASSES keys)
 * @param {string} vendor adapter/engine name (adapter `name` export, or a signal id)
 * @returns {number} the estimated USD attributed (0 for unpriced pairs)
 */
export function tick(route, vendor) {
  const key = `${route}:${vendor}`;
  const price = priceFor(route, vendor);
  const est = price ?? 0;
  const c = counters.get(key) || { calls: 0, estUsd: 0, unpriced: price == null };
  c.calls += 1;
  c.estUsd += est;
  counters.set(key, c);
  storeRollup(key, est);      // fire-and-forget, fail-silent
  ftAppend({ ev: "spend", t: Date.now(), route, vendor, est_usd: est, process_total_est_usd: round6(processTotal()) });
  return est;
}

function processTotal() {
  let t = 0;
  for (const c of counters.values()) t += c.estUsd;
  return t;
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** In-process tallies snapshot — "what THIS process has spent since it started". */
export function processTallies() {
  const by = {};
  for (const [k, c] of [...counters.entries()].sort()) {
    by[k] = { calls: c.calls, est_usd: round6(c.estUsd), ...(c.unpriced ? { unpriced: true } : {}) };
  }
  return { since: new Date(startedAt).toISOString(), total_est_usd: round6(processTotal()), by };
}

// ---- tier 2: optional store-backed daily rollup ----------------------------------------
// Hash per UTC day: spend:<YYYYMMDD> { "<route>:<vendor>:calls": n, "<route>:<vendor>:usd_micro": µUSD }
// Integer micro-USD so HINCRBY stays atomic and float-drift-free across instances.
const utcDay = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
const DAY_TTL_S = String(40 * 24 * 3600);   // ~40 days of history, then self-cleaning

function storeRollup(key, est) {
  if (!isConfigured()) return;
  const dayKey = `spend:${utcDay()}`;
  const micro = Math.round(est * 1e6);
  // one pipeline, no await from the caller — errors are swallowed (metering is best-effort)
  pipeline([
    ["HINCRBY", dayKey, `${key}:calls`, "1"],
    ["HINCRBY", dayKey, `${key}:usd_micro`, String(micro)],
    ["EXPIRE", dayKey, DAY_TTL_S],
  ]).catch(() => {});
}

/** Today's cross-instance tallies from the store; null when no store / store trouble. */
export async function todayTallies() {
  if (!isConfigured()) return null;
  try {
    const out = await pipeline([["HGETALL", `spend:${utcDay()}`]]);
    const flat = out?.[0]?.result;
    if (!Array.isArray(flat)) return null;
    const by = {};
    let total = 0;
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const field = String(flat[i]);
      const value = Number(flat[i + 1]);
      const m = /^(.*):(calls|usd_micro)$/.exec(field);
      if (!m || !Number.isFinite(value)) continue;
      const row = by[m[1]] || (by[m[1]] = { calls: 0, est_usd: 0 });
      if (m[2] === "calls") row.calls = value;
      else { row.est_usd = round6(value / 1e6); total += value / 1e6; }
    }
    return { day: utcDay(), total_est_usd: round6(total), by };
  } catch { return null; }
}

/** Full admin surface body for GET /api/admin?op=spend — estimates, clearly labeled. */
export async function spendSnapshot() {
  return {
    est: true,
    note: "ESTIMATES from the static per-call price table in src/core/spendmeter.js — not a bill; update prices there.",
    process: processTallies(),
    today: await todayTallies(),   // null on self-host without Redis (process ≈ today there anyway, D1)
  };
}

// ---- field-test sink (server-side ftAppend) --------------------------------------------
// Direct JSONL append when FOOTNOTE_FIELDTEST_LOG is set — the server-side twin of the
// /__fieldtest/log POST sink in src/server/index.js (same file, same event-per-line shape,
// srv_t stamped like ftSink does). Env read per-call so tests can point it at a temp file.
function ftAppend(ev) {
  const log = process.env.FOOTNOTE_FIELDTEST_LOG;
  if (!log) return;
  try { fs.appendFileSync(log, JSON.stringify({ ...ev, srv_t: Date.now() }) + "\n"); } catch {}
}
