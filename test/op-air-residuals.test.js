// Packet 5a — N2/N4 residual hardening: deterministic interleaving + injected-fault tests
// for the op:"cmd" air branch, against the REAL handler on the memory state adapter.
//
// The memory adapter's _setHook seam (src/adapters/state/memory-ws) intercepts verb entry:
//   throw            → models the store failing on that verb (N2 partial-failure epochs)
//   return a Promise → parks the verb until the test releases it (deterministic ordering
//                      of two racing handlers' log appends — no Promise.all roulette)
//
// What this file pins:
//   1. N2 elect under a FORCED overlap (both racers pass the prior scan before either
//      appends) — exactly one publish, one aired-log row, one air-landed marker.
//   2. N2 partial failure (publish dies after the cmd append): the cmd record is now
//      self-describing (air entry with NO air-landed marker + NO aired-log row), a retap
//      inside OP_AIR_INFLIGHT_GRACE_MS answers dup (documented residual: the ghost
//      window), and a retap past the grace RE-AIRS — the self-heal.
//   3. N2 partial failure later in the sequence (aired-log append dies; marker append
//      dies) — each heals or falls back without double-airing.
//   4. N4 hold-vs-air adjudicated by append order: a hold that reaches the log BEFORE
//      the air's own append now wins deterministically (the pre-5a code lost this race
//      in the window between its one pre-scan and the publish).
import test from "node:test";
import assert from "node:assert/strict";

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.FOOTNOTE_STATE = "memory";
const { _setFlagReader } = await import("../src/core/spendgate.js");
const { default: onair } = await import("../api/onair.js");
// same module instance the registry hands the handler — the seam and direct log reads
const mem = await import("../src/adapters/state/memory-ws/index.js");
_setFlagReader(() => false);

const KEY = "test-write-key-12345678";
const GRACE_MS = 90_000;   // mirrors OP_AIR_INFLIGHT_GRACE_MS (api/onair.js)

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
const cmdLog = (room) => mem.readLog("cmd." + room);
const settle = () => new Promise((r) => setImmediate(r));
// age every matching cmd entry past the in-flight grace. readLog returns a shallow copy —
// entry OBJECTS are shared with the store, so mutating t here models time passing without
// clock games. Test-only reach-around, same spirit as planting q.<room> directly.
async function agePastGrace(room, pred) {
  for (const e of await cmdLog(room)) if (e && pred(e)) e.t -= GRACE_MS + 1000;
}

test("normal air appends an air-landed marker certifying the full sequence", async () => {
  const room = "res-marker";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(1)] });
  const r = await cmd(room, "air", 1);
  assert.equal(r.statusCode, 200);
  const log = await cmdLog(room);
  const marker = log.find((e) => e.action === "air-landed");
  assert.ok(marker, "air-landed marker present after a healthy air");
  assert.equal(marker.of, r.body.id, "marker references the air cmd entry");
  assert.equal(marker.airedId, r.body.airedId);
});

test("N2 forced overlap: both racers pass the prior scan → elect yields one publish, one log row, one marker", async () => {
  const room = "res-overlap";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(2)] });
  // gate BOTH racers at their air-entry append (payload.action === "air"), so both have
  // already passed the prior scan on an empty log — the true TOCTOU overlap, forced.
  const gated = [];
  mem._setHook((verb, rm, payload) => {
    if (verb === "appendLog" && rm === "cmd." + room && payload && payload.action === "air" && gated.length < 2)
      return new Promise((release) => gated.push(release));
  });
  const pA = cmd(room, "air", 2);
  const pB = cmd(room, "air", 2);
  while (gated.length < 2) await settle();
  mem._setHook(null);          // everything after the gated appends runs unimpeded
  gated[0]();                  // racer A appends first…
  const a = await pA;          // …and completes its whole sequence
  gated[1]();                  // racer B appends second — MUST see A on its read-back
  const b = await pB;
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.notEqual(a.body.dup, true, "first appender wins the elect");
  assert.equal(b.body.dup, true, "second appender is told it was the duplicate");
  assert.equal(b.body.airedId, a.body.airedId, "loser answers with the winner's airedId");
  assert.equal((await get({ room, log: "1" })).body.log.length, 1, "exactly one aired-log row");
  assert.equal((await get({ room })).body.id, a.body.airedId, "overlay carries the winner");
  assert.equal((await cmdLog(room)).filter((e) => e.action === "air-landed").length, 1, "exactly one landed marker");
});

test("N2 partial failure (publish dies): self-describing record; dup-ghost inside the grace; re-air heals past it", async () => {
  const room = "res-pubfail";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(3)] });
  mem._setHook((verb, rm) => { if (verb === "publish" && rm === room) throw new Error("injected: store died"); });
  const r1 = await cmd(room, "air", 3);
  mem._setHook(null);
  assert.equal(r1.statusCode, 502, "mid-sequence store failure surfaces as store error");
  // the record is self-describing: an air entry with NO landed marker and NO aired row
  const log1 = await cmdLog(room);
  const orphan = log1.find((e) => e.action === "air" && e.cardId === 3);
  assert.ok(orphan, "the cmd entry whose publish never landed is in the log");
  assert.equal(log1.some((e) => e.action === "air-landed"), false, "…and carries no landed marker");
  assert.equal((await get({ room })).body.card, null, "nothing reached the overlay");
  assert.equal((await get({ room, log: "1" })).body.log.length, 0, "nothing reached the aired log");
  // DOCUMENTED RESIDUAL (≤ grace): a retap while the orphan could still be an in-flight
  // racer answers dup with an airedId that never aired — pinned here on purpose.
  const r2 = await cmd(room, "air", 3);
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.body.dup, true, "inside the grace the orphan is presumed in flight");
  assert.equal(r2.body.airedId, orphan.airedId);
  assert.equal((await get({ room })).body.card, null, "the ghost dup still airs nothing");
  // past the grace the orphan is provably dead → the retap RE-AIRS (self-heal)
  await agePastGrace(room, (e) => e.action === "air");
  const r3 = await cmd(room, "air", 3);
  assert.equal(r3.statusCode, 200);
  assert.notEqual(r3.body.dup, true, "heal is a fresh air, not a dup");
  assert.notEqual(r3.body.airedId, orphan.airedId, "healed air mints a fresh airedId");
  assert.equal((await get({ room })).body.card.claim, "claim 3", "healed air reaches the overlay");
  const lg = await get({ room, log: "1" });
  assert.equal(lg.body.log.length, 1, "exactly one aired-log row after the heal");
  assert.equal(lg.body.log[0].id, r3.body.airedId);
  assert.equal((await cmdLog(room)).filter((e) => e.action === "air-landed").length, 1, "the heal, and only the heal, is certified");
});

