// Hosted /api/verify spend authorization: room requirement, global cap, Redis failure,
// and kill-switch ordering. A tiny fetch fake emulates the Upstash pipeline response so
// these tests exercise the real route and Lua command boundary without a live Redis.
import { after, test } from "node:test";
import assert from "node:assert/strict";

const ENV_KEYS = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "HOSTED_MODE", "BYOK_ENABLED",
  "FOOTNOTE_VERIFIER", "ALLOW_STUBS"];
const oldEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
process.env.KV_REST_API_URL = "https://redis.test";
process.env.KV_REST_API_TOKEN = "test-token";
process.env.HOSTED_MODE = "1";
process.env.BYOK_ENABLED = "0";
process.env.FOOTNOTE_VERIFIER = "stub";
process.env.ALLOW_STUBS = "1";

const oldFetch = globalThis.fetch;
const { default: verify } = await import("../api/verify.js");
const { _setFlagReader } = await import("../src/core/spendgate.js");
const { GLOBAL_VERIFICATIONS_PER_DAY } = await import("../src/core/tunables.js");

after(() => {
  _setFlagReader(null);
  globalThis.fetch = oldFetch;
  for (const [k, v] of Object.entries(oldEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; },
  };
}

function req(body) {
  return { method: "POST", headers: { "x-forwarded-for": "203.0.113.7" }, body };
}

function redisFake() {
  const counts = new Map();
  return async (_url, options) => {
    const commands = JSON.parse(options.body);
    const cmd = commands[0];
    if (cmd[0] === "INCR") {   // per-IP limiter; keep it below its threshold
      return { ok: true, json: async () => [{ result: 1 }, { result: 1 }] };
    }
    assert.equal(cmd[0], "EVAL", "spend authorization must be one atomic Redis command");

    const keyCount = Number(cmd[2]);
    const keys = cmd.slice(3, 3 + keyCount);
    const args = cmd.slice(3 + keyCount);
    const roomCap = Number(args[0]);
    const globalCap = Number(args[1]);
    const roomCount = counts.get(keys[0]) || 0;
    const globalCount = keyCount > 1 ? (counts.get(keys[1]) || 0) : 0;
    let result;
    if (keyCount > 1 && globalCount >= globalCap) result = ["global", roomCount, globalCount];
    else if (roomCount >= roomCap) result = ["room", roomCount, globalCount];
    else {
      counts.set(keys[0], roomCount + 1);
      if (keyCount > 1) counts.set(keys[1], globalCount + 1);
      result = ["allowed", roomCount + 1, keyCount > 1 ? globalCount + 1 : 0];
    }
    return { ok: true, json: async () => [{ result }] };
  };
}

test("hosted verify without a valid room returns the room-required contract", async () => {
  _setFlagReader(() => false);
  globalThis.fetch = redisFake();
  const res = mockRes();
  await verify(req({ claim: "The moon has lower gravity than Earth." }), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "room required" });
});

test("self-hosted verify keeps the documented optional-room behavior", async () => {
  _setFlagReader(() => false);
  globalThis.fetch = redisFake();
  process.env.HOSTED_MODE = "0";
  try {
    const res = mockRes();
    await verify(req({ claim: "The moon has lower gravity than Earth." }), res);
    assert.equal(res.statusCode, 200);
  } finally {
    process.env.HOSTED_MODE = "1";
  }
});

test("rotating rooms cannot bypass the hosted global daily cap", async () => {
  _setFlagReader(() => false);
  globalThis.fetch = redisFake();
  for (let i = 0; i < GLOBAL_VERIFICATIONS_PER_DAY; i++) {
    const res = mockRes();
    await verify(req({ claim: `claim ${i}`, room: `room_${i}` }), res);
    assert.equal(res.statusCode, 200, `request ${i + 1} should be authorized`);
  }
  const denied = mockRes();
  await verify(req({ claim: "one too many", room: "room_over_cap" }), denied);
  assert.equal(denied.statusCode, 429);
  assert.deepEqual(denied.body, { error: "global daily cap reached", cap: GLOBAL_VERIFICATIONS_PER_DAY });
});

test("hosted Redis failure fails closed before the verifier adapter", async () => {
  _setFlagReader(() => false);
  globalThis.fetch = async () => { throw new Error("redis down"); };
  const previous = process.env.FOOTNOTE_VERIFIER;
  const previousError = console.error;
  process.env.FOOTNOTE_VERIFIER = "tripwire-no-such-adapter";
  console.error = () => {};
  try {
    const res = mockRes();
    await verify(req({ claim: "must not reach upstream", room: "room_fail" }), res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: "spend authorization unavailable" });
  } finally {
    process.env.FOOTNOTE_VERIFIER = previous;
    console.error = previousError;
  }
});

test("verify kill switch remains first and touches neither Redis nor verifier", async () => {
  _setFlagReader(() => true);
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("unexpected Redis call"); };
  const previous = process.env.FOOTNOTE_VERIFIER;
  process.env.FOOTNOTE_VERIFIER = "tripwire-no-such-adapter";
  try {
    const res = mockRes();
    await verify(req({ claim: "blocked", room: "room_kill" }), res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: "paused by operator", paused: true });
    assert.equal(fetchCalls, 0);
  } finally {
    process.env.FOOTNOTE_VERIFIER = previous;
    _setFlagReader(() => false);
  }
});
