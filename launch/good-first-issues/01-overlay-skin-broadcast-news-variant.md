# Overlay skin: broadcast-news lower-third variant

**Labels:** good first issue, overlay-skin

## Context

Footnote ships one overlay look — the reference broadcast lower-third. Real newsrooms have house styles: a two-deck chyron with a kicker bar, a network-style flipper, a ticker-adjacent strap. This issue is a *second* broadcast-news treatment so streams can pick a different on-air identity without touching the pipeline.

Think: BBC/PBS-style restraint, or a cable-news two-tier with the verdict as a kicker above the correction line. Your call — propose the direction in a comment before building.

## Pointers

- Reference skin: `src/adapters/overlay/broadcast/` <!-- landing in sprint-01: until the adapter layout lands, the reference code is `overlay.html` + `overlay.js` + `overlay.css` at repo root -->
- Skin interface: `src/core/interfaces/overlay-skin.js`
- Card shape and timing semantics (`durationMs` null = hold): `api/onair.js` (`slimCard`) and the poll loop in `overlay.js`
- Verdict metadata (five verdicts, icons, labels): `VERDICT_META` in `overlay.js`
- Style rules for all skins: CONTRIBUTING.md → "Contribute an overlay skin"
- Preview without the pipeline: `/overlay?demo=1`

## Definition of done

- [ ] New skin directory following the reference layout; no changes to core or other skins
- [ ] Renders all five verdicts (True / False / Misleading / Needs Context / Unverifiable) distinctly, not by color alone
- [ ] Shows claim, correction, and source name; transparent background; animates in/out; honors the remaining-time bar and hold semantics
- [ ] Works at 1920×1080 and 1080×1920 (portrait)
- [ ] PR includes a screenshot of each verdict from `/overlay?demo=1`
