// Tests for packet 5c spend-dashboard groundwork: the spend meter (src/core/spendmeter.js),
// the price-table sanity contract, and the admin surface (GET /api/admin?op=spend).
//
// COVERAGE HONESTY: the store-backed daily rollup (HINCRBY into spend:<day>) is NOT unit
// tested here — it rides the same pipeline() primitive spendgate/admin/ratelimit use and
// is fire-and-forget by design; it's exercised against prod via ?op=spend. What IS pinned:
// in-process accumulation, estimate labeling, price-table coverage of every costed route,
// the field-test spend event, and the admin auth + shape.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HERMETIC-STORE GUARD: the Upstash adapter captures its env at module load, and tick()
// fire-and-forgets a rollup write whenever the store is configured. A developer shell
// with live KV_* / UPSTASH_* vars would make these unit tests write to PROD Redis. So:
// strip the store env FIRST, then dynamically import everything under test — this whole
// process runs in self-host (no-store) mode, which is also what makes `today: null`
// deterministic below. (node --test runs each file in its own process, so this leaks
// nowhere.)
for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
  delete process.env[k];
}
const { PRICE_TABLE, priceFor, tick, processTallies, spendSnapshot, _reset } = await import("../src/core/spendmeter.js");
const { ROUTE_CLASSES } = await import("../src/core/spendgate.js");

// ---------------------------------------------------------------------------
// meter accumulation
// ---------------------------------------------------------------------------

test("tick: accumulates calls and estimated USD per route:vendor key", () => {
  _reset();
  tick("extract", "anthropic-haiku");
  tick("extract", "anthropic-haiku");
  tick("verify", "perplexity");
  const t = processTallies();
  assert.equal(t.by["extract:anthropic-haiku"].calls, 2);
  assert.equal(t.by["extract:anthropic-haiku"].est_usd, 2 * PRICE_TABLE["extract:anthropic-haiku"]);
  assert.equal(t.by["verify:perplexity"].calls, 1);
  assert.equal(t.by["verify:perplexity"].est_usd, PRICE_TABLE["verify:perplexity"]);
  // total is the sum of the lines
  const sum = Object.values(t.by).reduce((n, r) => n + r.est_usd, 0);
  assert.equal(t.total_est_usd, Math.round(sum * 1e6) / 1e6);
  assert.ok(t.since, "snapshot carries a since timestamp");
  _reset();
});

test("tick: returns the estimate it attributed", () => {
  _reset();
  assert.equal(tick("verify", "perplexity"), PRICE_TABLE["verify:perplexity"]);
  assert.equal(tick("dg-token", "deepgram"), 0);   // priced at zero, still counted
  assert.equal(processTallies().by["dg-token:deepgram"].calls, 1);
  _reset();
});

test("tick: unpriced vendor (e.g. stub adapter) is counted at $0 and flagged", () => {
  _reset();
  tick("extract", "stub");
  const row = processTallies().by["extract:stub"];
  assert.equal(row.calls, 1);
  assert.equal(row.est_usd, 0);
  assert.equal(row.unpriced, true);
  _reset();
});

test("priceFor: known pair returns the table value, unknown pair returns null", () => {
  assert.equal(priceFor("verify", "perplexity"), PRICE_TABLE["verify:perplexity"]);
  assert.equal(priceFor("verify", "no-such-engine"), null);
});

// ---------------------------------------------------------------------------
// price-table sanity — every costed route has an entry; figures are sane
// ---------------------------------------------------------------------------

test("price table: every D14 costed route has at least one priced vendor entry", () => {
  const costed = Object.entries(ROUTE_CLASSES).filter(([, c]) => c === "costed").map(([r]) => r);
  assert.ok(costed.length >= 4, "sanity: the D14 registry still lists the costed routes");
  for (const route of costed) {
    const entries = Object.keys(PRICE_TABLE).filter((k) => k.startsWith(route + ":"));
    assert.ok(entries.length >= 1, `costed route "${route}" has no price-table entry`);
  }
});

test("price table: the DEFAULT adapter of each costed route is priced (not just some vendor)", () => {
  // Registry defaults (src/core/registry.js DEFAULTS) — the pairs that meter in a stock deploy.
  for (const key of ["extract:anthropic-haiku", "verify:perplexity", "transcribe:deepgram", "dg-token:deepgram"]) {
    assert.ok(key in PRICE_TABLE, `default pair "${key}" missing from PRICE_TABLE`);
  }
  // Concurrence fans out to both arms + the polarity signal — all three priced.
  for (const key of ["verify:brave-claude", "verify:polarity-signal"]) {
    assert.ok(key in PRICE_TABLE, `concurrence-path pair "${key}" missing from PRICE_TABLE`);
  }
});

