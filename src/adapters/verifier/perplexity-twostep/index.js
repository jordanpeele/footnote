// Verifier adapter: Perplexity sonar-pro, TWO-STEP (P4-C — built dark, never default).
// Selected via FOOTNOTE_VERIFIER=perplexity-twostep; same interface as the single-shot
// adapter (src/core/interfaces/verifier.js), same RawVerification shape out.
//
// Why two steps (calibration runs #1/#2, docs/CALIBRATION_REPORT_2_2026-08-07.md): the
// single-shot verifier measured 84–94% verdict precision at the floor vs the 95% auto-air
// bar, dominated by UNDER-COMMITMENT — NeedsContext/Misleading verdicts on definitive
// evidence. Prompt-level commitment tuning was tried and REJECTED (eval/ADJUDICATIONS.md:
// it flipped genuinely-mid-tier controls to confident-wrong False). The sanctioned lever
// is structural:
//   step 1 — evidence gathering: a search-focused call that reports the strongest
//            evidence for AND against, with citations, and is forbidden to give a verdict;
//   step 2 — verdict commitment: a reasoning-focused call (search disabled, temperature 0)
//            that judges the claim against ONLY the gathered evidence block, must commit
//            True/False when the evidence is definitive, must stay mid-tier when it
//            genuinely conflicts, and must name the evidence lines its verdict rests on
//            (the confident-wrong guard the rejected prompt iteration lacked).
// Sum latency is ~2x the single-shot adapter — accepted; this is a precision play.
//
// Editorial policy still lives ABOVE this interface (Decision D5): core ranks citations,
// whitelists the verdict, and cleans the correction. This adapter returns raw material.
import { UpstreamError } from "../../../core/errors.js";

export const name = "perplexity-twostep";

// steer the actual web search away from the most common low-trust domains (max 10 entries)
const DOMAIN_FILTER = ["-reddit.com", "-quora.com", "-x.com", "-twitter.com", "-facebook.com", "-tiktok.com", "-youtube.com", "-pinterest.com", "-medium.com", "-wikihow.com"];

// Step-1 system prompt — evidence only, NO verdict. Named export so tests can assert the
// wire payload verbatim (R14 pattern, cf. the extractor's FALLBACK_PROMPT).
export const EVIDENCE_PROMPT = 'You are the evidence-gathering stage of a live TV fact-checking pipeline. A separate stage decides the verdict; you do NOT judge whether the claim is true. Your only job is to search for and report the strongest evidence bearing on the claim — for AND against — from high-trust sources that an average American would trust: major wire services (AP, Reuters), national newspapers and broadcasters (New York Times, Wall Street Journal, Washington Post, BBC, NPR, PBS, ABC, CBS, NBC, CNN), U.S. government agencies and official statistics (.gov, e.g. Bureau of Labor Statistics, Census Bureau, CDC, Federal Reserve), reputable encyclopedias (Britannica), peer-reviewed science, and established fact-checkers (PolitiFact, FactCheck.org, Snopes). Do NOT rely on social media, forums (Reddit, Quora), personal blogs, or commercial/SEO pages. Respond with ONLY a numbered evidence list, most probative first, one finding per line, each line formatted exactly: E<n>: <one specific checkable finding — the concrete figure, date, name, or fact> — <outlet name>. If qualifying sources genuinely disagree, include the conflicting findings as separate lines. If no qualifying source bears on the claim, respond with exactly NO_EVIDENCE. Never state a verdict, never say the claim is true or false, never editorialize.';

