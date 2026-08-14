# Phase 2 — the pipeline leaves the living room

Status: **DESIGN SKELETON** (DAYSPRINT packet 2a, 2026-08-14). Phase 2 ships in
pieces, every piece dark until it has earned its flip. This document is the map;
the first built piece (the relay audio tap) is measured in
[PHASE2_AUDIO_TAP_SPIKE.md](./PHASE2_AUDIO_TAP_SPIKE.md).

## Why (one paragraph)

Phase 1 ([STREET_RIG.md](./STREET_RIG.md)) hears the stream through
OBS → BlackHole → a browser tab on the home Mac. The run test showed that capture
chain is the fragile link: it depends on a logged-in desktop session, a virtual
audio driver, a browser tab staying alive (FS-2 was exactly this class of failure),
and it positions the *fact-checking ears* behind the *compositor*. Phase 2 peels the
audio off at the relay's SRT ingest — the earliest point the stream exists on
infrastructure we control — and sends it to STT directly. The Mac keeps compositing;
it stops being the pipeline's ears.

```
                       Phase 1 (today)                    Phase 2 (this path)
  Moblin ──srtla──► relay ──srt──► OBS (Mac)         Moblin ──srtla──► relay ──srt──► OBS (Mac)
                                    │ BlackHole                          │ tee (on relay)
                                    ▼                                    ▼
                              /control browser ──► Deepgram        audio-tap ──► STT bridge ──► Deepgram
                                    │                                    │ transcripts
                                    ▼                                    ▼
                              Vercel pipeline                      Vercel pipeline (unchanged)
```

## Stage 1 — the relay tap (BUILT dark, this packet)

`tools/relay/setup-tap.sh` installs a "tap mode" unit set on the existing relay
(t4g.nano, the Phase-1 front door), **disabled by default** (`static` units — they
cannot even be `enable`d; an operator starts `footnote-tap.target` deliberately,
between sessions).

Measured constraint that shaped it: **srt-live-transmit's hand-off listener serves
exactly one caller** — a second caller handshakes and then receives nothing (spike
doc, experiment 1). So the tap cannot ride `:4001` next to OBS; tap mode terminates
SRT once and tees the MPEG-TS on loopback:

```
srtla_rec :5000 ──► srt-tee (ffmpeg :4000 listener, -c copy)
                      ├── udp 4002 ──► srt-out-tap (srt listener :4001, passphrase)
                      │                    └── home OBS caller — config unchanged
                      └── udp 4003 ──► audio-tap (ffmpeg)
                                           ├── 60 s pcm16/16 k mono WAV segments
                                           │       /var/lib/footnote-tap/
                                           └── s16le → udp://127.0.0.1:9877
                                                   (640 B = 20 ms datagrams)
```

The OBS-facing contract (`srt://<elastic-ip>:4001?passphrase=…`, pbkeylen 16) is
byte-identical in both modes. Rollback is one command (below).

## Stage 2 — the cloud STT bridge (NEXT packet; interface fixed here)

A small Node process on the relay, consuming the tap's UDP stub and speaking
Deepgram live. Its contract, so the tap and the app don't move underneath it:

- **Input:** `udp://127.0.0.1:9877`, s16le, 16 kHz, mono, 640-byte (20 ms)
  datagrams. Exactly what Deepgram's realtime WS wants for `linear16/16000` —
  the bridge forwards bytes, it does not transcode.
- **Auth:** the bridge holds **no Deepgram key**. It mints a short-lived access
  token via the existing `/api/dg-token` contract (`POST`, optional `{ room }`
  for BYOK; response `{ access_token, expires_in }`) and authenticates the WS
  with `["bearer", access_token]` — the same TOFU/token story the browser client
  uses today (`api/dg-token.js`, `src/adapters/stt/deepgram/`). Fresh token per
  (re)connect. The relay needs exactly one secret: the room's capability URL /
  write key, same trust class as the `/op` phone.
- **Keyterms:** per-session STT keyterms (street finding FS-3) must travel to the
  bridge — planned as a query param on the WS URL built from the same keyterm list
  the control page uses.
- **Output:** finalized sentences enter the pipeline exactly where the control
  page's browser STT enters it today — same utterance → extract → verify path,
  so extract/verify/editorial/queue/op/overlay notice nothing. The bridge is a
  headless replacement for one producer, not a new pipeline.
- **Failure posture:** bridge death ≠ stream death (it's downstream of the tee's
  audio branch only). Restart=always; on reconnect it re-mints a token and resumes.
  Missed audio during an outage is *lost, not queued* — same semantics as the
  Phase-1 browser tab dying, but now visible in journald instead of silently.

