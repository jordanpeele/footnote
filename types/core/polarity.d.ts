/**
 * Map a verifier verdict on the canonical assertive claim to the verdict on what the
 * speaker actually said. Pure function; no I/O, no mutation.
 *
 * @param {string} verdict
 *   Verdict from the verifier ("True"|"False"|"Misleading"|"NeedsContext"|"Unverifiable").
 * @param {string|null|undefined} polarity
 *   "asserts" (or null/undefined/absent) → verdict unchanged. "denies" → True↔False
 *   flipped; Misleading/NeedsContext/Unverifiable unchanged. Any OTHER non-null value →
 *   verdict unchanged with conflict:true — the conservative tripwire; upstream holds
 *   conflicted cards instead of auto-airing them.
 * @returns {{verdict: string, conflict: boolean}}
 */
export declare function applyPolarity(verdict: string, polarity: string | null | undefined): {
    verdict: string;
    conflict: boolean;
};