// Step-2 system prompt — verdict against ONLY the evidence block. Rules (2)–(4) fix the
// under-commitment miss class without reintroducing the rejected iteration's failure:
// rule (5) is the verdict/correction-consistency guard (the Nixon flip aired True against
// its own correction) and rule (6) forbids a definitive verdict that cannot name its
// supporting evidence lines.
export const VERDICT_PROMPT = 'You are the verdict stage of a live TV fact-checking pipeline. You will receive a claim and an evidence block gathered by a separate search stage. Judge the claim against ONLY that evidence block: you have no search access and must not introduce facts that are not in it. Decision rules, in order: (1) If the block is NO_EVIDENCE or nothing in it bears on the claim, the verdict is Unverifiable. (2) If every evidence line that bears on the claim points the same way and is specific enough to settle it, you MUST commit to a definitive verdict: True if the lines confirm the claim as stated, False if they contradict it. Softening a settled verdict to NeedsContext or Misleading is a failure. (3) Misleading only when the evidence shows the claim uses true elements to create a false impression (cherry-picked baseline, misattributed cause, technically-true framing). (4) NeedsContext only when the claim is true or partly true but the evidence shows it is materially incomplete, or when evidence lines genuinely conflict with each other. (5) Your verdict must agree with your own correction sentence: if your correction contradicts the claim, the verdict cannot be True; if it supports the claim as stated, the verdict cannot be False. (6) evidence_lines must list the line IDs your verdict rests on; a True or False verdict you cannot support with specific line IDs is invalid — return Unverifiable instead. Respond with ONLY a compact JSON object, no prose, no code fences: {"verdict":"True|False|Misleading|Unverifiable|NeedsContext","correction":"one concise sentence with the accurate figure/fact, drawn from the evidence lines","confidence":0.0-1.0,"source_name":"the most authoritative outlet named in the evidence lines, e.g. Reuters","evidence_lines":["E1","E3"]}';

// One Perplexity chat/completions call. BYOK (D13/R8): per-call credential, resolved at
// header-construction time on EVERY call. NEVER via env mutation — that races across
// concurrent invocations in a warm lambda (test/perplexity-twostep.test.js enforces both
// the per-call scoping and, statically, the absence of env writes).
async function callPerplexity(body, credentials, step) {
  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials?.perplexityKey || process.env.PERPLEXITY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    console.error(`verify twostep ${step} upstream error`, r.status, detail);
    throw new UpstreamError("verify failed", { status: r.status, detail });
  }
  return r.json();
}

/** @type {import("../../../core/interfaces/verifier.js").Verifier["verify"]} */
export async function verify(claim, _ctx = {}, credentials = null) {
  // ---- step 1: evidence gathering (search-focused; forbidden to render a verdict) ----
  const ev = await callPerplexity({
    model: "sonar-pro",
    search_domain_filter: DOMAIN_FILTER,
    messages: [
      { role: "system", content: EVIDENCE_PROMPT },
      { role: "user", content: `Claim: ${claim}` },
    ],
  }, credentials, "step1");
  const evidenceBlock = (ev?.choices?.[0]?.message?.content || "").trim() || "NO_EVIDENCE";
  // All citations come from step 1 — step 2 runs with search disabled and produces none.
  const citations = (Array.isArray(ev?.citations) && ev.citations) || (ev?.search_results || []).map((s) => s.url).filter(Boolean) || [];

  // ---- step 2: verdict commitment against ONLY the gathered evidence (no new search) --
  const vd = await callPerplexity({
    model: "sonar-pro",
    disable_search: true,   // reasoning-only: the verdict may not shop for new facts
    temperature: 0,
    messages: [
      { role: "system", content: VERDICT_PROMPT },
      { role: "user", content: `Claim: ${claim}\n\nEvidence block:\n${evidenceBlock}` },
    ],
  }, credentials, "step2");
  const content = vd?.choices?.[0]?.message?.content || "";
  let parsed = {};
  try { parsed = JSON.parse(content.replace(/```json/gi, "").replace(/```/g, "").trim()); } catch {}
  // raw + unfiltered, IDENTICAL shape to the single-shot adapter: core applies verdict
  // whitelisting, markdown cleanup, trust ranking (D5).
  return { verdict: parsed.verdict, correction: parsed.correction, confidence: parsed.confidence, sourceName: parsed.source_name, citations, raw: content };
}