test("N2 partial failure (aired-log append dies after publish): overlay had the card, receipts heal on re-air", async () => {
  const room = "res-logfail";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(4)] });
  mem._setHook((verb, rm) => { if (verb === "appendLog" && rm === room) throw new Error("injected: store died"); });
  const r1 = await cmd(room, "air", 4);
  mem._setHook(null);
  assert.equal(r1.statusCode, 502);
  assert.equal((await get({ room })).body.card.claim, "claim 4", "publish landed before the failure");
  assert.equal((await get({ room, log: "1" })).body.log.length, 0, "…but the aired log missed it");
  assert.equal((await cmdLog(room)).some((e) => e.action === "air-landed"), false, "no marker → sequence not certified");
  await agePastGrace(room, (e) => e.action === "air");
  const r2 = await cmd(room, "air", 4);
  assert.equal(r2.statusCode, 200);
  assert.notEqual(r2.body.dup, true);
  const lg = await get({ room, log: "1" });
  assert.equal(lg.body.log.length, 1, "receipts finally carry the air — exactly once");
  assert.equal((await get({ room })).body.id, r2.body.airedId, "overlay converges on the healed airedId");
});

test("N2 marker-append failure is benign: air still 200s; the aired-log fallback confirms the retap as dup", async () => {
  const room = "res-markerfail";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(5)] });
  mem._setHook((verb, rm, payload) => {
    if (verb === "appendLog" && rm === "cmd." + room && payload && payload.action === "air-landed") throw new Error("injected: store died");
  });
  const r1 = await cmd(room, "air", 5);
  mem._setHook(null);
  assert.equal(r1.statusCode, 200, "a fully-landed air must not 502 over a lost best-effort marker");
  assert.ok(r1.body.airedId);
  assert.equal((await cmdLog(room)).some((e) => e.action === "air-landed"), false, "marker really was lost");
  // even PAST the grace, the aired log is ground truth: the retap must dup, never re-air
  await agePastGrace(room, (e) => e.action === "air");
  const r2 = await cmd(room, "air", 5);
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.body.dup, true, "aired-log fallback confirms the prior without its marker");
  assert.equal(r2.body.airedId, r1.body.airedId);
  assert.equal((await get({ room, log: "1" })).body.log.length, 1, "no double row in receipts");
});

test("N4 forced interleave: hold reaches the log before the air's append → air 409s, nothing publishes", async () => {
  const room = "res-holdrace";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(6)] });
  // air passes its pre-scan (no hold yet) and parks at its own append; the hold then
  // lands in full; the released air appends AFTER the hold and must lose the election.
  // This exact interleaving aired a held card before packet 5a.
  let releaseAir = null;
  mem._setHook((verb, rm, payload) => {
    if (verb === "appendLog" && rm === "cmd." + room && payload && payload.action === "air" && !releaseAir)
      return new Promise((release) => { releaseAir = release; });
  });
  const pAir = cmd(room, "air", 6);
  while (!releaseAir) await settle();
  const h = await cmd(room, "hold", 6);   // hold runs to completion while the air is parked
  assert.equal(h.statusCode, 200);
  mem._setHook(null);
  releaseAir();
  const r = await pAir;
  assert.equal(r.statusCode, 409, "a hold serialized before the air's append wins");
  assert.equal(r.body.stale, true);
  assert.equal((await get({ room })).body.card, null, "the held card never reaches the overlay");
  assert.equal((await get({ room, log: "1" })).body.log.length, 0, "…or the aired log");
  assert.equal((await cmdLog(room)).some((e) => e.action === "air-landed"), false, "no certification for a refused air");
});

test("N4 boundary (documented residual): a control-LOCAL dismissal the server never saw is invisible — the air succeeds", async () => {
  // /control dismissed the card locally and its synchronous push failed silently
  // (app.js opPushQueue is best-effort): the snapshot still lists the card pending and
  // NO hold cmd exists server-side. The server cannot distinguish this from a legit
  // air — by design (docs/redteam/N2N4-RESIDUALS.md). This test pins the boundary so
  // any future server-side closure shows up as a deliberate assertion flip.
  const room = "res-localdismiss";
  await post({ room, writeKey: KEY, op: "queue", cards: [qcard(7)] });
  const r = await cmd(room, "air", 7);
  assert.equal(r.statusCode, 200, "server-side N4 guards cannot reach a dismissal that never reached the server");
  assert.equal((await get({ room })).body.card.claim, "claim 7");
});
