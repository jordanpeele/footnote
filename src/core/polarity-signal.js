// Footnote — independent polarity signal (R50, gap F-1 mirror class). Calibration #4
// measured the last unguarded polarity direction: the extractor labels a denial "asserts"
// (the MIRROR of FS-8), the flip never happens, and the card airs inverted — R46 cannot
// catch this direction (negation-present + asserts is riddled with false positives), and
// concurrence over VERIFIERS is structurally blind to it because the polarity field is
// emitted by the SHARED extractor upstream of both arms and the flip is applied above the
// Verifier interface (D5): both arms would confirm the same mirrored card.
//
// The guard is therefore a SECOND, INDEPENDENT reading of polarity: one cheap Haiku call
// that sees ONLY the speaker's raw words — a different prompt than the extractor, and no
// canonical claim shown — and answers a single question: is the speaker ASSERTING or
// DENYING the factual proposition they reference? api/verify.js runs it in PARALLEL with
// the verifier (zero added wall latency) and, when the signal disagrees with the
// extractor's claimed polarity, forces `polarity_conflict` — routing into the EXISTING
// hold machinery (never auto-airs per D4, ⚠ on /op, spoken framing per D17; R46's exact
// pattern, ruled by R50).
//
// FAIL-SAFE CONTRACT: this signal can only ever ADD a hold, never clear one, and it must
// never manufacture a hold out of its own failure. Any error — vendor non-2xx, network,
// malformed output, ambiguity — returns null, meaning "no signal": the pipeline behaves
// exactly as if the cross-check didn't exist. A dead signal is a no-op, not an outage.
// (Unlike the verifier adapters, this module deliberately does NOT throw UpstreamError —
// its whole error contract is "swallow and return null".)

export const SIGNAL_MODEL = "claude-haiku-4-5-20251001";
export const SIGNAL_MAX_TOKENS = 50;

// System prompt for the one-word polarity read. Deliberately DIFFERENT from the extractor
// prompt (prompts/extractor.md) — an independent signal must not share the failure modes
// of the instrument it cross-checks — but it encodes the SAME polarity convention the
// pipeline uses (src/core/polarity.js): a plain negative statement counts as DENYING the
// positive proposition, and double negatives resolve to net meaning. Exported so tests can
// assert the wire payload verbatim (R14 pattern).
export const SIGNAL_PROMPT = `You are an independent polarity cross-check inside a live TV fact-checking pipeline. You will receive ONLY the raw words a speaker just said on air. A separate system has already extracted the factual claim; you must not guess what it extracted and you must not judge whether anything is true. Answer exactly one question: is the speaker ASSERTING the factual proposition their words reference (stating it as true), or DENYING it (stating it as false)?

Rules:
- DENIES covers explicit denials ("never said", "did not", "that's not true", "there's no way that happened") AND plain negative statements whose whole point is that the positive proposition does not hold ("Nixon didn't finish his second term" and "No woman has run a mile faster than four minutes" are both DENIES).
- Myth-busting is DENIES: when the speaker's central point is to negate a proposition other people commonly state or believe ("X is not a democracy, it's a republic", "that's a myth, people need to learn this"), the speaker is DENYING the commonly referenced proposition, even though they also affirm an alternative in the same breath. But a positive statement with only an incidental tail correction ("the capital of Australia is Canberra, not Sydney") is ASSERTS — the affirmation is the point there, not the negation.
- DENIES requires negating language in the speaker's OWN words ("not", "never", "no", "didn't", "myth", "false", "wrong", "that's untrue"). A speaker who states a proposition affirmatively is ASSERTS even when the proposition is a famous myth or a claim you know to be false — repeating a popular misconception approvingly is ASSERTING it, not denying it.
- ASSERTS covers positive statements of fact — including attributing a quote or statement to a named person ("X said ...") when the speaker is repeating it approvingly rather than disputing it — even if you personally believe the statement is false. Truth is not your question.
- Resolve double negatives to their net meaning ("it's not true that she never won" means the speaker is asserting she won: ASSERTS).
- If the words contain no factual proposition at all, or the polarity is genuinely ambiguous, reply UNCLEAR.

Reply with EXACTLY one word: ASSERTS or DENIES or UNCLEAR. No punctuation, no quotes, no explanation.`;

// Strict output parsing: exactly one recognized word (case-insensitive, tolerating only
// surrounding whitespace and trailing sentence punctuation). Anything else — UNCLEAR,
// prose, an explained answer, an empty body — is null. Strictness IS the fail-safe: a
// signal we cannot read verbatim is a signal we do not have.
export function parseSignal(raw) {
  const s = String(raw ?? "").trim().replace(/[.!]+$/, "").toLowerCase();
  if (s === "asserts") return "asserts";
  if (s === "denies") return "denies";
  return null;
}

/**
 * Compare the independent signal against the extractor's claimed polarity.
 * `suspect_denies` (the R46 rewrite) normalizes to "denies" for comparison; absent claimed
 * polarity means "asserts" (the applyPolarity convention). Returns true only when a real,
 * readable signal contradicts a well-formed claimed polarity — a null signal never
 * disagrees (fail-safe), and a malformed claimed value never disagrees either, because
 * applyPolarity already forces the conflict hold for those on its own.
 * @param {("asserts"|"denies"|null)} signal
 * @param {string|null|undefined} claimedPolarity
 * @returns {boolean}
 */
export function signalDisagrees(signal, claimedPolarity) {
  if (signal !== "asserts" && signal !== "denies") return false;
  let claimed = claimedPolarity == null ? "asserts" : String(claimedPolarity).trim().toLowerCase();
  if (claimed === "") claimed = "asserts";
  if (claimed === "suspect_denies") claimed = "denies";
  if (claimed !== "asserts" && claimed !== "denies") return false;   // applyPolarity's tripwire owns this
  return signal !== claimed;
}

/**
 * One cheap, independent Haiku read of the speaker's polarity. Reads ONLY the raw
 * utterance — never the canonical claim (independence from the extractor is the point).
 * Credentials are per-call (R8): `credentials?.anthropicKey || env`; NEVER env mutation.
 *
 * @param {string} utterance   The speaker's raw words, verbatim.
 * @param {{anthropicKey?: string}|null} [credentials]
 * @returns {Promise<"asserts"|"denies"|null>}  null = no signal (error/ambiguity/empty).
 *   NEVER throws, NEVER returns a forced hold — null must always mean "behave as if this
 *   module didn't exist".
 */
export async function independentPolarity(utterance, credentials = null) {
  const text = typeof utterance === "string" ? utterance.trim() : "";
  if (!text) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": credentials?.anthropicKey || process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: SIGNAL_MODEL,
        max_tokens: SIGNAL_MAX_TOKENS,
        temperature: 0,
        system: SIGNAL_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!r.ok) {
      const detail = (await r.text().catch(() => "")).slice(0, 200);
      console.warn("polarity signal upstream non-2xx (fail-safe null)", r.status, detail);
      return null;
    }
    const j = await r.json();
    const out = (Array.isArray(j?.content) ? j.content : [])
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text).join("").trim();
    return parseSignal(out);
  } catch (e) {
    console.warn("polarity signal error (fail-safe null)", e && e.message);
    return null;
  }
}
