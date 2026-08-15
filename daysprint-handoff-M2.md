# DAYSPRINT handoff — packet M2 (PREFLIGHT go/no-go)

**2026-08-15 · branch `worktree-agent-ac9c2a8a57a7702a4` · committed, NOT pushed.**

## What this packet ships

`node tools/street/preflight.js` — the one command the operator runs before walking out
the door. Probes every walk-readiness condition and prints a single **GO / NO-GO** with a
per-check PASS/WARN/FAIL reason, so on wake there's one answer, not a checklist to re-run.
Read-only by contract: it never starts a server, kills a process, or writes to the relay —
it curls the relay health endpoint, asks tailscale for its serve state, invokes
`arm.sh --check` (arm.sh's own dry-run), and reads a few files. Exit 0 on GO, 1 on NO-GO
(composes in a launchd wrapper / script).

## The eight checks (each → PASS/WARN/FAIL + a one-line reason)

1. **Relay health** (`curl :8080`) — PASS iff `srtla_rec` AND `srt_out` both `"active"`;
   **FAIL if the front door is down** (bonded media path unavailable). Blocking.
2. **Relay ingest auth** — reads the packet-2a-sec handoff. The parked passphrase fix is
   **committed but NOT applied to the live relay** (vulnerable config still live), so this
   is **WARN**: "front door unauthenticated — decision #1, fix parked on
   `daysprint/2a-sec-ingest-auth-PARKED`". Flips to PASS automatically if that handoff (or
   a sibling `-APPLIED` note) ever attests the fix is live. Non-blocking by design — the
   rig still functions, it's just open; **surfaced as decision #1 for the operator.**
3. **tailscale serve ON + /op reachable** — PASS if serve proxies :3000 and the tailnet
   `/op` URL answers 2xx/3xx (or 401/403 = reachable-but-wants-key); **WARN** if serve is
   ON but the backend isn't up yet (502/000 — `arm.sh` starts it; re-check after arming);
   **FAIL** if serve is OFF (phone /op path down). Blocking only when serve is OFF.
4. **Local server armable** — `arm.sh --check` exists, invoked, parsed; PASS if it exits 0
   (nothing is armed — dry-run only). Distills DG-key / srtla_rec / server-state one-liner.
5. **Kill-switch** — `ADMIN_TOKEN` present+nonempty in the **main-tree** `.env.local` so the
   FOOTNOTE KILL iOS Shortcut works; **prints the copy-ready Shortcut URL** with the real
   tailnet host. FAIL if missing (Shortcut would 501 — no remote stop). Blocking.
6. **OBS 120 Hz high-pass preset** — `tools/street/obs-audio-preset.md` present → **WARN**
   (confirm-it's-loaded: EQ Low -20 dB above Limiter -6 dB on `moblin-feed`; OBS state
   isn't machine-readable so this can never be a clean PASS). FAIL if the file is gone.
7. **R40 keyterms** — **WARN-to-fill**: type the route's proper nouns into the Deepgram
   keyterm list, restart the server. Not machine-verifiable; standing reminder.
8. **Kit** — **WARN**: Moblin bonded URL `srtla://54.203.255.224:5000` (Implementation must
   be "Moblin", passphrase on) + wear the wired/earbud mic with windscreen (the #1 street
   quality tax per RUN_TEST 2026-08-14).

**Aggregate:** GO iff **zero FAIL**. WARN items print (both inline and in a "Confirm
(non-blocking)" block) but never block. NO-GO lists the blocking reasons explicitly.

## Files

- `tools/street/preflight.js` — runner (probing + printer + exit code).
- `tools/street/preflight-checks.js` — pure aggregator + per-check evaluators (the tested
  core; `aggregate()` is the GO/NO-GO contract).
- `test/preflight.test.js` — 17 assertions: aggregator (GO iff zero FAIL, WARN
  non-blocking, single/multiple FAIL → NO-GO with blockers listed) + evaluator guards.
- `docs/WALK_TEST_PROTOCOL.md` — pre-flight list now leads with `preflight.js`.
- `tools/street/arm.sh` — refreshed in this worktree to the packet-5de rebuilt version
  (the one with `--check`, tailscale-serve, `srtla_rec:active` health) so `arm.sh --check`
  works from here; preflight reuses its probe logic and invokes it verbatim.

## Cross-tree note

This is an isolated worktree. `.env.local` (ADMIN_TOKEN, DEEPGRAM_API_KEY), the OBS preset,
and the 2a-sec handoff live in the **main** working tree. `preflight.js` resolves those via
`git rev-parse --git-common-dir` → main root when they're absent here, so it reports the
operator's *real* readiness, not the worktree's. (Side effect: `arm.sh --check` runs with
the worktree cwd, which has no `.env.local`, so its DG-key line reads MISSING — honest for
this tree; the real arm on main sees the key. The Kill-switch and OBS checks correctly read
across to main.)

## Test status

`npm test`: **260 pass, 0 fail, 2 skipped** (was 243+2 before; +17 from preflight).

## Sample run (real, against the current environment — 2026-08-15T05:24Z)

```
FOOTNOTE PREFLIGHT · 2026-08-15T05:24:08Z
──────────────────────────────────────────────────────────────────────────
PASS  Relay health (:8080)
      both services active (srtla_rec + srt_out, uptime 181547s)
WARN  Relay ingest auth
      front door unauthenticated — decision #1, fix parked on daysprint/2a-sec-ingest-auth-PARKED
WARN  tailscale serve + /op
      serve ON but backend not answering (https://cobys-macbook-pro.tail3e2669.ts.net/op -> 502)
      — arm.sh starts the server; re-check after arming
PASS  Local server armable (arm.sh --check)
      arm.sh --check clean — DG key MISSING, srtla_rec built, server not yet up
PASS  Kill-switch (ADMIN_TOKEN)
      ADMIN_TOKEN set in /…/footnote/.env.local — Shortcut works; confirm URL:
      http://cobys-macbook-pro.tail3e2669.ts.net/api/admin?token=<ADMIN_TOKEN>&op=kill
WARN  OBS wind-cut preset (120 Hz high-pass)
      preset present — CONFIRM it's loaded on moblin-feed (EQ Low -20 dB above Limiter -6 dB)
WARN  R40 keyterms for the route
      TYPE tonight's proper nouns into the Deepgram keyterm list, then restart the server
WARN  Kit (Moblin URL + mic)
      Moblin bonded URL = srtla://54.203.255.224:5000 · wear the wired/earbud mic w/ windscreen
──────────────────────────────────────────────────────────────────────────
=== GO ===
Zero FAIL — clear to walk.   (exit 0)
```

Current environment is **GO**: relay up (both services), tailscale serve ON, arm path
clean, kill-switch armed. The four+one WARNs are the standing confirm-before-you-walk
items — the ingest-auth one is the live security decision to surface (decision #1).

## Next-packet hooks

- Re-running preflight *after* `arm.sh` (real, not `--check`) flips check 3 to PASS (the
  502 was just the not-yet-started loopback server behind tailscale serve).
- When packet 2a-sec is applied to the box, check 2 auto-detects it and turns PASS — no
  preflight code change needed (drop an `-APPLIED` note or amend the handoff wording).
