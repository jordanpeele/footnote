// ClaimExtractor adapter: Claude Haiku via the Anthropic Messages API. Extracts the atomic
// checkable claim from a spoken sentence — plus polarity ("asserts"|"denies") and
// harm_class ("none"|"person_public"|"person_private"|"quote_attribution") — or null claim
// (filler/opinion/question). Prompt v2 asks for strict one-line JSON; the parser below
// tolerates fences/stray text/single quotes and NEVER loses a claim to malformed JSON.
// Implements src/core/interfaces/claim-extractor.js (fields additive on the v1 shape).
import fs from "node:fs";
import path from "node:path";
import { UpstreamError } from "../../../core/errors.js";

const HAIKU = "claude-haiku-4-5-20251001";

const POLARITIES = new Set(["asserts", "denies"]);
const HARM_CLASSES = new Set(["none", "person_public", "person_private", "quote_attribution"]);
// R57: closed topical set. Unknown/missing parses to "other", which is NOT in the pilot
// allowlist — a claim the model can't categorize is structurally unable to auto-air.
const CATEGORIES = new Set(["science_health", "politics_government", "economics_business", "history_geography", "sports_culture", "other"]);

// The system prompt lives in prompts/extractor.md (versioned, human-readable); the inlined
// copy below is a belt-and-braces fallback so a Vercel bundling miss (fs reads aren't
// traced — vercel.json includeFiles handles it) can never break production. Keep in sync
// verbatim with the .md BODY (the leading <!-- version comment --> is stripped on load).
// Exported ONLY so test/prompt-sync.test.js can byte-compare it against the .md (R14).
export const FALLBACK_PROMPT = `You extract the single checkable factual claim from a live speaker's sentence for a real-time TV fact-checker. A claim is CHECKABLE if it asserts OR denies something about the world that could be confirmed or refuted against authoritative sources. This includes statistics, dates, historical events, attributions/quotes, quantities — AND ALSO qualitative, comparative, or superlative factual assertions (e.g. 'gold is worth more than silver', 'the Nile is the longest river', 'the company laid off thousands of workers', 'crime is up this year'). When in doubt, EXTRACT the claim rather than replying NONE.

If there is a checkable claim, reply with EXACTLY one line of strict JSON in this shape: {"claim": "...", "polarity": "asserts", "harm_class": "none", "category": "other"}

Field rules:
- "claim": the claim rewritten as one short, self-contained ASSERTIVE declarative sentence (drop filler/preamble like 'let's fact-check this'). The claim must always state the positive proposition, even when the speaker is denying it: if the speaker says 'Einstein never said X' or 'unemployment did NOT go up last month', the claim is 'Einstein said X' / 'Unemployment went up last month'. Never put 'not', 'never', 'no', or 'did not' into the claim when the speaker's point IS the denial — the denial is recorded in "polarity" instead. Never pre-judge whether the claim is actually true, and never add a negation the speaker did not say: a speaker asserting 'Einstein said X' yields the claim 'Einstein said X' with polarity "asserts", even if you believe the quote is misattributed.
- "polarity": "asserts" if the speaker is claiming the proposition is true; "denies" if the speaker is claiming the proposition is false ('never said', 'did not', 'that's not true', 'there's no way that happened'). A plain negative fact stated by the speaker ('Nixon didn't finish his second term') is the positive claim ('Nixon finished his second term') with polarity "denies". Resolve double negatives to their net meaning: 'it's not true that Einstein never won a Nobel Prize' means the speaker is asserting 'Einstein won a Nobel Prize', so polarity is "asserts".
- "harm_class": exactly one of "quote_attribution", "person_private", "person_public", "none". Use "quote_attribution" when the claim attributes specific words, a quote, or a statement to a named person ('X said/claims/wrote/tweeted ...') — this wins whenever it applies. Use "person_private" when the claim is a factual claim about a named individual who is NOT a public figure (a neighbor, a coworker, a local person). Use "person_public" when the claim's subject is a named public figure (politician, celebrity, executive, historical figure) and no quote is attributed — this covers their biography, actions, achievements, and records ('Nixon finished his second term', 'Einstein won a Nobel Prize' are person_public, not none). Use "none" ONLY when no named individual person is the subject of the claim (statistics, events, geography, science, unnamed people, organizations).

- "category": exactly one of "science_health", "politics_government", "economics_business", "history_geography", "sports_culture", "other" — the claim's topical domain. "science_health": science, medicine, health, nutrition, biology, physics, technology-as-science. "politics_government": politicians, elections, laws, government actions, wars and geopolitics. "economics_business": prices, markets, companies, jobs, trade, money. "history_geography": historical events and figures, places, borders, dates of past events. "sports_culture": sports, entertainment, celebrities-as-performers, art, media. "other": anything that fits none of these. Pick the single best fit; when two apply, pick the one the claim is ABOUT (a law about healthcare funding is politics_government; a study about a drug is science_health).

Reply with exactly the single word NONE (no JSON) only when the sentence is pure personal opinion or preference, a question, a greeting, backchannel, or filler with no factual assertion at all. Output ONLY the one-line JSON object, OR the single word NONE — never add any explanation, reasoning, markdown, or code fences.`;

