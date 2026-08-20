// D19 — server posture disclosure. /control asks who is verifying so VERIFIED mode can
// fail CLOSED when the concurrence requirement isn't met (a session must not shed pilot
// posture silently — pilot-ledger §8/§11 fix). Read-only, no secrets: the verifier name
// is public information (registry defaults ship in the repo). Rate-limited like every
// public route; classed "free" (no vendor spend, and gating it would blind the posture
// check that decides whether auto-air may arm at all).
export const config = { api: { bodyParser: false } };
import { rateLimit } from "./_ratelimit.js";
import { getAdapter } from "../src/core/registry.js";

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  if (!(await rateLimit(req, res, "config", 60))) return;
  res.setHeader("Cache-Control", "no-store");
  let verifier = null, extractor = null, stt = null;
  try { verifier = getAdapter("verifier").name || null; } catch {}
  try { extractor = getAdapter("extractor").name || null; } catch {}
  try { stt = getAdapter("stt").name || null; } catch {}
  res.status(200).json({ verifier, extractor, stt });
}
