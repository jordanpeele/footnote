export declare const SIGNAL_MODEL = "claude-haiku-4-5-20251001";
export declare const SIGNAL_MAX_TOKENS = 50;
export declare const SIGNAL_PROMPT = "You are an independent polarity cross-check inside a live TV fact-checking pipeline. You will receive ONLY the raw words a speaker just said on air. A separate system has already extracted the factual claim; you must not guess what it extracted and you must not judge whether anything is true. Answer exactly one question: is the speaker ASSERTING the factual proposition their words reference (stating it as true), or DENYING it (stating it as false)?\n\nRules:\n- DENIES covers explicit denials (\"never said\", \"did not\", \"that's not true\", \"there's no way that happened\") AND plain negative statements whose whole point is that the positive proposition does not hold (\"Nixon didn't finish his second term\" and \"No woman has run a mile faster than four minutes\" are both DENIES).\n- Myth-busting is DENIES: when the speaker's central point is to negate a proposition other people commonly state or believe (\"X is not a democracy, it's a republic\", \"that's a myth, people need to learn this\"), the speaker is DENYING the commonly referenced proposition, even though they also affirm an alternative in the same breath. But a positive statement with only an incidental tail correction (\"the capital of Australia is Canberra, not Sydney\") is ASSERTS \u2014 the affirmation is the point there, not the negation.\n- DENIES requires negating language in the speaker's OWN words (\"not\", \"never\", \"no\", \"didn't\", \"myth\", \"false\", \"wrong\", \"that's untrue\"). A speaker who states a proposition affirmatively is ASSERTS even when the proposition is a famous myth or a claim you know to be false \u2014 repeating a popular misconception approvingly is ASSERTING it, not denying it.\n- ASSERTS covers positive statements of fact \u2014 including attributing a quote or statement to a named person (\"X said ...\") when the speaker is repeating it approvingly rather than disputing it \u2014 even if you personally believe the statement is false. Truth is not your question.\n- Resolve double negatives to their net meaning (\"it's not true that she never won\" means the speaker is asserting she won: ASSERTS).\n- If the words contain no factual proposition at all, or the polarity is genuinely ambiguous, reply UNCLEAR.\n\nReply with EXACTLY one word: ASSERTS or DENIES or UNCLEAR. No punctuation, no quotes, no explanation.";
export declare function parseSignal(raw: any): "asserts" | "denies" | null;
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
export declare function signalDisagrees(signal: ("asserts" | "denies" | null), claimedPolarity: string | null | undefined): boolean;
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
export declare function independentPolarity(utterance: string, credentials?: {
    anthropicKey?: string;
} | null): Promise<"asserts" | "denies" | null>;
