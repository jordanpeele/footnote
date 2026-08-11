// brave-claude adapter (issue #5, built dark — the SECOND independent verifier). node:test,
// zero deps, fetch stubbed — same pattern as test/perplexity-twostep.test.js and
// test/credentials.test.js. What must hold:
//   1. exactly two upstream calls per verify(): step 1 Brave Web Search (GET, query in URL,
//      X-Subscription-Token), step 2 Anthropic Messages (POST, claude-opus-4-8, the
//      versioned VERDICT_PROMPT as system, evidence block threaded into the user message);
//   2. the returned RawVerification is shape-identical to the perplexity adapters' (same
//      contract into src/core/editorial.js finalizeVerification — D5);
//   3. UpstreamError propagates from EITHER step (and step 2 never fires if step 1 died);
//   4. credentials (braveKey / anthropicKey) are PER-CALL on BOTH steps, race-free under
//      concurrency, and (statically) no env mutation exists in the adapter — R8;
//   5. empty Brave results degrade to a NO_EVIDENCE block; malformed Claude JSON preserves raw.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { name, verify, VERDICT_PROMPT } from "../src/adapters/verifier/brave-claude/index.js";
import { verify as verifyPerplexity } from "../src/adapters/verifier/perplexity/index.js";
import { finalizeVerification } from "../src/core/editorial.js";
import { UpstreamError } from "../src/core/errors.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAVE_HOST = "api.search.brave.com";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VERDICT_JSON = '{"verdict":"False","correction":"Nixon resigned on August 9, 1974, and did not finish his second term.","confidence":0.97,"source_name":"National Archives","evidence_lines":["E1","E2"]}';

// A Brave web/search ok-response shaped like the real API.
const braveResponse = (results = [
  { title: "Nixon resigns", description: "Richard Nixon resigned August 9, 1974.", url: "https://www.archives.gov/nixon" },
  { title: "Ford sworn in", description: "Gerald Ford took office the same day.", url: "https://www.reuters.com/x" },
]) => ({ ok: true, json: async () => ({ web: { results } }) });

// An Anthropic Messages ok-response: content is a blocks array (adaptive thinking may add a
// thinking block with no text; a text block carries the JSON).
const claudeResponse = (text = VERDICT_JSON, withThinking = true) => ({
  ok: true,
  json: async () => ({
    content: [
      ...(withThinking ? [{ type: "thinking", thinking: "…reasoning…" }] : []),
      { type: "text", text },
    ],
  }),
});

