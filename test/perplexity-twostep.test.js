// perplexity-twostep adapter (P4-C, built dark). node:test, zero deps, fetch stubbed —
// same pattern as test/credentials.test.js. What must hold:
//   1. exactly two Perplexity calls per verify(): step 1 search-focused (domain filter,
//      evidence prompt, NO verdict ask), step 2 reasoning-focused (search disabled,
//      temperature 0, verdict prompt);
//   2. the step-1 evidence block threads VERBATIM into the step-2 user message;
//   3. the returned RawVerification is shape-identical to the single-shot adapter's
//      (same contract into src/core/editorial.js finalizeVerification — D5);
//   4. UpstreamError propagates from EITHER step (and step 2 never fires if step 1 died);
//   5. credentials are PER-CALL on BOTH steps, race-free under concurrency, and (statically)
//      no env mutation exists in the adapter — R8, mirroring test/credentials.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { name, verify, EVIDENCE_PROMPT, VERDICT_PROMPT } from "../src/adapters/verifier/perplexity-twostep/index.js";
import { verify as verifySingleShot } from "../src/adapters/verifier/perplexity/index.js";
import { finalizeVerification } from "../src/core/editorial.js";
import { UpstreamError } from "../src/core/errors.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PPLX_URL = "https://api.perplexity.ai/chat/completions";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE = "E1: Nixon resigned the presidency on August 9, 1974 — National Archives\nE2: Gerald Ford was sworn in the same day, before Nixon's second term ended — Reuters";
const VERDICT_JSON = '{"verdict":"False","correction":"Nixon resigned on August 9, 1974, and did not finish his second term.","confidence":0.97,"source_name":"National Archives","evidence_lines":["E1","E2"]}';

// ok-responses shaped like Perplexity chat/completions answers
const step1Response = (content = EVIDENCE, citations = ["https://www.archives.gov/nixon", "https://www.reuters.com/x"]) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], citations }),
});
const step2Response = (content = VERDICT_JSON) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),   // no citations: search disabled
});

/** Install a fetch stub that records {url, body, auth} per call; returns {calls, restore}. */
function stubFetch(responder) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const rec = { url, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
    calls.push(rec);
    return responder(rec, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("two-step sequence: search-focused step 1, reasoning-focused step 2, evidence threaded verbatim", async () => {
  const { calls, restore } = stubFetch((_rec, n) => (n === 1 ? step1Response() : step2Response()));
  try {
    const out = await verify("Nixon finished his second term.", {}, { perplexityKey: "K" });
    assert.equal(calls.length, 2, "exactly two Perplexity calls per verify()");
    assert.ok(calls.every((c) => c.url === PPLX_URL));

    // step 1 — evidence gathering: searches, filtered domains, asks for evidence, not a verdict
    const s1 = calls[0].body;
    assert.equal(s1.model, "sonar-pro");
    assert.ok(Array.isArray(s1.search_domain_filter) && s1.search_domain_filter.includes("-reddit.com"), "step 1 keeps the low-trust domain filter");
    assert.equal(s1.disable_search, undefined, "step 1 must search");
    assert.equal(s1.messages[0].content, EVIDENCE_PROMPT, "step-1 system prompt is the versioned evidence prompt");
    assert.equal(s1.messages[1].content, "Claim: Nixon finished his second term.");
    assert.doesNotMatch(EVIDENCE_PROMPT, /"verdict"/, "step 1 must not ask for a verdict field");

    // step 2 — verdict commitment: no new search, deterministic, judges ONLY the evidence
    const s2 = calls[1].body;
    assert.equal(s2.model, "sonar-pro");
    assert.equal(s2.disable_search, true, "step 2 must not search");
    assert.equal(s2.temperature, 0, "step 2 is deterministic reasoning");
    assert.equal(s2.search_domain_filter, undefined, "no search → no domain filter");
    assert.equal(s2.messages[0].content, VERDICT_PROMPT, "step-2 system prompt is the versioned verdict prompt");
    assert.ok(s2.messages[1].content.includes("Claim: Nixon finished his second term."), "step 2 receives the claim");
    assert.ok(s2.messages[1].content.includes(EVIDENCE), "step-1 evidence block threads verbatim into step 2");
    assert.match(VERDICT_PROMPT, /evidence_lines/, "step-2 prompt requires the verdict to cite evidence lines");

    // result: verdict fields from step 2, citations from step 1, raw = step-2 content
    assert.equal(out.verdict, "False");
    assert.equal(out.correction, "Nixon resigned on August 9, 1974, and did not finish his second term.");
    assert.equal(out.confidence, 0.97);
    assert.equal(out.sourceName, "National Archives");
    assert.deepEqual(out.citations, ["https://www.archives.gov/nixon", "https://www.reuters.com/x"]);
    assert.equal(out.raw, VERDICT_JSON);
  } finally { restore(); }
});

test("contract parity: RawVerification shape is identical to the single-shot adapter's", async () => {
  // Drive BOTH adapters over stubbed fetch and compare the key sets — editorial.js
  // (finalizeVerification) is the shared consumer and must not be able to tell them apart.
  let two, single;
  {
    const { restore } = stubFetch((_rec, n) => (n === 1 ? step1Response() : step2Response()));
    try { two = await verify("claim", {}, null); } finally { restore(); }
  }
  {
    const { restore } = stubFetch(() => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: VERDICT_JSON } }], citations: ["https://www.reuters.com/x"] }),
    }));
    try { single = await verifySingleShot("claim", {}, null); } finally { restore(); }
  }
  assert.deepEqual(Object.keys(two).sort(), Object.keys(single).sort(), "same RawVerification keys as single-shot");

  // and the shared consumer produces a complete on-air card body from it
  const card = finalizeVerification(two);
  assert.equal(card.verdict, "False");
  assert.equal(card.source.name, "National Archives");           // display name derives from the winning domain (archives.gov, tier 3 — curated map, P5F-3), not the vendor's source_name
  assert.equal(card.source.url, "https://www.archives.gov/nixon");
  assert.equal(card.autoAirEligible, true);
  assert.equal(card.confidence, 0.97);
});

