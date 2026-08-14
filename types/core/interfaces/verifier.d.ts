export type RawVerification = {
    /**
     * Vendor's verdict string, ideally one of core's VERDICTS. Core replaces anything
     * off-list with "Unverifiable".
     */
    verdict?: string;
    /**
     * One-sentence accurate figure/fact. May contain markdown; core strips it.
     */
    correction?: string;
    /**
     * 0..1. Core clamps; non-numbers become 0.5.
     */
    confidence?: number;
    /**
     * Vendor's own idea of the best source name. Only used as a last-resort display
     * fallback when no rankable citation survives the trust filter.
     */
    sourceName?: string;
    /**
     *   Every citation URL the vendor produced, unranked and unfiltered. Core ranks these by
     *   trust tier and picks the surfaced source.
     */
    citations: string[];
    /**
     * The vendor's raw text answer — fallback correction copy when parsing failed.
     */
    raw?: string;
    /**
     * ADDITIVE (R50). An adapter that received `ctx.utterance` MAY also return its own
     * independent read of the speaker's polarity — "asserts"/"denies", or null when it
     * could not tell. Absent when no utterance context was provided or the adapter doesn't
     * support it. Consumed by the concurrence meta-adapter (polarity disagreement downgrades
     * like verdict disagreement); core editorial ignores it.
     */
    independent_polarity?: ("asserts" | "denies" | null);
};
export type VerifierCredentials = {
    /**
     * Room-scoped Perplexity key. Absent/null → the adapter uses its env default.
     */
    perplexityKey?: string;
};
export type VerifyContext = {
    /**
     * The speaker's raw words, verbatim (what the extractor derived the claim from). An
     * adapter that can cheaply form its own polarity opinion from these words may return it
     * as `independent_polarity` on RawVerification.
     */
    utterance?: string;
    /**
     * The polarity the SHARED extractor claimed ("asserts"|"denies"|"suspect_denies").
     * Context only — the authoritative flip still happens above this interface in
     * api/verify.js via applyPolarity (D5/D11). Adapters must never flip their verdict on
     * it; concurrence uses it purely as a disagreement reference.
     */
    claimedPolarity?: string;
};
export type Verifier = {
    /**
     *   Stable adapter id (matches its registry key).
     */
    name: string;
    /**
     *   `claim` is one self-contained declarative sentence (non-empty; the route validates).
     *   `ctx` is optional per-call context (VerifyContext above) — adapters may ignore it, and
     *   an empty `{}` must behave exactly as the pre-R50 contract. `credentials` is the
     *   per-call BYOK key bundle described above — null/undefined means "use the adapter's own
     *   env-configured default key". NEVER resolve credentials through env mutation — R8.
     *   Adapters should steer their search toward high-trust sources where the vendor allows
     *   (domain filters, prompting), but must still return ALL citations — filtering and
     *   ranking is core's call, not theirs.
     */
    verify: (claim: string, ctx?: VerifyContext, credentials?: VerifierCredentials | null) => Promise<RawVerification>;
};
/**
 * Raw, vendor-shaped verification result — BEFORE editorial policy is applied.
 * Fields come straight from the vendor and may be missing/malformed; core normalizes.
 * @typedef {Object} RawVerification
 * @property {string} [verdict]
 *   Vendor's verdict string, ideally one of core's VERDICTS. Core replaces anything
 *   off-list with "Unverifiable".
 * @property {string} [correction]
 *   One-sentence accurate figure/fact. May contain markdown; core strips it.
 * @property {number} [confidence]
 *   0..1. Core clamps; non-numbers become 0.5.
 * @property {string} [sourceName]
 *   Vendor's own idea of the best source name. Only used as a last-resort display
 *   fallback when no rankable citation survives the trust filter.
 * @property {string[]} citations
 *   Every citation URL the vendor produced, unranked and unfiltered. Core ranks these by
 *   trust tier and picks the surfaced source.
 * @property {string} [raw]
 *   The vendor's raw text answer — fallback correction copy when parsing failed.
 * @property {("asserts"|"denies"|null)} [independent_polarity]
 *   ADDITIVE (R50). An adapter that received `ctx.utterance` MAY also return its own
 *   independent read of the speaker's polarity — "asserts"/"denies", or null when it
 *   could not tell. Absent when no utterance context was provided or the adapter doesn't
 *   support it. Consumed by the concurrence meta-adapter (polarity disagreement downgrades
 *   like verdict disagreement); core editorial ignores it.
 */
/**
 * Per-call credentials for a single verify() invocation (BYOK, Decision D13).
 * CONTRACT (R8): credentials are PER-CALL function arguments, full stop. An adapter must
 * resolve them at request-construction time (`credentials?.perplexityKey || env default`)
 * and must NEVER write to process.env to "install" a caller's key — env mutation is
 * instance-global on a warm lambda, so two concurrent invocations would race and one
 * user's key could sign another user's traffic. Env mutation as a credential mechanism
 * is permanently banned (test/credentials.test.js statically enforces this).
 * @typedef {Object} VerifierCredentials
 * @property {string} [perplexityKey]
 *   Room-scoped Perplexity key. Absent/null → the adapter uses its env default.
 */
/**
 * ADDITIVE, OPTIONAL per-call context (R50). The route populates it when the client sent
 * the raw utterance alongside the claim; every field is optional and ADAPTERS MAY IGNORE
 * the whole object — passing `{}` (or nothing) must always behave exactly as before.
 * @typedef {Object} VerifyContext
 * @property {string} [utterance]
 *   The speaker's raw words, verbatim (what the extractor derived the claim from). An
 *   adapter that can cheaply form its own polarity opinion from these words may return it
 *   as `independent_polarity` on RawVerification.
 * @property {string} [claimedPolarity]
 *   The polarity the SHARED extractor claimed ("asserts"|"denies"|"suspect_denies").
 *   Context only — the authoritative flip still happens above this interface in
 *   api/verify.js via applyPolarity (D5/D11). Adapters must never flip their verdict on
 *   it; concurrence uses it purely as a disagreement reference.
 */
/**
 * @typedef {Object} Verifier
 * @property {string} name
 *   Stable adapter id (matches its registry key).
 * @property {(claim: string, ctx?: VerifyContext, credentials?: VerifierCredentials | null) => Promise<RawVerification>} verify
 *   `claim` is one self-contained declarative sentence (non-empty; the route validates).
 *   `ctx` is optional per-call context (VerifyContext above) — adapters may ignore it, and
 *   an empty `{}` must behave exactly as the pre-R50 contract. `credentials` is the
 *   per-call BYOK key bundle described above — null/undefined means "use the adapter's own
 *   env-configured default key". NEVER resolve credentials through env mutation — R8.
 *   Adapters should steer their search toward high-trust sources where the vendor allows
 *   (domain filters, prompting), but must still return ALL citations — filtering and
 *   ranking is core's call, not theirs.
 */
export {};
