// Credential-scoping race test (D13/R8). Proves that per-call BYOK credentials can never
// cross-contaminate between concurrent invocations sharing one process (the warm-lambda
// scenario that made round 2's env-swap unsafe), and statically proves the old failure
// mode is impossible by construction: no code in the credential path writes process.env.
//
// node:test, zero deps. Drives the REAL adapters with a mocked global fetch that captures
// the Authorization header at request time and resolves after a randomized micro-delay to
// force maximal interleaving.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A minimal ok-response shaped like Perplexity's chat/completions answer.
function perplexityResponse() {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"verdict":"True","correction":"x","confidence":0.9,"source_name":"Reuters"}' } }],
      citations: ["https://www.reuters.com/x"],
    }),
  };
}

test("race: 500 interleaved verify() calls, zero credential cross-contamination", async () => {
  process.env.PERPLEXITY_API_KEY = "SERVER_KEY";
  const { verify } = await import("../src/adapters/verifier/perplexity/index.js");

  const N = 500;
  const captured = [];                 // { idx, auth } — auth captured at request time
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    // Capture the Authorization header the moment the request is constructed — this is
    // the exact value that would be spent against a vendor account.
    const body = JSON.parse(opts.body);
    const m = /Claim: claim (\d+)$/.exec(body.messages[1].content);
    captured.push({ idx: Number(m[1]), auth: opts.headers.Authorization });
    // Randomized micro-delay so hundreds of requests are in flight simultaneously while
    // later calls are still constructing THEIR headers. Under the old env-swap this is
    // precisely the window where keys bled across calls.
    await sleep(Math.random() * 8);
    return perplexityResponse();
  };

  try {
    const calls = [];
    for (let i = 0; i < N; i++) {
      const creds = i % 2 === 0 ? { perplexityKey: "ROOM_A_KEY" } : null;   // alternate BYOK / server default
      calls.push(
        (async () => {
          await sleep(Math.random() * 8);              // jitter the start too, not just the fetch
          return verify(`claim ${i}`, {}, creds);
        })()
      );
    }
    await Promise.all(calls);

    assert.equal(captured.length, N, "every call must hit fetch exactly once");
    let clean = 0;
    for (const { idx, auth } of captured) {
      const expected = idx % 2 === 0 ? "Bearer ROOM_A_KEY" : "Bearer SERVER_KEY";
      assert.equal(auth, expected, `call ${idx}: header must match the credentials passed for THAT call`);
      clean++;
    }
    assert.equal(clean, N);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("deepgram mintToken: per-call credentials scope correctly under concurrency", async () => {
  process.env.DEEPGRAM_API_KEY = "SERVER_DG_KEY";
  const { mintToken } = await import("../src/adapters/stt/deepgram/index.js");

  const N = 100;
  const captured = [];
  const realFetch = globalThis.fetch;
  let seq = 0;
  globalThis.fetch = async (_url, opts) => {
    captured.push({ order: seq++, auth: opts.headers.Authorization });
    await sleep(Math.random() * 5);
    return { ok: true, json: async () => ({ access_token: "tok", expires_in: 300 }) };
  };

  try {
    const expects = [];
    const calls = [];
    for (let i = 0; i < N; i++) {
      const creds = i % 2 === 0 ? { deepgramKey: "ROOM_DG_KEY" } : null;
      expects.push(i % 2 === 0 ? "Token ROOM_DG_KEY" : "Token SERVER_DG_KEY");
      calls.push(
        (async () => {
          await sleep(Math.random() * 5);
          return mintToken(creds);
        })()
      );
    }
    await Promise.all(calls);
    assert.equal(captured.length, N);
    // fetch-invocation order is not call order (starts are jittered), so tally by value:
    // exactly N/2 of each, and nothing outside the two legitimate keys.
    const room = captured.filter((c) => c.auth === "Token ROOM_DG_KEY").length;
    const server = captured.filter((c) => c.auth === "Token SERVER_DG_KEY").length;
    assert.equal(room, N / 2);
    assert.equal(server, N / 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("R8: env mutation is impossible by construction in the credential path", () => {
  // Statically assert that neither the adapters nor the routes ever ASSIGN to (or delete)
  // the vendor key env vars. Reads (`|| process.env.X`) are the sanctioned default path;
  // writes were the round-2 race and are permanently banned.
  const files = [
    "src/adapters/verifier/perplexity/index.js",
    "src/adapters/verifier/_stub/index.js",
    "src/adapters/stt/deepgram/index.js",
    "src/adapters/stt/_stub/index.js",
    "api/verify.js",
    "api/dg-token.js",
  ];
  for (const f of files) {
    const src = read(f);
    // `process.env.PERPLEXITY_API_KEY =` (assignment, not `==`/`===` comparison)
    assert.doesNotMatch(src, /process\.env\.PERPLEXITY_API_KEY\s*=(?!=)/, `${f}: assigns PERPLEXITY_API_KEY`);
    assert.doesNotMatch(src, /process\.env\.DEEPGRAM_API_KEY\s*=(?!=)/, `${f}: assigns DEEPGRAM_API_KEY`);
    assert.doesNotMatch(src, /delete\s+process\.env\.(PERPLEXITY|DEEPGRAM)_API_KEY/, `${f}: deletes a vendor key env var`);
    assert.doesNotMatch(src, /process\.env\[[^\]]+\]\s*=(?!=)/, `${f}: computed env assignment`);
  }
});