/** Install a fetch stub that records {url, method, headers, body} per call. */
function stubFetch(responder) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const rec = {
      url: String(url),
      method: opts.method || "GET",
      headers: opts.headers || {},
      body: opts.body ? JSON.parse(opts.body) : null,
    };
    calls.push(rec);
    return responder(rec, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const isBrave = (rec) => rec.url.includes(BRAVE_HOST);

test("two-step sequence: Brave search (step 1) then Claude verdict (step 2)", async () => {
  const { calls, restore } = stubFetch((rec) => (isBrave(rec) ? braveResponse() : claudeResponse()));
  try {
    const out = await verify("Nixon finished his second term.", {}, { braveKey: "BK", anthropicKey: "AK" });
    assert.equal(calls.length, 2, "exactly two upstream calls per verify()");

    // step 1 — Brave: GET, query in URL, subscription-token header
    const s1 = calls[0];
    assert.ok(isBrave(s1), "step 1 hits Brave");
    assert.equal(s1.method, "GET");
    assert.ok(s1.url.includes("q=Nixon%20finished%20his%20second%20term."), "claim is URL-encoded into the query");
    assert.equal(s1.headers["X-Subscription-Token"], "BK", "brave key on step 1");

    // step 2 — Anthropic: POST, opus-4-8, versioned system prompt, evidence threaded in
    const s2 = calls[1];
    assert.equal(s2.url, ANTHROPIC_URL);
    assert.equal(s2.method, "POST");
    assert.equal(s2.headers["x-api-key"], "AK", "anthropic key on step 2");
    assert.equal(s2.headers["anthropic-version"], "2023-06-01");
    assert.equal(s2.body.model, "claude-opus-4-8");
    assert.deepEqual(s2.body.thinking, { type: "adaptive" });
    assert.equal(s2.body.system, VERDICT_PROMPT, "step-2 system prompt is the versioned verdict prompt");
    assert.ok(s2.body.messages[0].content.includes("Claim: Nixon finished his second term."), "step 2 receives the claim");
    assert.ok(s2.body.messages[0].content.includes("E1: Nixon resigns — Richard Nixon resigned August 9, 1974."), "Brave evidence block threads into step 2");
    assert.doesNotMatch(VERDICT_PROMPT.slice(0, 200), /Brave Search.*verdict is Unverifiable/s, "prompt names Brave as the search stage");

    // result: verdict fields from Claude, citations from Brave, raw = Claude text
    assert.equal(out.verdict, "False");
    assert.equal(out.correction, "Nixon resigned on August 9, 1974, and did not finish his second term.");
    assert.equal(out.confidence, 0.97);
    assert.equal(out.sourceName, "National Archives");
    assert.deepEqual(out.citations, ["https://www.archives.gov/nixon", "https://www.reuters.com/x"]);
    assert.equal(out.raw, VERDICT_JSON);
  } finally { restore(); }
});

test("contract parity: RawVerification shape is identical to the perplexity adapter's", async () => {
  let bc, pplx;
  {
    const { restore } = stubFetch((rec) => (isBrave(rec) ? braveResponse() : claudeResponse()));
    try { bc = await verify("claim", {}, null); } finally { restore(); }
  }
  {
    const { restore } = stubFetch(() => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: VERDICT_JSON } }], citations: ["https://www.reuters.com/x"] }),
    }));
    try { pplx = await verifyPerplexity("claim", {}, null); } finally { restore(); }
  }
  assert.deepEqual(Object.keys(bc).sort(), Object.keys(pplx).sort(), "same RawVerification keys as perplexity");

  // and the shared consumer produces a complete on-air card body from it
  const card = finalizeVerification(bc);
  assert.equal(card.verdict, "False");
  assert.equal(card.source.name, "National Archives"); // derived from archives.gov (tier 3, curated map)
  assert.equal(card.source.url, "https://www.archives.gov/nixon");
  assert.equal(card.autoAirEligible, true);
  assert.equal(card.confidence, 0.97);
});

test("empty Brave results degrade to a NO_EVIDENCE block (Claude still runs)", async () => {
  const { calls, restore } = stubFetch((rec) =>
    (isBrave(rec)
      ? braveResponse([])
      : claudeResponse('{"verdict":"Unverifiable","correction":"","confidence":0.3,"source_name":"","evidence_lines":[]}')));
  try {
    const out = await verify("claim", {}, null);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].body.messages[0].content.includes("Evidence block:\nNO_EVIDENCE"));
    assert.equal(out.verdict, "Unverifiable");
    assert.deepEqual(out.citations, []);
  } finally { restore(); }
});

test("malformed Claude JSON: fields undefined, raw preserved — core's fallback path takes over", async () => {
  const { restore } = stubFetch((rec) => (isBrave(rec) ? braveResponse() : claudeResponse("The claim is false because Nixon resigned.")));
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, undefined);
    assert.equal(out.raw, "The claim is false because Nixon resigned.");
    assert.deepEqual(out.citations, ["https://www.archives.gov/nixon", "https://www.reuters.com/x"]);
    const card = finalizeVerification(out);
    assert.equal(card.verdict, "Unverifiable"); // off-list → whitelisted down
    assert.equal(card.correction, "The claim is false because Nixon resigned."); // raw fallback
  } finally { restore(); }
});

test("UpstreamError from Brave (step 1) propagates — and Claude never fires", async () => {
  const { calls, restore } = stubFetch(() => ({ ok: false, status: 503, text: async () => "search backend down" }));
  try {
    await assert.rejects(verify("claim", {}, null), (e) => {
      assert.ok(e instanceof UpstreamError);
      assert.equal(e.status, 503);
      assert.equal(e.detail, "search backend down");
      return true;
    });
    assert.equal(calls.length, 1, "no verdict call after a dead search call");
  } finally { restore(); }
});

