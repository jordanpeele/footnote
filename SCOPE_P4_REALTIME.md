# Footnote P4 — realtime transport (push instead of poll)

**One-liner:** replace the overlay's 1-second polling of `/api/onair` with a **push channel** so
aired checks hit the OBS overlay in ~50–100ms instead of up to ~1s — and stop burning ~1
Upstash read/sec per overlay. Everything else (rooms, write-key, resume, Hold/Pull) stays as-is.

Companion to [SCOPE_OBS.md](./SCOPE_OBS.md). **Nothing built yet — for sign-off on the transport
choice before code.**

## Is it worth doing now? (honest CTO read)
The AIR action is a deliberate callback, so 1s is *fine* for most fact-check rhythms. Do P4 when:
- a producer says the lag is noticeable, **or**
- the overlay runs always-on (polling then wastes Upstash commands), **or**
- you want it to feel instant in a pitch.
It's cheap and low-risk, but it is an enhancement, not a fix. If none of the above, park it.

## The constraint (why we polled in the first place)
Vercel serverless **can't hold a persistent WebSocket/SSE** connection reliably: 300s cap,
ephemeral instances, no instance affinity between the overlay's connection and control's publish.
So the push channel must live somewhere that *can* hold connections. Three ways:

| Option | What | Verdict |
|---|---|---|
| **Managed pub/sub (Ably / Pusher)** | browser-direct WebSocket to a hosted service; token-scoped channels | **Recommended** — least ops, solves the constraint, free tier ample |
| Self-run WS on Railway | our own `ws` server, route by room | full control, but a service to run/monitor/secure for no real gain now |
| SSE from Vercel + Redis pub/sub | function streams; fans out via Upstash pub/sub | fiddly; 300s forces reconnjust churn; Upstash REST can't SUBSCRIBE (needs TCP) |

## Recommended design — Ably, server-side fan-out, poll fallback
Keep `/api/onair` as the **single source of truth** (TOFU write-key gate + Upstash store for
resume). Add a realtime *fan-out* on top; the overlay subscribes for instant pushes and still does
its one resume GET on connect.

**Flow**
1. **Control → `POST /api/onair`** (unchanged): write-key check + Upstash `SET`, **then the server
   also publishes the same payload to Ably channel `footnote:onair:<room>`.** Control needs no Ably
   token — publishing is server-side only.
2. **Overlay** on load:
   - `GET /api/onair?room=` **once** → resume any in-flight check (exact P3 logic, unchanged).
   - `GET /api/rt-token?room=` → a **subscribe-only** Ably token scoped to this room's channel.
   - Connect Ably, subscribe → on `air` render, on `pull` hide.
3. **Polling becomes a fallback**, not the primary path: if Ably is disconnected for >~8s, resume
   the P3 poller (slow, e.g. every 3s) so the overlay never goes dark; stop polling once Ably
   reconnects. Realtime is the enhancement; polling is the safety net.

**Why server fan-out (not control-publishes-direct):** keeps auth + the resume store centralized in
one write path; the overlay only ever gets a read-only token; control keeps its current POST.

## API / token contract
```
POST /api/onair   { room, writeKey, card|null, durationMs }   // unchanged + now also publishes to Ably
GET  /api/onair?room=                                          // unchanged (resume + serverNow)
GET  /api/rt-token?room=<room>  ->  Ably TokenRequest          // subscribe-only capability on
                                                               //   footnote:onair:<room>
```
Env: `ABLY_API_KEY` (server-side only; the overlay only ever receives a scoped token). Coby creates
an Ably account (free) + adds the key to Vercel — one setup step, same as Upstash.

## Resume on connect (unchanged)
Ably replaces the *repeated* poll, not the resume. The overlay still does one `GET /api/onair` on
connect to catch a check that's already live (P3). Alternative later: Ably "rewind"/history to get
the last message on attach and drop the resume GET — not needed for MVP.

## Vendoring the client (OBS reliability)
The overlay pulls the Ably browser SDK. For broadcast reliability, **self-host/vendor the Ably JS
bundle** in the repo rather than a runtime CDN fetch, so a CDN blip at showtime can't break the
overlay. (Small file; commit it.)

## Cost / latency
- Ably free: ~6M msgs/month, 200 peak connections. Footnote sends a handful of msgs per broadcast;
  ~1 connection per active overlay. Trivially within free tier.
- Eliminates the ~86k/day Upstash GETs a continuously-open overlay would generate. **Net cost win.**
- Latency ~50–100ms vs up to 1000ms. Meets the "instant" goal.

## Build phases
- **P4a** — Ably account + `ABLY_API_KEY`; `/api/rt-token`; server fan-out in `/api/onair`; vendor
  the Ably SDK; overlay subscribe + keep resume GET. Behind a flag/param so we can A/B vs polling.
- **P4b** — poll fallback (activate on Ably disconnect), reconnect → re-resume; remove the always-on
  poller.
- **P4c** — real OBS test (Coby-driven): confirm CEF holds the Ably WS through a broadcast; measure
  air→overlay latency.

## Decisions to lock
1. **Provider:** Ably (recommended) vs Pusher (equivalent; Pusher's free tier is smaller — 100
   conns / 200k msgs-day) vs self-run Railway WS.
2. **Fan-out:** server-side from `/api/onair` (recommended) vs control publishes directly.
3. **Keep polling as a fallback** (recommended) vs realtime-only.
4. **Vendor the SDK** (recommended) vs CDN script tag.

## Risks / gotchas
- **OBS CEF + WebSocket:** modern Chromium, should hold fine — but verify across a full broadcast in
  P4c (a dropped WS that doesn't fall back = a dark overlay; the poll fallback covers this).
- **Another vendor account** (Ably) + env var — one-time setup by Coby.
- **Token endpoint latency** is on the overlay's connect path; keep it a plain signed TokenRequest.
- **Reconnection gaps:** on Ably reconnect, re-run the resume GET so nothing aired during the gap is
  missed.
- **Free-tier connection cap** (Ably 200 / Pusher 100) — fine now; note it before any wide rollout.
