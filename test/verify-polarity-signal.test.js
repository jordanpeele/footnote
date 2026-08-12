// api/verify.js × the independent polarity signal (R50). Drives the REAL route handler
// with mock req/res and a single fetch stub routed by host (perplexity = the default
// verifier; api.anthropic.com = the Haiku signal). No network, no store (Upstash
// unconfigured → spend gate + rate limiter fail open, exactly the self-hoster path).
//
// What must hold:
//   1. utterance present + signal DISAGREES with claimed polarity → polarity_conflict
//      FORCED true (routes into the existing hold machinery: D4 no-auto-air, ⚠ on /op,
//      D17 spoken framing) — verdict itself unchanged;
//   2. utterance present + signal agrees → no forced conflict; polarity_signal additive;
//   3. NO utterance → byte-compatible with the pre-R50 response (no polarity_signal key,
//      no Anthropic call, ctx {} to the adapter) — the eval harness doesn't send
//      utterance yet, so this is load-bearing;
//   4. FOOTNOTE_POLARITY_SIGNAL=off → bypass: no Anthropic call, polarity_signal null,
//      never a forced conflict;
//   5. the signal runs IN PARALLEL with the verifier (Promise.all — zero added latency);
//   6. signal failure → null → NO forced hold (fail-safe);
//   7. one-way ratchet: the signal can only ADD a hold — a conflict applyPolarity raised
//      (suspect_denies) stays held even when the signal agrees.
import test from "node:test";
import assert from "node:assert/strict";

import handler from "../api/verify.js";

const PPLX_HOST = "api.perplexity.ai";
const ANTHROPIC_HOST = "api.anthropic.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// default verifier for every test in this file (registry reads env at call time)
process.env.FOOTNOTE_VERIFIER = "perplexity";
delete process.env.FOOTNOTE_POLARITY_SIGNAL;

function mockReqRes(body) {
  const req = { method: "POST", body, headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return { req, res };
}

const pplxOk = (verdict) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify({ verdict, correction: "c", confidence: 0.95, source_name: "Reuters" }) } }],
    citations: ["https://www.reuters.com/a"],
  }),
});
const signalOk = (word) => ({ ok: true, json: async () => ({ content: [{ type: "text", text: word }] }) });

function stub({ verdict = "True", signalWord = "ASSERTS", signalFail = false, delays = {} } = {}) {
  const order = [];
  const calls = { pplx: 0, anthropic: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(PPLX_HOST)) {
      calls.pplx++;
      order.push("pplx:start");
      if (delays.pplx) await sleep(delays.pplx);
      order.push("pplx:end");
      return pplxOk(verdict);
    }
    if (u.includes(ANTHROPIC_HOST)) {
      calls.anthropic++;
      order.push("signal:start");
      if (delays.signal) await sleep(delays.signal);
      order.push("signal:end");
      if (signalFail) return { ok: false, status: 500, text: async () => "down" };
      return signalOk(signalWord);
    }
    throw new Error("unexpected fetch url: " + u);
  };
  return { order, calls, restore: () => { globalThis.fetch = real; } };
}

test("MIRROR class: signal says denies, extractor claimed asserts → conflict FORCED, verdict unchanged", async () => {
  const { calls, restore } = stub({ verdict: "True", signalWord: "DENIES" });
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "asserts", utterance: "that never actually happened, no way" });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.verdict, "True", "the signal never flips the verdict — it only holds the card");
    assert.equal(res.body.polarity_conflict, true, "disagreement routes into the existing hold machinery");
    assert.equal(res.body.polarity_signal, "denies");
    assert.equal(calls.anthropic, 1);
  } finally { restore(); }
});

test("signal agrees with claimed polarity → no forced conflict; polarity_signal is additive observability", async () => {
  const { restore } = stub({ verdict: "False", signalWord: "DENIES" });
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "denies", utterance: "he never said that" });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.verdict, "True", "denies still flips False→True (applyPolarity unchanged)");
    assert.equal(res.body.polarity_conflict, false);
    assert.equal(res.body.polarity_signal, "denies");
  } finally { restore(); }
});

