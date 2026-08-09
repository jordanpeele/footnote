// Verifier stub — the minimal shape a contributor implements (see
// src/core/interfaces/verifier.js). No network, no keys; FOOTNOTE_VERIFIER=stub returns a
// canned raw result so the full route → core-editorial → card path can run offline.
// Note what a verifier does NOT do: no trust ranking, no verdict whitelisting, no markdown
// stripping — that's core's job (src/core/editorial.js, Decision D5).
export const name = "stub";

/** @type {import("../../../core/interfaces/verifier.js").Verifier["verify"]} */
export async function verify(claim, _ctx = {}, _credentials = null) {
  // CREDENTIALS ARE PER-CALL (D13/R8). A real adapter resolves
  // `credentials?.perplexityKey || process.env.<ITS_ENV_KEY>` at request-header
  // construction time. NEVER resolve credentials through env mutation — process.env is
  // instance-global, so a swap-and-restore races across concurrent invocations and one
  // user's key could sign another user's traffic. Env mutation as a credential mechanism
  // is permanently banned; test/credentials.test.js enforces it statically.
  return {
    verdict: "Unverifiable",
    correction: `Stub verifier: no verification performed for "${claim.slice(0, 80)}".`,
    confidence: 0.5,
    sourceName: "Stub",
    citations: [],                 // raw, unranked vendor citations — core filters + ranks
    raw: "",
  };
}
