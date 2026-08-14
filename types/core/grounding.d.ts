/**
 * Decide whether an extracted claim is grounded in the utterance it was extracted from.
 * @param {string} claim - the extractor's canonicalized claim
 * @param {string} utterance - the transcript text sent to the extractor
 * @returns {{ok: boolean, reason?: string}}
 */
export declare function groundedClaim(claim: string, utterance: string): {
    ok: boolean;
    reason?: string;
};
