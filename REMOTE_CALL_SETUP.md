# Footnote — remote-call + street rig

How to run Footnote on a real conversation with a remote guest (tomorrow's test), and the
architecture for doing it live on the street in NYC with a phone. Both use the same shape:

```
conversation audio ──► /control (Chrome, home base, auto-air ON)
                          │  extract → verify → publish
                          ▼
                      /api/onair (Upstash, per-room)
                          ▼
        /overlay?room=…  ──► Moblin Browser widget (phone)  or  OBS Browser Source (Mac)
```

The only thing that changes between "remote call at the desk" and "street in NYC" is where the
audio comes from and what composites the overlay.

---

## A. Remote-call test (you at the Mac, guest anywhere)

The guest call runs in a **Chrome tab** (Google Meet, or Zoom's "join from browser"). `/control`
captures that tab's audio and mixes it with your mic, so **both voices get fact-checked**.

1. **Wear headphones.** Tab capture works even with the Mac muted, but if the guest plays out of
   the speakers your mic re-hears them and Deepgram transcribes them twice.
2. Open the call in a Chrome tab (Meet / Zoom web client).
3. Open `https://footnote-live.vercel.app/control` in another Chrome window.
4. Click **“+ Call audio”** in the ¹ OBS OVERLAY bar → in Chrome's picker choose the **Chrome
   Tab** tab → pick the call tab → tick **“Also share tab audio”** → Share. Button turns
   **✓ Call audio** (green). (Chrome shows a "sharing this tab" bar — leave it; clicking its
   Stop button cleanly un-mixes the call.)
5. Pick your mic under **Audio in** if it isn't the default.
6. Tick **Auto-air** (queue header) for auto mode — True/False verdicts with confidence ≥ 85%
   and a source air themselves after a 4-second veto window. Everything else waits in the queue
   for A (air) / S (skip) / P (pull).
7. **● Start Stream.** Talk. The transcript self-monitor should show BOTH voices. If it only
   shows you, the tab capture didn't take — re-do step 4.

Order doesn't matter: you can add/drop Call audio before going live or mid-stream.

### Where the graphic shows up
- **Streaming from the Mac (OBS):** Browser Source with the overlay URL from the bar (the
  proven path — see OBS_SETUP.md).
- **Streaming from the phone (Moblin):** see below.

---

## B. Moblin — overlay on a phone stream

Moblin's **Browser widget** composites a web page onto the outgoing stream, transparency
included.

1. Copy the overlay URL from the /control bar (`…/overlay?room=<yourroom>`).
2. Moblin → **Settings → Scenes → (your scene) → Widgets → + → Browser**.
3. URL = the overlay URL. Size = your **stream resolution** (portrait stream → 1080 × 1920;
   landscape → 1920 × 1080). Position it to cover the full canvas.
4. The overlay auto-detects a portrait canvas and switches to the stacked vertical card. It
   sits 200 px off the bottom to clear platform UI; nudge with `&y=<px>` on the URL if a
   platform's chrome still collides (higher number = higher on screen).
5. Sanity check without the pipeline: add `&demo=1` to the URL — sample cards should cycle on
   your stream preview. **Remove `&demo=1` before going live.**

You see aired checks in Moblin's own preview (the widget is composited locally), so you know
what your viewers are seeing.

**Resume-on-connect:** the overlay shows any in-flight check when it (re)connects, so adding
the widget mid-show or Moblin hiccuping doesn't lose the graphic.

---

## C. Street rig (NYC) — phone streams, home base listens

No laptop on the street. The trick: **the conversation reaches home base as a call.**

- **Phone:** Moblin streams (camera + your mic → Twitch/YouTube/wherever). Browser widget =
  the overlay, as above.
- **The call:** your phone (or a second phone) joins a Google Meet with home base. You and
  whoever you're talking to are audible on that call.
- **Home base (Mac, unattended):** the Meet tab is open (mic muted, camera off — it's just a
  listener). `/control` captures the Meet tab via **+ Call audio**, **Auto-air ON**, stream
  started. Mac muted or headphones unplugged-safe — tab capture doesn't need the speakers.
- Checks auto-air → Upstash → the Moblin widget on your phone. You see them land in your
  stream preview; so do viewers.

Notes for the street:
- In this mode home-base's mic contributes nothing — set **Audio in** to the default mic and
  let the quiet room be quiet, or leave it; silence is free.
- The pipeline self-heals: Deepgram reconnects automatically if its socket drops, and the
  overlay resumes state on reconnect. The fragile link is the **call** — if the Meet drops on
  the street, redial; nothing at home base needs touching.
- A remote producer can also watch /control and manually AIR/HOLD/PULL — auto-air and the
  human can coexist (auto only takes True/False ≥ 85% + sourced; the human can air the rest).
- Session log: the **⭳ Session** button (or `GET /api/onair?room=…&log=1`) has the full
  broadcast record afterward — the clip-mining source.

### Solo street mode — second-phone operator (/op)

No producer at home base, no auto-air trust yet — YOU are the operator, from the street,
on a second phone. The operator page is the /control queue re-shaped for a thumb: newest
check on top, big **AIR / HOLD / SKIP** per card, **PULL** on whatever's on air.

**Before leaving home:**
1. Set up home base as above (Meet tab captured, `/control` streaming). Auto-air on or off
   is your call — see the honesty note below.
2. In the `/control` bar, find the **📱 OPERATOR** row and copy its URL
   (`…/op?room=<room>&key=<writeKey>`). **The URL contains the room's write key — treat it
   like a password.** Anyone holding it can air to your overlay. Text it to yourself /
   AirDrop it to the second phone; don't paste it anywhere public.
3. Open it on the second phone (add to home screen if you want it full-screen). You should
   see the room chip, a green connection dot, and "waiting for checks".

**On the street:**
- Checks land on the phone newest-first, with the verdict color, the quoted claim, the
  correction, confidence %, and the source. Cards still mid-verify show as CHECKING (no
  buttons yet).
- **AIR** publishes the card to the overlay **from the server** — it lands on your Moblin
  widget even if the home Mac is momentarily hiccuping; `/control` catches up and marks it
  in the session record within a couple of seconds. The tapped card greys instantly and
  drops off once home base confirms.
- **HOLD / SKIP** are bookkeeping marks: they clear the card from your phone and record
  the disposition at home base. Nothing airs.
- **MANUAL — person / quote / ⚠ polarity** tags mean auto-air refused this card by policy
  (D4) — it airs only if you tap AIR.
- The **ON AIR** strip at the top mirrors what viewers currently see; **PULL** takes it
  down immediately (server-side, same resilience as AIR).
- A red dot + "offline" banner means the phone lost the network — taps don't send until it
  clears. The queue self-heals on reconnect; nothing at home base needs touching.

**Honesty note — what airs without you:** the auto-air scope is set by the calibration
report, and the current calibration is **manual everything** — with Auto-air unticked at
home base, nothing reaches the overlay unless you tap AIR on this page. If you tick
Auto-air, only sourced True/False at ≥ 85% confidence air themselves (after the 4s veto
window, which you can't veto from the street — the /op page has no countdown); everything
else still waits for your thumb.

(Self-hosting note: the `/op` rewrite is a Vercel route; on the local `npm start` server
open `/operator.html?room=…&key=…` instead.)

### Known limits / later
- One phone doing Moblin + the Meet call at once: iOS *can* run a VoIP call alongside Moblin
  (Moblin ducks in), but mic contention is real — a second phone or a Bluetooth mic split is
  the safe rig. Test before the street.
- Moblin exposes a JS API (incl. its own speech-to-text) to Browser widgets with "Moblin
  access" enabled — a possible future phone-only mode with no home base. Not built.
- Auto-air only airs definitive True/False. Misleading / NeedsContext / Unverifiable queue
  for a human. That's intentional on the street: the spiciest verdicts get a human eye.