test("empty step-1 answer degrades to a NO_EVIDENCE block (step 2 still runs)", async () => {
  const { calls, restore } = stubFetch((_rec, n) =>
    (n === 1 ? step1Response("", []) : step2Response('{"verdict":"Unverifiable","correction":"","confidence":0.3,"source_name":"","evidence_lines":[]}')));
  try {
    const out = await verify("claim", {}, null);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].body.messages[1].content.includes("Evidence block:\nNO_EVIDENCE"));
    assert.equal(out.verdict, "Unverifiable");
    assert.deepEqual(out.citations, []);
  } finally { restore(); }
});

test("malformed step-2 JSON: fields undefined, raw preserved — core's fallback path takes over", async () => {
  const { restore } = stubFetch((_rec, n) => (n === 1 ? step1Response() : step2Response("The claim is false because Nixon resigned.")));
  try {
    const out = await verify("claim", {}, null);
    assert.equal(out.verdict, undefined);
    assert.equal(out.raw, "The claim is false because Nixon resigned.");
    assert.deepEqual(out.citations, ["https://www.archives.gov/nixon", "https://www.reuters.com/x"]);
    const card = finalizeVerification(out);
    assert.equal(card.verdict, "Unverifiable");                   // off-list → whitelisted down
    assert.equal(card.correction, "The claim is false because Nixon resigned."); // raw fallback
  } finally { restore(); }
});

test("UpstreamError from step 1 propagates — and step 2 never fires", async () => {
  const { calls, restore } = stubFetch(() => ({ ok: false, status: 503, text: async () => "search backend down" }));
  try {
    await assert.rejects(verify("claim", {}, null), (e) => {
      assert.ok(e instanceof UpstreamError);
      assert.equal(e.status, 503);
      assert.equal(e.detail, "search backend down");
      return true;
    });
    assert.equal(calls.length, 1, "no verdict call after a dead evidence call");
  } finally { restore(); }
});

test("UpstreamError from step 2 propagates", async () => {
  const { calls, restore } = stubFetch((_rec, n) =>
    (n === 1 ? step1Response() : { ok: false, status: 429, text: async () => "rate limited" }));
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
  process.env.PERPLEXITY_API_KEY = "SERVER_KEY";
  const N = 60;                                   // 120 fetches, alternating BYOK / server default
  const captured = [];                            // { idx, step, auth } at request-construction time
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const m = /claim (\d+)/.exec(body.messages[1].content);
    const step = body.disable_search ? 2 : 1;
    captured.push({ idx: Number(m[1]), step, auth: opts.headers.Authorization });
    await sleep(Math.random() * 8);               // force maximal interleaving across calls
    return step === 1 ? step1Response() : step2Response();
  };
  try {
    await Promise.all(Array.from({ length: N }, (_, i) =>
      (async () => {
        await sleep(Math.random() * 8);
        return verify(`claim ${i}`, {}, i % 2 === 0 ? { perplexityKey: "ROOM_A_KEY" } : null);
      })()));
    assert.equal(captured.length, N * 2, "every verify() hits fetch exactly twice");
    for (const { idx, step, auth } of captured) {
      const expected = idx % 2 === 0 ? "Bearer ROOM_A_KEY" : "Bearer SERVER_KEY";
      assert.equal(auth, expected, `call ${idx} step ${step}: header must match THAT call's credentials`);
    }
    for (let i = 0; i < N; i++) {
      assert.deepEqual(captured.filter((c) => c.idx === i).map((c) => c.step).sort(), [1, 2], `call ${i}: one step-1 and one step-2`);
    }
  } finally { globalThis.fetch = real; }
});

test("R8 static: the adapter never mutates env in the credential path", () => {
  const src = readFileSync(path.join(ROOT, "src/adapters/verifier/perplexity-twostep/index.js"), "utf8");
  assert.doesNotMatch(src, /process\.env\.PERPLEXITY_API_KEY\s*=(?!=)/, "assigns PERPLEXITY_API_KEY");
  assert.doesNotMatch(src, /delete\s+process\.env\./, "deletes an env var");
  assert.doesNotMatch(src, /process\.env\[[^\]]+\]\s*=(?!=)/, "computed env assignment");
});

test("registry: FOOTNOTE_VERIFIER=perplexity-twostep selects this adapter; default stays perplexity (dark)", () => {
  // subprocess isolation, same rationale as test/registry.test.js
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
  assert.equal(run({ FOOTNOTE_VERIFIER: "perplexity-twostep" }), "OK perplexity-twostep");
  assert.equal(run({ FOOTNOTE_VERIFIER: "perplexity-twostep", NODE_ENV: "production" }), "OK perplexity-twostep", "not a stub — allowed in prod when explicitly selected");
  assert.equal(run({}), "OK perplexity", "P4-C stays dark: the default verifier is unchanged");
  assert.equal(name, "perplexity-twostep", "adapter name matches its registry key");
});
