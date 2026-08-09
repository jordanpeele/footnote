// Footnote — stage 2: the active Verifier adapter (default: Perplexity sonar-pro) checks
// an atomic claim against the live web; core editorial policy (src/core/editorial.js,
// Decision D5) then ranks the citations by trust tier, selects the surfaced source,
// whitelists the verdict, and cleans the correction for air. Thin route: spend gate →
// parse/validate → rate limit → room cap/BYOK → adapter → editorial → polarity → shape.
export const config = { api: { bodyParser: true } };
import { spendGate } from "../src/core/spendgate.js";
import { rateLimit } from "./_ratelimit.js";
import { getAdapter } from "../src/core/registry.js";
import { UpstreamError } from "../src/core/errors.js";
import { finalizeVerification } from "../src/core/editorial.js";
import { applyPolarity } from "../src/core/polarity.js";
import { HOSTED_VERDICTS_PER_ROOM_PER_DAY } from "../src/core/tunables.js";
import { isConfigured as storeConfigured, pipeline } from "../src/adapters/state/upstash/index.js";

const okRoom = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(s);

// BYOK feature flag. D13 — off until credential race-verified; flip via env var
// BYOK_ENABLED=1. While off, stored room keys (rk:<room>) are ignored by this route —
// no rk lookup happens at all — and hosted daily caps apply to every room. The /api/onair
// byok status GET keeps working either way (key storage is unaffected; only spending
// against stored keys is gated here).
//
// Credential mechanism (R8): the room key travels as a PER-CALL `credentials` argument
// into the adapter. The old process.env swap-and-restore is gone and permanently banned —
// env is instance-global on a warm lambda, so concurrent invocations raced and one room's
// key could have signed another room's traffic. test/credentials.test.js enforces both
// the race-freedom and (statically) the absence of env writes.
const BYOK_ENABLED = process.env.BYOK_ENABLED === "1";

export default async function handler(req, res) {
  if (!(await spendGate(req, res))) return;   // operator pause — first, before everything else
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!(await rateLimit(req, res, "verify", 20))) return;
  const claim = (req.body?.claim || "").trim();
  if (!claim) { res.status(400).json({ error: "no claim" }); return; }
  const polarity = req.body?.polarity;                                // optional, from /api/extract
  const room = okRoom(req.body?.room) ? req.body.room : null;         // optional, from /control

  // Room accounting (hosted-spend protection). With BYOK_ENABLED, a room whose stored
  // rk:<room> record holds its own Perplexity key pays its own way and skips the cap;
  // with the flag off (D13 default) every room is capped. Fails OPEN on store trouble —
  // same stance as the rate limiter.
  let credentials = null;                     // per-call BYOK credentials (R8) — never via env
  if (room && storeConfigured()) {
    if (BYOK_ENABLED) {
      try {
        const out = await pipeline([["GET", `rk:${room}`]]);
        const rk = out?.[0]?.result ? JSON.parse(out[0].result) : null;
        if (rk?.perplexity) credentials = { perplexityKey: rk.perplexity };
      } catch {}
    }
    if (!credentials) {
      try {
        const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");   // UTC day
        const key = `vc:${room}:${day}`;
        const out = await pipeline([["INCR", key], ["EXPIRE", key, String(26 * 3600)]]);
        const n = out?.[0]?.result;
        if (typeof n === "number" && n > HOSTED_VERDICTS_PER_ROOM_PER_DAY) {
          res.status(429).json({ error: "room daily cap reached", cap: HOSTED_VERDICTS_PER_ROOM_PER_DAY });
          return;
        }
      } catch {}
    }
  }

  try {
    const raw = await getAdapter("verifier").verify(claim, {}, credentials);
    const v = finalizeVerification(raw);
    // D11: the extractor canonicalizes denials into assertive claims and reports polarity;
    // flip definitive verdicts back for "denies", and surface a conflict flag on malformed
    // polarity so the client can force manual review.
    const p = applyPolarity(v.verdict, polarity);
    v.verdict = p.verdict;
    v.polarity_conflict = Boolean(p.conflict);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(v);
  } catch (e) {
    if (e instanceof UpstreamError) {   // vendor answered non-2xx; adapter already logged it
      res.status(502).json({ error: "verify failed", upstream_status: e.status, upstream: e.detail });
      return;
    }
    console.error("verify error", e && e.message);
    res.status(502).json({ error: "verify failed" });
  }
}
