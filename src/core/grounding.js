// Footnote grounding gate (P4-F1). Speech is adversarial input (Decision D8), and the
// extractor is an LLM: in the 2026-08-08 field test it 4x returned its own assistant
// preamble ("I'm ready to extract checkable claims...") as the "claim" when the speaker
// talked ABOUT claims. This module sits in core, above the ClaimExtractor interface, and
// rejects any extraction that is not grounded in what the speaker actually said — so no
// vendor adapter (or induced prompt echo) can push its own words into the operator queue.
//
// TUNING RATIONALE — calibrated against eval/golden/drafts-2026-08-08-fieldtest.jsonl
// (51 real field-test pairs: 47 legitimate, 4 prompt echoes):
//
// 1. Assistant-voice patterns (reject): text that addresses the extraction TASK rather
//    than stating a fact about the world. All 4 real echoes open with "I'm ready" and use
//    task jargon ("checkable claim", "please provide", "speaker's sentence", "JSON
//    object") that has ~zero probability of appearing inside a canonicalized third-person
//    factual claim. Each pattern is kept narrow (e.g. "extract a checkable claim", not
//    bare "extract...claim") so a real claim like "oil extraction increased insurance
//    claims" cannot trip it.
//
// 2. Number grounding (reject): every numeric token in the claim must appear in the
//    utterance. A number the speaker never said is the single strongest ungrounded
//    signal — the extractor canonicalizes wording but never invents figures. Spelled-out
//    numbers in the utterance ("five percent") are mapped to numerals before comparison
//    because ASR formatting varies; commas/percent/currency are normalized away.
//
// 3. Lexical overlap (reject only when < 1/3): content words (length ≥ 4, lowercased,
//    punctuation split, light plural/possessive stemming) of the claim must overlap the
//    utterance's. Every legitimate pair in the drafts file scores 1.0 while the 4 echoes
//    score ≈ 0, so the threshold has a huge margin — it is set LOW (1/3, and only when
//    the claim has ≥ 3 content words) deliberately: the extractor legitimately rewrites
//    ("The CEO of McDonald's is..." reorderings), expands pronouns/acronyms into proper
//    nouns the speaker never uttered ("he" → "Emmanuel Macron", "AOC" → "Alexandria
//    Ocasio-Cortez"), and substitutes "the United States" for "The US" (handled by an
//    explicit alias so it doesn't eat into the margin). A false rejection silently drops
//    a real claim on air, so when uncertain we allow — the overlap rule is a backstop for
//    non-templated hallucinations, not the primary defense. For the same reason there is
//    NO hard proper-noun rule: pronoun expansion makes "proper noun absent from
//    utterance" a legitimate outcome, so proper nouns are only counted as ordinary
//    content words.

// Patterns of task-addressing / assistant-voice text. Narrow by design; see rationale 1.
const ASSISTANT_VOICE = [
  /\bi'?m ready\b/i,
  /\bplease provide\b/i,
  /\bas an ai\b/i,
  /\bspeaker'?s (?:sentence|statement|message)\b/i,
  /\bextract (?:a |the )?(?:single |checkable |factual )*claims?\b/i,
  /\bcheckable (?:factual )?claims?\b/i,
  /\byour message\b/i,
  /\bi (?:don'?t|do not|cannot|can'?t) see\b/i,
  /\bjson object\b/i,
  /\bthe word none\b/i,
  /\bi'?ll (?:extract|analyze|respond|return)\b/i,
];

// Spelled-number map for ASR variance ("five percent" grounds a claim's "5%").
const SPELLED = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);

/** @param {string} s */
function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")                 // 1,000 → 1000
    .replace(/\b(?:u\.?s\.?a?|usa)\b/g, "united states") // "The US"/"U.S." alias (rationale 3)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** numeric tokens of a token list, with spelled-out words (and tens+unit pairs) mapped in */
function numbersOf(tokens) {
  const nums = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) { nums.add(String(Number(t))); continue; }
    if (t in SPELLED) {
      let v = SPELLED[t];
      // "twenty five" → 25 (also keep 20 and 5 individually; extra grounding never hurts)
      if (TENS.has(v) && tokens[i + 1] in SPELLED && SPELLED[tokens[i + 1]] < 10) {
        nums.add(String(v + SPELLED[tokens[i + 1]]));
      }
      nums.add(String(v));
    }
  }
  return nums;
}

/** content words: length ≥ 4, non-numeric */
function contentWords(tokens) {
  return tokens.filter((t) => t.length >= 4 && !/\d/.test(t));
}

/** light stemming for the match only: exact, or plural/possessive-s apart */
function inSet(word, set) {
  if (set.has(word)) return true;
  if (set.has(word + "s") || set.has(word + "es")) return true;
  if (word.endsWith("es") && set.has(word.slice(0, -2))) return true;
  if (word.endsWith("s") && set.has(word.slice(0, -1))) return true;
  return false;
}

/**
 * Decide whether an extracted claim is grounded in the utterance it was extracted from.
 * @param {string} claim - the extractor's canonicalized claim
 * @param {string} utterance - the transcript text sent to the extractor
 * @returns {{ok: boolean, reason?: string}}
 */
export function groundedClaim(claim, utterance) {
  const c = String(claim || "").trim();
  if (!c) return { ok: false, reason: "empty-claim" };

  for (const re of ASSISTANT_VOICE) {
    if (re.test(c)) return { ok: false, reason: `assistant-voice:${re.source}` };
  }

  const cTokens = tokenize(c);
  const uTokens = tokenize(utterance);

  const uNums = numbersOf(uTokens);
  for (const n of numbersOf(cTokens)) {
    if (!uNums.has(n)) return { ok: false, reason: `ungrounded-number:${n}` };
  }

  const cWords = contentWords(cTokens);
  if (cWords.length >= 3) {
    const uSet = new Set(contentWords(uTokens));
    const hits = cWords.filter((w) => inSet(w, uSet)).length;
    if (hits / cWords.length < 1 / 3) {
      return { ok: false, reason: `low-overlap:${hits}/${cWords.length}` };
    }
  }
  return { ok: true };
}
