// concurrence meta-verifier (gap F-3, built dark — the two-verifier concurrence gate).
// node:test, zero deps, fetch stubbed. What must hold:
//   1. it runs the two configured sub-verifiers (default perplexity + brave-claude) in
//      PARALLEL (Promise.all) — asserted via call ordering under staggered stub delays;
//   2. MERGE TRUTH-TABLE: agree-definitive → that verdict + air-eligible; disagree-
//      definitive → NeedsContext (conflict), not eligible; mixed/non-definitive → the LESS
//      committal verdict wins, not eligible (conservative merge);
//   3. ONE-VERIFIER-ERRORS policy: survivor's definitive verdict floored to NeedsContext,
//      not eligible; BOTH error → the UpstreamError propagates;
//   4. the env pair FOOTNOTE_CONCURRENCE_A / _B selects the engines; self-composition is
//      refused;
//   5. output is a RawVerification editorial.js can finalize; credentials thread per-call;
//   6. registry: FOOTNOTE_VERIFIER=concurrence selects it, default stays perplexity (dark).
//
// The two default sub-verifiers are the REAL perplexity + brave-claude adapters, driven
// over a single fetch stub that routes by URL and returns per-engine canned verdicts.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { name, verify } from "../src/adapters/verifier/concurrence/index.js";
import { finalizeVerification } from "../src/core/editorial.js";
import { UpstreamError } from "../src/core/errors.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAVE_HOST = "api.search.brave.com";
const ANTHROPIC_HOST = "api.anthropic.com";
const PPLX_HOST = "api.perplexity.ai";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ensure the default engine pair for every test in this file.
process.env.FOOTNOTE_CONCURRENCE_A = "perplexity";
process.env.FOOTNOTE_CONCURRENCE_B = "brave-claude";

// Build a Perplexity chat/completions ok-response carrying a given verdict JSON.
const pplxOk = (verdict, correction = "c", confidence = 0.95, source = "Reuters", citations = ["https://www.reuters.com/a"]) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify({ verdict, correction, confidence, source_name: source }) } }],
    citations,
  }),
});
// Brave web/search ok-response (evidence only).
const braveOk = (citations = ["https://www.archives.gov/b"]) => ({
  ok: true,
  json: async () => ({ web: { results: citations.map((u, i) => ({ title: `T${i}`, description: `D${i}`, url: u })) } }),
});
// Anthropic Messages ok-response carrying a given verdict JSON.
const claudeOk = (verdict, correction = "c", confidence = 0.95, source = "Reuters") => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify({ verdict, correction, confidence, source_name: source }) }] }),
});

/**
 * Route the single fetch stub to the right engine. `opts` lets each host return a canned
 * response and (optionally) sleep first — used to prove parallelism and to fail one engine.
 * `braveVerdict` is the verdict Claude renders for the brave-claude engine; the Brave
 * search call always succeeds unless braveSearchFail is set.
 */
function stubEngines({ pplxVerdict, braveVerdict, pplxFail, braveClaudeFail, braveSearchFail, delays = {} } = {}) {
  const order = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(PPLX_HOST)) {
      order.push("pplx:start");
      if (delays.pplx) await sleep(delays.pplx);
      order.push("pplx:end");
      if (pplxFail) return { ok: false, status: 502, text: async () => "pplx down" };
      return pplxOk(pplxVerdict);
    }
    if (u.includes(BRAVE_HOST)) {
      order.push("brave:start");
      if (delays.braveSearch) await sleep(delays.braveSearch);
      order.push("brave:end");
      if (braveSearchFail) return { ok: false, status: 503, text: async () => "brave down" };
      return braveOk();
    }
    if (u.includes(ANTHROPIC_HOST)) {
      order.push("claude:start");
      if (delays.claude) await sleep(delays.claude);
      order.push("claude:end");
      if (braveClaudeFail) return { ok: false, status: 500, text: async () => "claude down" };
      return claudeOk(braveVerdict);
    }
    throw new Error("unexpected fetch url: " + u);
  };
  return { order, restore: () => { globalThis.fetch = real; } };
}

