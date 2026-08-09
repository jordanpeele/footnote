// ClaimExtractor stub — the minimal shape a contributor implements (see
// src/core/interfaces/claim-extractor.js). No network, no keys; deterministic enough for
// offline dev: FOOTNOTE_EXTRACTOR=stub treats every sentence as its own claim.
export const name = "stub";

/** @type {import("../../../core/interfaces/claim-extractor.js").ClaimExtractor["extract"]} */
export async function extract(text) {
  // A real adapter calls its vendor here and returns { claim: string } or { claim: null };
  // throw UpstreamError (src/core/errors.js) on a non-2xx vendor response.
  return { claim: text.trim() || null };
}
