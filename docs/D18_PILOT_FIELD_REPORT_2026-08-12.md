# D18 pilot field report — session 1 · 2026-08-12

The first machine-aired fact-checks in this project's history. Indoor,
operator-present, science_health material only, concurrence verifier, 4s veto
window, cap 10, kill switch verified pre-session, auto-aired cards marked
`AUTO · machine-aired` on receipts. ~17 minutes of live checking (11:45–12:02
PT). Raw: `eval/results/fieldtest-2026-08-12-d18pilot.jsonl` + the R20 export
(`footnote-session-2026-08-12T19-02-05.json`).

**Headline: 10 auto-airs, 0 wrong cards, 0 aborts. Every gate that was
supposed to refuse, refused.** Two protocol deliverables did not complete:
the FS-2 screen-lock drill was skipped, and the per-card attention debrief
was not captured — both recorded honestly below and carried to session 2.

## Session totals

| checked | aired | auto-aired | manual airs | vetoes | skipped | errors | wrong cards |
|---|---|---|---|---|---|---|---|
| 20 | 13 | **10** | 3 | 2 | 3 | 0 | **0** |

Latency: extract p50 719ms · verify p50 3128ms (concurrence, two arms +
polarity signal) · spoken→air p50 7.9s · p95 23.1s (the p95 tail is operator
manual decides, not the pipeline).

## Auto-air section (per-card veto-window timing)

All ten countdowns ran their full window — timer precision was 4001–4002ms
against the 4000ms spec.

| # | card | claim (canonical) | verdict | conf | veto window | attention |
|---|---|---|---|---|---|---|
| 1 | u2 | Water boils at 100°C at sea level | True | 0.99 | 4002ms | not captured |
| 2 | u4 | The adult human body has 206 bones | True | 0.97 | 4002ms | not captured |
| 3 | u5 | Smoking increases the risk of lung cancer | True | 0.99 | 4001ms | not captured |
| 4 | u6 | Humans use only 10% of their brains | **False** | 0.98 | 4001ms | not captured |
| 5 | u12 | Vitamin C cures the common cold *(spoken as a denial)* | True¹ | 0.97 | 4002ms | not captured |
| 6 | u13 | Measles vaccine causes autism *(spoken as a denial)* | True¹ | 0.99 | 4001ms | not captured |
| 7 | u14 | Lightning can strike the same place twice | True | 0.99 | 4001ms | not captured |
| 8 | u16 | Sugar makes children hyperactive *(spoken as a denial)* | True¹ | 0.97 | 4002ms | not captured |
| 9 | u19 | Exercise reduces the risk of heart disease | True | 0.98 | 4001ms | not captured |
| 10 | u20 | The human heart beats ~100,000 times a day | True | 0.97 | 4001ms | not captured |

¹ Polarity-applied verdict: the canonical claim is False, the speaker DENIED
it, so the aired verdict affirms the speaker. **These are the first
machine-aired polarity-flipped verdicts**, and D17 held: the overlay rendered
the speaker's framing ("Measles vaccine does not cause autism · True"), not
the canonical positive. All three were correct.

### The attention gap (per the session addendum)

The addendum required per-card self-reported attention state
(watching/talking/away) paired with the timing above. **It was not captured**
— the debrief was designed as an end-of-session recall step and the operator
moved on before completing it. Lesson recorded: attention state must be
captured live or not at all; post-hoc recall over ten 4-second windows was
never going to be reliable anyway.

What the log does establish objectively: the operator was demonstrably
watching during 3 of the 12 countdowns —

- **veto of u8 at 2400ms** into the window
- **veto of u9 at 1482ms** into the window
- **manual air of u18 at 2171ms** into its countdown (operator decided
  faster than the timer)

First data on the "is 4s a real veto window" question: **when watching, the
operator acted in 1.5–2.4s — comfortably inside 4s.** Whether the operator
is watching during a *typical* card remains unmeasured. Session 2 captures
attention live.

## Veto evidence

Both scripted vetoes cancelled cleanly mid-countdown and **did not consume
the cap** (10 auto-airs happened after them):

