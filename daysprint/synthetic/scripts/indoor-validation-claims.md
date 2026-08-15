# Indoor window-validation read — 5 minutes, VERIFIED-FRESH client

**Purpose.** Run2 (2026-08-15) measured a STALE cached client (the W1.3 window never
executed) on wind-shredded street audio, so we still do not have the window's REAL coverage
number. This read isolates the window from the two confounds: it uses a **verified-fresh
client** (defeats the stale-cache confound) on **clean indoor audio into BlackHole** (defeats
the wind/capture confound), while deliberately reading in a **shredded, fragment-prone cadence**
so the window has something to reassemble. See `docs/redteam/RUN2_CAPTURE_FORENSICS.md` for
why run2 could not answer this.

**What to expect.** On clean-but-shredded input the W1.3 rolling window should recover word
coverage toward **~100%**. The window drops ZERO words it receives (proven in
`daysprint/synthetic/results/redteam-audio-sweep.json` and the `npm test` replay pins:
`shred_only` profile, "run-shape coverage ≥ 95%", "window loses NOTHING it receives"). So:

- **PASS:** `window_extract` fires, `dg_open`/`stt_final` fire, and word coverage lands
  ≥ 95% (target ~100%) with claims reaching extraction/verify — i.e. the fragments
  reassemble into whole claims that the gate accepts. This is the number run2 owes us.
- **FAIL (window bug):** fresh client confirmed, clean audio confirmed, yet coverage still
  collapses to the run2 regime (median-2-word fragments dying at the gate,
  `window_extract` = 0). That would indict the window itself — not capture, not cache.
- **Contrast to run2:** run2 was 1839 fragments / median 2 words / 4 airs / `window_extract`
  fired **0** times. A passing indoor read should show `window_extract` firing on nearly
  every claim and the fragment count collapsing.

---

## Exact steps

### 0. Pre-flight (once)
1. Confirm the served client carries the fix: the running commit must include app-shell
   `cache-control: no-store` (`src/server/index.js`) and the `APP_VERSION` stamp
   `2026-08-15-w13-window+deadair` (`app.js`). Both are present on this branch.
2. Route show/voice audio into **BlackHole 2ch** (the virtual cable the control picker reads
   as an audio input). Indoors, near-mouth mic → your normal capture app → BlackHole, or read
   directly into a mic that feeds BlackHole. Goal: clean, full-band voice (no wind), −25 to
   −30 dB program level.

### 1. Load a GUARANTEED-FRESH client
1. Start the server (`npm start`) and open **`/control`**.
2. **Hard-reload to defeat any cached body:** DevTools open → right-click reload →
   "Empty Cache and Hard Reload" (or Cmd-Shift-R). The `no-store` header makes a normal
   reload sufficient, but hard-reload is the belt-and-suspenders that run2 lacked.

### 2. CONFIRM the fresh client is actually running (do NOT skip — this is the whole point)
1. In DevTools **Console**, look for the `client_version` line emitted at harness init, or
   check the first `__fieldtest/log` beacon in the Network tab. It must read
   **`client_version … version: "2026-08-15-w13-window+deadair"`**. (The version is logged
   to the harness, not painted on the page — verify it in the console/log, not by eyeballing
   the UI.)
2. If any `client_error` events appear at load, stop — the window code path may be dying
   silently (the exact failure the error handlers were added to surface). Fix before reading.

### 3. Select BlackHole as the input
1. In the `/control` audio-input picker, choose **BlackHole 2ch**.
2. Optionally set per-session keyterms for the science/health script:
   `mRNA, Fahrenheit, Celsius, Krebs, mitochondria, sodium, glucose`.
3. Start capture. Confirm the debug panel shows windows advancing (`windows` counter
   incrementing at the 400 ms `winTimer` cadence) and `dg_open` in the log.

### 4. Read the script below — SHREDDED CADENCE
Read at a deliberately choppy, street-like pace: short bursts of 2–4 words, frequent
half-second pauses mid-sentence, so Deepgram endpoints into fragments. The window's job is to
stitch those fragments back into the whole claim. Read the whole block once (~5 min).

### 5. Read the number
Download the session JSON (queue header) and/or pull `eval/results/…`. Report:
`window_extract` count, `stt_final`/`dg_open` counts, word-coverage %, fragment count +
median words, claims reaching extraction/verify, airs. Compare to run2's
0 / 0 / — / 1839 / 2 / 113→5 / 4.

---

## THE SCRIPT (read shredded; ~5 min)

### Block A — science/health (definite, checkable claims — should reach verify)
Water freezes at thirty-two degrees Fahrenheit, which is zero degrees Celsius.
The human body has two hundred and six bones in adulthood.
Sound travels at about seven hundred and sixty-seven miles per hour at sea level.
The mitochondria is the powerhouse of the cell, and it produces ATP.
An mRNA vaccine works by delivering instructions, not a live virus, to your cells.
Normal human body temperature is about ninety-eight point six degrees Fahrenheit.
The Krebs cycle happens inside the mitochondria and releases carbon dioxide.
Table salt is sodium chloride, and it is about forty percent sodium by mass.
Light from the sun takes roughly eight minutes to reach the Earth.
Human blood is red because of the iron in hemoglobin, not because of oxygen alone.

### Block B — everyday mixed claims (some true, some off — exercises the gate)
The Great Wall of China is visible from space with the naked eye. (this one is false — should NOT sail through)
Los Angeles has more people than any other city in California.
The Pacific Ocean is the largest ocean on Earth by surface area.
A year on Mars is almost twice as long as a year on Earth.
Coffee is the second most traded commodity in the world after oil. (widely repeated, actually false — good gate probe)
The Eiffel Tower is taller in summer than in winter because metal expands with heat.
Mount Everest is the highest mountain above sea level, at over twenty-nine thousand feet.
Honey never spoils if it is stored sealed and dry.
The average adult heart beats about one hundred thousand times a day.
Bananas are berries, botanically, but strawberries are not.

### Block C — deliberate mid-sentence fragmentation (stress the reassembly directly)
Read each of these with a hard pause at every slash, so STT emits separate finals:
The speed / of light / in a vacuum / is about / three hundred thousand / kilometers per second.
The Amazon / rainforest / produces / roughly twenty percent / of the world's oxygen. (commonly cited, disputed — gate probe)
A group / of crows / is called / a murder.
The freezing / and boiling / points of water / are zero / and one hundred / degrees Celsius.
There are / eight planets / in the solar system / since Pluto / was reclassified / in two thousand six.

(End of read. Stop capture. Download the session JSON. Report the coverage number.)