test("both agree on a definitive verdict → that verdict, air-eligible", async () => {
  const { restore } = stubEngines({ pplxVerdict: "False", braveVerdict: "False" });
  try {
    const out = await verify("Nixon finished his second term.", {}, null);
    assert.equal(out.verdict, "False");
    assert.equal(out.concurrence.eligible, true);
    assert.equal(out.concurrence.conflict, false);
    assert.equal(out.concurrence.a.verdict, "False");
    assert.equal(out.concurrence.b.verdict, "False");
    // citations unioned across both engines
    assert.ok(out.citations.includes("https://www.reuters.com/a"));
    assert.ok(out.citations.includes("https://www.archives.gov/b"));
    // finalizes cleanly for air
    const card = finalizeVerification(out);
    assert.equal(card.verdict, "False");
  } finally { restore(); }
});

test("both agree True → that verdict, air-eligible, confidence is the lower of the two", async () => {
  const { restore } = stubEngines({ pplxVerdict: "True", braveVerdict: "True" });
  try {
    const out = await verify("claim", {}, null);
    // perplexity confidence 0.95, claude 0.95 — min is 0.95; not damped when eligible
    assert.equal(out.verdict, "True");
    assert.equal(out.concurrence.eligible, true);
    assert.equal(out.confidence, 0.95);
  } finally { restore(); }
});

test("definitive DISAGREEMENT (True vs False) → NeedsContext, conflict flagged, not eligible", async () => {
  const { restore } = stubEngines({ pplxVerdict: "True", braveVerdict: "False" });
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, "NeedsContext");
    assert.equal(out.concurrence.eligible, false);
    assert.equal(out.concurrence.conflict, true);
    assert.equal(out.concurrence.a.verdict, "True");
    assert.equal(out.concurrence.b.verdict, "False");
  } finally { restore(); }
});

test("conservative merge: True (A) vs NeedsContext (B) → NeedsContext, not eligible", async () => {
  const { restore } = stubEngines({ pplxVerdict: "True", braveVerdict: "NeedsContext" });
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, "NeedsContext", "the less-committal verdict wins");
    assert.equal(out.concurrence.eligible, false);
  } finally { restore(); }
});

test("conservative merge: Misleading vs Unverifiable → Unverifiable (least committal)", async () => {
  const { restore } = stubEngines({ pplxVerdict: "Misleading", braveVerdict: "Unverifiable" });
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, "Unverifiable");
    assert.equal(out.concurrence.eligible, false);
    assert.equal(out.concurrence.conflict, true);
  } finally { restore(); }
});

test("both agree on a NON-definitive verdict → that verdict but NOT air-eligible", async () => {
  const { restore } = stubEngines({ pplxVerdict: "NeedsContext", braveVerdict: "NeedsContext" });
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, "NeedsContext");
    assert.equal(out.concurrence.eligible, false, "only definitive concurrence is ever eligible");
    assert.equal(out.concurrence.conflict, false);
  } finally { restore(); }
});

test("off-list / garbled sub-verdict normalizes to Unverifiable before merge", async () => {
  const { restore } = stubEngines({ pplxVerdict: "true", braveVerdict: "totally-bogus" });
  try {
    const out = await verify("claim", {}, null);
    // A canonicalizes to True (definitive), B to Unverifiable (non-definitive) → conservative: Unverifiable
    assert.equal(out.verdict, "Unverifiable");
    assert.equal(out.concurrence.a.verdict, "True");
    assert.equal(out.concurrence.b.verdict, "Unverifiable");
    assert.equal(out.concurrence.eligible, false);
  } finally { restore(); }
});

test("ONE errors: survivor's definitive verdict is FLOORED to NeedsContext, not eligible", async () => {
  // brave-claude engine fails at its Claude step; perplexity survives with a definitive False.
  const { restore } = stubEngines({ pplxVerdict: "False", braveClaudeFail: true });
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, "NeedsContext", "single-engine definitive must not air through the gate");
    assert.equal(out.concurrence.eligible, false);
    assert.equal(out.concurrence.errored, "brave-claude");
    assert.equal(out.concurrence.a.ok, true);
    assert.equal(out.concurrence.b.ok, false);
    // survivor's correction/source still carried through
    assert.equal(out.sourceName, "Reuters");
  } finally { restore(); }
});

test("ONE errors: survivor's non-definitive verdict is preserved (no floor needed)", async () => {
  const { restore } = stubEngines({ pplxVerdict: "Unverifiable", braveSearchFail: true });
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, "Unverifiable");
    assert.equal(out.concurrence.errored, "brave-claude");
  } finally { restore(); }
});

