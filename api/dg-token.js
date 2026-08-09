// Mints a short-lived STT access token so the browser can stream speech-to-text WITHOUT a
// vendor key in client source (default adapter: Deepgram — needs a grant-capable Member
// scope key in DEEPGRAM_API_KEY; the client authenticates its WebSocket with
// ["bearer", access_token] and fetches a fresh token per (re)connect). Thin route:
// spend gate → validate → rate limit → resolve BYOK credentials → adapter mintToken →
// shape response.
export const config = { api: { bodyParser: true } };
import { spendGate } from "../src/core/spendgate.js";
import { rateLimit } from "./_ratelimit.js";
import { getAdapter } from "../src/core/registry.js";
import { UpstreamError } from "../src/core/errors.js";
import { isConfigured as storeConfigured, pipeline } from "../src/adapters/state/upstash/index.js";

const okRoom = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(s);

// BYOK feature flag. D13 — off until credential race-verified; flip via env var
// BYOK_ENABLED=1. When on, a POST body may carry an optional { room }: if that room's
// stored rk:<room> record has a `deepgram` key, the token is minted against the room's
// key instead of the server env key. Credentials travel as a PER-CALL argument into the
// adapter (R8) — env mutation as a credential mechanism is permanently banned
// (test/credentials.test.js enforces this statically).
const BYOK_ENABLED = process.env.BYOK_ENABLED === "1";

export default async function handler(req, res) {
  if (!(await spendGate(req, res))) return;   // operator pause — first, before everything else
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!(await rateLimit(req, res, "dgtoken", 12))) return;
  res.setHeader("Cache-Control", "no-store");
  const stt = getAdapter("stt");
  // 501 when the adapter has no token story at all
  if (!stt.mintToken) { res.status(501).json({ error: "DEEPGRAM_API_KEY not configured" }); return; }

  // BYOK (D13): resolve the room's stored Deepgram key, if any. rk:<room> is the same
  // JSON record /api/onair op:"keys" writes ({perplexity, anthropic, deepgram?} — the
  // `deepgram` field is additive; the keys UI is owned elsewhere).
  let credentials = null;                     // per-call credentials (R8) — never via env
  const room = okRoom(req.body?.room) ? req.body.room : null;
  if (BYOK_ENABLED && room && storeConfigured()) {
    try {
      const out = await pipeline([["GET", `rk:${room}`]]);
      const rk = out?.[0]?.result ? JSON.parse(out[0].result) : null;
      if (rk?.deepgram) credentials = { deepgramKey: rk.deepgram };
    } catch {}
  }
  // 501 when no key is available at all (no server env key AND no room key)
  if (!credentials && !stt.isConfigured()) { res.status(501).json({ error: "DEEPGRAM_API_KEY not configured" }); return; }

  try {
    const t = await stt.mintToken(credentials);
    res.status(200).json({ access_token: t.accessToken, expires_in: t.expiresIn });
  } catch (e) {
    if (e instanceof UpstreamError) {   // vendor answered non-2xx; adapter already logged it
      res.status(502).json({ error: "grant failed", upstream_status: e.status, upstream: e.detail });
      return;
    }
    console.error("dg-token error", e && e.message);
    res.status(502).json({ error: "grant failed" });
  }
}
