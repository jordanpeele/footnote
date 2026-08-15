# Moblin passphrase bench — verify the phone's SRT crypto against a TEST port

**Why this exists.** The relay ingest-auth fix (packet 2a-sec, parked on
`daysprint/2a-sec-ingest-auth-PARKED`) declares the session passphrase at the internal
`:4000` SRT termination so a passphrase-less pusher is rejected. It was applied once and
**rolled back at run2 arm time** because the operator's Moblin build rejected every SRT
passphrase form we tried — there was no reachable passphrase field / URL syntax that
survived Moblin's `srtla://` sender. If Moblin can't carry a passphrase, applying the fix
just breaks ingest for everyone.

So the fix must NOT be re-applied to the live relay until a Moblin configuration is proven
to negotiate SRT encryption. **That proof happens here, against a TEST listener — never
against the live relay, and never during / just before a session** (sequencing lesson,
`docs/STREET_RIG.md`).

This bench is the client-side half of `verify-ingest-auth.sh`, decoupled from the live
media path so the operator can iterate on Moblin's settings on the phone safely.

---

## The test target (already standing)

A transient `srt-live-transmit` listener on the relay's **spare port `:4010`**, passphrase
enforced, discarding to a local UDP sink. It is **additive** — it does not touch the live
`srtla_rec:5000` / `srt-out:4000`+`:4001` services (verified active/active before and after
standing it up). Its `passphrase` + `pbkeylen=16` are the **exact same crypto contract** the
ingest-auth fix will apply to `:4000`, so a Moblin config that passes here passes against the
real relay.

| field            | value                              |
|------------------|------------------------------------|
| host             | `54.203.255.224` (relay Elastic IP)|
| bench SRT port   | `4010/udp` (ufw opened, additive)  |
| bench passphrase | `footnote-bench-4010`              |
| pbkeylen         | `16` (AES-128; matches the fix)    |
| latency          | `2000` ms                          |

> The bench passphrase is intentionally **not** the live session passphrase — this port is a
> throwaway lab, publicly reachable while up. Rotate/tear down when done (below).

### Start / restart the bench (operator's one command)

The listener is **transient** (`systemd-run --unit=srt-bench --collect`) so it vanishes on
reboot and never becomes a permanent second attack surface. To (re)start it:

```bash
ssh -i ~/.ssh/footnote-relay.pem ubuntu@54.203.255.224 \
  'sudo ufw allow 4010/udp; sudo systemctl reset-failed srt-bench 2>/dev/null; \
   sudo systemd-run --unit=srt-bench --collect /usr/bin/srt-live-transmit -v \
     "srt://0.0.0.0:4010?mode=listener&passphrase=footnote-bench-4010&pbkeylen=16&latency=2000" \
     "udp://127.0.0.1:9999"'
```

### Watch the handshake (this is your PASS/FAIL readout)

```bash
ssh -i ~/.ssh/footnote-relay.pem ubuntu@54.203.255.224 \
  'journalctl -u srt-bench -f'
```

### Tear it down when finished

```bash
ssh -i ~/.ssh/footnote-relay.pem ubuntu@54.203.255.224 \
  'sudo systemctl stop srt-bench; sudo ufw delete allow 4010/udp'
```

---

## Candidate Moblin configurations to try (in order)

Point iPhone A's Moblin at the bench, go live, and read the log. Try each form until one
shows **PASS**. Moblin's UI has moved across versions, so both the URL-query path and the
settings-screen path are listed.

### Implementation setting comes first (gates everything)

Moblin has an **Implementation** toggle for SRT(LA): **"Moblin"** vs **"Official"**.

- **"Moblin"** — Moblin's own SRT/SRTLA stack. Required for `srtla://` bonding (the
  "Official"/libsrt path silently speaks plain SRT only and the bond never forms —
  `STREET_RIG.md` session-2 finding). **Open question this bench answers:** whether the
  Moblin implementation exposes/honors a passphrase at all. If "Moblin" cannot carry the
  passphrase but **"Official"** can, that's a real finding — it means bonded + encrypted is
  not simultaneously available in this build and the decision rule below routes to a
  different auth approach.
- **"Official"** — libsrt. Single-path SRT only, but libsrt's `passphrase`/`pbkeylen`
  support is complete. Useful as a **control**: if "Official" passes the bench and "Moblin"
  does not, you've localized the gap to Moblin's SRTLA sender.

Test the passphrase under **both** implementations and record which pass.

### Form 1 — URL query on the `srtla://` / `srt://` destination

In Moblin's stream destination URL, append the query:

```
srtla://54.203.255.224:4010?passphrase=footnote-bench-4010
srtla://54.203.255.224:4010?passphrase=footnote-bench-4010&pbkeylen=16
srt://54.203.255.224:4010?passphrase=footnote-bench-4010&pbkeylen=16   # Official/libsrt control
```

