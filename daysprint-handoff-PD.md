# daysprint handoff — packet P-D: FRONT-DOOR TRIPWIRE (interim, ingest unauthenticated)

**Branch:** `worktree-agent-a21e5ad335771711f` (committed, NOT pushed)
**Date:** 2026-08-15
**Status:** tripwire LIVE on the relay (enabled + running), wired into preflight as a WARN
check, media path untouched, `npm test` green (445 pass / 0 fail).

## Why

The relay SRTLA ingest is **unauthenticated again** — the passphrase fix was rolled back at
run2 (per `docs/STATUS_2026-08-15_RUN2_ORCHESTRATOR.md`, referenced by the packet). We can't
lock the door until the Moblin passphrase bench (P-C) passes. But we CAN **hear** it: alert
on any SRTLA registration from an UNEXPECTED source while the door is open.

## What shipped (all ADDITIVE — the live media path was never touched)

### On the relay (`ubuntu@54.203.255.224`, installed + running)

- **`/usr/local/bin/relay-tripwire.sh`** + **`relay-tripwire.service`** (enabled, `active`).
  Follows `journalctl -u srtla-rec -f`, extracts the source `IP:port` from every SRTLA
  registration line (`… connection registration` / `… group 0x.. registered` / the `(nil)
  failed` + `group registration failed` forms — success OR failure; an unknown source
  *attempting* to register is the signal), checks it against an operator allowlist, and
  appends any UNKNOWN source to a JSONL hit log with a UTC timestamp. Runs as root (needs
  the journal + `/var/log`); opens **no media sockets**. If it dies, the media path is
  unaffected.
- **`/etc/footnote/relay-allowlist.conf`** — operator-edited config, one IPv4(/32) or CIDR
  per line, inline `#` comments allowed. **Seeded from run2 forensics:** `76.32.135.77`
  (home ISP) and `166.199.0.0/16` (Verizon cell — `166.199.x` seen bonded in run2). The
  operator adds new carriers/hotspots here as they observe them. `setup-relay.sh` will NOT
  clobber it on re-run.