## Sizing — what honestly fits on a t4g.nano

Measured on the box (2 vCPU Graviton2, 512 MB nominal / **408 MB usable**, no swap,
6.8 GB disk):

| state | approx MemAvailable |
|---|---|
| at rest (relay services only) | ~210–225 MB |
| tap mode (tee + out-tap + audio-tap) | ~180–200 MB (three small processes, `-c copy` + one audio decode; ~1–3% CPU at stream bitrates) |
| + Node STT bridge (estimate) | ~100–140 MB left — Node runtime alone is 50–80 MB RSS |

Verdict, honestly:

- **Tap + bridge fit** on the nano — with thin margin and no swap. One memory
  spike (an apt run, an unattended-upgrade) while streaming is survivable but
  close; add a 256 MB swapfile as cheap insurance when the bridge lands.
- **The pipeline itself does NOT move to the nano.** It doesn't need to: extract,
  verify, editorial, state channel and the surfaces already run serverless on
  Vercel. "Pipeline moves cloud-side" = *the audio/STT producer* moves to the relay;
  the compute stays where it is.
- If a future packet wants pipeline compute co-resident on the box (self-host
  server, `src/server/`), that is a **t4g.small (2 GB)** job, ~4× the nano's cost
  (~$3/mo → ~$12/mo on-demand). Migration is `setup-relay.sh` + `setup-tap.sh` on
  a fresh host + Elastic IP re-associate — ~10 minutes by design, unchanged.
- During the spike's box-local head-to-head (which ran a full x264 *encoder* on the
  box — production never does) available memory bottomed around 150 MB and the
  stream stayed clean. The tap chain itself is not the resource risk; the bridge's
  Node runtime is the thing to measure before flipping anything.

## Migration / rollback story

Dark → live is an operator choice per session, and reversible in seconds:

- **Tap ON** (between sessions, never mid-stream — the swap drops the media path
  ~2–4 s): `sudo systemctl start footnote-tap.target`. `Conflicts=` stops
  `srt-out` first; OBS reconnects to an identical listener.
- **Tap OFF / full rollback:** `sudo systemctl stop footnote-tap.target &&
  sudo systemctl start srt-out`. The box is back to the exact Phase-1 topology;
  the units sit inert (`static`, never enabled, survive reboot as no-ops).
- **Reboot behavior:** only the Phase-1 services are enabled; a rebooted box comes
  up in Phase-1 mode regardless of what mode it was in. Deliberate — dark by
  default includes after power loss.
- **Health endpoint caveat:** `relay-health` reports `srt_out`, which reads
  `inactive` in tap mode by design. Do not "fix" this by editing the live unit in
  this phase; the health format gains `mode`/tap fields in the packet that flips
  tap mode on for real sessions.
- **Parallel-run validation:** because tap mode preserves the OBS contract, the
  Phase-1 BlackHole chain can run *simultaneously* with the tap during shakedown
  sessions — two independent ears on one stream — and the transcripts can be
  diffed before the Mac ear is retired. That is the acceptance test for Stage 2.

## What stays on the Mac in Phase 2

- **OBS**: compositing (camera + overlay Browser Source) and restream out. Still
  dials the relay as an SRT caller. Unchanged.
- **The overlay and `/op`**: served from the existing deployment; unchanged.
- **Gone from the Mac**: BlackHole routing, the `/control` tab's mic/STT capture
  duty, `caffeinate` babysitting *of the audio path* (FS-2's blast radius shrinks
  to video only).
- Phase 3 (cloud compositor) removes the Mac entirely; out of scope here.

## Security notes carried out of this packet

- The relay ingest (`udp/5000 → :4000`) accepts **passphrase-less SRT** — and
  *rejects* passphrase-carrying callers, since srt-out's input listener declares no
  passphrase (spike doc, experiment 2). Today a stranger who finds `udp/5000` can
  push video into the operator's compositor; setup-relay.sh's comment claims
  otherwise and is wrong about this hop. The tee inherits the same contract
  deliberately (this packet changes nothing live), but tap mode is the natural
  place to fix it: put a passphrase on the tee's `:4000` listener and set the same
  one in Moblin. Needs a Moblin-side change + a session to validate → its own
  packet, surfaced before flipping.
- `/etc/footnote/tap.env` (root, 0600) holds the SRT passphrase for the tap-mode
  hand-off listener — same secret `srt-out.service` already embeds in its unit file.
- AWS Security Group changes were **not** made in this packet (two temporary ufw
  rules were added and reverted during measurement; ufw is inside the SG anyway).
