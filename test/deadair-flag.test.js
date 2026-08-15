// R-transport dead-air flag (FS-2 lineage — making silent transport failure LOUD).
// The whole STT/audio chain runs on /control; the only thing that crosses to /op is the
// queue snapshot. When the transport goes deaf (bonded leg dies / relay drops OBS's source /
// Deepgram WS wedges / bandwidth saturates into silence) /control stops getting finals and
// sets sttStale on the op:"queue" snapshot. This pins the server contract: sttStale is a
// strict boolean (like `muted`), rides the snapshot, and comes back on op:"queue-read" so the
// street operator can tell dead air apart from a quiet speaker. Handler-level, memory adapter,
// same harness as render-ack.test.js / op-cmd.test.js.
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
    statusCode: 0, body: null, headers: {},
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
const queue = (room, extra) => post(Object.assign({ room, writeKey: KEY, op: "queue", cards: [] }, extra || {}));
const read = (room) => post({ room, writeKey: KEY, op: "queue-read" });

test("sttStale:true rides the snapshot and comes back on queue-read", async () => {
  const room = "da-true";
  const w = await queue(room, { sttStale: true });
  assert.equal(w.statusCode, 200);
  const r = await read(room);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.sttStale, true, "dead-air flag reaches the /op poll surface");
});

test("absent sttStale → false (default is healthy — never a phantom dead-air)", async () => {
  const room = "da-absent";
  await queue(room, {});
  assert.equal((await read(room)).body.sttStale, false);
});

test("sttStale is a STRICT boolean — a truthy non-boolean is NOT a latch (no false alarm)", async () => {
  const room = "da-nonbool";
  await queue(room, { sttStale: "yes" });
  assert.equal((await read(room)).body.sttStale, false, "only literal true trips the dead-air banner");
  await queue(room, { sttStale: 1 });
  assert.equal((await read(room)).body.sttStale, false);
});

test("sttStale clears when /control re-pushes false (audio restored)", async () => {
  const room = "da-clear";
  await queue(room, { sttStale: true });
  assert.equal((await read(room)).body.sttStale, true);
  await queue(room, { sttStale: false });   // finals flowing again → /control pushes false
  assert.equal((await read(room)).body.sttStale, false, "restore is legible, not sticky");
});

test("sttStale is independent of muted — a muted mic and a dead feed are different signals", async () => {
  const room = "da-vs-mute";
  await queue(room, { muted: true, sttStale: false });   // intentional silence, feed alive
  let r = await read(room);
  assert.equal(r.body.muted, true);
  assert.equal(r.body.sttStale, false, "muting must not masquerade as dead air");
  await queue(room, { muted: false, sttStale: true });   // feed dead, not muted
  r = await read(room);
  assert.equal(r.body.muted, false);
  assert.equal(r.body.sttStale, true, "dead air with a hot mic is the dangerous case — it must show");
});

test("dead-air flag does not disturb the existing snapshot fields (cards/muted/autoair/attn)", async () => {
  const room = "da-coexist";
  const qc = { id: 1, state: "pending", verdict: "False", claim: "c", spokenAt: 1001 };
  await queue(room, { cards: [qc], muted: true, sttStale: true, autoair: { on: true, count: 2, cap: 10 } });
  const r = await read(room);
  assert.equal(r.body.sttStale, true);
  assert.equal(r.body.muted, true);
  assert.equal(r.body.cards.length, 1);
  assert.equal(r.body.autoair.count, 2);
});
