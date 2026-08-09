## What this does

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `npm test` is green locally (the glob form — `npm test` runs it correctly)
- [ ] No new runtime dependencies (or there's a linked issue where we discussed it first)
- [ ] No keys, tokens, or vendor secrets anywhere in the diff — including test fixtures and comments
- [ ] Plain ESM JS with JSDoc types, no TypeScript, no build step
- [ ] If this touches an adapter: credentials stay per-call function arguments (`credentials?.xKey || env default` at request-construction time — never env mutation; `test/credentials.test.js` enforces this)
- [ ] If this is security-relevant — writeKey handling, spend gate / kill switch, BYOK key storage, anything on the path from the internet to someone's overlay — that's called out explicitly in the description, not left for review to discover
- [ ] If this changes the overlay or any UI: screenshots attached (`/overlay?demo=1` renders all five verdicts for skin work)
- [ ] Verifier adapters only: golden-set eval numbers pasted below (see CONTRIBUTING.md — a verifier PR without them won't be reviewed)
