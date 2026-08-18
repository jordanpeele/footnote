// Verifier adapter: Perplexity sonar-pro. Verifies an atomic claim against the live web and
// returns the RAW verdict + citations (implements src/core/interfaces/verifier.js).
// Source authority is enforced three ways — two live here, one in core (Decision D5):
//   (1) a search_domain_filter that blocks the most common low-trust domains (adapter),
//   (2) a prompt that demands wire/gov/major-outlet sourcing (adapter),
//   (3) server-side trust ranking so the surfaced source is always the most credible
//       citation — that lives in src/core/editorial.js, ABOVE this interface.
import { UpstreamError } from "../../../core/errors.js";

export const name = "perplexity";

/** @type {import("../../../core/interfaces/verifier.js").Verifier["verify"]} */
export async function verify(claim, _ctx = {}, credentials = null) {
  // BYOK (D13/R8): per-call credential, resolved at header-construction time. NEVER via
  // env mutation — that races across concurrent invocations in a warm lambda.
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials?.perplexityKey || process.env.PERPLEXITY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "sonar-pro",
      // steer the actual web search away from the most common low-trust domains (max 10 entries)
      search_domain_filter: ["-reddit.com", "-quora.com", "-x.com", "-twitter.com", "-facebook.com", "-tiktok.com", "-youtube.com", "-pinterest.com", "-medium.com", "-wikihow.com"],
      messages: [
        { role: "system", content: 'You are a rigorous live TV fact-checker. Verify the claim ONLY against high-trust sources that an average American would trust: major wire services (AP, Reuters), national newspapers and broadcasters (New York Times, Wall Street Journal, Washington Post, BBC, NPR, PBS, ABC, CBS, NBC, CNN), U.S. government agencies and official statistics (.gov, e.g. Bureau of Labor Statistics, Census Bureau, CDC, Federal Reserve), reputable encyclopedias (Britannica), peer-reviewed science, and established fact-checkers (PolitiFact, FactCheck.org, Snopes). Do NOT rely on social media, forums (Reddit, Quora), personal blogs, or commercial/SEO pages. Respond with ONLY a compact JSON object, no prose, no code fences: {"verdict":"True|False|Misleading|Unverifiable|NeedsContext","correction":"one concise sentence with the accurate figure/fact, maximum 140 characters — it must fit a TV lower-third","confidence":0.0-1.0,"source_name":"the single most authoritative outlet, e.g. Reuters or Bureau of Labor Statistics"}' },
        { role: "user", content: `Claim: ${claim}` },
      ],
    }),
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    console.error("verify upstream error", r.status, detail);
    throw new UpstreamError("verify failed", { status: r.status, detail });
  }
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content || "";
  const citations = (Array.isArray(j?.citations) && j.citations) || (j?.search_results || []).map((s) => s.url).filter(Boolean) || [];
  let parsed = {};
  try { parsed = JSON.parse(content.replace(/```json/gi, "").replace(/```/g, "").trim()); } catch {}
  // raw + unfiltered: core applies verdict whitelisting, markdown cleanup, trust ranking
  return { verdict: parsed.verdict, correction: parsed.correction, confidence: parsed.confidence, sourceName: parsed.source_name, citations, raw: content };
}
