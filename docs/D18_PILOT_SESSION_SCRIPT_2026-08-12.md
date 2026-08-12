# D18 pilot — session script · 2026-08-12 · science_health only

Read claims aloud, one at a time, with a beat between them. EVERY claim must
be at least SIX words — shorter finals are silently dropped as STT fragments
(app.js fragment guard). If you improvise, count words. Speak naturally —
this is a fact-check of what you SAY, not what you paste. Stay on this sheet;
the science_health scope is enforced by protocol, not code.

## Console setup (before Start Stream)

1. Terminal 2: `node tools/fieldtest/dashboard.js eval/results/fieldtest-2026-08-12-d18pilot.jsonl`
2. Browser: `http://localhost:3000/control` — **NO `?testair`**.
3. Phone (optional but wanted for FS-2): `/op` via tailnet — render-ack + remote veto.
4. Check **Auto-air ON**. First time with intent. Then Start Stream.

Abort at any time: uncheck Auto-air (instant) or kill switch:
`curl "http://localhost:3000/api/admin?token=$ADMIN_TOKEN&op=kill"`

## Segment 1 — clean auto-airs (let the countdown run)

1. "Water boils at 100 degrees Celsius at sea level."
2. "The adult human body has 206 bones."
3. "Smoking increases the risk of lung cancer."
4. "Humans use only ten percent of their brains."
5. "Vitamin C is a water-soluble vitamin."

## Segment 2 — the two deliberate VETOES

On each of these, when the card arms and the 4-second countdown starts,
hit **Skip** (or Hold) BEFORE it fires. That's the veto — it's recorded as
`vetoed`, and it must NOT consume the cap.

6. "Cracking your knuckles causes arthritis in your hands."
7. "Goldfish only have a memory of three seconds."

## Segment 3 — the holds (must never arm)

8. **D4 person-claim** — must go to the hold queue, no countdown ever:
   "Dr. Anthony Fauci lied about the origins of COVID."
9. **Denial (polarity path)** — expect speaker-framed display (D17), polarity
   machinery visible in the log:
   "It's not true that vitamin C cures the common cold."

## Segment 4 — FS-2 drill (after ~5 auto-airs have fired)

While a card is ON AIR: lock the screen (Ctrl+Cmd+Q). Wait ~90 seconds.
Unlock. Watch /op on the phone the whole time — if rendering throttles,
render-ack must show STALL. Either outcome is a pass; **silence is the only
failure.** Note the wall-clock times.

## Segment 5 — run out the cap (keep reading until the cap warning)

Continue until the debug log shows the one-time cap warning
("auto-air session cap (10) reached") and a subsequent eligible card does
NOT arm. Vetoes in Segment 2 didn't consume the cap, so this takes a few:

10. "The measles vaccine does not cause autism in children."
11. "Lightning can strike the same place twice."
12. "Bats are not actually blind, they can see."
13. "Sugar does not make children hyperactive."
14. "Antibiotics do not work against viruses."
15. "The Sun at the center of our solar system is a star."
16. "Exercise reduces the risk of heart disease."
17. "The human heart beats about 100,000 times a day."
18. "Adult humans have 32 teeth including wisdom teeth."

(Some of these may merge NeedsContext or land under the floor and hold —
that's normal and doesn't count toward the cap. Keep going down the list
until the cap wall is proven: 10 fired + at least one eligible card that
stays manual.)

## End

End Stream (R20 auto-exports the session). Then, **before anything else, the
attention debrief** (orchestrator addendum): for EACH card that auto-aired,
say what you were doing during its 4-second veto window —

- **watching** — eyes on the countdown, could have vetoed
- **talking** — mid-claim / mid-sentence, would have had to interrupt yourself
- **away** — eyes off the console (phone, overlay, room)

Do it immediately from memory, card by card in air order, while it's fresh.
The report pairs each card's veto-window timing with your attention state —
this is the evidence for whether 4s is a real veto or a formality.

Then hand off — the field report gets written from the harness log, with a
dedicated auto-air section (timing × attention per card), plus the FS-2
re-verify result.
