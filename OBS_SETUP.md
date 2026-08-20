# Footnote in OBS — setup

Footnote runs as two pieces inside your OBS session:
- **Control** (`/control`) — the producer console: transcribes, fact-checks, and lets you AIR/SKIP.
- **Overlay** (`/overlay?room=…`) — the transparent fact-check graphic OBS composites over your scene.

They pair by a **room** the control page generates for you. Open `/control` and you'll see an
**OBS OVERLAY** bar with your unique overlay URL, a **Copy URL** button, a **Download OBS scene**
button, and an **Audio in** picker.

---

## 1. Add the overlay to OBS (guaranteed path)
1. In OBS: **Sources → + → Browser**, "Create new", name it `Footnote`.
2. **URL:** paste the overlay URL from the control page's OBS OVERLAY bar (`…/overlay?room=xxxx`).
3. **Width `1920`, Height `1080`.** Leave the rest default. OK.
4. Position/scale it over your scene (it's transparent, so only the lower-third shows).

> Convenience: the **Download OBS scene** button gives you a scene collection with the overlay
> pre-added (Scene Collection → Import). Note it imports as a *new* collection — for an existing
> show, use the manual Browser Source above.

## 2. Add the control console inside OBS (optional but nice)
**Docks → Custom Browser Docks…** → Dock Name `Footnote`, URL = your `/control` URL → Apply.
The fact-check queue now lives as a panel inside OBS. (You can also just keep `/control` open in
a browser window on a second monitor.)

## 3. Audio — let Footnote hear the show
Footnote transcribes whatever the control page's **Audio in** picker is set to.
- **Single presenter on this machine:** pick your **microphone**. Done.
- **Mixed audio (music, remote guests, OBS bus):** route OBS's audio to a **virtual audio cable**
  and select it in the picker:
  - **macOS:** install [BlackHole](https://existential.audio/blackhole/); in OBS **Settings → Audio →
    Monitoring Device = BlackHole**, set the sources you want checked to **Monitor and Output**;
    pick **BlackHole** in the Footnote Audio in picker.
  - **Windows:** install [VB-Cable](https://vb-audio.com/Cable/); route OBS monitoring to
    **CABLE Input**; pick **CABLE Output** in the picker.

## 4. Go
1. On the control page, pick your **Audio in**, then hit **Start Stream** (allow the mic prompt).
   Talk, or type a claim to test.
2. A checked claim lands in the **FACT-CHECK QUEUE**. Click **AIR** and it appears on the OBS overlay.
3. On-air controls (queue header + keys):
   - **Hold** — keep the aired check on screen until you Pull it (instead of auto-retiring ~10s).
   - **Pull** — take the current graphic off-air now (button, or `P` key).
   - **Auto-air** — mode-dependent (D19). In VERIFIED (default): only calibrated, doubly-verified, well-sourced checks air, capped per session. In OPEN: every checked claim airs after a 2-second abort countdown, wearing an AI·UNVERIFIED marker. Person-claims never auto-air in either mode. Pick the mode on the MODE row.

---

## Gotchas
- **The overlay resumes an in-flight check on connect** — if you add the source mid-show, OBS
  restarts, or the source refreshes, it shows whatever check is currently live. A check that already
  auto-retired won't come back; use **Hold** if you want it to stay up until you Pull it.
- **One room = one pairing.** The control page remembers its room; the overlay URL must match it.
  Reloading control keeps the same room. Clearing site data mints a new one (re-copy the URL).
- **HTTPS + Chrome-based:** OBS's browser source is Chromium, so it just works. In a normal browser
  use Chrome and allow the mic.
- **Update speed:** the overlay checks for changes **adaptively** — ~0.4s while a check is on screen
  or just after an air/pull, backing off to ~2.5s when idle. So airing/pulling feels near-instant
  without a persistent connection. Tune with `&poll=` (active ms) and `&pollIdle=` (idle ms) on the
  overlay URL if needed.

> **Resizing an existing source to vertical?** After changing Width/Height, right-click the source → **Transform → Reset Transform** — OBS keeps the old bounding box otherwise and will scale the 16:9 page into your portrait canvas (tiny mid-frame card). Cleaner: delete + re-add, or import the downloaded `Footnote 9:16` scene.