test("price table: every figure is a finite non-negative number (estimates, not sentinels)", () => {
  for (const [k, v] of Object.entries(PRICE_TABLE)) {
    assert.ok(typeof v === "number" && Number.isFinite(v) && v >= 0, `${k} has bad price ${v}`);
  }
});

// ---------------------------------------------------------------------------
// field-test spend event (server-side ftAppend)
// ---------------------------------------------------------------------------

test("tick: appends a spend event to FOOTNOTE_FIELDTEST_LOG when set", () => {
  _reset();
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ft-spend-")), "ft.jsonl");
  const prev = process.env.FOOTNOTE_FIELDTEST_LOG;
  process.env.FOOTNOTE_FIELDTEST_LOG = log;
  try {
    tick("verify", "perplexity");
    const lines = fs.readFileSync(log, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const ev = JSON.parse(lines[0]);
    assert.equal(ev.ev, "spend");
    assert.equal(ev.route, "verify");
    assert.equal(ev.vendor, "perplexity");
    assert.equal(ev.est_usd, PRICE_TABLE["verify:perplexity"]);
    assert.equal(ev.process_total_est_usd, PRICE_TABLE["verify:perplexity"]);
    assert.ok(ev.srv_t, "stamped like ftSink");
  } finally {
    if (prev === undefined) delete process.env.FOOTNOTE_FIELDTEST_LOG; else process.env.FOOTNOTE_FIELDTEST_LOG = prev;
    _reset();
  }
});

test("tick: no FOOTNOTE_FIELDTEST_LOG → no file writes, no throw", () => {
  _reset();
  const prev = process.env.FOOTNOTE_FIELDTEST_LOG;
  delete process.env.FOOTNOTE_FIELDTEST_LOG;
  try { tick("extract", "anthropic-haiku"); } finally {
    if (prev !== undefined) process.env.FOOTNOTE_FIELDTEST_LOG = prev;
    _reset();
  }
});

// ---------------------------------------------------------------------------
// admin surface: GET /api/admin?op=spend — same token gate, estimate-labeled shape
// ---------------------------------------------------------------------------

function mockRes() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; },
  };
}

async function callAdmin(query) {
  const { default: admin } = await import("../api/admin.js");
  const res = mockRes();
  await admin({ method: "GET", query }, res);
  return res;
}

test("admin op=spend: bad token → 401, no tallies leak", async () => {
  const prev = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "right-token";
  try {
    const res = await callAdmin({ token: "wrong-token", op: "spend" });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "unauthorized" });
  } finally {
    if (prev === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = prev;
  }
});

test("admin op=spend: good token → 200 with est-labeled process tallies", async () => {
  const prev = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "right-token";
  _reset();
  tick("extract", "anthropic-haiku");
  try {
    const res = await callAdmin({ token: "right-token", op: "spend" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.est, true, "estimates MUST be labeled as estimates");
    assert.match(res.body.note, /estimate/i);
    assert.equal(res.body.process.by["extract:anthropic-haiku"].calls, 1);
    assert.equal(res.body.process.total_est_usd, PRICE_TABLE["extract:anthropic-haiku"]);
    // `today` is store-backed; this process runs storeless (hermetic guard above) → null.
    assert.ok("today" in res.body);
    assert.equal(res.body.today, null);
    assert.equal(res.headers["Cache-Control"], "no-store");
  } finally {
    if (prev === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = prev;
    _reset();
  }
});

test("admin: unknown op error names spend as a valid op", async () => {
  const prev = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "right-token";
  try {
    const res = await callAdmin({ token: "right-token", op: "bogus" });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /spend/);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = prev;
  }
});

// ---------------------------------------------------------------------------
// scope guard: this packet COUNTS, it does not enforce
// ---------------------------------------------------------------------------

test("spendmeter exports no gating surface (counting only — D14 enforcement stays in spendgate)", async () => {
  const meter = await import("../src/core/spendmeter.js");
  for (const name of Object.keys(meter)) {
    assert.ok(!/gate|kill|ceiling|enforce|block/i.test(name), `unexpected gating-shaped export "${name}"`);
  }
});

test("spendSnapshot: shape is stable for the admin surface", async () => {
  _reset();
  const snap = await spendSnapshot();
  assert.equal(snap.est, true);
  assert.ok(typeof snap.note === "string");
  assert.deepEqual(Object.keys(snap.process).sort(), ["by", "since", "total_est_usd"]);
  _reset();
});
