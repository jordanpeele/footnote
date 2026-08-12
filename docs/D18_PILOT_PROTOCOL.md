# D18 pilot protocol — supervised auto-air, science_health only

First-ever autonomous airing, earned through four calibrations, R49 concurrence
(100% on the category), and the R50 polarity guard. This document is the session
protocol; deviations end the pilot.

## Standing constraints (from D18, verbatim in spirit)

- **science_health claims only** — pilot sessions are scripted/topic-scoped by the
  operator; the pipeline has no runtime category classifier yet (known gap, logged),
  so scope is enforced by protocol: the operator speaks health/science material.
- **Operator present** at the console for the entire session. No unattended minutes.
- **4s veto window live** — the operator watches every countdown.
- **Kill switch verified at session start** — status + a full kill/restore cycle
  BEFORE the stream starts. Aborted if it fails.
- **Cap: 10 auto-airs per session** — enforced in code (arming stops at the cap;
  vetoed cards don't consume it).
- **Auto-aired cards distinctly marked on receipts** (`AUTO · machine-aired`) —
  the public record always distinguishes machine airing from human airing.
- **Full field harness** — everything logs; the session produces a field report
  with a dedicated auto-air section including per-card veto-window timing.
- **Operator attention state per auto-aired card** — self-reported at session
  end (watching / talking / away, per card). The report pairs veto-window
  timing with attention state: the evidence base for whether 4 seconds is a
  real veto window or a formality.
- **Verifier: concurrence** (D16) — two engines must agree; single-verifier
  sessions cannot auto-air under D18.

## Session shape (also serves as the FS-2 re-verify)

1. Arm (server: concurrence + harness + caffeinate; kill-switch cycle; fresh log).
2. Operator opens /control (NO ?testair), checks **Auto-air ON** — first time ever
   with intent.
3. Scripted claim set (~14 science/health claims): a mix designed to produce
   clean auto-airs, at least two deliberate VETOES during the countdown, one
   D4-class hold (person claim — must never arm), one denial (polarity path),
   and enough eligible claims to EXCEED the cap and prove it stops at 10.
4. **Mid-session FS-2 drill**: lock the screen for ~90 seconds while a card is
   airing. caffeinate should hold the display; if anything throttles, /op's
   render-ack STALL must show it. Either outcome is a pass (visible), silence is
   the only failure.
5. End Stream → session auto-exports (R20) → field report.

## Abort criteria (any one ends the session immediately)

A wrong card auto-airs · the veto fails to cancel a countdown · the cap fails ·
the kill switch fails mid-session · render-ack goes silent while a card misses
the screen. Abort = operator unchecks Auto-air (instant) or hits the kill switch;
the report gets written either way — especially either way.
