# Daysprint handoff — R-cap/veto (red-team the auto-air path races)

**Branch:** `worktree-agent-a7692025b2bd26eb8` (committed, NOT pushed)
**Full report:** `daysprint/handoffs/redteam-capveto.md`
**Test added:** `test/autoair-capveto-races.test.js` (10 tests, all green)
**Suite:** `npm test` → 255 tests, 253 pass, 2 pre-existing skips, 0 fail.

## The 4 races — real vs closed

| # | Race | Verdict |
|---|------|---------|
| 1 | **Cap race** (window arms > CAP timers before count catches up) | **CLOSED** — the fire-time `autoAirCount < AUTO_AIR_CAP` re-check (app.js L760) closes it; single-threaded run-to-completion means each callback increments atomically before the next runs. Proof: arm CAP+5, exactly CAP fire. |
| 2 | **Veto TOCTOU** (card fires the same tick operator vetoes) | **CLOSED** — `clearTimeout` in `dismissCard` (L690) + the `op:cmd` caller guards `c.state !== "pending"` (L1708 air / L1718 skip-hold). No interleaving registers both an air and a veto. |
| 3 | **Double-air** (two overlapping windows, same claim) | **CLOSED** — F2 dedupe check→register is atomic, no `await` between L516 and L531; the second concurrent extract deduplicates. |
| 4 | **Stale-generation** (End→Start mid-veto-window) | **CLOSED** — double-guarded: `clearFactChecks` clears the timer (L770) AND the fire callback is gen-guarded `c._gen === gen` (L760). |

## Parked RED
None. No fix was needed. The one fix that *would* be RED — moving the cap increment from FIRE to ARM time (changes D18 "vetoed cards don't consume the cap" semantics) — is both RED and unnecessary, since the fire-time re-check already holds the cap.

## GREEN work done
- Added `test/autoair-capveto-races.test.js`: per race, a source-scan **pin** on the exact app.js guard line (tripwire on drift) + a deterministic fake-clock **model** driving the adversarial interleaving.
- No production code changed (no bug to fix).

## Notes for the caller
- The prompt referenced files not present in this worktree (`op-air-residuals.test.js`, `pacing.test.js`, `docs/redteam/N2N4-RESIDUALS.md`, "packet 5a air-landed marker"). This worktree predates them. N2/N4 server residuals are covered by the existing `test/op-cmd.test.js`. The 4 races are all client-side and were addressed directly against `app.js`.
