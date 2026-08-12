// Verifier adapter: Brave Search (evidence gathering) + Claude / Anthropic (verdict
// synthesis). The SECOND independent verifier (issue #5), built so the concurrence
// meta-verifier (src/adapters/verifier/concurrence/) has two genuinely different engines
// under it — a different search backend AND a different verdict model than the Perplexity
// adapters. Implements src/core/interfaces/verifier.js, same RawVerification shape out, so
// src/core/editorial.js finalizeVerification (D5) cannot tell it apart from perplexity.
//
// ⚠️ DARK + INTERFACE-SCAFFOLDING, NOT LIVE-PROVEN. This adapter is written to the Verifier
// contract and fully unit-tested with a STUBBED fetch, but it has never been run against
// the live Brave or Anthropic APIs — BRAVE_API_KEY is not provisioned and no calibration
// eval has spent against it. Treat the request shapes below (Brave endpoint/params, Claude
// message envelope) as best-effort-to-spec, to be validated on first live run. See
// docs/VERIFY_CONCURRENCE.md.
//
// Design, two steps (mirrors perplexity-twostep's split, different vendors):
//   step 1 — evidence gathering: Brave Web Search returns high-trust-steered results; we
//            build a numbered evidence block from titles/descriptions + collect the URLs as
//            citations. Brave does the searching; it renders no verdict.
//   step 2 — verdict commitment: one Anthropic Messages call (claude-opus-4-8, adaptive
//            thinking) judges the claim against ONLY that evidence block and emits the same
//            compact JSON the perplexity adapters do (verdict/correction/confidence/
//            source_name). All citations come from step 1; step 2 gets no search.
//
// Editorial policy still lives ABOVE this interface (D5): core ranks citations, whitelists
// the verdict, cleans the correction. This adapter returns raw material only.
import { UpstreamError } from "../../../core/errors.js";

export const name = "brave-claude";

const CLAUDE_MODEL = "claude-opus-4-8";

// Brave Web Search endpoint. `result_filter=web` keeps the payload to organic web results;
// the low-trust steer is a prompt-level instruction to Claude in step 2 (Brave's own
// filtering surface is coarse) PLUS core's trust ranking (D5) — an adapter cannot weaken
// what airs, so exhaustive server-side blocking here is not load-bearing.
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_RESULT_COUNT = 10;

// Step-2 system prompt — verdict against ONLY the Brave evidence block, same verdict
// vocabulary + JSON envelope the editorial layer expects. Named export so tests can assert
// the wire payload verbatim (R14 pattern, cf. perplexity-twostep's VERDICT_PROMPT and the
// extractor's FALLBACK_PROMPT). Rules mirror the two-step verdict discipline: commit
// True/False on settled evidence, hold mid-tier only on genuine conflict/incompleteness,
// verdict must agree with its own correction, and a definitive verdict must rest on named
// evidence lines or become Unverifiable (the confident-wrong guard).
export const VERDICT_PROMPT = 'You are the verdict stage of a live TV fact-checking pipeline. You will receive a claim and an evidence block gathered by a separate web-search stage (Brave Search). Judge the claim against ONLY that evidence block: you have no search access and must not introduce facts that are not in it. Weigh the sources an average American would trust — major wire services (AP, Reuters), national newspapers and broadcasters (New York Times, Wall Street Journal, Washington Post, BBC, NPR, PBS, ABC, CBS, NBC, CNN), U.S. government agencies and official statistics (.gov, e.g. Bureau of Labor Statistics, Census Bureau, CDC, Federal Reserve), reputable encyclopedias (Britannica), peer-reviewed science, and established fact-checkers (PolitiFact, FactCheck.org, Snopes) — and disregard social media, forums (Reddit, Quora), personal blogs, and commercial/SEO pages. Decision rules, in order: (1) If the block is NO_EVIDENCE or nothing in it bears on the claim, the verdict is Unverifiable. (2) If every evidence line that bears on the claim points the same way and is specific enough to settle it, you MUST commit to a definitive verdict: True if the lines confirm the claim as stated, False if they contradict it. Softening a settled verdict to NeedsContext or Misleading is a failure. (3) Misleading only when the evidence shows the claim uses true elements to create a false impression (cherry-picked baseline, misattributed cause, technically-true framing). (4) NeedsContext only when the claim is true or partly true but the evidence shows it is materially incomplete, or when evidence lines genuinely conflict with each other. (5) Your verdict must agree with your own correction sentence: if your correction contradicts the claim, the verdict cannot be True; if it supports the claim as stated, the verdict cannot be False. (6) evidence_lines must list the line IDs your verdict rests on; a True or False verdict you cannot support with specific line IDs is invalid — return Unverifiable instead. Respond with ONLY a compact JSON object, no prose, no code fences: {"verdict":"True|False|Misleading|Unverifiable|NeedsContext","correction":"one concise sentence with the accurate figure/fact, drawn from the evidence lines","confidence":0.0-1.0,"source_name":"the most authoritative outlet named in the evidence lines, e.g. Reuters","evidence_lines":["E1","E3"]}';

