// R54 (post-pilot-1): live attention capture. The /op page tags what the operator was doing
// during an auto-aired card's veto window (watching / talking / away) via a LOG-ONLY
// "attention" cmd — no publish, no card checks; /control consumes it and applies the tag.
// Contract pinned here:
//   - attention with a valid state → 200, cmd entry carries `attn`
//   - state is a CLOSED set — anything else is a 400 (never defaulted: "uncaptured" is
//     only ever the ABSENCE of a tag, so a bad state must not silently become one)
//   - cardId is required (attention is per-card by definition)
//   - the queue snapshot carries the sanitized `attn` array back to /op
// Same real-handler-against-memory-adapter pattern as op-skip-reason.test.js.
import test from "node:test";
import assert from "node:assert/strict";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.FOOTNOTE_STATE = "memory";
const { _setFlagReader } = await import("../src/core/spendgate.js");
const { default: onair } = await import("../api/onair.js");
const mem = await import("../src/adapters/state/memory-ws/index.js");
_setFlagReader(() => false);

const KEY = "test-write-key-12345678";

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; },
    end() {},
  };
}
async function post(body) {
  const res = mockRes();
  await onair({ method: "POST", headers: {}, query: {}, body }, res);
  return res;
}
const cmdEntry = async (room, cardId, action) =>
  (await mem.readLog("cmd." + room)).find((e) => e && e.cardId === cardId && e.action === action);

test("attention with each valid state → 200, cmd entry carries attn", async () => {
  for (const state of ["watching", "talking", "away"]) {
    const room = "attn-" + state;
    const r = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "attention", cardId: 7, state } });
    assert.equal(r.statusCode, 200);
    const e = await cmdEntry(room, 7, "attention");
    assert.ok(e, "the attention cmd was logged");
    assert.equal(e.attn, state);
  }
});

test("attention with an out-of-set state → 400 (closed set, never defaulted)", async () => {
  for (const state of ["distracted", "", null, { evil: true }, 3]) {
    const r = await post({ room: "attn-bad", writeKey: KEY, op: "cmd", cmd: { action: "attention", cardId: 8, state } });
    assert.equal(r.statusCode, 400, `state ${JSON.stringify(state)} must be rejected`);
  }
  assert.equal(await cmdEntry("attn-bad", 8, "attention"), undefined, "nothing persisted");
});

test("attention without a cardId → 400 (per-card by definition)", async () => {
  const r = await post({ room: "attn-nocard", writeKey: KEY, op: "cmd", cmd: { action: "attention", state: "watching" } });
  assert.equal(r.statusCode, 400);
});

test("queue snapshot round-trips the sanitized attn array to /op", async () => {
  const room = "attn-snapshot";
  await post({ room, writeKey: KEY, op: "queue", cards: [],
    attn: [{ id: 3, claim: "Measles vaccine does not cause autism." }, { id: "junk" }, null] });
  const r = await post({ room, writeKey: KEY, op: "queue-read" });
  assert.equal(r.statusCode, 200);
  assert.ok(Array.isArray(r.body.attn), "snapshot carries attn");
  assert.equal(r.body.attn.length, 1, "malformed entries are dropped");
  assert.equal(r.body.attn[0].id, 3);
  assert.equal(r.body.attn[0].claim, "Measles vaccine does not cause autism.");
});
