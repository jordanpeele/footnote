# docs/ — the receipts

Footnote's claim is that accuracy is the spec. That claim is only worth something if the
measurements are public — including the ones that came back bad. This directory is the
evidence record: field sessions, calibration runs, red-team passes, latency accounting.
The misses are published next to the fixes, on purpose. If you're evaluating whether to
trust this thing, start here, not with the pitch.

The policy the evidence is measured against lives at the repo root:
**[HOW_FOOTNOTE_DECIDES.md](../HOW_FOOTNOTE_DECIDES.md)** — what counts as a claim, the
source tiers, the five verdicts, the auto-air gate, corrections. Code that diverges from
it is wrong, even if it works.

## Guides (start here if you want to run it)

| doc | what |
|---|---|
| [SELF_HOSTING.md](./SELF_HOSTING.md) | Zero to a running fact-checker, alone: keys, `.env.local`, first check, troubleshooting |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | The four interfaces, the editorial layer above them, and how to swap a part |
| [STREET_RIG.md](./STREET_RIG.md) | The two-iPhone street architecture: Moblin → tailnet → home Mac → platform, operator in a pocket |
| [FAQ.md](./FAQ.md) | Cost, accuracy, autonomy, latency — answered with the numbers below, not adjectives |

## Field reports

Real sessions, unedited findings, severity-ranked. Every bug that reached these files is
either fixed with a pointer to the fix, or still open and says so.

- **[FIELD_TEST_2026-08-08.md](./FIELD_TEST_2026-08-08.md)** — 35-minute indoor shakedown
  plus the pass-2 addendum: 0 wrong verdicts on 51 checks, but the extractor echoed its own
  prompt into the queue 4× (became the grounding gate), duplicates double-aired (became
  dedupe), and split sentences lost claims (became the final-merge). Pass 2 measured the
  true machine floor: **~3.5s spoken→screen**.
- **[FIELD_TEST_2026-08-10_STREET.md](./FIELD_TEST_2026-08-10_STREET.md)** — first outdoor
  run of the full street rig. The transport worked; the honesty section is the point: FS-1
  (a correct pipeline displayed a polarity-flipped card as a false sentence wearing a TRUE
  badge — closed by D17, display now shows the speaker's framing) and **FS-8, the first and
  only wrong-verdict card ever aired** — a polarity misclassification flipped a False to a
  True. Found in adjudication prep, reported in full, closed by the R46 negation tripwire
  (shipped, live-probed, regression-pinned in `test/field-replay.test.js`).

Cumulative field record, from the [ledger](./LATENCY_LEDGER.md): **4 sessions · 102 checks ·
1 wrong-verdict card aired (FS-8, closed) · 1 display-incoherent pairing (FS-1, closed).**

## Calibration — why auto-air is off

Three runs, one story: **auto-air has failed its bar three times and stays off.** The gate
(Decision D3/D15) requires ≥95% verdict precision at the confidence floor, per category,
both scorers clean — autonomy is measured into existence or it doesn't exist.

1. **[CALIBRATION_REPORT_2026-08-07.md](./CALIBRATION_REPORT_2026-08-07.md)** — run #1,
   173 cases. Eligible categories: none (insufficient n, and 94–95% against a 95% bar where
   n existed).
2. **[CALIBRATION_REPORT_2_2026-08-07.md](./CALIBRATION_REPORT_2_2026-08-07.md)** — run #2,
   grown to 260 cases with a deliberately unfriendly diet. The excuse of small n gone, the
   truth visible: the verifier is an **~85–94% instrument at the floor**. Eligible: none.
3. **[CALIBRATION_REPORT_3_TWOSTEP_2026-08-09.md](./CALIBRATION_REPORT_3_TWOSTEP_2026-08-09.md)**
   — the two-step verifier's promotion eval. It fixed the miss class it targeted (hedging on
   definitive evidence) and bought that by over-committing on mid-tier claims — the worse
   failure on air. Not promoted; it stays dark.

Supporting material: **[VERIFY_TWOSTEP.md](./VERIFY_TWOSTEP.md)** (the dark adapter, why it
exists, and the exact promotion bar it failed) and the adjudication trail in
[`eval/ADJUDICATIONS.md`](../eval/ADJUDICATIONS.md) — 13 wrong-verdict rulings from run #1,
where 3 golden labels were fixed against the spec and 10 verifier misses stand, plus the
attempted-and-rejected prompt iteration. The open human-adjudication backlog is
[`eval/ADJUDICATION_QUEUE.md`](../eval/ADJUDICATION_QUEUE.md); the harness itself is
documented in [`eval/README.md`](../eval/README.md).

## Latency

**[LATENCY_LEDGER.md](./LATENCY_LEDGER.md)** — the stage-by-stage waterfall from real
session logs, the source of truth for optimization priority. Headline: verify (Perplexity)
is ~75% of machine time at 2.6–3.0s p50; the measured floor is ~3.5s spoken→screen. Also a
record of discipline: every latency lever bench-tested this sprint either spent accuracy or
bought nothing, so **no change shipped** — the diffs are empty and the ledger says why.

## Red team

**[redteam/](./redteam/)** — adversarial passes over the codebase, with severity, exact
anchors, and executed probes (not speculation):

- [ROUND2.md](./redteam/ROUND2.md) — findings (3 HIGH, incl. a ghost auto-air after End
  Stream and a `.gov.<cc>` trust spoof).
- [ROUND2-TRIAGE.md](./redteam/ROUND2-TRIAGE.md) — every finding's disposition.
- [ROUND3-REPROBE.md](./redteam/ROUND3-REPROBE.md) — re-verification that every closure
  held, plus four new findings on the operator bridge.

## Street operations

- **[STREET_PROTOCOL.md](./STREET_PROTOCOL.md)** — the operator's one-page editorial
  rulebook (veto everything; don't air Unverifiable; card text ≠ what was said → SKIP).
- **[STREET_CHECKLIST.md](./STREET_CHECKLIST.md)** — pre-flight: arm script, tripwire
  check, SRT passphrase, keyterms, the leg-kill drill.
- **[STREET_RIG.md](./STREET_RIG.md)** — the architecture those two documents operate.

## Acceptance testing

**[e2e-scenarios.md](./e2e-scenarios.md)** — browser-level acceptance scenarios for the
behavior `node --test` can't reach (the control page is a classic-script IIFE). Each
scenario is an exact, repeatable recipe with its verification date.
