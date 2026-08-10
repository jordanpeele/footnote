// P7-B render-ack (R39 — the trust-gap closure: 8 cards silently missed broadcast while
// /op said success) + P7-C mute latch plumbing, pinned through the real handler against
// the memory state adapter (same pattern as op-cmd.test.js).
//   op:"rendered" — UNAUTHENTICATED BY DESIGN (the overlay holds no writeKey); the gate is
//   the unguessable server-minted aired id: accepted ONLY when body.id === the room's
//   CURRENT on-air record id. Accept → atomic merge of {renderedId, renderedAt} that must
//   NEVER clobber the card. renderedId/renderedAt must reach BOTH read surfaces: the
//   public GET and the writeKey-gated op:"queue-read".
//   mute/unmute — log-only operator commands (no cardId, no publish, no card checks);
//   the latch itself rides the op:"queue" snapshot as `muted` and comes back on queue-read.
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

const card = { verdict: "False", claim: "the claim", correction: "the fix", source: { name: "Reuters", url: "https://reuters.com/a" } };
// control-style air: publish a card, return the minted aired id
async function airCard(room, c = card) {
  const r = await post({ room, writeKey: KEY, card: c });
  assert.equal(r.statusCode, 200);
  return r.body.id;
}
const rendered = (room, id) => post({ room, op: "rendered", id });   // NO writeKey — that's the point

test("op:rendered — matching current id accepted WITHOUT a writeKey; merge preserves the card", async () => {
  const room = "rack-accept";
  const id = await airCard(room);
  const before = (await get({ room })).body;
  const r = await rendered(room, id);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
  const after = (await get({ room })).body;
  assert.equal(after.renderedId, id, "renderedId reaches the public GET");
  assert.equal(typeof after.renderedAt, "number", "renderedAt is server-stamped");
  // the atomic merge must never clobber the on-air record it annotates
  assert.deepEqual(after.card, before.card, "card untouched by the ack merge");
  assert.equal(after.seq, before.seq, "seq untouched — no phantom edge-trigger for the overlay");
  assert.equal(after.id, id, "aired id untouched");
});

test("op:rendered — wrong id rejected 409, nothing stamped", async () => {
  const room = "rack-wrongid";
  const id = await airCard(room);
  const r = await rendered(room, id + "x");
  assert.equal(r.statusCode, 409);
  const g = (await get({ room })).body;
  assert.equal(g.renderedId, undefined, "a spoofed id must not mark anything rendered");
  assert.equal(g.renderedAt, undefined);
});

test("op:rendered — no current on-air card → 409 (an ack can't resurrect or pre-stamp state)", async () => {
  const room = "rack-nocard";
  await post({ room, writeKey: KEY, card: null });   // registers the room, publishes a pull (card:null)
  const r = await rendered(room, "12345-abcd");
  assert.equal(r.statusCode, 409);
});

test("op:rendered — a STALE id (previous air) is rejected once a newer card takes the chyron", async () => {
  const room = "rack-staleid";
  const first = await airCard(room);
  const second = await airCard(room, { ...card, claim: "newer claim" });
  const r = await rendered(room, first);
  assert.equal(r.statusCode, 409, "only the CURRENT record id is a valid capability");
  const ok = await rendered(room, second);
  assert.equal(ok.statusCode, 200);
  assert.equal((await get({ room })).body.renderedId, second);
});

test("op:rendered — malformed body: bad room 400, missing/non-string id 400", async () => {
  assert.equal((await post({ room: "x", op: "rendered", id: "1-a" })).statusCode, 400);   // room too short
  const room = "rack-badid";
  await airCard(room);
  assert.equal((await post({ room, op: "rendered" })).statusCode, 400);
  assert.equal((await post({ room, op: "rendered", id: 42 })).statusCode, 400);
});

test("renderedId/renderedAt flow to the op:queue-read response (the /op poll surface)", async () => {
  const room = "rack-qread";
  await post({ room, writeKey: KEY, op: "queue", cards: [] });   // TOFU-register
  const id = await airCard(room);
  const pre = await post({ room, writeKey: KEY, op: "queue-read" });
  assert.equal(pre.body.renderedId, null, "null before the overlay acks");
  await rendered(room, id);
  const r = await post({ room, writeKey: KEY, op: "queue-read" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.renderedId, id);
  assert.equal(typeof r.body.renderedAt, "number");
});

test("operator air → overlay ack: renderedId matches the operator's airedId end-to-end", async () => {
  const room = "rack-opair";
  const qc = { id: 1, state: "pending", verdict: "False", claim: "op claim", correction: "c", spokenAt: 1001 };
  await post({ room, writeKey: KEY, op: "queue", cards: [qc] });
  const a = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "air", cardId: 1 } });
  assert.equal(a.statusCode, 200);
  assert.equal((await rendered(room, a.body.airedId)).statusCode, 200);
  const q = await post({ room, writeKey: KEY, op: "queue-read" });
  assert.equal(q.body.renderedId, a.body.airedId, "/op can match its airedId against the ack");
});

test("P7-C: queue snapshot carries muted; queue-read returns it (default false)", async () => {
  const room = "rack-muted";
  await post({ room, writeKey: KEY, op: "queue", cards: [], muted: true });
  assert.equal((await post({ room, writeKey: KEY, op: "queue-read" })).body.muted, true);
  await post({ room, writeKey: KEY, op: "queue", cards: [] });
  assert.equal((await post({ room, writeKey: KEY, op: "queue-read" })).body.muted, false, "absent → false");
  await post({ room, writeKey: KEY, op: "queue", cards: [], muted: "yes" });
  assert.equal((await post({ room, writeKey: KEY, op: "queue-read" })).body.muted, false, "non-boolean truthy is not a latch");
});

test("P7-C: mute/unmute are log-only cmds — 200 without cardId, land in cmds-read, publish nothing", async () => {
  const room = "rack-mutecmd";
  await post({ room, writeKey: KEY, op: "queue", cards: [] });
  const m = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "mute" } });
  assert.equal(m.statusCode, 200);
  assert.ok(m.body.id, "mute cmd is minted like any other");
  const u = await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "unmute" } });
  assert.equal(u.statusCode, 200);
  const cmds = (await post({ room, writeKey: KEY, op: "cmds-read" })).body.cmds;
  assert.deepEqual(cmds.map((c) => c.action), ["mute", "unmute"], "oldest→newest for /control");
  assert.equal(cmds[0].cardId, null);
  assert.equal((await get({ room })).body.card, null, "mute must never touch the on-air channel");
  assert.equal((await get({ room, log: "1" })).body.log.length, 0, "…or the aired log");
  // the action allowlist still rejects garbage
  assert.equal((await post({ room, writeKey: KEY, op: "cmd", cmd: { action: "mtue" } })).statusCode, 400);
});
