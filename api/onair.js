// Footnote OBS state channel. Bridges /control (producer) → /overlay (OBS Browser Source),
// which run in separate browser processes and can't share client state.
//   POST /api/onair  { room, writeKey, card|null }            -> publish what's on air  (write, gated)
//   POST /api/onair  { room, writeKey, op:"keys", keys:{…} }  -> store room BYOK keys   (write, gated)
//   POST /api/onair  { room, writeKey, op:"queue", cards }    -> operator-queue snapshot (write, gated; P3-J)
//   POST /api/onair  { room, writeKey, op:"cmd", cmd:{…} }    -> operator command        (write, gated; P3-J)
//   GET  /api/onair?room=<room>                                -> { card, seq, activeAt?, renderedId?, renderedAt? } (read, open)
//   GET  /api/onair?room=<room>&byok=1                         -> { perplexity, anthropic, deepgram } booleans ONLY
//   GET  /api/onair?room=<room>&log=1                           -> { log } aired record — public, CORS * (R9)
//   POST /api/onair  { room, writeKey, op:"queue-read" }        -> { cards, qseq } UNAIRED queue — writeKey-gated, no CORS (P3-J/N1)
//   POST /api/onair  { room, writeKey, op:"cmds-read", after }  -> { cmds } operator commands since `after` — writeKey-gated (P3-J/N1)
//   POST /api/onair  { room, op:"rendered", id }                 -> overlay render-ack — UNAUTHENTICATED, id-gated (P7-B/R39)
// Backed by the active StateChannel adapter (default: Upstash Redis REST). Rooms isolate
// streams; a per-room write key (TOFU) stops randos airing to someone's overlay. seq is
// server-stamped so the overlay edge-triggers on change regardless of poll timing.
// Thin route: validate → rate limit → StateChannel verbs → shape response.
import { rateLimit } from "./_ratelimit.js";
import { spendGate } from "../src/core/spendgate.js";
import { getAdapter } from "../src/core/registry.js";
import { ROOM_TTL_HOURS } from "../src/core/tunables.js";
import { isConfigured as storeConfigured, pipeline } from "../src/adapters/state/upstash/index.js";
export const config = { api: { bodyParser: true } };

const okRoom = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(s);
const ROOM_TTL_SEC = ROOM_TTL_HOURS * 3600;
// live speech is adversarial input: strip control chars + zero-width/bidi chars so nothing
// hostile or invisible crosses the state channel to the overlay (which renders textContent,
// but downstream consumers of the log shouldn't have to trust us less).
const strip = (s) => String(s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "");
// budget-slice that can't emit a broken glyph: .slice() can cut a surrogate pair in half,
// leaving a lone high surrogate (renders as � on the chyron) — strip it (red-team L4).
const cut = (s, n) => { const t = s.slice(0, n); return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t; };
// stable id for every aired event (R9): server seq (ms) + short random suffix so two airs
// in the same millisecond can't collide. Corrections reference originals by this id.
const mintId = (seq) => `${seq}-${(Math.random().toString(36).slice(2) + "0000").slice(0, 4)}`;
// keep the payload small + clean — only what the lower-third renders
function slimCard(c) {
  if (!c || typeof c !== "object") return null;
  const src = c.source && typeof c.source === "object" ? { name: cut(strip(c.source.name || ""), 80), url: c.source.url || null } : null;
  const slim = {
    verdict: cut(strip(c.verdict || "Unverifiable"), 24),
    claim: cut(strip(c.claim || ""), 300),
    correction: cut(strip(c.correction || ""), 300),
    source: src,
  };
  /* P7-A/D17: `claim` is the display framing (as-spoken, negation preserved); `canonical`
     is the pipeline-internal positive form — verification substrate, NEVER rendered on any
     surface (not overlay, /op, or receipts). It rides the slim card so the aired LOG keeps
     the substrate for accountability review; same strip/cut budget as claim. */
  if (typeof c.canonical === "string" && c.canonical) slim.canonical = cut(strip(c.canonical), 300);
  if (typeof c.kind === "string") slim.kind = cut(strip(c.kind), 24);   // passthrough (e.g. "correction" cards — overlay renders)
  if (c.test === true) slim.test = true;   // field-test watermark flag (local TESTAIR) — boolean only, overlay renders "TEST"
  if (typeof c.refId === "string" && c.refId) slim.refId = cut(strip(c.refId), 32);         // correction → original join key (R9)
  if (typeof c.refClaim === "string" && c.refClaim) slim.refClaim = cut(strip(c.refClaim), 300);   // legacy fallback join — keep one release
  /* SPRINT-02 C: sourcing passthrough → the aired log, so receipts can render tier + all
     qualifying citations per aired check.
     tier — STRICT integer 0–3 or absent: sanitizers bound, they don't repair, so a "3"
     string (or 2.5, or 7) is dropped, not coerced — the publisher (app.js) owns sending a
     real number, and an absent tier degrades to the plain-source display everywhere.
     citations — ≤5 http(s) URL strings, each through the same strip+cut budget as every
     other card field (parse-checked AFTER the cut so a truncated-into-garbage URL drops
     out rather than shipping broken); anything else → field absent entirely. */
  if (Number.isInteger(c.tier) && c.tier >= 0 && c.tier <= 3) slim.tier = c.tier;
  if (Array.isArray(c.citations)) {
    const cites = [];
    for (const u of c.citations) {
      if (cites.length >= 5) break;
      if (typeof u !== "string") continue;
      const s = cut(strip(u), 300);
      try { const p = new URL(s); if (p.protocol === "http:" || p.protocol === "https:") cites.push(s); } catch {}
    }
    if (cites.length) slim.citations = cites;
  }
  return slim;
}

