# i18n: Spanish overlay + docs

**Labels:** good first issue, i18n, docs

## Context

The overlay hardcodes English verdict labels ("FALSE", "NEEDS CONTEXT", "Source:") and the docs are English-only. Spanish-language streaming is enormous and news-heavy — this issue makes the *on-air* surface and the setup docs work in Spanish, and in doing so builds the pattern every other language reuses.

Scope note: this is overlay strings + docs. The pipeline (extraction/verification prompts, source trust lists) staying English/US-centric is a known, larger issue — don't tackle it here, but note anything you hit.

## Pointers

- Overlay strings: `VERDICT_META` labels and the `"Source: "` prefix in `overlay.js` (reference skin `src/adapters/overlay/broadcast/` <!-- landing in sprint-01 -->)
- Proposed mechanism: `?lang=es` on the overlay URL (querystring params are the established config pattern — see `?y=`, `?poll=` handling in `overlay.js`), defaulting to `en`; keep the string table trivially extensible to a third language
- Docs to translate: `README.md` → `README.es.md`, `OBS_SETUP.md` → `OBS_SETUP.es.md` (cross-link both directions at the top of each file)
- Verdict translation needs editorial care — "Misleading" vs "Engañoso", "Needs Context" vs "Falta contexto". Propose the five labels in a comment before translating everything.

## Definition of done

- [ ] `/overlay?...&lang=es` renders all five verdict labels + the source prefix in Spanish; default stays English; unknown `lang` falls back to `en`
- [ ] String table structured so adding a third language is additive (no per-skin forks)
- [ ] `README.es.md` and `OBS_SETUP.es.md` — natural Spanish, not machine-dump; technical terms (Browser Source, lower-third) handled the way OBS's own Spanish UI does
- [ ] Cross-links between language versions at the top of each doc
- [ ] Screenshots of the five Spanish verdicts from `/overlay?demo=1&lang=es` in the PR