test("BOTH error: the UpstreamError propagates (no verdict to give)", async () => {
  const { restore } = stubEngines({ pplxFail: true, braveSearchFail: true });
  try {
    await assert.rejects(verify("claim", {}, null), (e) => {
      assert.ok(e instanceof UpstreamError, "propagates an UpstreamError from a dead engine");
      return true;
    });
  } finally { restore(); }
});

test("both sub-verifiers run in PARALLEL (Promise.all), not sequentially", async () => {
  // Give perplexity a long delay; if the engines ran sequentially, Brave's search wouldn't
  // start until perplexity finished. Under Promise.all, both starts precede either end.
  const { order, restore } = stubEngines({ pplxVerdict: "True", braveVerdict: "True", delays: { pplx: 40 } });
  try {
    await verify("claim", {}, null);
    const pplxStart = order.indexOf("pplx:start");
    const braveStart = order.indexOf("brave:start");
    const pplxEnd = order.indexOf("pplx:end");
    assert.ok(pplxStart !== -1 && braveStart !== -1);
    assert.ok(braveStart < pplxEnd, "Brave started before Perplexity finished → concurrent, not serial");
  } finally { restore(); }
});

test("credentials thread per-call to BOTH sub-verifiers", async () => {
  const keys = { pplx: null, brave: null, anthropic: null };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(PPLX_HOST)) { keys.pplx = opts.headers.Authorization; return pplxOk("True"); }
    if (u.includes(BRAVE_HOST)) { keys.brave = opts.headers["X-Subscription-Token"]; return braveOk(); }
    if (u.includes(ANTHROPIC_HOST)) { keys.anthropic = opts.headers["x-api-key"]; return claudeOk("True"); }
    throw new Error("unexpected url");
  };
  try {
    await verify("claim", {}, { perplexityKey: "PK", braveKey: "BK", anthropicKey: "AK" });
    assert.equal(keys.pplx, "Bearer PK", "perplexity got the per-call key");
    assert.equal(keys.brave, "BK", "brave got the per-call key");
    assert.equal(keys.anthropic, "AK", "claude got the per-call key");
  } finally { globalThis.fetch = real; }
});

test("self-composition is refused (no infinite recursion)", async () => {
  process.env.FOOTNOTE_CONCURRENCE_A = "concurrence";
  const { restore } = stubEngines({ pplxVerdict: "True", braveVerdict: "True" });
  try {
    await assert.rejects(verify("claim", {}, null), /cannot compose itself/);
  } finally {
    restore();
    process.env.FOOTNOTE_CONCURRENCE_A = "perplexity";
  }
});

test("env pair reconfigures the engines: A=perplexity, B=perplexity-twostep", async () => {
  process.env.FOOTNOTE_CONCURRENCE_B = "perplexity-twostep";
  // both engines are now perplexity-based → all calls go to PPLX_HOST. two-step makes 2
  // pplx calls, single-shot makes 1: 3 total, all definitive False → agree, eligible.
  let pplxCalls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(PPLX_HOST)) {
      pplxCalls++;
      const body = JSON.parse(opts.body);
      // two-step step-2 disables search; return a verdict JSON either way
      return pplxOk("False");
    }
    throw new Error("unexpected url: " + u);
  };
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, "False");
    assert.equal(out.concurrence.eligible, true);
    assert.equal(pplxCalls, 3, "single-shot (1) + two-step (2) perplexity calls");
  } finally {
    globalThis.fetch = real;
    process.env.FOOTNOTE_CONCURRENCE_B = "brave-claude";
  }
});

test("registry: FOOTNOTE_VERIFIER=concurrence selects it; default stays perplexity (dark)", () => {
  const script = `
    import { getAdapter } from "./src/core/registry.js";
    console.log("OK " + getAdapter("verifier").name);
  `;
  const run = (envOverrides) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: ROOT, encoding: "utf8",
      env: { ...process.env, NODE_ENV: "", ALLOW_STUBS: "", FOOTNOTE_VERIFIER: "", ...envOverrides },
    });
    assert.equal(r.status, 0, `subprocess crashed:\n${r.stderr}`);
    return r.stdout.trim();
  };
  assert.equal(run({ FOOTNOTE_VERIFIER: "concurrence" }), "OK concurrence");
  assert.equal(run({ FOOTNOTE_VERIFIER: "concurrence", NODE_ENV: "production" }), "OK concurrence", "not a stub — allowed in prod when explicitly selected");
  assert.equal(run({}), "OK perplexity", "concurrence stays dark: the default verifier is unchanged");
  assert.equal(name, "concurrence", "adapter name matches its registry key");
});
