/**
 * @param {"extractor"|"verifier"|"stt"|"state"} domain
 * @returns {*} the active adapter module for that domain
 */
export declare function getAdapter(domain: "extractor" | "verifier" | "stt" | "state"): any;
/**
 * Resolve a verifier adapter by its registry key, WITHOUT consulting FOOTNOTE_VERIFIER.
 * Used by the concurrence meta-verifier (src/adapters/verifier/concurrence/) to compose its
 * two configured sub-verifiers (FOOTNOTE_CONCURRENCE_A / _B) by name. Bypasses the stub
 * production guard on purpose — concurrence never defaults, and a caller opting into a stub
 * sub-verifier is an explicit dev/CI choice. Returns undefined for an unknown key so the
 * caller can throw a domain-specific error.
 * @param {string} nameKey
 * @returns {*} the verifier adapter module, or undefined
 */
export declare function getVerifierByName(nameKey: string): any;
