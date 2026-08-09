// ClaimExtractor — stage 1 of the Footnote pipeline. Takes one spoken sentence and pulls
// out the single atomic checkable claim, or null when there is nothing checkable (filler,
// opinion, question, greeting). Fast + cheap; it gates the pricey verify stage.
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
 * @property {(text: string) => Promise<{claim: string|null}>} extract
 *   `text` is a raw transcript sentence (already trimmed + length-gated by the route).
 *   Resolve `{claim}` with one short self-contained declarative sentence, or `{claim: null}`
 *   when nothing is checkable. The adapter owns vendor quirks (quote stripping, "NONE"
 *   detection, prompt loading) — callers only ever see the clean claim-or-null shape.
 */

export {};
