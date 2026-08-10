# Street pre-flight checklist

P7-D (R45). Companion to `tools/street/arm.sh` — run top to bottom before every
street session. The uplink is now SRTLA-bonded: Moblin sends over MULTIPLE
network paths → `srtla_rec` (UDP :5000 on the Mac) reassembles → plain SRT into
the existing OBS listener (`*:9000`). Single-path `srt://…:9000` remains the
fallback if any bonded piece is down.

## T-30 — at home, before leaving

- [ ] Build includes the R46 negation tripwire (public-street gate): `curl -s -X POST localhost:3000/api/extract -H 'content-type: application/json' -d '{"text":"Women biologically have x y sex chromosomes."}'` must return `"tripwire":"negation"`.

- [ ] `bash tools/street/arm.sh` — all reachability lines green AND
      `srtla_rec: UP` printed. If it prints `not built`, run
      `bash tools/street/build-srtla.sh` first.
- [ ] **caffeinate check (FS-2):** `pgrep caffeinate` returns a pid. A locked
      display throttles the OBS browser source and aired cards miss their
      on-air window — this burned 8 of 11 airs on 8/10. Display must stay awake
      the whole session.
- [ ] **keyterms typed (R40):** tonight's proper nouns (venue names, local
      businesses, people) are in the Deepgram keyterm list BEFORE leaving —
      "Erewhon" transcribed seven ways on 8/10 (FS-3). Currently the hardcoded
      list in `src/adapters/stt/deepgram/index.js`; if R40's per-session
      keyterm field has landed, use that instead. Restart the server after
      editing (re-run arm.sh).
- [ ] **SRT passphrase set in OBS listener.** `srtla_rec` can only bind UDP
      wildcard (`*:5000` — upstream hardcodes INADDR_ANY), so the port is open
      at UDP level; the SRT stream itself must carry the passphrase. Set the
      same passphrase in OBS's Media Source SRT listener and in Moblin's stream
      settings. srtla relays SRT payloads untouched, so the passphrase and
      encryption survive the bonding hop end-to-end.
- [ ] Battery banks packed — one per phone (see burn note below).
- [ ] Fieldtest log path in arm.sh points at TODAY's session file.

## Phones

- [ ] **Tailscale ON, on BOTH phones.** iPhone A needs it for the stream
      uplink (`<tailnet-ip>`); iPhone B needs it for the operator `/op`
      page. Verify each phone can load `http://<tailnet-ip>:3000/op` before
      leaving WiFi.
- [ ] **Moblin (iPhone A) bonded uplink:**
  - Stream URL: `srtla://<tailnet-ip>:5000` (NOT the old `srt://…:9000`)
  - Passphrase: same as the OBS listener
  - Bonding legs: **cellular** (leg 1) + **WiFi joined to iPhone B's personal
    hotspot** (leg 2). In Moblin, confirm both interfaces show in the
    stream/bonding status before going live.
  - Keep `srt://<tailnet-ip>:9000` saved as a second stream profile — the
    single-path fallback if bonding misbehaves.
- [ ] **CARRIER-DIVERSITY CAVEAT:** same-carrier bonding helps congestion, not
      coverage — a second-carrier eSIM is the real redundancy, operator's call.
- [ ] **Battery-bank note:** hotspot + /op doubles phone B's burn — B runs the
      hotspot radio AND the operator page simultaneously. Dedicated bank on B,
      cable connected from the start, not when it hits 20%.

## Leg-kill drill — run at the top of every session (~2 min, before going live)

The loopback drill (`tools/street/srtla-drill.sh`) proves the Mac-side chain
locally; this drill proves the real phone paths. It also settles the one thing
the local drill cannot: whether both of Moblin's legs ride distinct physical
paths through the Tailscale tunnel (check step 2 — if only ONE registration
line ever appears, bonding is collapsing into a single path; fall back to
single-path srt:// for the session and flag it in the fieldtest notes).

1. Start the stream in Moblin to the `srtla://` URL; confirm picture in OBS.
2. On the Mac: `grep "connection registration" /tmp/fn-srtla-rec.log` — expect
   TWO lines with DIFFERENT source addresses (one per leg).
3. **Kill the WiFi leg:** turn off iPhone B's hotspot (or WiFi on A). Feed
   should continue on cellular with at most a brief quality dip — not the
   8/10-style freeze.
4. Restore the hotspot; within ~30s confirm a new registration line (leg
   re-joined).
5. **Kill the cellular leg:** toggle cellular data off on iPhone A for ~15s.
   Feed should continue on the hotspot leg. Restore.
6. Any kill that freezes the feed for more than a few seconds → bonding is not
   delivering; switch to the single-path profile and note it.

## In-session norms

- **D17 SKIP rule:** card text ≠ what was said → SKIP. (FS-1: polarity-flipped
  cards can display the canonical positive with the flipped verdict — a false
  statement wearing a TRUE badge. Until the display fix ships, the operator
  skips any card whose text doesn't match the speaker's framing.)
- **R41 — don't air Unverifiable:** street norm per FS-4. Hyperlocal claims come
  back Unverifiable or tier-1 junk; an Unverifiable card adds nothing for
  viewers. HOLD or SKIP them.

## Close-out

- [ ] Stop the stream in Moblin, then kill caffeinate (`pkill caffeinate`).
- [ ] `pkill -f srtla_rec` (next arm.sh run also reaps it).
- [ ] Turn off iPhone B's hotspot; charge both phones.
- [ ] Dashboard pass over the session log while it's fresh:
      `node tools/fieldtest/dashboard.js eval/results/<today>.jsonl`
