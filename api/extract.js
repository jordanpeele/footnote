// Footnote — stage 1: the active ClaimExtractor adapter (default: Claude Haiku) extracts
// the atomic checkable claim from a spoken sentence, or returns null (filler/opinion/
// question). Fast + cheap; gates the pricey verify. Thin route: parse/validate → rate
// limit → adapter → shape response. Prompt + vendor call live in
// src/adapters/extractor/anthropic-haiku/ (prompt text in prompts/extractor.md).
//
// Response shape (v2, additive): { claim, polarity, harm_class }. `claim` is always the
// canonical ASSERTIVE form; `polarity` ("asserts"|"denies") records whether the speaker
// asserted or denied it (core applyPolarity maps the verified verdict back); `harm_class`
// feeds the D11 auto-air gate. No-claim responses stay exactly { claim: null }.
export const config = { api: { bodyParser: true } };
import { spendGate } from "../src/core/spendgate.js";
import { rateLimit } from "./_ratelimit.js";
import { getAdapter } from "../src/core/registry.js";
import { groundedClaim } from "../src/core/grounding.js";
import { UpstreamError } from "../src/core/errors.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!(await spendGate(req, res))) return;   // D14: kill switch first — before rate limit or any adapter
  if (!(await rateLimit(req, res, "extract", 40))) return;
  const text = (req.body?.text || "").trim();
  if (text.length < 8) { res.status(200).json({ claim: null }); return; }
  try {
    const { claim, polarity, harm_class } = await getAdapter("extractor").extract(text);
    res.setHeader("Cache-Control", "no-store");
    if (claim == null) { res.status(200).json({ claim: null }); return; }
    // P4-F1 grounding gate: an LLM extractor can echo its own prompt as a "claim" when
    // the speaker talks about claims (4x in the 2026-08-08 field test). Reject anything
    // not grounded in the utterance; reason stays server-side, response is uniform.
    const g = groundedClaim(claim, text);
    if (!g.ok) {
      console.warn("extract ungrounded", g.reason, "claim:", String(claim).slice(0, 80), "utterance:", text.slice(0, 80));
      res.status(200).json({ claim: null, rejected: "ungrounded" });
      return;
    }
    res.status(200).json({ claim, polarity, harm_class });
  } catch (e) {
    if (e instanceof UpstreamError) {   // vendor answered non-2xx; adapter already logged it
      res.status(502).json({ error: "extract failed", claim: null, upstream_status: e.status, upstream: e.detail });
      return;
    }
    console.error("extract error", e && e.message);
    res.status(502).json({ error: "extract failed", claim: null });
  }
}
