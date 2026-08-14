export type RoomEvent = {
    card: Object | null;
    seq: number;
    airedAt: number;
    /**
     * number = auto-retire after that long; null = hold until pulled
     */
    durationMs: number | null;
};
export type StateChannel = {
    /**
     *   Stable adapter id (matches its registry key).
     */
    name: string;
    /**
     *   True when the backing store's credentials are present in the environment.
     */
    isConfigured: () => boolean;
    /**
     *   Replace the room's current on-air state. `ttlSec` bounds how long stale state can
     *   outlive its writer (callers compute it from durationMs); adapters without expiry
     *   semantics may ignore it.
     */
    publish: (room: string, event: RoomEvent, opts?: {
        ttlSec?: number;
    }) => Promise<void>;
    /**
     *   Current on-air state, or null if nothing was ever published / it expired.
     */
    get: (room: string) => Promise<RoomEvent | null>;
    /**
     * OPTIONAL. Atomically shallow-merge `fields` into the room's current event — the
     * adapter must guarantee no concurrent publish() can be lost between its read and its
     * write (in-process single-threaded for memory; server-side Lua EVAL for upstash).
     * When no record exists, merge into the empty RoomEvent `{card:null, seq:0}`. The
     * resulting TTL is max(remaining life, ttlSec): a merge may LENGTHEN a record's life,
     * never shorten it. Added for P4-F2's activeAt wake stamp, whose original
     * get→assign→publish sequence could clobber an air landing inside the store RTT
     * (round-3 re-probe, known residual). Callers must feature-test (`typeof state.merge
     * === "function"`) and fall back to read-merge-publish on adapters without it.
     */
    merge?: (room: string, fields: Object, opts?: {
        ttlSec?: number;
    }) => Promise<void>;
    /**
     *   TOFU write auth: first caller registers `writeKey` for the room (with a rolling TTL,
     *   `ttlSec` when given, else an adapter default); later calls return true and refresh the
     *   TTL when the key matches, false when it doesn't. Callers treat false as forbidden.
     *   MUST be atomic for concurrent first-writers (red-team L6): two simultaneous callers
     *   with different keys must not both get true — use an atomic claim (e.g. SET NX EX), not
     *   read-then-write. Adapters without expiry semantics may ignore `ttlSec`.
     */
    registerRoom: (room: string, writeKey: string, opts?: {
        ttlSec?: number;
    }) => Promise<boolean>;
    /**
     *   Append one aired-check entry to the room's durable session log (adapter owns
     *   retention: cap + expiry).
     */
    appendLog: (room: string, entry: Object) => Promise<void>;
    /**
     *   The room's session log, newest first. Unparseable entries are dropped.
     */
    readLog: (room: string) => Promise<Object[]>;
    /**
     * Push-based change feed: invoke `handler` on every publish to `room`; returns an
     * unsubscribe function. See the NOTE above — poll-based adapters throw here.
     */
    subscribe?: (room: string, handler: (event: RoomEvent) => void) => () => void;
};
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
 * @property {(room: string, fields: Object, opts?: {ttlSec?: number}) => Promise<void>} [merge]
 *   OPTIONAL. Atomically shallow-merge `fields` into the room's current event — the
 *   adapter must guarantee no concurrent publish() can be lost between its read and its
 *   write (in-process single-threaded for memory; server-side Lua EVAL for upstash).
 *   When no record exists, merge into the empty RoomEvent `{card:null, seq:0}`. The
 *   resulting TTL is max(remaining life, ttlSec): a merge may LENGTHEN a record's life,
 *   never shorten it. Added for P4-F2's activeAt wake stamp, whose original
 *   get→assign→publish sequence could clobber an air landing inside the store RTT
 *   (round-3 re-probe, known residual). Callers must feature-test (`typeof state.merge
 *   === "function"`) and fall back to read-merge-publish on adapters without it.
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
