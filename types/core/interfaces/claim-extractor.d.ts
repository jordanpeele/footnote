export type ClaimExtractor = {
    /**
     *   Stable adapter id (matches its registry key).
     */
    name: string;
    /**
     *   `text` is a raw transcript sentence (already trimmed + length-gated by the route).
     *   Resolve `{claim}` with one short self-contained declarative sentence, or `{claim: null}`
     *   when nothing is checkable. The adapter owns vendor quirks (quote stripping, "NONE"
     *   detection, prompt loading) — callers only ever see the clean claim-or-null shape.
     */
    extract: (text: string) => Promise<{
        claim: string | null;
    }>;
};
/**
 * @typedef {Object} ClaimExtractor
 * @property {string} name
 *   Stable adapter id (matches its registry key).
 * @property {(text: string) => Promise<{claim: string|null}>} extract
 *   `text` is a raw transcript sentence (already trimmed + length-gated by the route).
 *   Resolve `{claim}` with one short self-contained declarative sentence, or `{claim: null}`
 *   when nothing is checkable. The adapter owns vendor quirks (quote stripping, "NONE"
 *   detection, prompt loading) — callers only ever see the clean claim-or-null shape.
 */
export {};
