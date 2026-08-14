// Unit tests for the sliding-window per-IP rate limiter (api/_ratelimit.js).
//
// The Upstash import is static, so the limiter exposes test seams instead of a module
// mock (same pattern as spendgate.test.js): _setPipeline(fn) swaps the store call,
// _setNow(fn) the clock. The fake store below implements just the five sorted-set
// commands the limiter pipelines, with Redis semantics for rank/score ranges.
//
// The headline test is the boundary burst: the old fixed-window INCR keyed on
// floor(now/window), so `limit` requests at t=59s and `limit` more at t=61s all passed
// (~2x budget through the seam). The sliding log must admit at most `limit` in ANY
// 60s span.
//
// COVERAGE HONESTY: these tests do not exercise the live Upstash /pipeline path — the
// fake interprets the same command arrays, but real-store behavior (non-2xx → null,
// TTL) is only covered by the fail-open assertions and prod probes.
import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit, _setPipeline, _setNow } from "../api/_ratelimit.js";
import { isConfigured } from "../src/adapters/state/upstash/index.js";

// ---- fakes ----------------------------------------------------------------

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

function mockReq(ip = "203.0.113.7") {
  return { headers: { "x-forwarded-for": ip }, socket: {} };
}

// In-memory sorted-set store speaking the limiter's pipeline dialect. Each key holds
// [{score, member}] kept sorted by score ascending (insertion order for ties — rank
// tie-break by member lex doesn't matter for counting).
function fakeStore() {
  const sets = new Map();
  const zset = (k) => { if (!sets.has(k)) sets.set(k, []); return sets.get(k); };
  return {
    sets,
    async pipeline(cmds) {
      return cmds.map(([cmd, key, ...args]) => {
        const z = zset(key);
        switch (cmd) {
          case "ZREMRANGEBYSCORE": {
            const [min, max] = [Number(args[0]), Number(args[1])];
            const before = z.length;
            sets.set(key, z.filter((e) => e.score < min || e.score > max));
            return { result: before - sets.get(key).length };
          }
          case "ZADD": {
            const [score, member] = [Number(args[0]), args[1]];
            const existing = z.find((e) => e.member === member);
            if (existing) { existing.score = score; z.sort((a, b) => a.score - b.score); return { result: 0 }; }
            z.push({ score, member });
            z.sort((a, b) => a.score - b.score);
            return { result: 1 };
          }
          case "ZREMRANGEBYRANK": {
            let [start, stop] = [Number(args[0]), Number(args[1])];
            const len = z.length;
            if (start < 0) start += len;
            if (stop < 0) stop += len;
            start = Math.max(start, 0);
            if (start > stop || stop < 0) return { result: 0 };
            const removed = z.splice(start, Math.min(stop, len - 1) - start + 1);
            return { result: removed.length };
          }
          case "ZCARD":
            return { result: z.length };
          case "EXPIRE":
            return { result: 1 };
          default:
            throw new Error("fakeStore: unexpected command " + cmd);
        }
      });
    },
  };
}

function withStore(fn) {
  return async () => {
    const store = fakeStore();
    let now = 0;
    _setPipeline((cmds) => store.pipeline(cmds));
    _setNow(() => now);
    try { await fn({ store, setNow: (t) => { now = t; } }); }
    finally { _setPipeline(null); _setNow(null); }
  };
}

// ---- tests ----------------------------------------------------------------

test("steady state under budget: `limit` requests spread across the window all pass", withStore(async ({ setNow }) => {
  for (let i = 0; i < 5; i++) {
    setNow(i * 10_000);   // t = 0s..40s, limit 5 / 60s
    const res = mockRes();
    assert.equal(await rateLimit(mockReq(), res, "verify", 5), true, `request ${i} should pass`);
    assert.equal(res.statusCode, 0, "allowed requests must not touch the response");
  }
}));

