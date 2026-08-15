# Walk-test protocol — first out-of-apartment session, Mac home alone (W4)

The point of the walkable-rig sprint: operator on the sidewalk with two
phones, Mac at home untouched, everything observable and controllable from
`/op`. Gated on: W1 audio-path recovery landed (bonded STT ≥8 intact claims
in a 10-claim read), W2 cloud relay live, R57 category code in prod.

## Rig

- **Streaming iPhone (A)**: Moblin → `srtla://<relay-ip>:5000` (implementation
  "Moblin", passphrase on). Cell only — Wi-Fi OFF.
- **Operator iPhone (B)**: `/op` via the tailnet URL. Cell only. This is the
  ONLY console for the session — the Mac may as well not have a screen.
- **Mac (home)**: OBS (SRT caller pulling from the relay) → unlisted sink +
  BlackHole → server armed. Nobody touches it after pre-flight.

## Pre-flight (at home, before leaving)

- [ ] `node tools/street/preflight.js` — the one command: single GO / NO-GO with a
      per-check reason (relay health, ingest auth, tailscale serve, armable,
      kill-switch, OBS preset, keyterms, kit). GO = zero FAIL; WARN items are
      confirm-before-you-walk, not blockers. Exit 0 on GO, 1 on NO-GO.
- [ ] `arm.sh` (includes relay health check once W2 lands)
- [ ] Kill-switch cycle: status → kill → verify 503 → restore
- [ ] caffeinate holding · unlisted sink ingest green
- [ ] R40 keyterms typed for the route (street names, store names, park names)
- [ ] `/op` loads on phone B over CELL (Wi-Fi off) — check the W4 header
      chips: AUTO state, mute latch, connection dot
- [ ] Kill curl saved as an **iOS Shortcut** on phone B (one tap, no
      terminal on a sidewalk):
      Shortcuts → + → "Get Contents of URL" →
      `http://<mac-tailnet-ip-or-ts.net-host>/api/admin?token=<TOKEN>&op=kill`
      → name it "FOOTNOTE KILL". Test it once at home (then restore).
- [ ] Auto-air ON → Start Stream → one test claim from the sidewalk outside
      the front door → confirm the card lands on `/op`

## The walk (20–30 min loop, cell only)

- Speak claims naturally while walking — science/health per D18 (R57 makes
  out-of-category structurally unarmable, but the sheet habit stands).
- Tag every auto-air from `/op` (the attention strip is the console now).
- Watch for on the phone: render-ack STALL chips, the AUTO cap chip, the
  mute latch, connection dot. **Anything you needed to know and couldn't
  see on the phone is a W4 finding — note it in the moment.**
- Abort paths, in speed order: `/op` MUTE (stops new checks) · the
  FOOTNOTE KILL shortcut (stops all spend) · walk home.

## Post

- [ ] Home → End Stream (attention prompt backstop) → export
- [ ] Delete nothing: harness log + export + Moblin stats feed the report
- [ ] Field report gets a **RELAY column** in the latency waterfall (the hop
      is architectural now) + the W4 observability-findings section

## Acceptance (from the sprint ruling)

One completed walk · ≥10 intact claims processed · zero silent failures
(anything that broke was visible on `/op` in the moment) · the operator
never needed the Mac.
