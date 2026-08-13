# The street rig — two iPhones, one home Mac, live fact-checks on the sidewalk

This is the architecture that fact-checks a street conversation live: one phone is the
camera and uplink, one phone is the control room, and the Mac at home does everything
else. It has been run end-to-end outdoors — the findings, good and bad, are in the
[street field report](./FIELD_TEST_2026-08-10_STREET.md).

Operationally it's driven by two companion documents: the
[street checklist](./STREET_CHECKLIST.md) (gear, arming, go/no-go, the leg-kill drill)
and the [street protocol](./STREET_PROTOCOL.md) (the editorial rules once rolling). This
document is the *why* — what each piece is and why it's shaped that way.

## The shape

```
  iPhone A (camera)                      home Mac                          audience
 ┌──────────────────┐          ┌───────────────────────────┐          ┌──────────────┐
 │ Moblin           │  SRT or  │ srtla_rec (UDP :5000)     │          │ platform(s)  │
 │ camera + encoder ├─────────►│   └─► OBS SRT listener    ├─────────►│ via restream │
 │                  │  SRTLA   │        (127.0.0.1:9000)   │  RTMP/   └──────────────┘
 └──────────────────┘  bonded  │ OBS: scene + overlay      │  etc.
   cell (+ hotspot)   over the │   Browser Source          │
                      tailnet  │ stream audio ─► BlackHole │
                               │   ─► /control pipeline    │
  iPhone B (operator)          │ Footnote server :3000     │
 ┌──────────────────┐          │   (loopback + tailnet     │
 │ /op page         │  https   │    relay)                 │
 │ AIR · HOLD ·     ├─────────►│                           │
 │ SKIP · MUTE      │  over    └───────────────────────────┘
 └──────────────────┘  tailnet
```