/* ---- P3-J street-operator bridge (second-phone /op page) --------------------------------
   /control publishes a slim snapshot of its ACTIONABLE (checking/pending) cards; the /op
   page reads it and sends air/skip/hold/pull commands back; /control polls the command
   list to sync its local state. Storage rides the existing StateChannel adapter (works on
   upstash AND the self-host memory adapter) under dot-prefixed internal room names —
   "." is outside okRoom's charset, so `q.<room>` / `cmd.<room>` can never be claimed,
   written, or read through the public room surface. Both directions are writeKey-gated
   via the same TOFU registerRoom as the write path: the queue holds UNAIRED claims, which
   are NOT public (unlike the aired log). */
const qRoom = (room) => "q." + room;      // queue snapshot   (publish/get, EX QUEUE_SNAPSHOT_TTL_SEC)
const cmdRoom = (room) => "cmd." + room;  // command list      (appendLog/readLog; adapter retention)
// TUNABLE — lifetime of the q.<room> snapshot: a dead /control stops offering stale AIR
// targets within this window (the /op page empties when the snapshot expires).
const QUEUE_SNAPSHOT_TTL_SEC = 180;
/* TUNABLE — N4 (round-3 re-probe): max age of the snapshot an operator air may be served
   from. Deliberately EQUAL to the snapshot TTL, not the ~10s a "control pushes constantly"
   model would suggest: /control pushes snapshots ONLY on queue mutations (the
   schedulePersist choke points + stream start/end) — there is NO periodic re-push — so a
   live-but-quiet control legitimately leaves qseq minutes old while the operator
   deliberates over a pending card. Any ceiling tighter than the (unbounded) push cadence
   would 409 legitimate airs, and /op renders a 409 as "already handled" (operator.js act())
   — a false rejection looks like a ghost AIR on the phone. What this bound buys instead:
   the air path stops depending on the adapter honoring ttlSec (the StateChannel contract
   lets adapters IGNORE it — the _stub does), so on an expiry-less store a snapshot can
   still never back an air past its intended lifetime. The parts of N4 this can't reach are
   handled/bounded elsewhere: /op-originated HOLD/SKIPs are server-logged and scanned
   against qseq in the air branch below; control-LOCAL dismissals reach the server only via
   the next snapshot push, so a hold inside the ~400ms debounce (+RTT), or one whose
   best-effort re-push silently failed, remains airable for up to this window — that
   residual is closable only control-side (synchronous push on dismiss). */