test("budget exhaustion → 429 with the unchanged response contract", withStore(async ({ setNow }) => {
  for (let i = 0; i < 5; i++) { setNow(i * 1000); await rateLimit(mockReq(), mockRes(), "verify", 5); }
  setNow(6000);
  const res = mockRes();
  assert.equal(await rateLimit(mockReq(), res, "verify", 5), false);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "rate limited", limit_per_min: 5 });
  assert.equal(res.headers["Retry-After"], "60");
}));

test("boundary burst (the old weakness): a seam-straddling burst is capped at `limit`, not 2x", withStore(async ({ setNow }) => {
  // Old fixed window: key = floor(t/60s), so t=59s and t=61s were DIFFERENT counters and
  // all 10 of these passed. The sliding window sees one 60s span containing all of them.
  let allowed = 0;
  setNow(59_000);
  for (let i = 0; i < 5; i++) if (await rateLimit(mockReq(), mockRes(), "verify", 5)) allowed++;
  setNow(61_000);
  for (let i = 0; i < 5; i++) if (await rateLimit(mockReq(), mockRes(), "verify", 5)) allowed++;
  assert.equal(allowed, 5, "no 60s span may admit more than the budget");
}));

test("recovery: entries age out — a full window after the burst, requests pass again", withStore(async ({ setNow }) => {
  setNow(0);
  for (let i = 0; i < 5; i++) await rateLimit(mockReq(), mockRes(), "verify", 5);
  setNow(59_000);
  assert.equal(await rateLimit(mockReq(), mockRes(), "verify", 5), false, "still inside the window");
  setNow(120_000);   // >60s after every prior entry (incl. the counted rejection at 59s)
  assert.equal(await rateLimit(mockReq(), mockRes(), "verify", 5), true, "window slid past the burst");
}));

test("memory cap: a flooding IP's set never grows past limit+1 members", withStore(async ({ store, setNow }) => {
  for (let i = 0; i < 50; i++) {
    setNow(i * 100);
    await rateLimit(mockReq(), mockRes(), "verify", 5);
  }
  const [key, z] = [...store.sets.entries()].find(([k]) => k.startsWith("rl:verify:"));
  assert.ok(z.length <= 6, `${key} holds ${z.length} members — ZREMRANGEBYRANK cap broken`);
}));

test("per-IP isolation: one IP exhausting its budget doesn't limit another", withStore(async ({ setNow }) => {
  setNow(1000);
  for (let i = 0; i < 6; i++) await rateLimit(mockReq("198.51.100.1"), mockRes(), "verify", 5);
  const res = mockRes();
  assert.equal(await rateLimit(mockReq("198.51.100.2"), res, "verify", 5), true);
  assert.equal(res.statusCode, 0);
}));

test("per-route isolation: budgets are keyed by route name", withStore(async ({ setNow }) => {
  setNow(1000);
  for (let i = 0; i < 6; i++) await rateLimit(mockReq(), mockRes(), "verify", 5);
  assert.equal(await rateLimit(mockReq(), mockRes(), "extract", 5), true);
}));

test("fail open: store answers non-2xx (pipeline → null) → request passes", async () => {
  _setPipeline(async () => null);
  try {
    const res = mockRes();
    assert.equal(await rateLimit(mockReq(), res, "verify", 5), true);
    assert.equal(res.statusCode, 0);
  } finally { _setPipeline(null); }
});

test("fail open: store call throws → request passes", async () => {
  _setPipeline(async () => { throw new Error("network down"); });
  try {
    const res = mockRes();
    assert.equal(await rateLimit(mockReq(), res, "verify", 5), true);
    assert.equal(res.statusCode, 0);
  } finally { _setPipeline(null); }
});

test("fail open: no Redis configured → ungated (documented self-hosting posture)", { skip: isConfigured() ? "Upstash env present in this shell — keyless path not reachable" : false }, async () => {
  // No test pipeline, no env creds: the limiter must return true without touching res.
  const res = mockRes();
  assert.equal(await rateLimit(mockReq(), res, "verify", 5), true);
  assert.equal(res.statusCode, 0);
});
