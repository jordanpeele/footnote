# State-channel adapter: Cloudflare Durable Objects

**Labels:** good first issue, adapter, state-channel

## Context

The control→overlay bridge ships on Upstash Redis REST with adaptive polling. A Cloudflare Durable Objects adapter is the natural alternative: one DO per room is exactly the room model, it can serve the same polled GET shape, and (stretch) a WebSocket push path that drops air/pull latency to near-zero for people already on Workers.

Scope discipline: the polled-HTTP parity version is the issue. The WebSocket push upgrade is a welcome follow-up, not a requirement (see `SCOPE_P4_REALTIME.md` for why polling was chosen and what would justify push).

## Pointers

- Interface contract: `src/core/interfaces/state-channel.js` <!-- landing in sprint-01: until the layout lands, `api/onair.js` is the reference implementation and defines the semantics -->
- Reference adapter: `src/adapters/state-channel/upstash-redis/`
- Load-bearing semantics to preserve (read `api/onair.js` + the poll loop in `overlay.js` first):
  - server-stamped `seq` so the overlay edge-triggers on change regardless of poll timing
  - `serverNow`/`airedAt`/`durationMs` so a reconnecting overlay resumes an in-flight check (survives OBS restart)
  - TOFU write key per room (first writer registers; later writes must match; reads open)
  - durable aired-check log, append-only, capped, with the 7-day retention behavior
- Card slimming: `slimCard()` in `api/onair.js`
- Realtime design notes: `SCOPE_P4_REALTIME.md`

## Definition of done

- [ ] `src/adapters/state-channel/cloudflare-do/` with a deployable Worker + DO (wrangler config included) and the client-side adapter implementing the interface
- [ ] Full semantic parity: seq edge-trigger, resume-on-connect, TOFU write key, hold vs auto-retire durations, aired log with retention
- [ ] Setup README: wrangler deploy steps + the env vars to point Footnote at it (documented in `.env.example`)
- [ ] Demonstrated: `/control` on one machine airs a card, `/overlay` on another shows it, OBS-restart resume works
- [ ] No changes to the Upstash adapter or core beyond selection wiring
