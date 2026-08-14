declare const DUP_CLAIM_WINDOW_MS = 60000;
declare const MERGE_MAX_GAP_MS = 3500;
declare const MERGE_SHORT_WORDS = 4;
declare const ASSEMBLE_SILENCE_MS = 3600;
declare const ASSEMBLE_MAX_FINALS = 6;
declare const WINDOW_WORDS = 30;
declare const WINDOW_MIN_NEW_WORDS = 3;
declare const WINDOW_EXTRACT_MS = 3500;
declare const WINDOW_TRAIL_SILENCE_MS = 1500;
/**
 * Canonical claim key for dedupe: lowercase, punctuation stripped, whitespace collapsed.
 * @param {string|null|undefined} claim extracted claim text
 * @returns {string} normalized key ("" for empty/nullish input)
 */
declare function normalizeClaim(claim: string | null | undefined): string;
/**
 * F2 — is a claim first carded at `createdAt` still a duplicate at `nowAt`?
 * @param {number|null|undefined} createdAt epoch ms of the prior card's creation, if any
 * @param {number} nowAt epoch ms of the would-be new card
 * @returns {boolean} true → drop the new card as a duplicate
 */
declare function withinDupWindow(createdAt: number | null | undefined, nowAt: number): boolean;
/**
 * F3 — should two consecutive STT finals ALSO be checked as one joined utterance?
 * True when they arrived close together AND the boundary looks like a split thought:
 * the earlier final didn't end in sentence-terminal punctuation, or the later one is a
 * short fragment ("Was 4%.").
 * @param {string|null|undefined} prev earlier final transcript
 * @param {number} prevAt epoch ms the earlier final arrived
 * @param {string|null|undefined} next later final transcript
 * @param {number} nowAt epoch ms the later final arrived
 * @returns {boolean} true → also run the joined check
 */
declare function shouldMergeFinals(prev: string | null | undefined, prevAt: number, next: string | null | undefined, nowAt: number): boolean;
/**
 * W1.2 (walkable-rig sprint) — rolling final-assembler flush predicate. Session 2's
 * routed/bonded audio made Deepgram finalize at micro-gaps, shredding one spoken claim
 * across 2-5 finals; the pair-join (shouldMergeFinals, retained above for reference and
 * tests but no longer called by the client) couldn't reconstruct them — splits arrived
 * pre-punctuated, and pairs aren't enough. The assembler buffers consecutive finals and
 * flushes the JOINED utterance when the thought actually ends.
 * Flush when: the buffer hit the cap, OR real silence has passed since the last final.
 * @param {number} count finals currently buffered
 * @param {number} lastAt epoch ms of the newest buffered final
 * @param {number} nowAt epoch ms now
 * @returns {boolean} true → flush (join + check as merged when count >= 2)
 */
declare function assemblyShouldFlush(count: number, lastAt: number, nowAt: number): boolean;
/**
 * W1.3 (run-test 2026-08-14) — rolling-WINDOW extraction predicate. The run proved the
 * final is not a unit of meaning: 244 finals, median ONE word, 73% of spoken words never
 * reached a check. The window frame: keep a running transcript of the last ~N words and
 * extract claims from the WINDOW on a cadence, letting F2 dedupe absorb the overlap and
 * the grounding gate reject anything not actually said. Supersedes the final-assembler
 * (whose wiring is retired; predicate retained above for reference/tests).
 * Extract when: enough NEW words arrived since the last extract AND (the newest final
 * ended a sentence, OR the cadence interval elapsed, OR real silence set in).
 * @param {number} newWords words arrived since the last window extract
 * @param {number} msSinceExtract ms since the last window extract
 * @param {number} msSinceLastWord ms since the newest word arrived
 * @param {boolean} endsTerminal newest final ended with . ! or ?
 * @returns {boolean} true → extract the window now
 */
declare function windowShouldExtract(newWords: number, msSinceExtract: number, msSinceLastWord: number, endsTerminal: boolean): boolean;
/**
 * D17 — pick the claim-bearing sentence from a (possibly filler-prefixed) utterance:
 * best content-word overlap with the canonical claim wins; whole utterance is the
 * fallback. Used to render the SPEAKER'S framing (denials keep their negation).
 * @param {string} spoken the utterance that produced the claim
 * @param {string} claim the canonical (positive-form) claim
 * @returns {string} the sentence to display
 */
/**
 * R46 — does the text contain an explicit negation token? Deterministic consistency
 * check for the polarity tripwire (extractor says "denies" but the speaker's words
 * carry no negation → the flip is suspect) and the D17 split-negation fallback.
 * @param {string} text
 * @returns {boolean}
 */
declare function hasNegation(text: string): boolean;
declare function pickSpokenSentence(spoken: any, claim: any, preferNegation: any): string;
export { DUP_CLAIM_WINDOW_MS, MERGE_MAX_GAP_MS, MERGE_SHORT_WORDS, ASSEMBLE_SILENCE_MS, ASSEMBLE_MAX_FINALS, WINDOW_WORDS, WINDOW_MIN_NEW_WORDS, WINDOW_EXTRACT_MS, WINDOW_TRAIL_SILENCE_MS, normalizeClaim, withinDupWindow, shouldMergeFinals, assemblyShouldFlush, windowShouldExtract, pickSpokenSentence, hasNegation };
