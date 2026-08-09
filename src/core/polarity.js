// Footnote polarity (Decision D11 companion): the extractor always emits the claim in
// canonical ASSERTIVE form and records separately whether the speaker asserted or denied
// it. The verifier then checks the assertive claim; this module — in core, above the
// adapter seam, like editorial.js — maps the verifier's verdict back onto what the
// speaker actually said. Keeping the flip HERE (instead of letting the extractor
// pre-negate claims) is what prevents the polarity-inversion bug where "Einstein said X"
// came back extracted as "Einstein did NOT say X" and flipped the on-air verdict.
//
// Unit walkthrough:
//   speaker: "Einstein never said X"  → claim "Einstein said X", polarity "denies"
//   verifier on the claim → "False" (he didn't say it)
//   applyPolarity("False", "denies") → { verdict: "True", conflict: false }   speaker was right
//
//   applyPolarity("True", "asserts")        → { verdict: "True",  conflict: false }  unchanged
//   applyPolarity("True", undefined)        → { verdict: "True",  conflict: false }  absent = asserts
//   applyPolarity("True", "denies")         → { verdict: "False", conflict: false }  flipped
//   applyPolarity("Misleading", "denies")   → { verdict: "Misleading", conflict: false }  only True/False flip
//   applyPolarity("Unverifiable", "denies") → { verdict: "Unverifiable", conflict: false }
//   applyPolarity("True", "negates")        → { verdict: "True",  conflict: true }   tripwire: hold the card

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
export function applyPolarity(verdict, polarity) {
  if (polarity == null || polarity === "asserts") return { verdict, conflict: false };
  if (polarity === "denies") {
    if (verdict === "True") return { verdict: "False", conflict: false };
    if (verdict === "False") return { verdict: "True", conflict: false };
    return { verdict, conflict: false };
  }
  return { verdict, conflict: true };
}
