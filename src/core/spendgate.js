// Footnote — global spend kill switch (Decision D14: the kill switch gates EVERY spend
// path or it doesn't count). api/admin.js sets/clears `kill:global` in the store (no
// TTL — restore is explicit); every "costed"/"gated" route (see ROUTE_CLASSES below)
// calls spendGate() FIRST and 503s while the flag is set.
//
// Fail-OPEN on store errors / unconfigured store: a kill switch needs a store to engage,
// and this is spend protection, not an availability dependency — same posture as the
// rate limiter (api/_ratelimit.js). Self-hosters without Redis simply run ungated.
//
// The flag is read fresh on every invocation — per-request only, NO cross-request or
// module-level cache — so admin ?op=restore takes effect immediately without a redeploy.
//
// Imports the Upstash adapter directly (not via the registry): the kill flag is
// infrastructure tied to this store, not a StateChannel verb.
import { isConfigured, pipeline } from "../adapters/state/upstash/index.js";

// D14 registry of record — every api/*.js route (basename, underscore-prefixed helpers
// excluded) must appear here. test/route-inventory.test.js enforces this map against the
// api/ directory in both directions, so an unclassified new route fails CI.
//   "costed": calls a paid upstream — MUST call spendGate()
//   "gated":  no upstream spend, but must stop under kill — MUST call spendGate()
//   "free":   must NEVER be gated (or the operator can't restore)
export const ROUTE_CLASSES = {
  extract: "costed",     // Anthropic Haiku claim extraction
  verify: "costed",      // Perplexity verification
  transcribe: "costed",  // Deepgram batch STT
  "dg-token": "costed",  // mints Deepgram streaming tokens — spend by proxy
  onair: "gated",        // broadcast control: stop airing while killed
  admin: "free",         // kill/restore/status — gating this would lock the switch shut
  config: "free",        // D19 posture disclosure (active verifier) — no spend; gating it would blind the VERIFIED fail-closed check
};

/* In-process kill flag — the SELF-HOST fallback (D18 pilot arming found the gap: without
   Redis the switch was a silent no-op, meaning self-hosters shipped with NO kill switch).
   Correct only because npm start is one process (D1): a module flag IS global there. On
   serverless, invocations don't share modules — the store remains the only correct
   mechanism, which is why this engages ONLY when the store is unconfigured. */
export const localKill = { engaged: false, at: null };

// Reads kill:global. Swappable via _setFlagReader so tests can exercise the gate without
// a live store (the static adapter import leaves no other seam).
async function defaultFlagReader() {
  if (!isConfigured()) return localKill.engaged;   // self-host: in-process flag (was fail-open no-op)
  const out = await pipeline([["GET", "kill:global"]]);   // null on store non-2xx → falsy → open
  return Boolean(out?.[0]?.result);
}
let readFlag = defaultFlagReader;

/** TEST HOOK ONLY — replace the flag reader; pass null/undefined to restore the default. */
export function _setFlagReader(fn) { readFlag = fn || defaultFlagReader; }

/**
 * Pure gate policy: flag value in, decision out. Split from spendGate so the 503
 * contract is unit-testable without mocking req/res or the store.
 * @param {boolean} flagValue
 * @returns {{allow: true} | {allow: false, status: 503, body: {error: string, paused: true}}}
 */
export function gateDecision(flagValue) {
  if (!flagValue) return { allow: true };
  // "paused by operator" keeps round-2's client-visible string; `paused` is the machine flag.
  return { allow: false, status: 503, body: { error: "paused by operator", paused: true } };
}

/**
 * Call FIRST in every costed/gated route (before rate limiting — a killed deployment
 * shouldn't burn store writes either). Responds 503 and returns false while the operator
 * kill flag is set; returns true otherwise. Fails OPEN on any store trouble.
 * @returns {Promise<boolean>} true = proceed, false = response already sent
 */
export async function spendGate(req, res) {
  let flag = false;
  try { flag = Boolean(await readFlag()); } catch { /* fail open */ }
  const d = gateDecision(flag);
  if (d.allow) return true;
  res.status(d.status).json(d.body);
  return false;
}
