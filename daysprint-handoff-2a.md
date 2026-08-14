# DAYSPRINT handoff — packet 2a (ffmpeg audio tap on the relay, DARK)

**2026-08-14 · branch `worktree-agent-adaa08b5879a64efd` · committed, NOT pushed.**

## What shipped (all dark)

1. **The tap is built and installed on the relay** — `tools/relay/setup-tap.sh`
   deployed a 4-unit "tap mode" (`footnote-tap.target`, `srt-tee`, `srt-out-tap`,
   `audio-tap`) on 54.203.255.224. All units are `static`: they cannot be enabled,
   never auto-start, and a reboot always comes up Phase-1. Nothing changes for
   current sessions.
2. **The keystone question is answered with data**: `srt-live-transmit`'s `:4001`
   listener serves exactly ONE caller (second caller handshakes, gets 0 bytes;
   control solo caller got 824 KB/10 s) → the packet's anticipated redesign was
   taken: terminate SRT once at `:4000`, ffmpeg-tee the TS on loopback, re-offer an
   identical `:4001` to OBS, decode audio once to pcm16/16k → WAV segments +
   `udp://127.0.0.1:9877` stub (640 B = 20 ms — the Deepgram bridge's input contract).
3. **Head-to-head measured** — [docs/PHASE2_AUDIO_TAP_SPIKE.md](docs/PHASE2_AUDIO_TAP_SPIKE.md):
   - Designed chain, both branches simultaneously (box-local source): tap branch is
     sample-continuous (probe residual spread 0.00 ms across all WAV segment
     boundaries), 54/54 source silences matched, zero inserted gaps — bit-honest vs
     the OBS hand-off branch.
   - Production WAN leg (live front door, Mac pull = BlackHole proxy): 6 corrupt-packet
     events in 5:49 and **~360 ms of audio lost mid-stream** (silence-fingerprint
     shift at ~293 s). The tap position halves WAN exposure and drops
     BlackHole/browser from the ears' path entirely.
4. **Phase-2 design skeleton** — [docs/PHASE2_DESIGN.md](docs/PHASE2_DESIGN.md):
   relay tap → STT bridge (interface pinned: UDP stub in, `/api/dg-token` for auth,
   transcripts enter where the control page's do) → honest nano sizing (tap+bridge
   fit in 408 MB with thin margin; pipeline compute stays on Vercel — a co-resident
   self-host server is a t4g.small job), migration/rollback (one-command swap, dark
   after reboot), what stays on the Mac (OBS compositing only).
5. `tools/relay/tap-stub-listen.py` — stdlib stub consumer standing where the bridge
   will stand.

## Findings that need eyes

- **Security (pre-existing, unfixed by design tonight):** the relay ingest
  `udp/5000 → :4000` accepts passphrase-less SRT and *rejects* passphrase-carrying
  callers — Moblin is necessarily pushing unauthenticated; a stranger who finds the
  port can push video into the compositor. setup-relay.sh's comment overclaims.
  Fix belongs to a hardening packet (passphrase on the tee's `:4000` when tap mode
  flips; needs a Moblin-side change + surfacing before any live change).
- The tap-mode **swap choreography** (`Conflicts=` stop/start of srt-out) is the one
  thing not exercised live — it needs a maintenance window; everything around it was
  validated on test ports / loopback.
- `relay-health` reports `srt_out: inactive` in tap mode — deliberate; health format
  update rides the packet that flips tap mode for real.

## Relay-state attestation

`curl http://54.203.255.224:8080/` — **before:**
`{"srtla_rec":"active","srt_out":"active","uptime_s":128058}` · **after:**
`{"srtla_rec":"active","srt_out":"active","uptime_s":136515}`. All three live
services: `ActiveEnterTimestamp=Thu 2026-08-13 02:55:47 UTC`, `NRestarts=0`,
unchanged through the whole packet. Installed on the box: apt `ffmpeg` 6.1.1 + the
dark units + `/etc/footnote/tap.env` (0600) + empty `/var/lib/footnote-tap/` — full
log in the spike doc. Temporary ufw test rules were reverted (SG was never touched;
opening SG test ports would have been a security-boundary change, so the measurement
was redesigned to need no new inbound ports instead).

## Test status

`npm test`: **243 pass, 0 fail, 2 skipped** (unchanged — this packet is
tools/docs/relay-side only).

## Next packet hooks

- **Bridge packet:** consume `udp://127.0.0.1:9877`, mint via `/api/dg-token`
  (`POST` → `{access_token, expires_in}`, WS auth `["bearer", token]`, fresh per
  reconnect), carry per-session keyterms, feed transcripts into the existing
  utterance path. Add a 256 MB swapfile when the bridge lands.
- **Acceptance test for retiring the Mac ear:** run tap mode + Phase-1 BlackHole
  chain simultaneously on a shakedown session and diff transcripts (tap mode
  preserves the OBS contract, so both ears can listen at once).
