// Shared per-IP rate limiter (fixed window, Upstash REST). Underscore prefix keeps this
// out of Vercel's function routing. Fails OPEN on any store/limiter error — protection
// against runaway spend, not an availability dependency; self-hosters without Redis
// simply run unlimited. Imports the Upstash adapter directly (not via the registry):
// rate limiting is infrastructure tied to this store, not a StateChannel verb.
// (The global kill switch that used to live here as killed() moved to
// src/core/spendgate.js — D14: one gate module, checked by every spend path.)
import { isConfigured, pipeline } from "../src/adapters/state/upstash/index.js";

export async function rateLimit(req, res, name, limit, windowSec = 60) {
  if (!isConfigured()) return true;
  const ip = (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim())
    || (req.socket && req.socket.remoteAddress) || "unknown";
  const key = `rl:${name}:${ip}:${Math.floor(Date.now() / (windowSec * 1000))}`;
  try {
    const out = await pipeline([["INCR", key], ["EXPIRE", key, String(windowSec + 5)]]);
    const n = out?.[0]?.result;   // null (store non-2xx) falls through → fail open
    if (typeof n === "number" && n > limit) {
      res.setHeader("Retry-After", String(windowSec));
      res.status(429).json({ error: "rate limited", limit_per_min: limit });
      return false;
    }
  } catch {}
  return true;
}
