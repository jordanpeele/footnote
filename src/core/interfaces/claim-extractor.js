// ClaimExtractor — stage 1 of the Footnote pipeline. Takes one transcript window and pulls
// out every distinct atomic checkable claim (rapid-fire speech can pack several into one
// window), or none when nothing is checkable (filler, opinion, question, greeting).
// Fast + cheap; it gates the pricey verify stage.
//
// This repo is no-build plain JS: interfaces are JSDoc @typedefs, importable for docs and
// optional `tsc --checkJs` runs (jsconfig.json ships with checkJs OFF). Contracts are
// documentation + shape; they are enforced by adapter behavior, not a compiler gate.
//
// A ClaimExtractor adapter is an ES module (see src/adapters/extractor/_stub/) exporting:
//   name     — vendor id, e.g. "anthropic-haiku"
//   extract  — the one method below
//
// Error contract: throw `UpstreamError` (src/core/errors.js) when the vendor API responds
// non-2xx (carry status + truncated detail); let any other failure (network, JSON parse)
// throw as a plain Error. Routes map the two cases to distinct response bodies.

/**
 * @typedef {Object} ClaimExtractor
 * @property {string} name
 *   Stable adapter id (matches its registry key).
 * @property {(text: string) => Promise<{claim: string|null, claims?: Array<{claim: string, polarity?: string, harm_class?: string, category?: string}>}>} extract
 *   `text` is a raw transcript window (already trimmed + length-gated by the route).
 *   Resolve `{ ...firstClaimFields, claims: [...] }` — one entry per distinct checkable
 *   claim, each a short self-contained declarative sentence — or `{claim: null, claims: []}`
 *   when nothing is checkable. The legacy top-level fields mirror claims[0] so pre-multi
 *   consumers keep working; a single-claim adapter may omit `claims` entirely (the route
 *   wraps it). The adapter owns vendor quirks (quote stripping, "NONE" detection, prompt
 *   loading) — callers only ever see the clean validated shape.
 */

export {};
