// SPRINT-02 C — slimCard sourcing passthrough contract, pinned end-to-end through the real
// handler (memory adapter, same pattern as op-cmd.test.js):
//   tier      — STRICT integer 0–3 or ABSENT. Strings are dropped, not coerced ("3" → absent):
//               sanitizers bound, they don't repair — the publisher owns sending a number,
//               and an absent tier degrades to the plain-source display everywhere.
//   citations — ≤5 http(s) URL strings (strip+cut budget, parse-checked after the cut);
//               non-arrays, non-strings, and non-http(s) schemes drop; empty → field ABSENT.
// Both must survive to (a) the live on-air GET and (b) the aired log — receipts reads them.
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

const card = (over) => ({ verdict: "False", claim: "c", correction: "x", source: { name: "Reuters", url: "https://reuters.com/a" }, ...over });
// unique room per test — memory maps are per-process
const air = async (room, c) => {
  const r = await post({ room, writeKey: KEY, card: c });
  assert.equal(r.statusCode, 200);
  return (await get({ room })).body.card;
};

test("tier: integer 0–3 passes through to the on-air card AND the aired log", async () => {
  const room = "slim-tier-ok";
  const got = await air(room, card({ tier: 3, citations: ["https://reuters.com/a"] }));
  assert.equal(got.tier, 3);
  const lg = await get({ room, log: "1" });
  assert.equal(lg.body.log[0].tier, 3);
  assert.deepEqual(lg.body.log[0].citations, ["https://reuters.com/a"]);
});

test("tier: out-of-bounds / non-integer / string all come out ABSENT (documented: no coercion)", async () => {
  for (const [i, bad] of [["3"], [7], [-1], [2.5], [null], [true]].entries()) {
    const got = await air("slim-tier-bad-" + i, card({ tier: bad[0] }));
    assert.equal("tier" in got, false, `tier ${JSON.stringify(bad[0])} must be absent`);
  }
  const got0 = await air("slim-tier-zero", card({ tier: 0 }));
  assert.equal(got0.tier, 0, "tier 0 is a legal bound, not falsy-dropped");
});

test("citations: 6 URLs → first 5 kept, order preserved (editorial ranking is upstream)", async () => {
  const urls = [1, 2, 3, 4, 5, 6].map((n) => `https://example${n}.gov/page`);
  const got = await air("slim-cite-cap", card({ citations: urls }));
  assert.deepEqual(got.citations, urls.slice(0, 5));
});

test("citations: non-http(s) schemes and non-strings drop; survivors keep their slots", async () => {
  const got = await air("slim-cite-filter", card({ citations: [
    "javascript:alert(1)", "ftp://example.gov/x", 42, null,
    "https://bea.gov/gdp", "not a url", "http://example.org/ok",
  ] }));
  assert.deepEqual(got.citations, ["https://bea.gov/gdp", "http://example.org/ok"]);
});

test("citations: empty-after-filter and non-array both leave the field ABSENT", async () => {
  const a = await air("slim-cite-empty", card({ citations: ["javascript:alert(1)"] }));
  assert.equal("citations" in a, false);
  const b = await air("slim-cite-notarray", card({ citations: "https://reuters.com/a" }));
  assert.equal("citations" in b, false);
  const c = await air("slim-cite-missing", card({}));
  assert.equal("citations" in c, false);
  assert.equal("tier" in c, false);
});
