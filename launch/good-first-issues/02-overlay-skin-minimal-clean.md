# Overlay skin: minimal / clean

**Labels:** good first issue, overlay-skin

## Context

The reference lower-third is intentionally "TV news." A lot of streamers want the opposite: a quiet, typographic card that doesn't fight their aesthetic — think a single line of text with a small verdict mark and the source in a lighter weight. This skin should be the one a design-conscious podcaster picks.

Constraint that makes this interesting: minimal cannot mean information-poor. Claim, correction, and source all still appear — the craft is hierarchy and restraint, not deletion.

## Pointers

- Reference skin: `src/adapters/overlay/broadcast/` <!-- landing in sprint-01: until the adapter layout lands, reference code is `overlay.html`/`overlay.js`/`overlay.css` -->
- Skin interface: `src/core/interfaces/overlay-skin.js`
- Style rules for all skins: CONTRIBUTING.md → "Contribute an overlay skin"
- Preview: `/overlay?demo=1`, single-card testing via `/overlay?card=<base64 json>`

## Definition of done

- [ ] New skin directory following the reference layout; no core changes
- [ ] All five verdicts distinguishable without relying on color alone (shape/mark/label)
- [ ] Claim, correction, source name all present and readable at TikTok-feed size
- [ ] Transparent background; in/out animation; remaining-time and hold semantics honored
- [ ] Works at 1920×1080 and 1080×1920
- [ ] PR includes screenshots of each verdict from `/overlay?demo=1`