test("NO utterance → byte-compatible pre-R50 response: no polarity_signal key, no Anthropic call, ctx {}", async () => {
  const { calls, restore } = stub({ verdict: "True" });
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "asserts" });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.anthropic, 0, "no signal spend without an utterance");
    assert.ok(!("polarity_signal" in res.body), "no additive field on a legacy-shaped request");
    // the exact legacy key set — the eval harness depends on this shape
    assert.deepEqual(
      Object.keys(res.body).sort(),
      ["autoAirEligible", "citations", "confidence", "correction", "polarity_conflict", "source", "verdict"],
    );
  } finally { restore(); }
});

test("FOOTNOTE_POLARITY_SIGNAL=off → bypass: no Anthropic call, polarity_signal null, no forced conflict", async () => {
  process.env.FOOTNOTE_POLARITY_SIGNAL = "off";
  const { calls, restore } = stub({ verdict: "True", signalWord: "DENIES" });
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "asserts", utterance: "that never happened" });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.anthropic, 0, "kill switch stops the signal spend");
    assert.equal(res.body.polarity_signal, null, "field present (utterance was sent) but carries no signal");
    assert.equal(res.body.polarity_conflict, false);
  } finally {
    restore();
    delete process.env.FOOTNOTE_POLARITY_SIGNAL;
  }
});

test("signal runs IN PARALLEL with the verifier (Promise.all), not after it", async () => {
  // long verifier, instant signal: under Promise.all the signal STARTS before the
  // verifier finishes; run sequentially it couldn't.
  const { order, restore } = stub({ verdict: "True", signalWord: "ASSERTS", delays: { pplx: 40 } });
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "asserts", utterance: "words words words" });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const signalStart = order.indexOf("signal:start");
    const pplxEnd = order.indexOf("pplx:end");
    assert.ok(signalStart !== -1 && pplxEnd !== -1);
    assert.ok(signalStart < pplxEnd, "signal started before the verifier finished → concurrent, zero added latency");
  } finally { restore(); }
});

test("signal failure → null → NO forced hold (fail-safe: a dead signal is a no-op)", async () => {
  const { restore } = stub({ verdict: "True", signalFail: true });
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "asserts", utterance: "some words" });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.polarity_signal, null);
    assert.equal(res.body.polarity_conflict, false, "the signal's own failure must never hold a card");
    assert.equal(res.body.verdict, "True");
  } finally { restore(); }
});

test("one-way ratchet: suspect_denies stays HELD even when the signal agrees (denies)", async () => {
  // R46 rewrote the polarity to suspect_denies → applyPolarity raises the conflict. The
  // signal normalizes suspect_denies→denies, agrees, and must NOT clear the hold.
  const { restore } = stub({ verdict: "False", signalWord: "DENIES" });
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "suspect_denies", utterance: "Women have XY chromosomes" });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.verdict, "False", "suspect flip stays UN-applied (R46)");
    assert.equal(res.body.polarity_conflict, true, "R46's hold survives signal agreement");
    assert.equal(res.body.polarity_signal, "denies");
  } finally { restore(); }
});

test("utterance is sanitized: non-string ignored (legacy path), oversized capped before spend", async () => {
  // non-string utterance → treated as absent → legacy byte-compatible path
  const s1 = stub({ verdict: "True" });
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "asserts", utterance: { evil: true } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(s1.calls.anthropic, 0);
    assert.ok(!("polarity_signal" in res.body));
  } finally { s1.restore(); }
  // oversized utterance → hard cap (1000 chars) on what reaches the vendor
  let signalUtterance = null;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(PPLX_HOST)) return pplxOk("True");
    if (u.includes(ANTHROPIC_HOST)) {
      signalUtterance = JSON.parse(opts.body).messages[0].content;
      return signalOk("ASSERTS");
    }
    throw new Error("unexpected fetch url: " + u);
  };
  try {
    const { req, res } = mockReqRes({ claim: "The claim.", polarity: "asserts", utterance: "x".repeat(5000) });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(signalUtterance.length, 1000, "utterance hard-capped before it reaches the vendor");
  } finally { globalThis.fetch = real; }
});
