// P4-F2 (field F5): queue-driven overlay wake. A non-empty op:"queue" snapshot must stamp
// activeAt onto the room's MAIN on-air record — the one the public GET reads — so an idle
// overlay learns work is coming without any extra read on the poll path. Contract pinned
// here:
//   - snapshot with ≥1 card  → subsequent GET carries activeAt (server epoch ms)
//   - the stamp preserves card/seq/airedAt/durationMs (overlay edge-trigger untouched)
//   - snapshot with 0 cards (stream-end clear) → activeAt NOT created / NOT refreshed
// Runs the real handler against the memory state adapter (same pattern as the spendgate
// acceptance tests). Store env is scrubbed BEFORE the handler import chain pulls in the
// upstash module (it captures env at import time): with no store, the rate limiter
// no-ops; the spend-gate flag reader is pinned open so a shell env can't leak live-store
// calls into this suite. node --test isolates files per process, so nothing leaks out.
import test from "node:test";
import assert from "node:assert/strict";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.FOOTNOTE_STATE = "memory";
const { _setFlagReader } = await import("../src/core/spendgate.js");
const { default: onair } = await import("../api/onair.js");
// same module instance the registry hands the handler — used to pin the merge() contract
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
async function get(query) {
  const res = mockRes();
  await onair({ method: "GET", headers: {}, query }, res);
  return res;
}

const qcard = (id) => ({ id, state: "pending", verdict: "False", claim: "claim " + id, correction: "corr", spokenAt: 1000 + id });

test("queue snapshot with ≥1 card → subsequent GET carries activeAt; seq untouched", async () => {
  const room = "wake-basic";                                   // memory maps are per-process; unique room per test
  const t0 = Date.now();
  const r = await post({ room, writeKey: KEY, op: "queue", cards: [qcard(1)] });
  assert.equal(r.statusCode, 200);
  const g = await get({ room });
  assert.equal(g.statusCode, 200);
  assert.equal(typeof g.body.activeAt, "number", "GET must carry activeAt after a non-empty snapshot");
  assert.ok(g.body.activeAt >= t0 && g.body.activeAt <= Date.now(), "activeAt is server epoch ms of the snapshot");
  assert.equal(typeof g.body.serverNow, "number", "overlay compares activeAt against serverNow — same response, server clock only");
  // idle room: the stamp must not fabricate on-air state or advance seq (edge-trigger M4)
  assert.equal(g.body.card, null);
  assert.equal(g.body.seq, 0);
});

test("stamp preserves a live on-air record byte-for-byte (card/seq/airedAt/durationMs)", async () => {
  const room = "wake-live";
  const air = await post({ room, writeKey: KEY, card: { verdict: "False", claim: "the wall is visible from space", correction: "it is not", source: { name: "NASA" } }, durationMs: 10000 });
  assert.equal(air.statusCode, 200);
  const seq = air.body.seq;
  const r = await post({ room, writeKey: KEY, op: "queue", cards: [qcard(2)] });
  assert.equal(r.statusCode, 200);
  const g = await get({ room });
  assert.equal(g.body.seq, seq, "stamp must not advance seq — the overlay edge-triggers on it");
  assert.equal(g.body.id, air.body.id);
  assert.equal(g.body.airedAt, seq);
  assert.equal(g.body.durationMs, 10000);
  assert.equal(g.body.card.claim, "the wall is visible from space", "on-air card must survive the merge intact");
  assert.equal(typeof g.body.activeAt, "number");
  assert.ok(g.body.activeAt >= seq);
});

test("zero-card snapshot → activeAt neither created nor refreshed", async () => {
  const room = "wake-clear";
  // fresh room, empty snapshot: no activeAt appears
  await post({ room, writeKey: KEY, op: "queue", cards: [] });
  let g = await get({ room });
  assert.equal(g.statusCode, 200);
  assert.equal(g.body.activeAt, undefined, "empty snapshot must not create a stamp");
  // stamp once, then an empty snapshot (stream-end clear) must NOT refresh it —
  // otherwise a cleared queue would hold the overlay at FAST forever
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(3)] });
  const stamped = (await get({ room })).body.activeAt;
  assert.equal(typeof stamped, "number");
  await new Promise((r) => setTimeout(r, 5));   // ensure a refresh would be observable as a larger stamp
  await post({ room, writeKey: KEY, op: "queue", cards: [] });
  g = await get({ room });
  assert.equal(g.body.activeAt, stamped, "empty snapshot must leave the prior stamp untouched");
});

test("merge() contract: stale read cannot influence the stamp; missing room merges into the empty RoomEvent", async () => {
  // P4-F2 known residual, closed: the stamp used to be get→assign→publish, so an air
  // landing inside that gap was clobbered by the stale re-publish. merge() writes ONLY
  // its fields — deterministically replay the old hazard window at the adapter level.
  const room = "wake-atomic";
  const stale = await mem.get(room);   // the "old" read: room is empty
  assert.equal(stale, null);
  await mem.publish(room, { card: { claim: "live air" }, seq: 7, airedAt: 7, durationMs: 10000 }, { ttlSec: 300 });   // air lands in the gap
  await mem.merge(room, { activeAt: 123 }, { ttlSec: 180 });   // stamp fires AFTER, oblivious to the air
  const cur = await mem.get(room);
  assert.equal(cur.card.claim, "live air", "the concurrent air survives the stamp");
  assert.equal(cur.seq, 7, "seq untouched — overlay edge-trigger intact");
  assert.equal(cur.activeAt, 123, "the stamp itself landed");
  // no record → merge produces the empty RoomEvent + fields (GET contract: card:null, seq:0)
  await mem.merge("wake-atomic-empty", { activeAt: 5 }, { ttlSec: 60 });
  assert.deepEqual(await mem.get("wake-atomic-empty"), { card: null, seq: 0, activeAt: 5 });
});

test("concurrent air + queue snapshot: the air survives every interleaving (P4-F2 clobber)", async () => {
  // handler-level: fire a real air POST and a stamping queue push together, repeatedly,
  // so the await interleavings vary. With the old read-merge-write the queue push's
  // stale re-publish could erase the air; with merge() the card must survive always.
  for (let i = 0; i < 10; i++) {
    const room = "wake-race-" + i;
    await post({ room, writeKey: KEY, op: "queue", cards: [] });   // register the key first (empty push: no stamp)
    const [qr, ar] = await Promise.all([
      post({ room, writeKey: KEY, op: "queue", cards: [qcard(1)] }),
      post({ room, writeKey: KEY, card: { verdict: "False", claim: "race claim", correction: "no" }, durationMs: 10000 }),
    ]);
    assert.equal(qr.statusCode, 200);
    assert.equal(ar.statusCode, 200);
    const g = await get({ room });
    assert.ok(g.body.card, `iteration ${i}: the activeAt stamp must never clobber a concurrent air`);
    assert.equal(g.body.card.claim, "race claim");
    assert.equal(g.body.seq, ar.body.seq);
  }
});

test("?log=1 CORS contract unchanged by the stamp path", async () => {
  const room = "wake-cors";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(4)] });
  const logRes = await get({ room, log: "1" });
  assert.equal(logRes.statusCode, 200);
  assert.equal(logRes.headers["Access-Control-Allow-Origin"], "*", "log read stays CORS-open (R9)");
  const liveRes = await get({ room });
  assert.equal(liveRes.headers["Access-Control-Allow-Origin"], undefined, "live state read stays same-origin");
});
