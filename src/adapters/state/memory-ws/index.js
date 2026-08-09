// StateChannel adapter: in-process memory (implements
// src/core/interfaces/state-channel.js). The self-host default — when the whole app runs
// in ONE long-lived Node process (src/server/), control and overlay hit the same maps, so
// no external store is needed. Registry id: "memory" (FOOTNOTE_STATE=memory; the local
// server selects it automatically when FOOTNOTE_STATE is unset).
//
// Semantics deliberately mirror the upstash adapter verb-for-verb so routes can't tell
// them apart:
//   - publish   : SET onair:<room> EX (ttlSec ?? 3600)  → stored with an expiry timestamp
//   - registerRoom: TOFU write key, 86400s rolling TTL, refreshed on every matching write
//   - appendLog : LPUSH + LTRIM 0..499 + EXPIRE 604800s (7 days, reset on every append)
//   - readLog   : newest first
// Expiry is emulated with per-entry timestamps checked (and purged) on read — no timers.
// Unlike upstash, subscribe() is real: in-process listeners fire on every publish. The
// current overlay still polls GET /api/onair — identical behavior either way.

export const name = "memory";
export function isConfigured() { return true; }

const rooms = new Map();   // room -> { event, expiresAt }
const keys = new Map();    // room -> { key,   expiresAt }
const logs = new Map();    // room -> { entries, expiresAt }  entries newest-first
const subs = new Map();    // room -> Set<handler>

const now = () => Date.now();

// Return the slot if still live, else purge it and return null (read-time expiry).
function fresh(map, room) {
  const slot = map.get(room);
  if (!slot) return null;
  if (slot.expiresAt <= now()) { map.delete(room); return null; }
  return slot;
}

// Opportunistic sweep so long-running processes don't accumulate dead rooms. Cheap:
// only runs when a map has grown past the threshold, which local use never hits.
function sweep(map) {
  if (map.size < 256) return;
  const t = now();
  for (const [k, v] of map) if (v.expiresAt <= t) map.delete(k);
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["publish"]} */
export async function publish(room, event, { ttlSec } = {}) {
  sweep(rooms);
  rooms.set(room, { event, expiresAt: now() + (ttlSec ?? 3600) * 1000 });
  for (const h of subs.get(room) || []) {
    try { h(event); } catch (e) { console.error("memory state subscriber error", e && e.message); }
  }
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["get"]} */
export async function get(room) {
  return fresh(rooms, room)?.event ?? null;
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["registerRoom"]} */
export async function registerRoom(room, writeKey, { ttlSec } = {}) {
  // TOFU: the first writer registers this room's write key; later writes must match.
  // Atomic by construction — single-threaded in-process check-and-set with no await
  // between check and set (mirrors upstash's SET NX EX single round trip).
  sweep(keys);
  const ttlMs = (ttlSec ?? 86400) * 1000;
  const slot = fresh(keys, room);
  if (!slot) { keys.set(room, { key: writeKey, expiresAt: now() + ttlMs }); return true; }
  if (slot.key !== writeKey) return false;
  slot.expiresAt = now() + ttlMs;   // rolling TTL, same as upstash EXPIRE on match
  return true;
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["appendLog"]} */
export async function appendLog(room, entry) {
  sweep(logs);
  const slot = fresh(logs, room) || { entries: [] };
  slot.entries.unshift(entry);
  if (slot.entries.length > 500) slot.entries.length = 500;   // LTRIM 0..499
  slot.expiresAt = now() + 604800 * 1000;                     // 7 days, reset per append
  logs.set(room, slot);
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["readLog"]} */
export async function readLog(room) {
  return (fresh(logs, room)?.entries ?? []).slice();
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["subscribe"]} */
export function subscribe(room, handler) {
  if (!subs.has(room)) subs.set(room, new Set());
  subs.get(room).add(handler);
  return () => { subs.get(room)?.delete(handler); };
}
