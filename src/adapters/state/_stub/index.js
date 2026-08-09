// StateChannel stub — the minimal shape a contributor implements (see
// src/core/interfaces/state-channel.js). Pure in-memory Maps: fine for a single
// long-lived process (and it CAN implement subscribe, unlike the poll-based Upstash
// adapter), useless across serverless instances — control and overlay would hit
// different sandboxes. FOOTNOTE_STATE=stub is for local single-process experiments only.
export const name = "stub";
export function isConfigured() { return true; }

const rooms = new Map();      // room -> RoomEvent
const keys = new Map();       // room -> writeKey (TOFU; no expiry in the stub)
const logs = new Map();       // room -> entries, newest first
const subs = new Map();       // room -> Set<handler>

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["publish"]} */
export async function publish(room, event, _opts = {}) {   // stub ignores ttlSec (no expiry)
  rooms.set(room, event);
  for (const h of subs.get(room) || []) h(event);
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["get"]} */
export async function get(room) { return rooms.get(room) || null; }

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["registerRoom"]} */
export async function registerRoom(room, writeKey, _opts = {}) {   // stub ignores ttlSec (no expiry)
  if (!keys.has(room)) { keys.set(room, writeKey); return true; }
  return keys.get(room) === writeKey;
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["appendLog"]} */
export async function appendLog(room, entry) {
  const l = logs.get(room) || [];
  l.unshift(entry);
  logs.set(room, l.slice(0, 500));
}

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["readLog"]} */
export async function readLog(room) { return logs.get(room) || []; }

/** @type {import("../../../core/interfaces/state-channel.js").StateChannel["subscribe"]} */
export function subscribe(room, handler) {
  if (!subs.has(room)) subs.set(room, new Set());
  subs.get(room).add(handler);
  return () => subs.get(room)?.delete(handler);
}
