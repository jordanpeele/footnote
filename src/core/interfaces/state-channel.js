// StateChannel — the shared-state bridge between /control (producer) and /overlay (OBS
// Browser Source), which run in separate browser processes and can't share client state.
// Rooms isolate concurrent streams; a per-room write key (TOFU: first writer registers it)
// stops randos airing to someone's overlay; a per-room append-only log is the durability
// backstop for every AIRED check.
//
// This repo is no-build plain JS: interfaces are JSDoc @typedefs (see claim-extractor.js
// for the full convention notes).
//
// A StateChannel adapter is an ES module (see src/adapters/state/_stub/) exporting:
//   name, isConfigured, publish, get, registerRoom, appendLog, readLog, and (where the
//   transport allows) subscribe.
//
// NOTE on subscribe(): it is part of the contract but the serverless Upstash adapter does
// NOT implement it — Vercel functions are request-scoped, so the overlay polls get()
// instead. A long-lived process adapter (the planned memory-ws adapter, packet P1-A) will
// implement subscribe for real push. Poll-based adapters should export a subscribe that
// throws, so misuse fails loudly rather than silently never firing.

/**
 * On-air room state. `card` is the slimmed lower-third payload (or null = nothing on air);
 * `seq` is server-stamped so readers edge-trigger on change regardless of poll timing.
 * @typedef {Object} RoomEvent
 * @property {Object|null} card
 * @property {number} seq
 * @property {number} airedAt
 * @property {number|null} durationMs  number = auto-retire after that long; null = hold until pulled
 */

/**
 * @typedef {Object} StateChannel
 * @property {string} name
 *   Stable adapter id (matches its registry key).
 * @property {() => boolean} isConfigured
 *   True when the backing store's credentials are present in the environment.
 * @property {(room: string, event: RoomEvent, opts?: {ttlSec?: number}) => Promise<void>} publish
 *   Replace the room's current on-air state. `ttlSec` bounds how long stale state can
 *   outlive its writer (callers compute it from durationMs); adapters without expiry
 *   semantics may ignore it.
 * @property {(room: string) => Promise<RoomEvent|null>} get
 *   Current on-air state, or null if nothing was ever published / it expired.
 * @property {(room: string, writeKey: string, opts?: {ttlSec?: number}) => Promise<boolean>} registerRoom
 *   TOFU write auth: first caller registers `writeKey` for the room (with a rolling TTL,
 *   `ttlSec` when given, else an adapter default); later calls return true and refresh the
 *   TTL when the key matches, false when it doesn't. Callers treat false as forbidden.
 *   MUST be atomic for concurrent first-writers (red-team L6): two simultaneous callers
 *   with different keys must not both get true — use an atomic claim (e.g. SET NX EX), not
 *   read-then-write. Adapters without expiry semantics may ignore `ttlSec`.
 * @property {(room: string, entry: Object) => Promise<void>} appendLog
 *   Append one aired-check entry to the room's durable session log (adapter owns
 *   retention: cap + expiry).
 * @property {(room: string) => Promise<Object[]>} readLog
 *   The room's session log, newest first. Unparseable entries are dropped.
 * @property {(room: string, handler: (event: RoomEvent) => void) => () => void} [subscribe]
 *   Push-based change feed: invoke `handler` on every publish to `room`; returns an
 *   unsubscribe function. See the NOTE above — poll-based adapters throw here.
 */

export {};
