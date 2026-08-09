# Overlay skin: high-contrast accessibility

**Labels:** good first issue, overlay-skin, accessibility

## Context

The reference skin uses color-coded verdicts and mid-weight text over whatever video happens to be behind it. This skin is the one that's actually readable for everyone: max-contrast solid plates, large type, redundant verdict encoding (label + distinct shape/icon, tested for the common color-vision deficiencies), reduced-motion friendly.

This shouldn't feel like a compliance checkbox — it's also just the most *legible* skin for bright outdoor IRL streams and heavily compressed re-uploads, which is a big share of where Footnote clips end up.

## Pointers

- Reference skin: `src/adapters/overlay/broadcast/` <!-- landing in sprint-01: until the adapter layout lands, reference code is `overlay.html`/`overlay.js`/`overlay.css` -->
- Skin interface: `src/core/interfaces/overlay-skin.js`
- Verdict set: `VERDICT_META` in `overlay.js`
- Targets: WCAG 2.1 AA contrast (aim AAA for the correction text), `prefers-reduced-motion` respected
- Preview: `/overlay?demo=1`

## Definition of done

- [ ] New skin directory following the reference layout; no core changes
- [ ] Text contrast ≥ 4.5:1 against its own plate (state the measured ratios in the PR); plates opaque enough that background video never degrades readability
- [ ] Verdicts distinguishable with color removed entirely (grayscale screenshot in the PR proves it)
- [ ] `prefers-reduced-motion: reduce` swaps animations for fades/instant states
- [ ] Claim, correction, source present; remaining-time and hold semantics honored
- [ ] Works at 1920×1080 and 1080×1920
- [ ] PR includes per-verdict screenshots, the grayscale set, and contrast measurements
