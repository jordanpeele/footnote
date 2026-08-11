// A-4 (Sprint-A): OPTIONAL one-tap skip reason on /op. The operator's street skips are the
// best labeled training data the pipeline generates (wrong-entity / dull / risky) and today
// the record can't say why any skip happened. The reason rides the existing op:"cmd" path
// and is LOG-ONLY — a plain SKIP with no reason must behave byte-for-byte as it did before.
// Contract pinned here:
//   - skip WITH a valid reason → cmd entry carries `reason`, still a plain 200 skip
//   - skip WITHOUT a reason    → cmd entry has NO reason field (unchanged behavior)
//   - an out-of-allowlist / non-string reason → dropped (no reason field), skip still works
//   - reason is accepted on skip ONLY (never on air/hold/pull/mute)
// Runs the real handler against the memory state adapter (same pattern as op-cmd.test.js).
// Store env is scrubbed before the handler import chain pulls in upstash; the spend-gate
// flag reader is pinned open. node --test isolates files per process.
import test from "node:test";
import assert from "node:assert/strict";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.FOOTNOTE_STATE = "memory";
const { _setFlagReader } = await import("../src/core/spendgate.js");
const { default: onair } = await import("../api/onair.js");
// same module instance the registry hands the handler — read the cmd log directly to
// assert the persisted shape (the cmd log is an internal room the public surface can't reach)
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
const qcard = (id) => ({ id, state: "pending", verdict: "False", claim: "claim " + id, correction: "corr", spokenAt: 1000 + id });
// read the cmd log back for the room and return the entry for the given card + action
const cmdEntry = async (room, cardId, action) =>
  (await mem.readLog("cmd." + room)).find((e) => e && e.cardId === cardId && e.action === action);

test("skip WITH a valid reason → 200 and the cmd entry carries reason", async () => {
  const room = "skipreason-with";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(1)] });
  const r = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "skip", cardId: 1, reason: "wrong-entity" } });
  assert.equal(r.statusCode, 200);
  const e = await cmdEntry(room, 1, "skip");
  assert.ok(e, "the skip was logged");
  assert.equal(e.action, "skip");
  assert.equal(e.cardId, 1);
  assert.equal(e.reason, "wrong-entity", "the operator's reason is captured in the cmd log");
});

test("every allowlisted reason survives to the log", async () => {
  for (const reason of ["wrong-entity", "dull", "risky", "other"]) {
    const room = "skipreason-" + reason;
    await post({ room, writeKey: KEY, op: "queue", cards: [qcard(2)] });
    const r = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "skip", cardId: 2, reason } });
    assert.equal(r.statusCode, 200);
    assert.equal((await cmdEntry(room, 2, "skip")).reason, reason);
  }
});

test("reasonless skip → 200 and the cmd entry has NO reason field (unchanged behavior)", async () => {
  const room = "skipreason-none";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(3)] });
  const r = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "skip", cardId: 3 } });
  assert.equal(r.statusCode, 200);
  const e = await cmdEntry(room, 3, "skip");
  assert.ok(e, "the plain skip was logged");
  assert.equal("reason" in e, false, "a reasonless skip must not invent a reason field");
});

test("out-of-allowlist reason is dropped, skip still succeeds", async () => {
  const room = "skipreason-bogus";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(4)] });
  const r = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "skip", cardId: 4, reason: "boring-ish-something" } });
  assert.equal(r.statusCode, 200, "an unrecognized reason never breaks the skip");
  assert.equal("reason" in (await cmdEntry(room, 4, "skip")), false, "an unrecognized reason is not persisted");
});

test("non-string reason is ignored, skip still succeeds", async () => {
  const room = "skipreason-nonstr";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(5)] });
  const r = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "skip", cardId: 5, reason: { evil: true } } });
  assert.equal(r.statusCode, 200);
  assert.equal("reason" in (await cmdEntry(room, 5, "skip")), false);
});

test("reason is a skip-only field — a hold with a reason drops it", async () => {
  const room = "skipreason-hold";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(6)] });
  const r = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "hold", cardId: 6, reason: "risky" } });
  assert.equal(r.statusCode, 200);
  assert.equal("reason" in (await cmdEntry(room, 6, "hold")), false, "reason only rides skip commands");
});
