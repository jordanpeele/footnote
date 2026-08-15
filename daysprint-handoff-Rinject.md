# daysprint handoff — R-inject (red-team speech-borne injection at scale)

**Branch:** `worktree-agent-a9d3722a7208229ba` (committed, NOT pushed)
**Full report:** [daysprint/handoffs/redteam-inject.md](daysprint/handoffs/redteam-inject.md)

## TL;DR
Hunted for the one speech-borne injection that beats a Footnote gate. **Found zero confirmed
bypasses.** Every attack class is held by an existing gate/sanitizer. Worst severity: **NONE**
(no CRITICAL overlay-XSS, no instruction-leak-to-air). One Low-severity soft observation in
category-spoof (below).

## Bypasses found by class
- **Instruction injection:** 0 / 14 attempts (8 offline induced-outputs + 6 live utterances).
  Grounding gate rejects induced hostile outputs; real extractor returns NONE for injection speech.
- **Overlay XSS:** 0 / 17 payloads. `textContent` (overlay/op/receipts) is inert; `esc()` + `strip()`
  neutralize markup, quotes, and all zero-width/bidi/control chars.
- **Polarity flip:** 0 / 5. R46 tripwire + `applyPolarity` conflict + R50 independent signal hold
  every mismatch.
- **Grounding dodge:** 0 / 5 (all "passes" are documented backstop behavior, not new weakness).
- **Category spoof:** 0 clean. Parse-side allowlist unspoofable; LLM-side rate below.

## Category-spoof rate
**6.3% (1/16)** of political/economic/other claims dressed in science lexicon were mis-tagged
`science_health` by the real Haiku extractor (stable over 3 runs). The single hit is a
*borderline-genuine* supplement-efficacy claim, and still faces the full downstream auto-air stack
(confidence ≥0.85, source URL, server tier gate, 4s operator veto, session cap). **Low severity.**

## Deliverables
- `tools/redteam/probe.js` — offline adversary harness (42 payloads / 5 classes).
- `tools/redteam/live-extract.js` — live category-spoof + instruction-injection quantifier.
- `test/redteam-inject.test.js` — 20-test regression fixture (pins held behavior).
- `npm test`: **265 tests, 263 pass, 2 pre-existing skips, 0 fail.**

## Not touched (RED, parked)
No changes to extractor prompt, grounding/polarity/category gate semantics, or sanitizer behavior.
Parked: semantic-equivalence grounding (class 4 residual), category-accuracy improvement (class 5).
