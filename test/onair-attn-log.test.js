// 4a (R54 → public record, DARK): op:"attn" appends an operator-attention event to the
// AIRED log — kind:"attention" + refId join, the correction pattern (D6: append-only, the
// original entry is never mutated). The op is server-live but CLIENT-DARK: app.js only
// sends it under ?attn=1, and /receipts only renders it under ?attn=1. Contract pinned:
//   - valid state + refId of an autoAired log entry → 200, one attention event appended,
//     original entry byte-identical (never mutated)
//   - state is the R54 CLOSED set — anything else 400, nothing appended (never defaulted)
//   - refId must reference an EXISTING autoAired entry: unknown id → 409; a HUMAN-aired
//     entry → 409 (attention is defined per auto-aired card only)
//   - first tag wins: second tag for the same refId → 200 {dup}, still exactly one event
//   - writeKey-gated like every other write op (wrong key → 403)
// Same real-handler-against-memory-adapter pattern as op-attention.test.js.
import test from "node:test";
import assert from "node:assert/strict";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.FOOTNOTE_STATE = "memory";
const { _setFlagReader } = await import("../src/core/spendgate.js");
const { default: onair } = await import("../api/onair.js");
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
async function get(query) {
  const res = mockRes();
  await onair({ method: "GET", headers: {}, query }, res);
  return res;
}
// air one card into the room's log and return its server-minted aired id
async function airOne(room, over) {
  const r = await post({ room, writeKey: KEY, card: { verdict: "False", claim: "c",
    correction: "x", source: { name: "Reuters", url: "https://reuters.com/a" }, ...over } });
  assert.equal(r.statusCode, 200);
  return r.body.id;
}
const logOf = async (room) => (await get({ room, log: "1" })).body.log;

test("attn on an autoAired entry → 200, append-only attention event, original unmutated", async () => {
  const room = "attnlog-ok";
  const airedId = await airOne(room, { autoAired: true });
  const before = (await logOf(room)).find((e) => e.id === airedId);
  const r = await post({ room, writeKey: KEY, op: "attn", refId: airedId, state: "watching" });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.id && r.body.id !== airedId, "the event got its own minted id");
  const log = await logOf(room);
  const ev = log.find((e) => e.kind === "attention");
  assert.ok(ev, "attention event landed on the aired log");
  assert.equal(ev.refId, airedId);
  assert.equal(ev.attn, "watching");
  assert.deepEqual(log.find((e) => e.id === airedId), before, "D6: the aired entry is never mutated");
});

test("attn state is a closed set — anything else 400, nothing appended", async () => {
  const room = "attnlog-badstate";
  const airedId = await airOne(room, { autoAired: true });
  for (const state of ["distracted", "", null, 3, true, { evil: 1 }]) {
    const r = await post({ room, writeKey: KEY, op: "attn", refId: airedId, state });
    assert.equal(r.statusCode, 400, `state ${JSON.stringify(state)} must be rejected`);
  }
  assert.equal((await logOf(room)).some((e) => e.kind === "attention"), false, "nothing persisted");
});

test("attn refId must reference an existing AUTO-aired entry (unknown → 409, human air → 409)", async () => {
  const room = "attnlog-badref";
  const humanId = await airOne(room, {});   // no autoAired flag — a human air
  const unknown = await post({ room, writeKey: KEY, op: "attn", refId: "999999-zzzz", state: "away" });
  assert.equal(unknown.statusCode, 409, "unknown refId rejected");
  const human = await post({ room, writeKey: KEY, op: "attn", refId: humanId, state: "away" });
  assert.equal(human.statusCode, 409, "attention on a human air rejected — R54 is per auto-aired card");
  const missing = await post({ room, writeKey: KEY, op: "attn", state: "away" });
  assert.equal(missing.statusCode, 400, "absent refId is a bad request");
  assert.equal((await logOf(room)).some((e) => e.kind === "attention"), false, "record stays clean");
});

test("first tag wins: duplicate attn → 200 {dup}, exactly one event in the log", async () => {
  const room = "attnlog-dup";
  const airedId = await airOne(room, { autoAired: true });
  const a = await post({ room, writeKey: KEY, op: "attn", refId: airedId, state: "talking" });
  assert.equal(a.statusCode, 200);
  const b = await post({ room, writeKey: KEY, op: "attn", refId: airedId, state: "away" });
  assert.equal(b.statusCode, 200);
  assert.equal(b.body.dup, true, "second tag reports dup");
  assert.equal(b.body.id, a.body.id, "dup echoes the winner's event id");
  const evs = (await logOf(room)).filter((e) => e.kind === "attention");
  assert.equal(evs.length, 1, "exactly one attention event");
  assert.equal(evs[0].attn, "talking", "the first tag's state stands");
});

test("attn is writeKey-gated like every write op — wrong key → 403, nothing appended", async () => {
  const room = "attnlog-key";
  const airedId = await airOne(room, { autoAired: true });
  const r = await post({ room, writeKey: "wrong-key-12345678", op: "attn", refId: airedId, state: "watching" });
  assert.equal(r.statusCode, 403);
  assert.equal((await logOf(room)).some((e) => e.kind === "attention"), false);
});