test("UpstreamError from Claude (step 2) propagates", async () => {
  const { calls, restore } = stubFetch((rec) =>
    (isBrave(rec) ? braveResponse() : { ok: false, status: 429, text: async () => "rate limited" }));
  try {
    await assert.rejects(verify("claim", {}, null), (e) => {
      assert.ok(e instanceof UpstreamError);
      assert.equal(e.status, 429);
      assert.equal(e.detail, "rate limited");
      return true;
    });
    assert.equal(calls.length, 2);
  } finally { restore(); }
});

test("credentials are per-call on BOTH steps, race-free under 60 interleaved verifies (D13/R8)", async () => {
  process.env.BRAVE_API_KEY = "SERVER_BRAVE";
  process.env.ANTHROPIC_API_KEY = "SERVER_ANTHROPIC";
  const N = 60; // 120 fetches, alternating BYOK / server default
  const captured = []; // { idx, step, key } at request-construction time
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(BRAVE_HOST)) {
      const m = /q=claim%20(\d+)/.exec(u);
      captured.push({ idx: Number(m[1]), step: 1, key: opts.headers["X-Subscription-Token"] });
      await sleep(Math.random() * 8);
      return braveResponse();
    }
    const body = JSON.parse(opts.body);
    const m = /Claim: claim (\d+)/.exec(body.messages[0].content);
    captured.push({ idx: Number(m[1]), step: 2, key: opts.headers["x-api-key"] });
    await sleep(Math.random() * 8);
    return claudeResponse();
  };
  try {
    await Promise.all(Array.from({ length: N }, (_, i) =>
      (async () => {
        await sleep(Math.random() * 8);
        const creds = i % 2 === 0 ? { braveKey: "ROOM_BRAVE", anthropicKey: "ROOM_ANTHROPIC" } : null;
        return verify(`claim ${i}`, {}, creds);
      })()));
    assert.equal(captured.length, N * 2, "every verify() hits fetch exactly twice");
    for (const { idx, step, key } of captured) {
      const byok = idx % 2 === 0;
      const expected = step === 1
        ? (byok ? "ROOM_BRAVE" : "SERVER_BRAVE")
        : (byok ? "ROOM_ANTHROPIC" : "SERVER_ANTHROPIC");
      assert.equal(key, expected, `call ${idx} step ${step}: key must match THAT call's credentials`);
    }
    for (let i = 0; i < N; i++) {
      assert.deepEqual(captured.filter((c) => c.idx === i).map((c) => c.step).sort(), [1, 2], `call ${i}: one step-1 and one step-2`);
    }
  } finally { globalThis.fetch = real; }
});

test("R8 static: the adapter never mutates env in the credential path", () => {
  const src = readFileSync(path.join(ROOT, "src/adapters/verifier/brave-claude/index.js"), "utf8");
  assert.doesNotMatch(src, /process\.env\.BRAVE_API_KEY\s*=(?!=)/, "assigns BRAVE_API_KEY");
  assert.doesNotMatch(src, /process\.env\.ANTHROPIC_API_KEY\s*=(?!=)/, "assigns ANTHROPIC_API_KEY");
  assert.doesNotMatch(src, /delete\s+process\.env\./, "deletes an env var");
  assert.doesNotMatch(src, /process\.env\[[^\]]+\]\s*=(?!=)/, "computed env assignment");
});

test("registry: FOOTNOTE_VERIFIER=brave-claude selects this adapter; default stays perplexity (dark)", () => {
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
  assert.equal(run({ FOOTNOTE_VERIFIER: "brave-claude" }), "OK brave-claude");
  assert.equal(run({ FOOTNOTE_VERIFIER: "brave-claude", NODE_ENV: "production" }), "OK brave-claude", "not a stub — allowed in prod when explicitly selected");
  assert.equal(run({}), "OK perplexity", "brave-claude stays dark: the default verifier is unchanged");
  assert.equal(name, "brave-claude", "adapter name matches its registry key");
});
