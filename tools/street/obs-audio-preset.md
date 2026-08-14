# OBS street-audio preset — wind cut + gust ceiling on the relay media source

**Why.** The 2026-08-14 run test ([field report](../../docs/RUN_TEST_FIELD_REPORT_2026-08-14.md))
proved the transport innocent and the capture guilty: an unshielded iPhone mic in wind
delivered a loudness range of 18.8 LU with gusts slamming to -0.3 dBFS over speech
sitting in the -30s, and sub-200 Hz energy within ~2 dB of full band (clean voice trails
by 10-15 dB). Everything downstream of OBS — BlackHole, Deepgram, the recording —
received that rumble verbatim. Two filters on the **relay media source** (the
`ffmpeg_source` that dials the cloud relay as an SRT caller, `moblin-feed` in the
operator's `Footnote` collection) fix the worst of it at zero cost: a **low-band EQ cut**
that guts the sub-~120 Hz wind-rumble region where no voice information lives, and a
**limiter with a -6 dBFS ceiling** so a gust can never again ride 30 dB over the speech
and dominate what Deepgram hears. Order matters — EQ first, limiter second — so the
ceiling reacts to the de-rumbled signal instead of clamping on rumble energy the EQ was
about to remove. This is prescription #2 from the field report; the mic-side fix
(prescription #1) is in [STREET_RIG.md](../../docs/STREET_RIG.md#capture-the-mic-is-the-street-s-first-filter).

Note on "high-pass at 120 Hz": OBS ships no parametric high-pass filter. The native
equivalent is the **3-Band Equalizer** with its Low band at maximum cut (-20 dB), which
shelves the rumble region down; that's what this preset uses so the rig stays
plugin-free. If a true 120 Hz slope ever matters, it's one VST away (any free EQ VST2),
and in Phase 2 it becomes `highpass=f=120` in the relay's ffmpeg audio tap — the same
prescription, applied cloud-side (field report, prescription #3).

## The preset

On the relay media source, in this order:

| # | filter | settings |
|---|---|---|
| 1 | 3-Band Equalizer — "Wind cut (low shelf -20 dB)" | Low **-20.0 dB**, Mid 0.0, High 0.0 |
| 2 | Limiter — "Gust ceiling (limiter -6 dB)" | Threshold **-6.0 dB**, Release 60 ms |

## Install by clicking (~60 seconds, works while OBS is open)

1. Open OBS with the street scene collection loaded (**Scene Collection → Footnote**).
2. In the **Audio Mixer** dock, click the **gear** next to the relay media source
   (`moblin-feed`) → **Filters**. (Same dialog via right-click on the source in
   **Sources** → **Filters** — audio filters appear in the lower-left list.)
3. Under **Audio Filters**, click **+** → **3-Band Equalizer**. Name it
   `Wind cut (low shelf -20 dB)` → OK. Set **Low** to **-20.0 dB**; leave Mid/High at 0.
4. Click **+** → **Limiter**. Name it `Gust ceiling (limiter -6 dB)` → OK. Set
   **Threshold** to **-6.0 dB**, **Release** to **60 ms**.
5. Confirm the list order is EQ **above** Limiter (drag, or use the up/down arrows below
   the list, if not).
6. Sanity check: play the shredded bench fixture (or any wind-heavy clip) into the
   source, or just watch a live Moblin feed — the source's mixer meter should never
   cross about -6 dB, and the low-end rumble should audibly drop with the EQ toggled
   on/off (use **Audio Monitoring → Monitor Only** briefly, then set it back).

The filters live in the scene collection, so they persist across restarts and ride along
with the collection — set once per collection.

## Install by splicing JSON (OBS must be FULLY QUIT)

[`obs-audio-filters.json`](./obs-audio-filters.json) carries the exact `filters` array in
OBS's own scene-collection shape. OBS has no import-filters UI, so the scripted route is
editing the collection file directly:

1. **Quit OBS completely** — OBS rewrites the scene-collection JSON on exit and will
   clobber any edit made while it runs.
2. Back up, then splice the `filters` array from `obs-audio-filters.json` onto the relay
   media source's entry in
   `~/Library/Application Support/obs-studio/basic/scenes/<Collection>.json`
   (the object in the top-level `sources` array whose `"name"` is `moblin-feed`; it has
   no `filters` key by default — add one, or append to it if present):

   ```bash
   S=~/Library/Application\ Support/obs-studio/basic/scenes/Footnote.json
   cp "$S" "$S.pre-audio-preset.bak"
   python3 - "$S" <<'EOF'
   import json, sys
   scene, preset = sys.argv[1], "tools/street/obs-audio-filters.json"
   d = json.load(open(scene))
   src = next(s for s in d["sources"] if s.get("name") == "moblin-feed")
   have = {f["name"] for f in src.get("filters", [])}
   add = [f for f in json.load(open(preset))["filters"] if f["name"] not in have]
   src["filters"] = src.get("filters", []) + add
   json.dump(d, open(scene, "w"), indent=4)
   print(f"added {len(add)} filter(s) to moblin-feed")
   EOF
   ```

   (Run from the repo root; adjust the collection filename/source name to yours.)
3. Reopen OBS and verify both filters show under the source's **Filters** dialog, EQ
   above Limiter.

Either route ends in the same state; the click path is the recommended one for a live
config.

## What this does NOT fix

A -20 dB shelf is triage, not a windscreen. Speech that was drowned or pumped by the
gust at capture is gone before OBS ever sees it — the mic-position and windscreen
prescriptions in [STREET_RIG.md](../../docs/STREET_RIG.md#capture-the-mic-is-the-street-s-first-filter)
are the real fix; this preset keeps the residue from dominating STT and the recording.
