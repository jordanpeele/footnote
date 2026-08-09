// P3-J operator air — round-3 race residuals pinned (docs/redteam/ROUND3-REPROBE.md):
//   N4: an operator air must be refused when the server can SEE the backing q.<room>
//       snapshot is stale — (1) snapshot older than its intended lifetime (freshness
//       ceiling = the snapshot TTL; deliberately NOT tighter, because /control pushes
//       snapshots only on queue mutations, so a live-but-quiet control legitimately
//       leaves qseq minutes old), and (2) a server-logged HOLD/SKIP for the same card
//       that the snapshot can't yet reflect. Both reject 409 {error, stale:true}.
//   N2: two concurrent airs for the same (cardId, spokenAt) must produce exactly ONE
//       overlay publish + ONE aired-log entry (append-then-elect; loser answers dup
//       with the winner's airedId).
// Runs the real handler against the memory state adapter (same pattern as
// overlay-activity.test.js). Store env is scrubbed BEFORE the handler import chain pulls
// in the upstash module; the spend-gate flag reader is pinned open. node --test isolates
// files per process, so nothing leaks out.
import test from "node:test";
import assert from "node:assert/strict";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.FOOTNOTE_STATE = "memory";
const { _setFlagReader } = await import("../src/core/spendgate.js");
const { default: onair } = await import("../api/onair.js");
// same module instance the registry hands the handler — lets tests plant internal-room
// state (q.<room> with a doctored qseq) that the public surface can't reach by design
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
const cmd = (room, action, cardId) => post({ room, writeKey: KEY, op: "cmd", cmd: { action, cardId } });

test("fresh snapshot → operator air 200: overlay updated, exactly one aired-log entry", async () => {
  const room = "opcmd-fresh";
  const q = await post({ room, writeKey: KEY, op: "queue", cards: [qcard(1)] });
  assert.equal(q.statusCode, 200);
  const r = await cmd(room, "air", 1);
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.airedId, "air mints and returns an airedId");
  assert.notEqual(r.body.dup, true);
  const g = await get({ room });
  assert.equal(g.body.card.claim, "claim 1", "the card reached the overlay channel");
  assert.equal(g.body.id, r.body.airedId, "on-air record carries the minted airedId");
  const lg = await get({ room, log: "1" });
  assert.equal(lg.body.log.length, 1, "exactly one aired-log entry");
  assert.equal(lg.body.log[0].id, r.body.airedId);
});

test("N4: snapshot past the freshness ceiling → 409 stale, nothing published or logged", async () => {
  const room = "opcmd-stale";
  await post({ room, writeKey: KEY, op: "queue", cards: [] });   // TOFU-register the writeKey
  // plant an internal-room snapshot older than OP_AIR_MAX_SNAPSHOT_AGE_MS (180s) but
  // still alive in the store — models an adapter that ignores ttlSec (contract allows it)
  await mem.publish("q." + room, { cards: [qcard(2)], qseq: Date.now() - 181000, onAirId: null }, { ttlSec: 600 });
  const r = await cmd(room, "air", 2);
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.stale, true, "staleness is distinguishable from plain card-gone");
  const g = await get({ room });
  assert.equal(g.body.card, null, "stale air must not reach the overlay");
  assert.equal((await get({ room, log: "1" })).body.log.length, 0, "stale air must not reach the aired log");
});

test("N4: HOLD newer than the backing snapshot → air 409 stale; other cards unaffected", async () => {
  const room = "opcmd-hold";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(3), qcard(4)] });
  assert.equal((await cmd(room, "hold", 3)).statusCode, 200);
  const r = await cmd(room, "air", 3);
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.stale, true, "a held card must never air from a snapshot that predates the hold");
  // the hold pins the card INSTANCE (spokenAt): even a FRESHER snapshot that still lists
  // the card as pending (control hasn't applied the hold yet) must not make it airable
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(3), qcard(4)] });
  const r2 = await cmd(room, "air", 3);
  assert.equal(r2.statusCode, 409, "hold survives a snapshot refresh that hasn't applied it yet");
  // a hold for card 3 must not block card 4
  const r4 = await cmd(room, "air", 4);
  assert.equal(r4.statusCode, 200);
  assert.equal((await get({ room })).body.card.claim, "claim 4");
});

test("N4: SKIP newer than the backing snapshot → air 409 stale", async () => {
  const room = "opcmd-skip";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(5)] });
  assert.equal((await cmd(room, "skip", 5)).statusCode, 200);
  const r = await cmd(room, "air", 5);
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.stale, true);
});

test("N2: concurrent double-fire air → one publish, one aired-log entry, one dup answer", async () => {
  const room = "opcmd-race";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(6)] });
  const [a, b] = await Promise.all([cmd(room, "air", 6), cmd(room, "air", 6)]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  // whichever interleaving the scheduler picked (serialized → `prior` fast path;
  // overlapped → append-then-elect), exactly one caller is told it was the duplicate
  // and BOTH get the same winning airedId
  assert.equal([a, b].filter((r) => r.body.dup === true).length, 1, "exactly one dup answer");
  assert.ok(a.body.airedId, "both answers carry the winner's airedId");
  assert.equal(a.body.airedId, b.body.airedId);
  const lg = await get({ room, log: "1" });
  assert.equal(lg.body.log.length, 1, "the race must not double-log the air");
  assert.equal((await get({ room })).body.id, a.body.airedId, "overlay carries the winner");
});

test("N2: serialized re-tap → dup with the original airedId, log still one entry", async () => {
  const room = "opcmd-retap";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(7)] });
  const first = await cmd(room, "air", 7);
  assert.equal(first.statusCode, 200);
  const again = await cmd(room, "air", 7);
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.dup, true);
  assert.equal(again.body.airedId, first.body.airedId);
  assert.equal((await get({ room, log: "1" })).body.log.length, 1);
});

test("card absent from the current snapshot (control applied the hold) → plain 409, no stale flag", async () => {
  const room = "opcmd-gone";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(8)] });
  await post({ room, writeKey: KEY, op: "queue", cards: [] });   // control's re-push after applying a dismiss
  const r = await cmd(room, "air", 8);
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.stale, undefined, "card-gone keeps the original shape");
});
