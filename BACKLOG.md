# Footnote — backlog (parked work, trigger-gated)

Deferred on purpose. Each item lists the **trigger** that should make us build it, so we do it when
it's actually needed, not speculatively. Today's security (random room + browser-only write key =
capability model) is adequate for a team tool running real broadcasts.

## Security hygiene (cheap, ~10 min each)
- ~~**Rate-limit the `/api/onair` endpoints.**~~ **DONE 2026-08-06** — per-IP limits on all API
  routes (`api/_ratelimit.js`), trigger fired by the public/open-source push.
- **Require the write key to read the session log (`GET /api/onair?room=&log=1`).** Right now the
  aired-check history is readable by anyone with the room ID. The content was broadcast publicly, so
  it's low-sensitivity — but gate it behind the write key if you want the history private.
  **Trigger:** logs ever carry non-broadcast/private data, or you just want the aired history locked
  to the operator.

## Real auth (product-stage, bigger)
- **Accounts + per-user tokens + revocation + audit**, replacing the TOFU room/key model.
  **Trigger:** Footnote goes **multi-tenant** — multiple orgs/users, not just the internal team.
  (This is a product concern, not a security gap in the current single-team use.)

## Realtime transport
- **Ably push instead of adaptive polling** — full design in [SCOPE_P4_REALTIME.md](./SCOPE_P4_REALTIME.md).
  **Trigger:** a producer says the ~0.4–0.5s feels laggy, the overlay runs always-on (polling then
  wastes commands), or you want a pitch to feel instant. (Adaptive polling already covers most of it.)

## Ops / misc
- **Rotate the inlined Deepgram key** if it ever spreads beyond the current audience (Coby decided
  not to for now — it's a restricted, transcription-only key).
- **Scene-collection `.json` import** is untested in real OBS (the manual Browser Source is the
  verified path). Validate it during a future OBS session; fix the JSON if it errors.
