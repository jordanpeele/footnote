// Footnote — stage 1: the active ClaimExtractor adapter (default: Claude Haiku) extracts
// every distinct atomic checkable claim from a transcript window, or none (filler/opinion/
// question). Fast + cheap; gates the pricey verify. Thin route: parse/validate → rate
// limit → adapter → per-claim gates → shape response. Prompt + vendor call live in
// src/adapters/extractor/anthropic-haiku/ (prompt text in prompts/extractor.md).
//
// Response shape (v3 multi-claim, additive on v2): { ...firstClaim, claims: [ { claim,
// polarity, harm_class, category, tripwire? } ] }. Each `claim` is the canonical ASSERTIVE
// form; `polarity` ("asserts"|"denies"|"suspect_denies") records the speaker's stance
// (core applyPolarity maps the verified verdict back). The legacy top-level fields mirror
// the FIRST surviving claim so pre-multi consumers keep working. The grounding gate and
// the R46 negation tripwire run PER CLAIM. No-claim responses: { claim: null, claims: [] }.
export const config = { api: { bodyParser: true } };
import { spendGate } from "../src/core/spendgate.js";
import { tick } from "../src/core/spendmeter.js";
import { rateLimit } from "./_ratelimit.js";
import { getAdapter } from "../src/core/registry.js";
import { groundedClaim } from "../src/core/grounding.js";
import { hasNegation } from "../src/core/utterance.js";
import { UpstreamError } from "../src/core/errors.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!(await spendGate(req, res))) return;   // D14: kill switch first — before rate limit or any adapter
  if (!(await rateLimit(req, res, "extract", 40))) return;
  const text = (req.body?.text || "").trim();
  if (text.length < 8) { res.status(200).json({ claim: null, claims: [] }); return; }
  try {
    const extractor = getAdapter("extractor");
    tick("extract", extractor.name);   // spend metering (est. only) — count the attempt as the call leaves
    const ex = await extractor.extract(text);
    // multi-claim (v4) adapters return .claims; a legacy single-claim adapter's shape wraps
    const items = Array.isArray(ex.claims) ? ex.claims : (ex.claim != null ? [ex] : []);
    res.setHeader("Cache-Control", "no-store");
    if (!items.length) { res.status(200).json({ claim: null, claims: [] }); return; }
    let anyUngrounded = false;
    const claims = [];
    for (const it of items) {
      // P4-F1 grounding gate, PER CLAIM: an LLM extractor can echo its own prompt as a
      // "claim" when the speaker talks about claims (4x in the 2026-08-08 field test).
      // Reject anything not grounded in the utterance; reason stays server-side.
      const g = groundedClaim(it.claim, text);
      if (!g.ok) {
        anyUngrounded = true;
        console.warn("extract ungrounded", g.reason, "claim:", String(it.claim).slice(0, 80), "utterance:", text.slice(0, 80));
        continue;
      }
      /* R46 negation tripwire (street FS-8: an aired wrong verdict): the extractor said the
         speaker DENIED the claim, but the utterance carries no negation token — the flip is
         suspect, and a wrongly-flipped verdict airs the opposite of the truth. Rewrite to a
         polarity value applyPolarity treats as CONFLICT: verdict stays un-flipped, the card
         carries polarity_conflict (⚠ chip on the queue, spoken framing per D17).
         Second member of the deterministic-consistency family (R48; grounding gate was first).
         Replay: catches exactly the FS-8 card, zero false positives across four sessions.
         Window-level negation check, as before multi-claim: hasNegation scans the full
         utterance, so a denial anywhere in the window legitimizes "denies" on any claim. */
      if (it.polarity === "denies" && !hasNegation(text)) {
        console.warn("polarity tripwire (R46): denies without negation token", "utterance:", text.slice(0, 80));
        claims.push({ claim: it.claim, polarity: "suspect_denies", harm_class: it.harm_class, category: it.category, tripwire: "negation" });
        continue;
      }
      claims.push({ claim: it.claim, polarity: it.polarity, harm_class: it.harm_class, category: it.category });
    }
    if (!claims.length) { res.status(200).json({ claim: null, claims: [], ...(anyUngrounded ? { rejected: "ungrounded" } : {}) }); return; }
    res.status(200).json({ ...claims[0], claims });   // legacy top-level mirrors the first surviving claim
  } catch (e) {
    if (e instanceof UpstreamError) {   // vendor answered non-2xx; adapter already logged it
      res.status(502).json({ error: "extract failed", claim: null, claims: [], upstream_status: e.status, upstream: e.detail });
      return;
    }
    console.error("extract error", e && e.message);
    res.status(502).json({ error: "extract failed", claim: null, claims: [] });
  }
}