(Some Moblin builds strip unknown query params from `srtla://`; that's exactly the failure
we're hunting. `pbkeylen=16` must match the listener — the bench uses 16.)

### Form 2 — dedicated SRT(LA) settings fields (newer Moblin)

Newer Moblin exposes encryption fields in the stream's SRT(LA) settings screen rather than
in the URL:

- **Settings → Stream → (your stream) → SRT(LA) → Passphrase** — enter
  `footnote-bench-4010`.
- **… → Key length / pbkeylen** — set to **16** if offered (else leave default and set the
  bench listener to match).
- Leave the URL as the bare `srtla://54.203.255.224:4010` (no query) when using the fields
  form, so the two paths don't fight.

Try the fields form under **both** Implementation settings.

### Form 3 — combination / edge cases if 1 and 2 both fail

- URL query **plus** empty settings field (and vice-versa) to see which one Moblin actually
  reads.
- `pbkeylen` absent entirely (let it default) — bench listener already tolerates the client
  choosing; the passphrase is what's enforced.
- Confirm no leading/trailing whitespace in the passphrase field (a field that "looks set"
  but sends blank presents as the **UNSECURE** reject below — the classic false-negative).

---

## Reading PASS vs FAIL (from `journalctl -u srt-bench`)

**PASS** — Moblin negotiated encryption and bytes flow:

```
 connected.
Accepted SRT source connection
```

(and the connection stays up while streaming; no BADSECRET/UNSECURE lines). This is the
green light: the passphrase form you used works.

**FAIL — wrong passphrase** (typo / mismatched value):

```
KMREQ/rcv: (snd) Rx process failure - BADSECRET
interpretSrtHandshake: KMREQ result abnornal - rejecting per enforced encryption
connection rejected due to: INTERNAL REJECTION - ERROR:BADSECRET
processConnectRequest: rsp(REJECT): 1010 - Incorrect passphrase
```

**FAIL — no passphrase reached the wire** (the Moblin failure mode from run2 — field/URL not
honored, or sent blank):

```
HS EXT: Agent declares encryption, but Peer does not - rejecting connection per enforced encryption.
connection rejected due to: INTERNAL REJECTION - ERROR:UNSECURE
processConnectRequest: rsp(REJECT): 1011 - Password required or unexpected
```

These three states were **empirically confirmed on the bench** (2026-08-15): a correct-
passphrase `ffmpeg` push was Accepted; a wrong one hit `BADSECRET`/1010; a passphrase-less
one hit `ERROR:UNSECURE`/1011. So the log distinguishes "operator typed the wrong
passphrase" from "Moblin isn't sending one at all" — which is the whole point.

---

## Does Moblin's SRTLA even support SRT encryption? (the crux)

**At the transport-protocol level: YES — srtla carries SRT crypto, it does not block it.**
Read from the pinned source the relay runs (`BELABOX/srtla`, in `/opt/srtla`):

- `srtla_send.c` contains **zero** references to `passphrase`, `pbkeylen`, `crypt`, or
  `encrypt` — it never touches the SRT handshake.
- `srtla_rec.c` **forwards SRT packets verbatim** (`send(g->srt_sock, …)`); it parses only
  its own REG1/REG2/keepalive/ACK framing and the SRT sequence number.

So the SRT handshake — **including the KMREQ/KMRSP crypto negotiation and AES-encrypted
payloads** — runs end-to-end between the SRT *sender's* stack and whatever listens on the
receiver's SRT port. The bond hop is opaque; crypto survives it. (srtla's own README calls
out that the *basic* setup "doesn't implement authentication or encryption" — meaning srtla
adds none of its own; it relies on the SRT layer above it, which is free to.) The Mac street
rig already proves this daily, and the 2a spike proved it by measurement: a rejection at
`:4000` is a crypto negotiation that made the round trip.

**Therefore the open question is NOT the srtla protocol — it's Moblin's SRTLA *sender
implementation*.** srtla-the-protocol can carry the passphrase; the question this bench
settles is whether **Moblin's build exposes a passphrase field that its "Moblin"-
implementation SRTLA sender actually puts on the wire.** That's a client-app capability, not
a protocol limitation.

**If the bench shows Moblin's "Moblin" implementation genuinely cannot carry a passphrase**
(all forms → `UNSECURE`/1011, while the "Official"/libsrt control passes), the answer is a
**different auth approach for the bonded path**, candidates:

1. **Ship a Moblin build/version that supports SRTLA passphrase** (upstream `eerimoq/moblin`
   has been adding SRT encryption UI; confirm the operator's version, upgrade if a newer one
   exposes it). Cheapest if it exists.
2. **Network-layer perimeter on `udp/5000` that does not break bonding** — e.g. a
   short-lived source-IP allow window opened at arm time. Weak (carrier CGNAT rotates,
   noted in the 2a doc) but a partial DoS/obscurity gain.
3. **Accept unauthenticated bonded ingest as untrusted-by-design** and keep the operator-eyes
   mitigation (obscurity + `:4001` read-side passphrase), reserving the enforced-crypto fix
   for the single-path `srt://` fallback where the client *can* carry a passphrase. This is
   the honest fallback the 2a doc calls option (c) — only justified **if** Moblin truly
   can't.
4. **Single-path SRT for produced/authenticated sessions, bonded SRTLA only when coverage
   demands it** — pick the auth posture per session based on what the client can do.

Pick among these only **after** the bench has ruled out Forms 1–3 under both Implementation
settings. Don't assume the failure is the protocol — it isn't.

---

## Decision rule (binding)

> The relay ingest-auth fix (parked on `daysprint/2a-sec-ingest-auth-PARKED`) may be
> **re-applied to the live relay ONLY after** a specific Moblin configuration has **PASSed
> this bench** (Accepted SRT source connection with a passphrase on `:4010`).
>
> The apply must then happen **between sessions**, inside the ~10-minute maintenance window
> (`systemctl restart srt-out` drops the media path ~2 s), followed by
> `tools/relay/verify-ingest-auth.sh` (6/6) and a full `node tools/street/preflight.js`
> re-run — **never in the same window as a session**.
>
> Record the winning Moblin form (implementation + Form #) in the apply handoff so the next
> operator reproduces it, and set the passphrase in Moblin's real relay profile to the live
> session value (not the bench value) at apply time.

If no Moblin form passes the bench, **do not re-apply** — route to the "different auth
approach" candidates above and leave the fix parked.