- **`/var/log/footnote-tripwire.jsonl`** — the hit log (bounded to the last 500 lines).
  One object per unknown hit: `{ts, source_ip, source_port, line}`. Currently EMPTY (0 real
  unknown hits; only the operator's known carriers have registered).
- **`/usr/local/bin/relay-health.sh`** (extended) + **`relay-health.service`** (now runs the
  script form as root, restarted). The `:8080` health JSON gained two fields:
  `recent_unknown_sources` (last N=10 hits, newest last) and `unknown_sources_total`.
  Backups of the prior script + unit left on the box (`*.bak-<ts>`).

  Live `:8080` now returns, e.g.:
  ```json
  {"srtla_rec":"active","srt_out":"active","uptime_s":223278,
   "recent_unknown_sources":[],"unknown_sources_total":0}
  ```

### On the Mac (in-repo)

- **`tools/relay/check-tripwire.sh`** — curls `:8080`, prints any unknown-source hits.
  Exit `0` clean / `2` unknown-hit / `3` unreachable. Retries the single-shot `nc` up to 3×
  so a dropped connection isn't a false UNREACHABLE. `--json` mode prints the raw array.
- **`tools/street/preflight.js` + `preflight-checks.js`** — one additive check
  (`evalTripwire`, id `tripwire`) between ingest-auth and tailscale-serve. Reads
  `recent_unknown_sources` from the **shared** relay-health fetch (the two :8080 checks now
  share one cached GET — a second racing curl collided with the single-shot `nc`). **WARN**
  if any unknown source seen (names the latest `ip:port @ ts`) or if the field/endpoint is
  unreadable; **PASS** at zero. WARN never blocks GO — consistent with the packet ("one more
  check", additive, non-blocking).
- **`docs/STREET_CHECKLIST.md`** — T-30 arm-protocol line added: preflight tripwire must be
  PASS (or `check-tripwire.sh` exit 0) before arming; a WARN must be consciously cleared.
- **`tools/relay/setup-relay.sh`** — fresh-VM build now installs the allowlist + tripwire +
  script-form health so a rebuilt relay comes up with the tripwire by default.
- **Tests:** `test/preflight.test.js` gains 3 cases (unknown→WARN+non-blocking,
  clean→PASS, unreadable→WARN). `npm test` = 445 pass / 0 fail / 2 pre-existing skips.

## How an unknown-source hit reaches the operator

1. A source **not** on `/etc/footnote/relay-allowlist.conf` sends an SRTLA registration to
   the open `:5000` ingest. `srtla_rec` logs it to the journal.
2. `relay-tripwire.sh` (tailing that journal) classifies the source as unknown and appends a
   timestamped JSON line to `/var/log/footnote-tripwire.jsonl`.
3. The `:8080` health endpoint immediately reflects it in `recent_unknown_sources` /
   `unknown_sources_total`.
4. The operator sees it **two ways**:
   - **Preflight GO/NO-GO** — `node tools/street/preflight.js` shows the "Front-door
     tripwire" check as **WARN** with the offending `ip:port @ ts` in the "Confirm
     (non-blocking)" list. This is the arm-time surface.
   - **On demand** — `bash tools/relay/check-tripwire.sh` prints the full list + guidance
     (exit 2).
5. Operator judgment: if it's them on a new carrier → add the IP to the allowlist on the
   relay and re-check; if unrecognized → someone found the open front door, investigate
   before arming.

## Relay health attestation — BEFORE and AFTER

| | srtla_rec | srt_out | relay-health | relay-tripwire | media ActiveEnterTimestamp |
|---|---|---|---|---|---|
| **BEFORE** | active | active | active | (n/a) | srtla-rec Thu 08-13 02:55:47 UTC · srt-out Sat 08-15 14:10:47 UTC |
| **AFTER**  | active | active | active | active | **unchanged** (same timestamps) |

The media services' `ActiveEnterTimestamp` values are **identical** before and after —
proof `srtla_rec:5000` and `srt-out` were never restarted or touched. Only the additive
observability services (relay-health restarted to pick up the new script; relay-tripwire
newly installed) changed.

## Verification performed

- CIDR matcher unit-tested (exact /32, /16 boundaries, /0, /8 miss) — all correct.
- Log-line parser tested against all 4 real registration shapes + `-o cat`-stripped form;
  correctly skips non-registration ("connection removed") lines.
- Deployed allowlist logic classified `76.32.135.77` + `166.199.109.65` as KNOWN and
  strangers as UNKNOWN.
- End-to-end: fed synthetic known+unknown lines through the deployed script's own
  parse→classify→record chain — exactly the unknown sources logged, valid JSON.
- Live-fire: injected a synthetic unknown hit into the prod log → surfaced at `:8080` and in
  `check-tripwire.sh` (exit 2) → then **cleared** (prod log left empty for real hits).
- Full `node tools/street/preflight.js` against the live relay shows the tripwire check
  **PASS** (0 unknowns).

## Notes / open items

- The `:8080` server is a **single-shot `nc`** (one connection at a time). Pre-existing
  limitation; mitigated here by (a) sharing one cached fetch across both preflight :8080
  checks and (b) a 3× retry in `check-tripwire.sh`.
- Tripwire fires on registration **attempts**, success or failure — deliberately broad so a
  stranger probing the open port is caught even if their handshake never completes.
- When P-C lands and the ingest is re-authenticated, the tripwire remains useful (unexpected
  authed sources would still be worth hearing) but the urgency drops; it can stay running.
- The stale on-disk `relay-health.service` inline `ExecStart` (which had been superseded by a
  hand-run script) is now reconciled to the script form both live and in `setup-relay.sh`.