// R50 polarity fold-in: when the caller provides `ctx.utterance` (the speaker's raw
// words), the SAME step-2 Claude call also emits its own independent polarity read as one
// extra JSON field — no additional API call, no latency cost. Appended to VERDICT_PROMPT
// only when an utterance is present, so the no-context wire payload stays byte-identical.
// Named export so tests can assert the payload verbatim (R14).
export const POLARITY_ADDENDUM = ' Additional field: the user message may include a "Speaker said:" line carrying the speaker\'s raw words. When it does, add one more key to your JSON object: "speaker_polarity" — "asserts" if the speaker is stating the referenced factual proposition as true, "denies" if the speaker is stating it as false (an explicit denial like "never said" / "did not" / "that\'s not true", or a plain negative statement whose whole point is that the positive proposition does not hold). Judge speaker_polarity ONLY from the speaker\'s own words — not from the evidence block, and not from whether the claim is actually true.';

// ---- step 1: Brave Web Search ------------------------------------------------------------
// BYOK (D13/R8): per-call credential, resolved at header-construction time on EVERY call.
// NEVER via env mutation — that races across concurrent invocations in a warm lambda
// (test/verifier-brave-claude.test.js enforces both per-call scoping and, statically, the
// absence of env writes).
async function braveSearch(claim, credentials) {
  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(claim)}&count=${BRAVE_RESULT_COUNT}&result_filter=web`;
  const r = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": credentials?.braveKey || process.env.BRAVE_API_KEY,
    },
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    console.error("verify brave-claude search upstream error", r.status, detail);
    throw new UpstreamError("verify failed", { status: r.status, detail });
  }
  return r.json();
}

// ---- step 2: Anthropic Messages verdict --------------------------------------------------
// One claude-opus-4-8 call, adaptive thinking (per the claude-api guidance for anything
// non-trivial), judging ONLY the evidence block. Per-call credential (R8).
async function claudeVerdict(claim, evidenceBlock, credentials, utterance = "") {
  const system = utterance ? VERDICT_PROMPT + POLARITY_ADDENDUM : VERDICT_PROMPT;
  const user = utterance
    ? `Claim: ${claim}\n\nSpeaker said: ${utterance}\n\nEvidence block:\n${evidenceBlock}`
    : `Claim: ${claim}\n\nEvidence block:\n${evidenceBlock}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": credentials?.anthropicKey || process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    console.error("verify brave-claude verdict upstream error", r.status, detail);
    throw new UpstreamError("verify failed", { status: r.status, detail });
  }
  return r.json();
}

// Turn Brave's web results into a numbered evidence block + the raw citation URL list.
// Each line: `E<n>: <title> — <description>` (both cleaned of whitespace). Empty results
// degrade to the NO_EVIDENCE sentinel so step 2's rule (1) can fire.
function buildEvidence(braveJson) {
  const results = (braveJson?.web?.results || []).filter((x) => x && (x.title || x.description || x.url));
  const citations = results.map((x) => x.url).filter(Boolean);
  if (!results.length) return { evidenceBlock: "NO_EVIDENCE", citations };
  const lines = results.map((x, i) => {
    const title = String(x.title || "").replace(/\s+/g, " ").trim();
    const desc = String(x.description || "").replace(/\s+/g, " ").trim();
    const body = [title, desc].filter(Boolean).join(" — ");
    return `E${i + 1}: ${body}`;
  });
  return { evidenceBlock: lines.join("\n"), citations };
}

// Pull the Anthropic response text out of the content array (text blocks only — adaptive
// thinking blocks carry no `text`). Mirrors the extractor's j.content[0].text handling but
// concatenates every text block so a leading thinking block can't hide the answer.
function anthropicText(j) {
  const blocks = Array.isArray(j?.content) ? j.content : [];
  return blocks.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("").trim();
}

/** @type {import("../../../core/interfaces/verifier.js").Verifier["verify"]} */
export async function verify(claim, ctx = {}, credentials = null) {
  // R50 additive context: the raw utterance, when the route passes it. Optional — absent
  // (or an empty ctx) reproduces the pre-R50 behavior byte-for-byte.
  const utterance = typeof ctx?.utterance === "string" ? ctx.utterance.trim() : "";

  // step 1 — evidence gathering (Brave). All citations come from here.
  const brave = await braveSearch(claim, credentials);
  const { evidenceBlock, citations } = buildEvidence(brave);

  // step 2 — verdict commitment (Claude), judging ONLY the gathered evidence. With an
  // utterance present, the same call also emits its independent speaker-polarity read.
  const vd = await claudeVerdict(claim, evidenceBlock, credentials, utterance);
  const content = anthropicText(vd);
  let parsed = {};
  try { parsed = JSON.parse(content.replace(/```json/gi, "").replace(/```/g, "").trim()); } catch {}
  // raw + unfiltered, IDENTICAL shape to the perplexity adapters: core applies verdict
  // whitelisting, markdown cleanup, trust ranking (D5).
  const out = { verdict: parsed.verdict, correction: parsed.correction, confidence: parsed.confidence, sourceName: parsed.source_name, citations, raw: content };
  if (utterance) {
    // Additive (R50): strict normalization — anything but the two literals is null ("no
    // read"), mirroring the fail-safe posture of src/core/polarity-signal.js.
    const sp = typeof parsed.speaker_polarity === "string" ? parsed.speaker_polarity.trim().toLowerCase() : "";
    out.independent_polarity = sp === "asserts" || sp === "denies" ? sp : null;
  }
  return out;
}