- **iPhone A** runs [Moblin](https://github.com/eerimoq/moblin): camera, encoder, and the
  uplink — plain SRT to the Mac, or bonded SRTLA over multiple network paths (below).
- **The home Mac** receives the stream into an OBS SRT listener, composites the Footnote
  overlay as a Browser Source, and restreams the program feed to the platform. The
  program *audio* is routed through BlackHole into the Footnote control page, so the
  pipeline hears exactly what the stream hears. Everything — server, OBS, overlay — runs
  unattended at home.
- **iPhone B** holds the `/op` operator page: a big-thumb AIR / HOLD / SKIP surface plus
  a MUTE latch, reading the queue and sending commands over the same tailnet. The
  operator on the street airs cards from a pocket.

## Why each piece

**Tailscale, not port forwarding.** Both phone paths — the SRT/SRTLA uplink and the `/op`
page — ride the operator's tailnet: WireGuard-encrypted, no router config, no publicly
exposed ports, and the Footnote server can stay bound to loopback with a small relay on
the tailnet address (`tools/street/arm.sh` sets this up and prints reachability checks;
LAN access stays refused). The 2026-08-10 session pushed ~300MB of SRT through the tunnel
on cell service, and a mid-stream signal blip self-healed with zero downstream restarts.

**Capability URLs, not accounts.** `/op` authenticates with the room's write key in the
URL — `http://<tailnet-ip>:3000/op?room=<room>&key=<key>` — the same TOFU write-key model
the whole state channel uses (see [ARCHITECTURE.md](./ARCHITECTURE.md)). Treat that URL
like a password. Don't hand-type it: two mistranscribed key characters cost a mid-setup
403 in the field (finding FS-5), which is why `/control` now offers a ready-made **Copy
tailnet URL** button when the server detects a tailnet address.

**Veto-everything, by policy.** On the street, auto-air is OFF and every card gets a human
thumb — that's Decision D15, and it isn't caution theater: the calibration record
([three runs](./README.md#calibration--why-auto-air-is-off)) says the machine hasn't
earned autonomy, and the street session that aired the one wrong-verdict card in the field
record did it *with* a human in the loop. The [street protocol](./STREET_PROTOCOL.md) is
the operator's rulebook: veto everything, don't air Unverifiable, and if the card text
doesn't match what was said — skip it.

## The bonded uplink (SRTLA)

Single-path SRT dies with the cell signal. The upgrade is
[SRTLA](https://github.com/BELABOX/srtla) bonding: Moblin sends the stream over
**multiple network paths at once** (cellular + a WiFi leg joined to iPhone B's hotspot),
and `srtla_rec` on the Mac reassembles them into plain SRT for the existing OBS listener.

- **Build it:** `bash tools/street/build-srtla.sh`. Upstream is Linux-only; the script
  applies `tools/street/srtla-macos.patch` (byte-order shims, `SOCK_NONBLOCK` fallback,
  epoll→kqueue via epoll-shim) and builds into a vendor tree outside the repo.
- **Wire it (R61 — session-2 lessons ratified):** the bond terminates at a **public
  address**, never a tailnet one: **SRTLA and VPNs don't compose** — bonding binds each
  physical interface directly, and those sockets bypass the tunnel, delivering zero
  packets (session-2 finding; plain `srt://` over the tailnet works fine because
  single-path uses default routing). The production front door is the **cloud relay**
  (`tools/relay/setup-relay.sh` — stable IP, no home ports, OBS dials OUT as caller);
  a home router port-forward works in a pinch but is a session-scoped liability
  (residential IPs also rotate — session 2's rotated mid-setup). Keep `srt://<tailnet-ip>:9000`
  saved as the single-path indoor fallback profile.
- **Moblin's implementation setting must be "Moblin"** for `srtla://` URLs — "Official"
  (libsrt) silently speaks plain SRT only and the bond never forms (session-2 finding).
- **Start order matters:** OBS SRT listener → `srtla_rec` → Moblin Go Live. `srtla_rec`
  wedges silently if it starts before something is listening on its SRT hand-off port
  (session-2 finding: one restart fixed it; the relay's systemd units encode the order).
- **The passphrase is not optional.** `srtla_rec` can only bind wildcard UDP (upstream
  hardcodes `INADDR_ANY`), so the port is open at the UDP level even inside the tailnet
  posture. The SRT stream itself must carry a passphrase — set the same one in the OBS
  listener and in Moblin. srtla relays SRT payloads untouched, so the passphrase and
  encryption survive the bonding hop end-to-end.
- **The operator's deployment (example — the generic pattern above is what forks copy):**
  a dedicated `t4g.nano` in the operator's ops account (us-west-2) with an Elastic IP, so
  the Moblin URL never changes: `srtla://<elastic-ip>:5000`, OBS media source dials OUT
  to `srt://<elastic-ip>:4001?passphrase=…` in caller mode, health at `:8080`. Provisioned
  by `tools/relay/setup-relay.sh` verbatim; coupling: none (the box does nothing else).
  Migration is the same script on any Ubuntu host — ~10 minutes by design.
- **Architecture note (orchestrator-ratified):** the relay is Phase 1 of a three-phase
  path — (1) relay + Mac brain (this document), (2) the pipeline moves cloud-side with an
  ffmpeg audio tap at the relay ingest, retiring the OBS→BlackHole audio chain, (3) full
  cloud compositor. The relay is built knowing it becomes Phase 2's ingest point — no
  throwaway choices.
- The carrier caveat, from the [checklist](./STREET_CHECKLIST.md), verbatim:
  **"same-carrier bonding helps congestion, not coverage — a second-carrier eSIM is the
  real redundancy, operator's call."**
- **Prove it before trusting it.** `tools/street/srtla-drill.sh` exercises the Mac-side
  chain locally; the checklist's **leg-kill drill** proves the real phone paths at the top
  of every session — kill each leg in turn and watch the feed survive. If bonding
  collapses into a single path, fall back to plain `srt://` and note it.

## What this rig produced (the field record)

The [2026-08-10 street session](./FIELD_TEST_2026-08-10_STREET.md), ~90 minutes, operator
solo with both phones, home base unattended:

- The machine stages were **indistinguishable from indoor numbers** — the street added no
  pipeline latency (verify 2,572ms p50 vs 2,629 indoors). 30 cards aired, 21 from the
  pocket phone; 0 pipeline errors; 0 auto-airs.
- **FS-2:** the Mac's display locked and OBS's browser source throttled — 8 of 11 street
  airs silently missed their on-air window while `/op` reported success. Fix is one line
  (`caffeinate -d -u`, now in `arm.sh` + checklist) plus the render-ack that closes the
  trust gap: the overlay now acks "actually painted" back to `/op`.
- **FS-3:** proper nouns are the street's #1 quality tax — "Erewhon" transcribed seven
  ways, one of which reached the queue as a claim about Taiwan. The human gate caught
  every one; per-session STT keyterms are the standing mitigation (checklist item).
- **FS-8:** the wrong-verdict card. Found in adjudication prep, published in full, closed
  upstream by the R46 negation tripwire. Read the report — it's the most instructive
  failure in the record.

## Setup, in order

1. [SELF_HOSTING.md](./SELF_HOSTING.md) — get the server running at all.
2. `bash tools/street/build-srtla.sh` — once, if you want bonding.
3. [STREET_CHECKLIST.md](./STREET_CHECKLIST.md) top to bottom before every session —
   `arm.sh`, tripwire check, passphrase, keyterms, batteries, leg-kill drill.
4. [STREET_PROTOCOL.md](./STREET_PROTOCOL.md) in your head (it fits on a page) once
   you're rolling.
