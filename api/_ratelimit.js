// Shared per-IP rate limiter (SLIDING window, Upstash REST). Underscore prefix keeps this
// out of Vercel's function routing. Fails OPEN on any store/limiter error — protection
// against runaway spend, not an availability dependency; self-hosters without Redis
// simply run unlimited (documented posture, docs/SELF_HOSTING.md "Spending safety").
// Imports the Upstash adapter directly (not via the registry): rate limiting is
// infrastructure tied to this store, not a StateChannel verb.
// (The global kill switch that used to live here as killed() moved to
// src/core/spendgate.js — D14: one gate module, checked by every spend path.)
//
// WHY a sorted-set sliding log, not the two-fixed-window weighted approximation:
// the old fixed-window INCR let ~2x the budget through at window boundaries (fill the
// end of window N, fill the start of window N+1). The weighted approximation fixes the
// *average* case but is still adversarially gameable to ~2x (burst the last instant of
// the previous window, then pace the current one — the decaying weight admits up to a
// full extra budget across the seam). The sorted-set log is exact: no window of
// `windowSec` ever admits more than `limit`. Its usual costs don't apply here:
//   - round trips: Upstash's /pipeline endpoint batches all five commands into ONE
//     HTTP call, same as the old [INCR, EXPIRE] pair — no latency regression;
//   - memory: ZREMRANGEBYRANK caps each key at limit+1 members, so a flooding IP
//     can't grow the set beyond the budget it's already denied.
// Rejected requests still count toward the window (the old INCR counted them too), so
// an IP hammering past its budget stays limited until it backs off for a full window.
import { isConfigured, pipeline as upstashPipeline } from "../src/adapters/state/upstash/index.js";

// Test seams (same pattern as src/core/spendgate.js): the Upstash import is static, so
// tests swap the store call / clock instead of module-mocking. Production never sets these.
let testPipeline = null;
let nowFn = Date.now;
export function _setPipeline(fn) { testPipeline = fn; }
export function _setNow(fn) { nowFn = fn || Date.now; }

export async function rateLimit(req, res, name, limit, windowSec = 60) {
  const send = testPipeline || (isConfigured() ? upstashPipeline : null);
  if (!send) return true;   // keyless local setup runs ungated on purpose
  const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim())
    || (req.socket && req.socket.remoteAddress) || "unknown";
  const key = `rl:${name}:${ip}`;
  const now = nowFn();
  const windowMs = windowSec * 1000;
  // Member must be unique per request — same-ms requests would otherwise collapse into
  // one ZADD score update and undercount.
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
  try {
    const out = await send([
      ["ZREMRANGEBYSCORE", key, "0", String(now - windowMs)],  // drop entries older than the window
      ["ZADD", key, String(now), member],                      // record this request
      ["ZREMRANGEBYRANK", key, "0", String(-(limit + 2))],     // cap memory: keep newest limit+1
      ["ZCARD", key],                                          // count = requests in window
      ["EXPIRE", key, String(windowSec + 5)],                  // idle keys self-clean
    ]);
    const n = out?.[3]?.result;   // null pipeline (store non-2xx) falls through → fail open
    if (typeof n === "number" && n > limit) {
      res.setHeader("Retry-After", String(windowSec));
      res.status(429).json({ error: "rate limited", limit_per_min: limit });
      return false;
    }
  } catch {}
  return true;
}