const OP_AIR_MAX_SNAPSHOT_AGE_MS = QUEUE_SNAPSHOT_TTL_SEC * 1000;
// sanitize one queue card with the same strip/cut budget as the on-air path; extra
// operator-facing fields (confidence, harm_class, …) get their own tight budgets.
function slimQCard(c) {
  if (!c || typeof c !== "object") return null;
  const id = Number(c.id);
  if (!Number.isFinite(id)) return null;
  const base = slimCard(c) || {};
  const q = {
    id,
    state: c.state === "checking" ? "checking" : "pending",
    verdict: c.verdict == null ? null : base.verdict,   // checking cards have no verdict yet
    claim: base.claim || "",
    correction: base.correction || null,
    confidence: typeof c.confidence === "number" ? Math.max(0, Math.min(1, c.confidence)) : null,
    source: base.source,
    harm_class: typeof c.harm_class === "string" && c.harm_class ? cut(strip(c.harm_class), 24) : null,
    autoAirEligible: c.autoAirEligible === true,
    polarity_conflict: !!c.polarity_conflict,
    spokenAt: typeof c.spokenAt === "number" ? c.spokenAt : null,
  };
  // sourcing passthrough (SPRINT-02 C): keep tier/citations on the queue snapshot so an
  // operator air — which re-slims the queue card — lands them in the aired log too.
  if (base.tier !== undefined) q.tier = base.tier;
  if (base.citations !== undefined) q.citations = base.citations;
  // P7-A: canonical rides the queue snapshot for the same reason — an operator air must
  // land the verification substrate in the aired log too. /op never renders it (D17).
  if (base.canonical !== undefined) q.canonical = base.canonical;
  return q;
}

