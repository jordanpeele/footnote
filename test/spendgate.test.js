// Unit + acceptance tests for the D14 spend gate (src/core/spendgate.js).
//
// The Upstash adapter import is static, so the gate exposes a test seam instead of a
// module mock: _setFlagReader(fn) swaps the flag read, and gateDecision(flag) is the
// pure policy. COVERAGE HONESTY: what these tests do NOT cover is the live path —
// defaultFlagReader hitting Upstash REST for kill:global. That's the same pipeline()
// primitive the rate limiter and api/admin.js use, and it's exercised against prod via
// GET /api/admin?op=status; there is no local-Redis unit test here.
import test from "node:test";
import assert from "node:assert/strict";
import { spendGate, gateDecision, _setFlagReader, ROUTE_CLASSES } from "../src/core/spendgate.js";

const PAUSED_BODY = { error: "paused by operator", paused: true };

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

test("gateDecision: pure policy — flag on blocks with the 503 contract, flag off allows", () => {
  assert.deepEqual(gateDecision(true), { allow: false, status: 503, body: PAUSED_BODY });
  assert.deepEqual(gateDecision(false), { allow: true });
});

test("spendGate: flag ON → 503 paused body, returns false", async () => {
  _setFlagReader(() => true);
  try {
    const res = mockRes();
    assert.equal(await spendGate({}, res), false);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, PAUSED_BODY);
  } finally { _setFlagReader(null); }
});

test("spendGate: flag OFF → returns true, res untouched", async () => {
  _setFlagReader(() => false);
  try {
    const res = mockRes();
    assert.equal(await spendGate({}, res), true);
    assert.equal(res.statusCode, 0);
    assert.equal(res.body, null);
  } finally { _setFlagReader(null); }
});

test("spendGate: flag reader throws → fail OPEN (returns true, no response)", async () => {
  _setFlagReader(() => { throw new Error("store down"); });
  try {
    const res = mockRes();
    assert.equal(await spendGate({}, res), true);
    assert.equal(res.statusCode, 0);
  } finally { _setFlagReader(null); }
});

test("spendGate: no cross-request cache — restore takes effect on the next call", async () => {
  let flag = true;
  _setFlagReader(() => flag);
  try {
    assert.equal(await spendGate({}, mockRes()), false);   // killed
    flag = false;                                          // operator restores
    assert.equal(await spendGate({}, mockRes()), true);    // very next request proceeds
  } finally { _setFlagReader(null); }
});

test("spendGate: unconfigured store → default reader fails open", async (t) => {
  // Only meaningful when this machine has no store env; skip rather than hit a live store.
  if (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) {
    t.skip("store env present — default-reader fail-open not testable offline here");
    return;
  }
  _setFlagReader(null);   // restore the real reader
  const res = mockRes();
  assert.equal(await spendGate({}, res), true);
  assert.equal(res.statusCode, 0);
});

// ---------------------------------------------------------------------------
// Acceptance simulation (D14): with the kill flag ON, the costed routes this packet
// wired return 503 with ZERO adapter calls. Proof of zero adapter touch: the adapter
// env var is set to a tripwire value, so any getAdapter() call would throw and surface
// as a 502/500 — a clean 503 paused body means the gate fired before the adapter layer.
// ---------------------------------------------------------------------------

test("acceptance: extract under kill → 503, zero adapter calls", async () => {
  const prev = process.env.FOOTNOTE_EXTRACTOR;
  process.env.FOOTNOTE_EXTRACTOR = "tripwire-no-such-adapter";
  _setFlagReader(() => true);
  try {
    const { default: extract } = await import("../api/extract.js");
    const res = mockRes();
    await extract({ method: "POST", headers: {}, body: { text: "the moon is made of basalt and cheese" } }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, PAUSED_BODY);
  } finally {
    _setFlagReader(null);
    if (prev === undefined) delete process.env.FOOTNOTE_EXTRACTOR; else process.env.FOOTNOTE_EXTRACTOR = prev;
  }
});

test("acceptance: transcribe under kill → 503, zero adapter calls", async () => {
  const prev = process.env.FOOTNOTE_STT;
  process.env.FOOTNOTE_STT = "tripwire-no-such-adapter";
  _setFlagReader(() => true);
  try {
    const { default: transcribe } = await import("../api/transcribe.js");
    const res = mockRes();
    await transcribe({ method: "POST", headers: {} }, res);   // gate fires before origin/body reads
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, PAUSED_BODY);
  } finally {
    _setFlagReader(null);
    if (prev === undefined) delete process.env.FOOTNOTE_STT; else process.env.FOOTNOTE_STT = prev;
  }
});

test("ROUTE_CLASSES: the D14 pinned classes hold", () => {
  assert.equal(ROUTE_CLASSES.extract, "costed");
  assert.equal(ROUTE_CLASSES.verify, "costed");
  assert.equal(ROUTE_CLASSES.transcribe, "costed");
  assert.equal(ROUTE_CLASSES["dg-token"], "costed");
  assert.equal(ROUTE_CLASSES.onair, "gated");
  assert.equal(ROUTE_CLASSES.admin, "free");
});