function loadPrompt() {
  // cwd covers Vercel (/var/task = project root), `vercel dev`, and `npm start` from the
  // repo root. No import.meta here: Vercel's builder transpiles traced files to CJS when
  // it feels like it, and import.meta is a hard syntax error there.
  for (const p of [
    path.join(process.cwd(), "prompts", "extractor.md"),
  ]) {
    try {
      // strip the leading <!-- version-stamp comment --> so only the prompt body is sent
      const s = fs.readFileSync(p, "utf8").replace(/^\s*<!--[\s\S]*?-->/, "").trim();
      if (s) return s;
    } catch {}
  }
  console.error("extractor prompt file missing — using inlined fallback");
  return FALLBACK_PROMPT;
}
const SYSTEM = loadPrompt();   // module scope: read once per cold start

// Robust NONE detection: the model occasionally returns "NONE <explanation>" despite
// instructions. A leading NONE token means "no claim" — but a genuine claim beginning
// "None of …" is preserved.
function isNoneText(s) {
  return !s || (/^none\b/i.test(s) && !/^none\s+of\b/i.test(s));
}

function stripQuotes(s) {
  // strip wrapping quotes only when the model quoted the WHOLE claim (both ends) — a
  // one-sided strip would unbalance claims with internal quotes ("Kennedy said 'ask not…'").
  const t = s.trim();
  const m = t.match(/^["“'']+([\s\S]*?)["”'']+$/);
  return (m ? m[1] : t).trim();
}

// Pull one string field out of near-JSON text, tolerating single OR double quotes around
// both key and value. Used only when strict JSON.parse fails.
function pluckField(src, key) {
  const m = src.match(new RegExp(`["']${key}["']\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`));
  if (!m) return null;
  const raw = m[1] !== undefined ? m[1] : m[2];
  try { return JSON.parse(`"${raw.replace(/"/g, '\\"')}"`); } catch { return raw; }
}

// Parse the model output into { claim, polarity, harm_class }. Tolerates code fences,
// leading/trailing prose, and single-quoted near-JSON. On ANY parse failure the whole
// trimmed output becomes a bare claim with polarity "asserts" / harm_class "none" — a
// malformed envelope must never crash the route or drop a real claim on live TV.
export function parseExtraction(raw) {
  let out = (raw || "").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (isNoneText(out)) return { claim: null };

  let fields = null;
  const start = out.indexOf("{"), end = out.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const cand = out.slice(start, end + 1);
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj === "object") fields = obj;
    } catch {
      // lenient rescue: field-by-field regex pluck (handles single quotes, trailing junk)
      const claim = pluckField(cand, "claim");
      if (claim !== null) fields = { claim, polarity: pluckField(cand, "polarity"), harm_class: pluckField(cand, "harm_class"), category: pluckField(cand, "category") };
    }
  }

  if (!fields) {
    // no recoverable JSON at all → treat the raw output as a v1-style bare claim
    // (category "other" — an unparseable envelope must never be pilot-eligible, R57)
    return { claim: stripQuotes(out), polarity: "asserts", harm_class: "none", category: "other" };
  }

  const claim = typeof fields.claim === "string" ? stripQuotes(fields.claim) : "";
  if (isNoneText(claim)) return { claim: null };

  // polarity: missing/empty → "asserts"; any other unknown value passes through so the
  // core applyPolarity tripwire flags it as a conflict (conservative: hold, don't guess).
  let polarity = typeof fields.polarity === "string" ? fields.polarity.trim().toLowerCase() : "";
  if (!polarity) polarity = "asserts";
  else if (!POLARITIES.has(polarity)) console.error("extract: unexpected polarity value", polarity);

  let harm_class = typeof fields.harm_class === "string" ? fields.harm_class.trim().toLowerCase() : "";
  if (!HARM_CLASSES.has(harm_class)) {
    if (harm_class) console.error("extract: unexpected harm_class value", harm_class);
    harm_class = "none";
  }

  // R57 category: strict allowlist parse — anything unexpected collapses to "other"
  // (fail-safe: "other" is never in the pilot allowlist, so it cannot arm auto-air).
  let category = typeof fields.category === "string" ? fields.category.trim().toLowerCase() : "";
  if (!CATEGORIES.has(category)) {
    if (category) console.error("extract: unexpected category value", category);
    category = "other";
  }

  return { claim, polarity, harm_class, category };
}

export const name = "anthropic-haiku";

/** @type {import("../../../core/interfaces/claim-extractor.js").ClaimExtractor["extract"]} */
export async function extract(text) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: HAIKU, max_tokens: 300, temperature: 0,   // 300: JSON envelope + long quote claims
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    console.error("extract upstream error", r.status, detail);
    throw new UpstreamError("extract failed", { status: r.status, detail });
  }
  const j = await r.json();
  return parseExtraction(j?.content?.[0]?.text || "");
}
