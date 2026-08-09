# Overlay skin: meme / chaotic

**Labels:** good first issue, overlay-skin

## Context

Footnote went semi-viral off a clip where the graphic *interrupts* someone being wrong. Lean into that: a skin built for reaction streams and debate bait — big stamp energy on FALSE, an airhorn-adjacent entrance, shaking text, whatever reads as "the computer disagrees with you" in a clip. This is the skin people screenshot.

Hard line that keeps this fun instead of harmful: the facts stay straight. The claim is quoted verbatim, the correction is rendered unmodified, the source is visible. The chaos is allowed in the *chrome*, never in the *content* — no editorializing text, no verdict exaggeration (Misleading doesn't get the FALSE stamp).

## Pointers

- Reference skin: `src/adapters/overlay/broadcast/` <!-- landing in sprint-01: until the adapter layout lands, reference code is `overlay.html`/`overlay.js`/`overlay.css` -->
- Skin interface: `src/core/interfaces/overlay-skin.js`
- Editorial constraints on presentation: `HOW_FOOTNOTE_DECIDES.md` <!-- landing in sprint-01 -->
- Preview: `/overlay?demo=1`

## Definition of done

- [ ] New skin directory following the reference layout; no core changes
- [ ] Each of the five verdicts has its own treatment; intensity scales with the verdict (Unverifiable/Needs Context must read as *uncertainty*, not a dunk)
- [ ] Claim, correction, source rendered verbatim and legible once the entrance settles
- [ ] Animations settle to a readable steady state within ~1s; remaining-time and hold semantics honored
- [ ] Transparent background; works at 1920×1080 and 1080×1920
- [ ] PR includes screenshots of each verdict + a short screen recording of the FALSE entrance