| card | claim | veto latency |
|---|---|---|
| u8 | Cracking knuckles causes arthritis (False, 0.98, eligible) | 2400ms |
| u9 | Goldfish have a three-second memory (False, 0.99, eligible) | 1482ms |

## The refusal ledger — everything that correctly did NOT auto-air

- **D4 person hold (u10):** "Anthony Fauci lied about the origins of COVID"
  → `harm_class: person_public`, manual-only, never armed. (Verify took
  15.5s — the session's slowest — and it didn't matter: the hold was decided
  at extract time.)
- **R50 polarity conflicts, first live firings (u15, u17):** "Bats are not
  actually blind, they can see" and "Antibiotics do not work against
  viruses" both flagged POLARITY CONFLICT (independent signal disagreed with
  the extractor on these negation-bearing utterances) → held from auto-air.
  The operator manually aired u15; u17 was never aired. Both verdicts were
  actually correct, so these were conservative false holds — **the exact
  trade R50 was designed to make: correct cards wait for a human, wrong
  cards can't slip through on a flipped polarity.** Contrast u16: a clean
  denial where the signal agreed — it auto-aired, correctly.
- **Trust-tier gate (u21):** "Adult humans have 32 teeth" came back tier 2 →
  `eligible: false` → operator aired manually.
- **Confidence floor behavior (u7):** "Vitamin C is a water-soluble vitamin"
  → NeedsContext at 0.495 — never armed; operator skipped it.
- **The cap wall (u22):** the 11th fully-eligible card ("Drinking coffee
  raises blood pressure temporarily", True, 0.98, tier 3) did NOT arm; the
  one-time `autoair_cap` warning fired (harness seq 232). Cap proven at
  exactly 10.

## FS-2 re-verify: NOT DONE

The screen-lock drill was skipped — the operator ended the session without
the 90-second lock. FS-2 therefore remains un-re-verified and is **the first
agenda item for session 2** (it needs only a card on the overlay and a
locked screen; auto-air is not required). Related pre-session result that
DID complete: the kill-switch verification cycle passed in the new
in-process mode — the arming requirement that found the fail-open bug
disclosed in [CHANGELOG.md](../CHANGELOG.md).

## Other findings

1. **Fragment-guard silent drops (observability gap).** Finals under 6 words
   are dropped by design as STT fragments — but with NO harness event, which
   cost ~5 live minutes of confusion when scripted 5-word claims ("Vitamin C
   is water soluble", "Cracking your knuckles causes arthritis", "Bats are
   not blind") vanished without trace. Fix queued: log a `gate` event with
   outcome `fragment` (log-only, no behavior change).
2. **Script authoring miss (mine).** The session script contained six claims
   under the 6-word minimum — a known, documented gate. Scripts must be
   linted against the pipeline's own guards before a session.
3. **Sheet mislabeled clean denials as "must never arm."** Design truth:
   only *conflicted* polarity holds; a clean negation-bearing denial that
   both polarity readers agree on is auto-air eligible, and three aired
   correctly (u12/u13/u16). Flagged for the orchestrator to confirm
   explicitly that denial auto-airs are inside D18's intended scope — they
   were treated as in-scope this session because the gates say so and the
   verdicts were right.
4. **Grounding-gate win (u3).** STT misheard "206" as "two zero six"; the
   extractor normalized the claim, and the P4-F1 grounding gate rejected it
   as ungrounded rather than checking a sentence the speaker didn't say.
   The re-spoken claim went through cleanly.
5. **Merge + dedupe both fired in anger** (P5-B joined the split "It's not
   true that / vitamin c cures the common cold"; F2 suppressed the duplicate
   extraction it raced against).

## Bottom line for the D18 decision

Session 1 met every constraint it measured: cap enforced at exactly 10,
vetoes cancel and don't consume the cap, person-claims never arm, polarity
conflicts hold, tier and floor gates hold, receipts mark machine airs, zero
wrong cards, zero aborts. Two deliverables carry: **FS-2 re-verify** and
**live attention capture** — both are session-2 work, and session 2 should
also decide (orchestrator call) whether it adds an unlisted broadcast sink
and the Sprint-B speaker-attribution harness.
