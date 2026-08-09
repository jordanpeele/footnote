# Footnote for OBS — ship the fact-checker as a real broadcast overlay

**One-liner:** turn Footnote from a self-contained mock-stream demo into two web views a
producer imports into OBS — a **transparent overlay** (the on-air fact-check lower-third, added
as a Browser Source) and a **control panel** (the transcript + queue + AIR/SKIP, added as a
Custom Browser Dock) — bridged by a tiny server-side state channel so "AIR" in the control
panel appears on the overlay OBS is compositing.

Companion to the original demo scope (private prototype). This doc scopes the productization for OBS.
**Nothing built yet — this is for sign-off on transport + audio path before code.**

## Mental model shift
The demo *is* the stream (renders webcam + platform skins). For OBS, **OBS is the stream.**
Footnote stops rendering video entirely and splits into:
- **`/overlay`** — only the fact-check lower-third, transparent background. OBS composites it.
- **`/control`** — the producer's surface: mic → transcribe → extract → verify → queue → AIR/SKIP.

OBS owns the camera, scenes, and program output. Footnote owns the fact-check layer + the
producer's decisions.

## Key simplification: only ONE thing crosses the boundary
The overlay and control run in **separate browser processes** (OBS embeds its own Chromium/CEF;
the producer's queue may run in Chrome or an OBS dock). They can't share JS memory, and
`BroadcastChannel`/`localStorage` don't cross that boundary. BUT — the only state the overlay
needs is **"what is on air right now"** (a single card, or null). The whole queue, transcript,
and pipeline stay client-side in `/control`. So the sync surface is tiny: publish one card on
AIR, clear it on retire. Everything else is unchanged from the demo.

## The three pieces

### 1. Overlay view (`/overlay`) → OBS **Browser Source**
- Renders ONLY the existing on-air lower-third component, `body { background: transparent }`.
- Canvas 1920×1080; lower-third positioned bottom-center (matches broadcast).
- Standard OBS flow: Sources → **Browser Source** → paste URL, set 1920×1080. OBS renders alpha
  natively (this is how StreamElements / Streamlabs alerts work). **No plugin needed.**
- Polls the state channel; when a card goes live it animates in, runs its countdown, retires.

### 2. Control view (`/control`) → OBS **Custom Browser Dock**
- The demo app minus the mock stream/skins: transcript strip, operator queue, AIR/HOLD/SKIP,
  auto-air toggle, debug panel. Runs the full mic → Deepgram → extract → verify pipeline.
- OBS has a built-in **Docks → Custom Browser Docks → add URL** — embeds a web panel inside the
  OBS window. So the queue lives *inside* OBS. **No plugin needed.**
- On AIR: publish the card to the state channel (+ keep local queue state as today).

### 3. The state bridge (the one new piece)
Producer clicks AIR → event must travel control → server → overlay.

**MVP: polling + a shared store.**
- `POST /api/onair` — control publishes `{ room, card | null, airedAt }` to the store.
- `GET  /api/onair?room=…` — overlay polls every ~500–750ms, renders whatever's current.
- Store: **Upstash Redis** (Vercel Marketplace; Vercel KV is discontinued). One key per room,
  short TTL so stale cards self-clear. ~20 lines total.
- Latency ~750ms — fine for a lower-third that's already a several-second callback.
- Works on Vercel serverless (no persistent connections), across machines, across the OBS/Chrome
  boundary.

**Later: realtime.** Swap polling for WebSocket/SSE via a managed pub-sub (Ably/Pusher free tier)
or a small always-on Node server on the existing **Railway** box, for sub-100ms. Same API shape;
overlay subscribes instead of polls.

## Rooms / pairing
`/control?room=<id>` ↔ `/overlay?room=<id>` (+ the Upstash key) isolate each stream. Generate a
room id + a write token on the control side; overlay only needs read. Prevents a random overlay
URL from receiving someone else's checks, and stops randoms airing to your overlay
(write requires the token).

## Audio path (name it early — it's the real setup step)
Footnote must *hear* the show to check it.
- **Simple:** `/control` uses `getUserMedia` on the mic — works when the producer's machine has
  the talent's audio.
- **Mixed audio (music, remote guests, OBS bus):** route OBS program audio to a **virtual audio
  cable** (BlackHole on macOS / VB-Cable on Windows) and select that device in `/control`.
  Standard streamer plumbing, but a documented step.

## Packaging for "import"
- **Overlay URL** → paste as Browser Source.
- **OBS Scene Collection `.json`** → export once with the Browser Source pre-configured
  (url + 1920×1080 + position); producer imports one file instead of hand-adding a source.
- **Control dock URL** → paste as Custom Browser Dock.
- **One-page setup doc** — the three URLs, the room id, and the virtual-audio-cable step.

## API / data contract
```
POST /api/onair        { room, token, card | null }      -> { ok }   // control publishes
GET  /api/onair?room=  -> { card | null, airedAt, seq }             // overlay polls
```
`card` reuses the demo's shape (verdict, claim, correction, source{name,url}, confidence).
`seq` (monotonic) lets the overlay ignore out-of-order/duplicate polls and de-dupe re-airs.

## Reuse map (from the current app)
| Reused ~as-is | Refactored | New |
|---|---|---|
| on-air lower-third component + animation/retire | single page → `/overlay` + `/control` split | `/api/onair` state channel |
| extract → verify pipeline, operator queue, AIR/SKIP/HOLD | remove mock stream/skins/webcam from control | Upstash store + room tokens |
| Deepgram streaming, debug/instrumentation | overlay = transparent, video-less | Scene Collection `.json` + setup doc |

## Build phases
- **P0** — split views: `/overlay` (transparent lower-third only) + `/control` (pipeline+queue,
  no mock stream). Still same-page state for now to prove the split renders.
- **P1** — Upstash store + `/api/onair` (POST/GET) + room tokens. AIR in control → overlay shows
  it via polling. **The core.**
- **P2** — OBS packaging: transparent 1920×1080 tuning, Scene Collection export, Custom Browser
  Dock verification, setup doc (incl. virtual audio cable). Test end-to-end inside real OBS.
- **P3** — auth on the write endpoint, session logging, carry over auto-air/veto to the split.
- **P4** — realtime transport (Ably/Pusher or Railway WS) replacing polling; sub-100ms.

## Decisions (locked 2026-08-06)
Guiding principle: cheap where reversible (transport, host, deploy), invest where load-bearing
for the first real OBS test (room isolation + write token, audio device selection).
1. **Transport → polling + Upstash.** Not realtime. The AIR action is a deliberate few-second
   callback; ~750ms polling is imperceptible. Same API shape, so realtime is a localized swap
   later if a producer asks. YAGNI.
2. **Host → Vercel + Upstash.** No new deploy target, zero ops. Shadow of #1; revisit only when
   realtime is justified (and even then prefer managed Ably/Pusher over a self-run WS).
3. **Audio → device picker, mic default, document the virtual cable.** The cable is OS plumbing
   the user installs, not code we write; our only work is a `getUserMedia` deviceId dropdown in
   `/control`, which covers both mic and virtual-cable cases.
4. **Rooms → build now (room id + write token).** The one corner we do NOT cut: a global room
   collides the moment two people test it, and an unauthed write endpoint lets anyone air to your
   overlay. ~15 min of work that protects the validation itself.
5. **Deploy → same Vercel project, new `/overlay` + `/control` routes, keep `/` as the demo.**
   One codebase, no drift; demo stays live for pitching. Split into its own project only when it's
   a real product with its own domain/billing — trivial to do later.

## Risks / gotchas
- **OBS CEF quirks** — Browser Sources cache aggressively; need cache-busting / "refresh cache of
  current page." Custom Browser Docks vary slightly by OBS version/OS.
- **Cross-process state** — confirmed: no `BroadcastChannel`/`localStorage` shortcut across the
  OBS↔Chrome boundary; the server bridge is required (don't waste time on the shortcut).
- **Vercel can't hold WS/long SSE** — that's why MVP is polling; realtime needs Ably/Pusher/Railway.
- **Open write endpoint** — without the room token, anyone with the overlay URL could air to it;
  gate writes before this is used on a real broadcast.
- **Audio realism** — mic-only won't catch mixed/remote audio; the virtual cable is the real answer
  for anything beyond a single local presenter.
- **Deepgram key** — still inlined client-side and now served in `/control` too; unchanged risk,
  Coby has chosen not to rotate for now.