export default async function handler(req, res) {
  let state;   // bad FOOTNOTE_STATE env must 500 cleanly, not kill the invocation (red-team M1)
  try { state = getAdapter("state"); } catch (e) { console.error("state adapter:", e && e.message); res.status(500).json({ error: "store not configured" }); return; }
  if (!state.isConfigured()) { res.status(500).json({ error: "store not configured" }); return; }
  res.setHeader("Cache-Control", "no-store");
  // minimal preflight for the public log read (receipts embedding) — GET only, no credentials
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }
  try {
    if (req.method === "GET") {
      if (!(await rateLimit(req, res, "onair-r", 600))) return;   // overlay polls ~150/min at FAST
      const room = req.query.room;
      if (!okRoom(room)) { res.status(400).json({ error: "bad room" }); return; }
      if (req.query.byok) {   // BYOK status: booleans ONLY — key material never leaves the store
        let keys = null;
        if (storeConfigured()) {
          try { const out = await pipeline([["GET", `rk:${room}`]]); if (out?.[0]?.result) keys = JSON.parse(out[0].result); } catch {}
        }
        res.status(200).json({ perplexity: Boolean(keys && keys.perplexity), anthropic: Boolean(keys && keys.anthropic), deepgram: Boolean(keys && keys.deepgram) });
        return;
      }
      if (req.query.queue || req.query.cmds) {
        /* N1 (round-3 red team): these reads carried the writeKey in the query string, which
           lands in serverless access logs and browser history. They moved to POST body ops
           ("queue-read" / "cmds-read") — same auth, same shapes. GONE, not deprecated: both
           clients ship in the same deploy, and a capability URL that keeps working in logs
           is the vulnerability. */
        res.status(410).json({ error: "moved to POST op" });
        return;
      }
      if (req.query.log) {   // durable aired-check log (accountability backstop), newest first
        // R9: the log is read-only public data (it's the receipts page) — allow cross-origin
        // embedding. ONLY this branch gets CORS; live state + BYOK stay same-origin.
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(200).json({ log: await state.readLog(room) });
        return;
      }
      // serverNow lets the overlay resume an in-flight check on connect (survives OBS restart/refresh)
      const base = (await state.get(room)) || { card: null, seq: 0 };
      res.status(200).json(Object.assign(base, { serverNow: Date.now() }));
      return;
    }
    if (req.method === "POST") {
      const { room, writeKey, card, durationMs, op } = req.body || {};
      /* N1: writeKey-gated READS ride POST bodies now (never query strings — capability
         keys must not reach access logs). Read ops take the read rate class and skip the
         spend gate: the kill switch stops spend/broadcast, not the operator's sight. */
      if (op === "queue-read" || op === "cmds-read") {
        if (!(await rateLimit(req, res, "onair-r", 600))) return;
        if (!okRoom(room) || typeof writeKey !== "string" || writeKey.length < 8) { res.status(403).json({ error: "forbidden" }); return; }
        if (!(await state.registerRoom(room, writeKey, { ttlSec: ROOM_TTL_SEC }))) { res.status(403).json({ error: "forbidden" }); return; }
        if (op === "queue-read") {
          // P7-B: the main room record rides along so /op sees the overlay's render-ack
          // (renderedId/renderedAt) without a second request; muted (P7-C) comes off the
          // snapshot — /control is the source of truth for the latch.
          const [q, cur] = await Promise.all([state.get(qRoom(room)), state.get(room)]);
          res.status(200).json({
            cards: (q && Array.isArray(q.cards)) ? q.cards : [], qseq: (q && q.qseq) || 0,
            onAirId: q && q.onAirId != null ? q.onAirId : null,
            muted: !!(q && q.muted),
            renderedId: cur && cur.renderedId != null ? cur.renderedId : null,
            renderedAt: cur && typeof cur.renderedAt === "number" ? cur.renderedAt : null,
            serverNow: Date.now(),
          });
          return;
        }
        // cmds-read {after} — operator commands newer than `after`, oldest→newest so
        // /control applies them in issue order. Unknown/expired `after` returns the whole
        // recent tail; /control dedupes by command id and drops pre-session timestamps.
        const list = (await state.readLog(cmdRoom(room))).slice(0, 100);
        const after = typeof req.body.after === "string" ? req.body.after : "";
        const idx = after ? list.findIndex((e) => e && e.id === after) : -1;
        res.status(200).json({ cmds: (idx >= 0 ? list.slice(0, idx) : list).reverse() });
        return;
      }
      if (op === "rendered") {
        /* P7-B render-ack (R39 — the trust-gap closure: 8 cards silently missed broadcast
           while /op said success). The overlay reports "I actually painted this card" so
           /op can distinguish AIRED (server accepted) from ON AIR (pixels on the program
           feed).
           TRUST MODEL — UNAUTHENTICATED BY DESIGN: the overlay is an OBS Browser Source
           holding only the public room URL — it has no writeKey and must never need one.
           The gate is the aired id itself: op:"rendered" is accepted ONLY when body.id
           equals the room's CURRENT on-air record id, and ids are minted server-side
           (mintId: ms timestamp + random suffix) — an unguessable weak capability. A
           spoofer who somehow learns the current id could only falsely mark the CURRENT
           card rendered — cosmetic stakes (a green ✓✓ on /op that should have been a
           stall warning); it cannot air, pull, mutate, or read anything. Rate class is
           read-ish (onair-r): one ack per air, but it shares the overlay's poll budget. */
        if (!(await rateLimit(req, res, "onair-r", 600))) return;
        if (!okRoom(room)) { res.status(400).json({ error: "bad room" }); return; }
        const rid = typeof req.body.id === "string" ? req.body.id : "";
        if (!rid) { res.status(400).json({ error: "bad id" }); return; }
        const cur = await state.get(room);
        if (!cur || !cur.card || cur.id !== rid) { res.status(409).json({ error: "not current" }); return; }
        // atomic merge (P5-E verb) — the ack can never clobber the card, and merge's TTL
        // is max(remaining, ttlSec) so this hint can't shorten the record's life. Same
        // ttl shape as the publish path: held card 3600s, timed card remaining + 15s.
        const tNow = Date.now();
        const left = typeof cur.durationMs === "number" && typeof cur.airedAt === "number"
          ? Math.ceil((cur.airedAt + cur.durationMs - tNow) / 1000) + 15 : 0;
        const ttlSec = cur.durationMs == null ? 3600 : Math.max(120, left);
        if (typeof state.merge === "function") await state.merge(room, { renderedId: rid, renderedAt: tNow }, { ttlSec });
        else await state.publish(room, Object.assign({}, cur, { renderedId: rid, renderedAt: tNow }), { ttlSec });
        res.status(200).json({ ok: true });
        return;
      }
      if (!(await spendGate(req, res))) return;   // D14: kill switch gates every spend/broadcast path (it 503s itself)
      if (!(await rateLimit(req, res, "onair-w", 60))) return;
      if (!okRoom(room) || typeof writeKey !== "string" || writeKey.length < 8) { res.status(400).json({ error: "bad room/key" }); return; }
      // TOFU room registration — atomicity lives in the adapter now (R12.1): SET NX EX in
      // one round trip on upstash, in-process check-and-set on memory. 403 on key mismatch.
      if (!(await state.registerRoom(room, writeKey, { ttlSec: ROOM_TTL_SEC }))) { res.status(403).json({ error: "forbidden" }); return; }
      if (op === "keys") {
        // BYOK (D10): room-scoped vendor keys, TTL-wiped with the room, never echoed back.
        if (!storeConfigured()) { res.status(500).json({ error: "store not configured" }); return; }
        const k = req.body.keys && typeof req.body.keys === "object" ? req.body.keys : {};
        const perplexity = typeof k.perplexity === "string" ? k.perplexity.trim().slice(0, 200) : "";
        const anthropic = typeof k.anthropic === "string" ? k.anthropic.trim().slice(0, 200) : "";
        const deepgram = typeof k.deepgram === "string" ? k.deepgram.trim().slice(0, 200) : "";
        if (!perplexity && !anthropic && !deepgram) {
          await pipeline([["DEL", `rk:${room}`]]);   // empty submit clears the room's keys
          res.status(200).json({ ok: true, perplexity: false, anthropic: false, deepgram: false });
          return;
        }
        await pipeline([["SET", `rk:${room}`, JSON.stringify({ perplexity: perplexity || undefined, anthropic: anthropic || undefined, deepgram: deepgram || undefined }), "EX", String(ROOM_TTL_SEC)]]);
        res.status(200).json({ ok: true, perplexity: Boolean(perplexity), anthropic: Boolean(anthropic), deepgram: Boolean(deepgram) });   // booleans only
        return;
      }
      if (op === "queue") {
        /* P3-J: /control publishes its actionable (checking/pending) cards for the
           second-phone operator page. qseq is server-stamped like seq so /op edge-triggers
           on change; the 180s TTL means a dead /control stops offering stale AIR targets
           within 3 minutes. Cards are sanitized server-side (strip/cut) and capped at 20. */
        const cards = (Array.isArray(req.body.cards) ? req.body.cards : []).slice(0, 20).map(slimQCard).filter(Boolean);
        const qseq = Date.now();
        const onAirId = typeof req.body.onAirId === "number" ? req.body.onAirId : null;
        const muted = req.body.muted === true;   // P7-C: mic-mute latch — control owns it, /op mirrors it
        await state.publish(qRoom(room), { cards, qseq, onAirId, muted }, { ttlSec: QUEUE_SNAPSHOT_TTL_SEC });
        /* P4-F2 (field F5): a non-empty queue means an air is likely soon, but an idle
           overlay is on its 2.5s cadence — the first air after a quiet stretch eats up to
           a full slow poll. Stamp activeAt onto the room's MAIN record so the overlay's
           existing GET carries the wake hint with ZERO extra reads on the poll path.
           Amortized: one read+write per snapshot push (never per poll), and refreshed at
           most once per 30s — the overlay's wake window is 90s, so a ≤30s-stale stamp
           still holds it awake while snapshots keep arriving. The merge preserves
           card/seq/airedAt/durationMs untouched (overlay edge-trigger semantics intact)
           and the recomputed ttl can only lengthen, never shorten, the record's remaining
           life (a held card keeps its 3600s; a timed card keeps its remaining run + 15s).
           Zero-card snapshots (stream-end clear) deliberately do NOT refresh the stamp,
           so an emptied queue lets the overlay fall back to SLOW within ~90s.
           Atomicity (closes the round-3 known residual): the stamp itself rides the
           adapter's atomic merge() — an air landing between our read and our write can no
           longer be clobbered, because the write only touches activeAt. The read below
           survives ONLY for the 30s throttle and the ttl hint, both of which are benign
           against staleness: a stale throttle read at worst skips/duplicates one stamp,
           and merge()'s TTL is max(remaining, ttlSec) so a stale ttl hint can never
           shorten a record's life. Adapters without merge (the _stub) keep the old
           read-merge-publish path — dev-only, residual documented on the interface. */
        if (cards.length > 0) {
          const cur = (await state.get(room)) || { card: null, seq: 0 };
          if (!(typeof cur.activeAt === "number" && qseq - cur.activeAt < 30000)) {
            const left = cur.card && typeof cur.durationMs === "number" && typeof cur.airedAt === "number"
              ? Math.ceil((cur.airedAt + cur.durationMs - qseq) / 1000) + 15 : 0;
            const ttlSec = cur.card && cur.durationMs == null ? 3600 : Math.max(180, left);
            if (typeof state.merge === "function") await state.merge(room, { activeAt: qseq }, { ttlSec });
            else await state.publish(room, Object.assign({}, cur, { activeAt: qseq }), { ttlSec });
          }
        }
        res.status(200).json({ ok: true, qseq });
        return;
      }
      if (op === "cmd") {
        /* P3-J: operator command from the /op page. skip/hold are MARKS only (control
           applies them on its next cmd poll). "air" also publishes the card to the on-air
           state HERE — through the exact publish path below (mintId + log mirror + ttl) —
           so the overlay updates even if /control hiccups; "pull" publishes card:null.
           Air is idempotent on (cardId, spokenAt): a double-tap can't double-air or
           double-log (card ids restart per /control session; spokenAt disambiguates) —
           made race-proof by append-then-elect (N2, below). Air also refuses cards the
           server can SEE were held/skipped after the backing snapshot was taken (N4). */
        const c = req.body.cmd && typeof req.body.cmd === "object" ? req.body.cmd : {};
        const action = c.action;
        // P7-C: mute/unmute are LOG-ONLY commands (no cardId, no publish, no card checks)
        // — /control consumes them from the cmd list and flips its own mic latch; the
        // latched state comes back to /op via the queue snapshot's `muted` boolean.
        if (action !== "air" && action !== "skip" && action !== "hold" && action !== "pull"
          && action !== "mute" && action !== "unmute") { res.status(400).json({ error: "bad cmd" }); return; }
        const cardId = Number(c.cardId);
        if (action !== "pull" && action !== "mute" && action !== "unmute" && !Number.isFinite(cardId)) { res.status(400).json({ error: "bad cmd" }); return; }
        const t = Date.now();
        const entry = { id: mintId(t), t, action, cardId: Number.isFinite(cardId) ? cardId : null };
        if (action === "air") {
          const q = await state.get(qRoom(room));
          const qc = q && Array.isArray(q.cards) ? q.cards.find((x) => x && x.id === cardId && x.state === "pending") : null;
          if (!qc) { res.status(409).json({ error: "card not airable" }); return; }   // gone / already actioned / still checking
          /* N4 guard 1 — snapshot freshness bound: never air from a snapshot past its
             intended lifetime, even on a store that ignores ttlSec (see the tunable's
             comment for why the ceiling is the TTL, not tighter). */
          const qseq = typeof q.qseq === "number" ? q.qseq : 0;
          if (t - qseq > OP_AIR_MAX_SNAPSHOT_AGE_MS) { res.status(409).json({ error: "card not airable", stale: true }); return; }
          /* N4 guard 2 — hold/skip recency scan: /op-originated HOLD/SKIPs are server-
             logged, so a hold the backing snapshot can't yet reflect is still visible
             here. Reject the air when a hold/skip for this card either (a) matches the
             card instance exactly (spokenAt — covers holds control hasn't APPLIED and
             re-pushed yet, e.g. two phones on one key) or (b) postdates the snapshot
             (t >= qseq; >= because same-ms is ambiguous and a held card never returns to
             the /op queue, so over-rejecting here has no false-positive path). Control-
             LOCAL dismissals stay invisible until the next snapshot — see the tunable. */
          const log = await state.readLog(cmdRoom(room));
          const heldAfter = log.some((e) => e && (e.action === "hold" || e.action === "skip") && e.cardId === cardId
            && ((e.spokenAt != null && qc.spokenAt != null) ? e.spokenAt === qc.spokenAt : (typeof e.t === "number" && e.t >= qseq)));
          if (heldAfter) { res.status(409).json({ error: "card not airable", stale: true }); return; }
          // serialized re-tap fast path: a prior COMPLETED air for this card instance → dup
          const prior = log.find((e) => e && e.action === "air" && e.cardId === cardId && e.spokenAt === qc.spokenAt);
          if (prior) { res.status(200).json({ ok: true, id: prior.id, airedId: prior.airedId || null, dup: true }); return; }
          /* N2 — concurrent double-air TOCTOU: two simultaneous airs can both pass the
             `prior` scan. Close it with append-then-elect: append our cmd entry FIRST,
             read the log back, and elect the entry that landed FIRST (deepest matching
             position in the newest-first list — position, not timestamps: t is minted
             before the store append, so arrival order is the only total order both
             racers agree on; both adapters' logs are arrival-ordered). The store
             serializes appends, so whichever racer appended second is guaranteed to see
             the winner on its read-back → exactly one publish + one aired-log entry;
             the loser answers dup with the winner's airedId. Cost: the loser's cmd
             entry stays in the log (control no-ops it: card no longer pending) and the
             overlay publish now happens after the cmd append, so a store failing
             mid-sequence can log a cmd whose publish never landed — the mirror image of
             the old ordering's partial-failure mode, equally narrow. */
          const dur = durationMs === null ? null : (typeof durationMs === "number" ? Math.max(0, Math.min(600000, durationMs)) : 10000);
          entry.airedId = mintId(t); entry.durationMs = dur; entry.spokenAt = qc.spokenAt;
          await state.appendLog(cmdRoom(room), entry);
          const rivals = (await state.readLog(cmdRoom(room))).filter((e) => e && e.action === "air" && e.cardId === cardId && e.spokenAt === qc.spokenAt);
          const winner = rivals[rivals.length - 1] || entry;   // newest-first ⇒ last = first appended
          if (winner.id !== entry.id) { res.status(200).json({ ok: true, id: winner.id, t, airedId: winner.airedId || null, dup: true }); return; }
          const seq = Date.now();
          const slim = slimCard(qc);
          await state.publish(room, { card: slim, seq, id: entry.airedId, airedAt: seq, durationMs: dur },
            { ttlSec: dur == null ? 3600 : Math.max(120, Math.ceil(dur / 1000) + 15) });
          await state.appendLog(room, Object.assign({ id: entry.airedId, airedAt: seq }, slim));   // same durability backstop as a control air
          res.status(200).json({ ok: true, id: entry.id, t, airedId: entry.airedId });
          return;
        }
        if (action === "skip" || action === "hold") {
          // Stamp the card INSTANCE onto the mark when the snapshot still has it, so the
          // air branch's N4 scan can match holds precisely across snapshot refreshes
          // (cardId alone restarts per /control session; spokenAt disambiguates).
          const q = await state.get(qRoom(room));
          const qc = q && Array.isArray(q.cards) ? q.cards.find((x) => x && x.id === cardId) : null;
          if (qc && qc.spokenAt != null) entry.spokenAt = qc.spokenAt;
        } else if (action === "pull") {
          const seq = Date.now();
          await state.publish(room, { card: null, seq, id: null, airedAt: seq, durationMs: 0 }, { ttlSec: 120 });
        }
        await state.appendLog(cmdRoom(room), entry);
        res.status(200).json({ ok: true, id: entry.id, t, airedId: null });
        return;
      }
      // durationMs: number = auto-retire after that long; null = hold until pulled
      const dur = durationMs === null ? null : (typeof durationMs === "number" ? Math.max(0, Math.min(600000, durationMs)) : 10000);
      const seq = Date.now();
      const slim = slimCard(card);
      const id = slim ? mintId(seq) : null;   // R9: stable id on every AIRED event (pulls carry none)
      // ttl bounds how long stale on-air state can outlive its writer in the store
      await state.publish(room, { card: slim, seq, id, airedAt: seq, durationMs: dur },
        { ttlSec: dur == null ? 3600 : Math.max(120, Math.ceil(dur / 1000) + 15) });
      // durability backstop: append every AIRED check to a per-room log (survives a control crash)
      if (slim) await state.appendLog(room, Object.assign({ id, airedAt: seq }, slim));
      res.status(200).json({ ok: true, seq, id });   // id echoes back so /control can reference it (corrections)
      return;
    }
    res.status(405).json({ error: "GET or POST" });
  } catch (e) { console.error("onair error", e && e.message); res.status(502).json({ error: "store error" }); }
}
