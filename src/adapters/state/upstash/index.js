// StateChannel adapter: Upstash Redis over REST (implements
// src/core/interfaces/state-channel.js). Serverless-friendly: every verb is a stateless
// HTTPS call, so it works from Vercel functions. subscribe() is NOT supported here —
// request-scoped functions can't hold a connection; the overlay polls get() instead
// (the planned memory-ws adapter, packet P1-A, will do real push).
//
// Also exports the raw pipeline() primitive used by api/_ratelimit.js — rate limiting is
// infrastructure tied to this store, not a StateChannel verb.

const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const name = "upstash";
export function isConfigured() { return Boolean(R_URL && R_TOKEN); }

async function redis(cmd) {
  const r = await fetch(R_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}

// Batched commands in one round trip. Returns the parsed result array, or null when the
// store answered non-2xx (callers like the rate limiter fail OPEN on null). Network
// errors throw — the caller decides whether that's fatal.
export async function pipeline(cmds) {
  const r = await fetch(R_URL + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) return null;
  return await r.json();
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["publish"]} */
export async function publish(room, event, { ttlSec } = {}) {
  await redis(["SET", `onair:${room}`, JSON.stringify(event), "EX", String(ttlSec ?? 3600)]);
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["get"]} */
export async function get(room) {
  const v = await redis(["GET", `onair:${room}`]);
  return v ? JSON.parse(v) : null;
}

// Atomic shallow-merge, server-side: GET→merge→SET runs as ONE Lua script inside Redis's
// single command thread, so a concurrent publish() can never land between the read and the
// write (P4-F2 activeAt stamp vs air clobber — round-3 known residual). Notes:
//   - lua-cjson decodes JSON null to the cjson.null sentinel (NOT nil), so `card: null`
//     survives the decode→encode round trip intact.
//   - TTL becomes max(current TTL, ttlSec) — a merge may lengthen the record's life,
//     never shorten it (TTL returns -2/-1 for missing/persistent keys; both < ttlSec).
//   - Missing/expired record merges into the empty RoomEvent (ARGV[3]).
const MERGE_LUA = `local v = redis.call('GET', KEYS[1])
local t = v and cjson.decode(v) or cjson.decode(ARGV[3])
for k, val in pairs(cjson.decode(ARGV[1])) do t[k] = val end
local ttl = tonumber(ARGV[2])
local left = redis.call('TTL', KEYS[1])
if left > ttl then ttl = left end
redis.call('SET', KEYS[1], cjson.encode(t), 'EX', ttl)
return 1`;

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["merge"]} */
export async function merge(room, fields, { ttlSec } = {}) {
  // EVAL rides the same single-command REST endpoint as every other verb (redis() throws
  // on non-2xx, same failure surface as publish). Not EVALSHA: one round trip either way
  // over REST, and shipping the script inline avoids a NOSCRIPT retry dance.
  await redis(["EVAL", MERGE_LUA, "1", `onair:${room}`, JSON.stringify(fields), String(ttlSec ?? 3600), JSON.stringify({ card: null, seq: 0 })]);
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["registerRoom"]} */
export async function registerRoom(room, writeKey, { ttlSec } = {}) {
  // TOFU, atomically (red-team L6): SET NX EX claims first-writer status in ONE pipeline
  // round trip — the old GET-then-SET let two "first writers" race and both win. On
  // NX-miss the room is already registered: GET-compare ownership, refresh the TTL on
  // match. (Semantics moved here from api/onair.js, which briefly open-coded them.)
  const wkKey = `wk:${room}`;
  const ttl = String(ttlSec ?? 86400);
  const out = await pipeline([["SET", wkKey, writeKey, "NX", "EX", ttl]]);
  if (out === null) {
    // /pipeline answered non-2xx — fall back to single commands (racy) rather than lock
    // writers out; redis() throws on non-2xx, so a fully-dead store still surfaces.
    const existing = await redis(["GET", wkKey]);
    if (existing == null) { await redis(["SET", wkKey, writeKey, "EX", ttl]); return true; }
    if (existing !== writeKey) return false;
    await redis(["EXPIRE", wkKey, ttl]);
    return true;
  }
  if (out?.[0]?.result === "OK") return true;   // we ARE the first writer
  // key already registered — verify ownership, refresh the rolling TTL on match
  const cur = await pipeline([["GET", wkKey]]);
  if (!cur || cur[0]?.result !== writeKey) return false;
  try { await pipeline([["EXPIRE", wkKey, ttl]]); } catch {}
  return true;
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["appendLog"]} */
export async function appendLog(room, entry) {
  await redis(["LPUSH", `log:${room}`, JSON.stringify(entry)]);
  await redis(["LTRIM", `log:${room}`, "0", "499"]);
  await redis(["EXPIRE", `log:${room}`, "604800"]);   // 7 days
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["readLog"]} */
export async function readLog(room) {
  const items = await redis(["LRANGE", `log:${room}`, "0", "-1"]);
  return (items || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["subscribe"]} */
export function subscribe() {
  throw new Error("upstash adapter is poll-based — subscribe() is not supported; poll get() instead");
}
