# FOOTNOTE — STATUS FOR ORCHESTRATOR · post-Round-7 · 2026-08-10

*Prepared by the Claude Code execution session. Verified at write time:
main == origin/main @ 26a1820 · CI green · 129/129 tests · prod healthy
(root 200, dg-token 200) at footnote-live.vercel.app.*

## Position

Round 7 is **closed, drilled, pushed**. The full round report-back was delivered
separately; this is the standing-state sync. Nothing is in flight.

## ⚠ The item that outranks everything: FS-8 (contradicts ratified R38)

The street session **aired one factually wrong card**: *"Women have XY sex
chromosomes" ✓ TRUE @0.98* (NIH tier-3 citation, operator-aired). Chain: the
speaker ASSERTED the false claim → the extractor emitted `polarity=denies`
(the transcript contains no negation — a misclassification) → the verifier
correctly falsified the canonical form → the polarity flip inverted a correct
False into an aired True. Found by the P7-E adjudication prep; confirmed
against the session record.

- **Ledger amended** (R38's ratified language was based on incomplete data):
  cumulative field record = **4 sessions · 102 checks · 1 wrong-verdict card
  aired · 1 display-incoherent pairing (FS-1, closed by D17)**.
- **D17 does not close the FS-8 class** — the spoken framing is also an
  assertion; the card reads wrong either way. Closure is upstream.
- **Awaiting ruling (gate-adjacent, deliberately not hotfixed):** a
  deterministic negation tripwire — extractor says `denies` but the utterance
  carries no negation token → route to the existing `polarity_conflict`
  machinery (never auto-airs per D4, ⚠ tag on /op, spoken framing on display).
  Replayed against all four field sessions: **catches exactly the FS-8 card,
  zero false positives** on the three legitimate denials.
- Recommendation: this ruling joins the public-street-stream gate list.

## Round-7 deliverables (all landed; acceptance evidence in the round report)

| packet | state |
|---|---|
| P7-A · D17 speaker-framing display | shipped; replay-accepted (103 claims / 4 sessions, every denial faithful; FS-1 card renders coherent); mirror-tested |
| P7-B · render-ack | shipped; live-drilled (air w/ no overlay → STALL visible; overlay opens → ack matches airedId). FS-2's silent-miss class can't recur silently |
| P7-C · street ergonomics | shipped: per-session keyterms (R40), /op latched mute (R43), tailnet-origin operator URL button (R42), Unverifiable de-emphasis (R41) |
| P7-D · SRTLA bonded uplink | built (macOS/ARM port, 56-line patch, reproducible build); two-leg loopback bonding drill PASS + real OBS-listener handoff; wildcard-UDP caveat → SRT passphrase documented |
| P7-E · records | adjudication queue restaged (5 sections); FS-4 hyperlocal spec in BACKLOG; STREET_PROTOCOL.md + STREET_CHECKLIST.md written |

## Gates to the next PUBLIC street stream

1. FS-8 tripwire ruling (above) — recommended addition to the gate list
2. FS-2 re-verify + live render-ack observation — one indoor session
3. SRTLA leg-kill drill with real phones (if riding bonded)
4. Keyterms typed pre-session (R40 — the row exists now)
5. STREET_PROTOCOL.md rules in force (D17 SKIP rule stays live for the FS-8
   class until the tripwire ships)

## The standing human items

1. **Adjudication sitting** — 5th consecutive round as critical path, and it
   just **proved its value by catching FS-8**. Now staged at 5 sections,
   ~2h10 (~90 min with batch ratifications). Blocks: eligibility math, the
   verify-architecture bench, 1A canonical-form policy, and now informs the
   FS-8 ruling.
2. **Launch fork** (POST-NOW vs LAUNCH-AT-STREET) — still open; the repo is
   0-star because the announcement remains unposted. Everything it links to
   is now field-proven, drilled, and honestly recorded.

## Standing state

Veto-everything (D15) unchanged; auto-air scope NONE (3 calibration runs).
P5-C two-step verifier dark by its own eval. No editorial gate was touched in
round 7 — the one gate-adjacent item (FS-8 tripwire) is parked awaiting your
ruling, per the rules.
