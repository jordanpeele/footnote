# Daysprint handoff — packet P-C · Moblin passphrase bench (relay-side + docs)

**Branch:** `worktree-agent-ab4481cc0d98a7600` (committed, NOT pushed)
**Date:** 2026-08-15
**Scope:** the relay-side + docs half of the ingest-auth re-apply. The "poke Moblin's
settings on the phone" half stays with the operator — this packet gives them a **verified
target to test against** and documents the candidate URL/field forms + the decision rule.

## What this packet did NOT do (by design)

- Did **not** re-apply the ingest-auth fix. It stays parked on
  `daysprint/2a-sec-ingest-auth-PARKED`; `node tools/street/preflight.js` still reports it
  **WARN / not-applied** (verified). The re-apply is gated on a Moblin bench PASS.
- Did **not** touch the live `srtla_rec:5000` / `srt-out:4000`+`:4001` services. All work
  was additive (spare port `:4010`).

## Deliverables

1. **TEST listener on the relay** — a transient passphrase'd `srt-live-transmit` on the
   spare port **`:4010`** (passphrase `footnote-bench-4010`, `pbkeylen=16`, discarding to a
   local UDP sink). Additive; live services untouched. **Currently RUNNING.** It is
   transient (`systemd-run --unit=srt-bench --collect`) so it self-clears on reboot and can't
   become a permanent second attack surface. Start/watch/teardown commands are in the bench
   doc.
   - **Empirically validated (2026-08-15):** correct-passphrase push → *Accepted SRT source
     connection*; wrong passphrase → `BADSECRET` / REJECT 1010; **no passphrase → `ERROR:
     UNSECURE` / REJECT 1011** (the exact Moblin run2 failure mode). So the log cleanly
     distinguishes "operator typo" from "Moblin sent no passphrase."
2. **`tools/relay/moblin-passphrase-bench.md`** — the candidate Moblin forms (URL query
   `?passphrase=X` and `?passphrase=X&pbkeylen=16`; the newer SRT(LA) **settings-screen**
   passphrase/key-length fields; the **"Moblin" vs "Official" implementation** difference and
   why it's the crux), how to read PASS vs FAIL from `journalctl -u srt-bench`, and the
   binding decision rule.
3. **`docs/STREET_RIG.md`** — encoded the sequencing lesson: *NEVER apply ingest-auth in the
   same window as a session — verify Moblin passphrase against the bench port first, apply
   between sessions, re-run preflight.* Also hardened the "passphrase is not optional" bullet
   with the source-confirmed note that srtla carries SRT crypto transparently.
4. **Crux answered (see below).**

## Does srtla support SRT encryption? — CONFIRMABLE, and the answer is YES

Confirmed from the **pinned `BELABOX/srtla` source on the box** (`/opt/srtla`):
`srtla_send.c` has **zero** `passphrase`/`pbkeylen`/`crypt`/`encrypt` references and
`srtla_rec.c` **forwards SRT packets verbatim** — srtla parses only its own REG/keepalive/
ACK framing + the SRT sequence number, never the SRT handshake. So the KMREQ/KMRSP crypto
negotiation + AES payloads run **end-to-end** between the SRT sender's stack and the `:4000`
listener; the bond hop is opaque and crypto survives it. srtla's own README notes the basic
setup "doesn't implement authentication or encryption" — i.e. srtla adds none of its own and
defers to the SRT layer, which is free to encrypt.

**Consequence:** the open question is NOT the srtla protocol — it's whether the **operator's
Moblin build's "Moblin"-implementation SRTLA sender actually puts a passphrase on the wire.**
That's a client-app capability, and it's exactly what the bench settles. If the bench proves
Moblin's "Moblin" impl can't carry a passphrase (all forms → UNSECURE while the
"Official"/libsrt control passes), the fix stays parked and the answer is a different auth
approach — candidates enumerated in the bench doc (newer Moblin build w/ SRTLA passphrase UI;
arm-time source-IP window; accept-untrusted + operator-eyes for bonded, enforced-crypto only
on the single-path `srt://` fallback; per-session posture).

## Decision rule (binding, now in the bench doc + STREET_RIG)

Re-apply ingest-auth to the live relay **ONLY after** a specific Moblin config **PASSes the
`:4010` bench**, then apply **between sessions** (~2 s `srt-out` restart), run
`verify-ingest-auth.sh` (6/6) + `node tools/street/preflight.js`, and record the winning
Moblin form (implementation + form #) in the apply handoff. If nothing passes, don't apply.

## Verification

- `npm test` — **442 pass / 0 fail / 2 skipped** (green; all outside the app path).
- `node tools/street/preflight.js` — ingest-auth still WARN/not-applied (correct).

## Relay health attestation

| check | BEFORE | AFTER |
|-------|--------|-------|
| `srtla-rec` | active | active (pid 630, unchanged) |
| `srt-out`   | active | active (pid 37358, unchanged) |
| `relay-health` | active | active |
| live ports `:5000 :4000 :4001` | all bound | all bound (same pids) |
| `:8080/` endpoint | `{"srtla_rec":"active","srt_out":"active"}` | same |
| bench `:4010` | (n/a) | active, listening |

No live media path was disturbed at any point.

## Operator next steps

1. `journalctl -u srt-bench -f` on the box, point Moblin at
   `srtla://54.203.255.224:4010` with passphrase `footnote-bench-4010`, walk the candidate
   forms in the bench doc under **both** Implementation settings.
2. If a form PASSes → schedule a between-sessions apply of the parked fix, using the live
   session passphrase (not the bench value) in Moblin's real relay profile.
3. Tear down the bench when done:
   `ssh … 'sudo systemctl stop srt-bench; sudo ufw delete allow 4010/udp'`.
