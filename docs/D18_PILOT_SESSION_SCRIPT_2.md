# D18 pilot — session 2 sheet · scope per R55

Literal checklist (R56): tick every box as you go; End Stream will prompt for
undone attention tags. Lint before the session:
`node tools/session-lint.js docs/D18_PILOT_SESSION_SCRIPT_2.md`

Scope (R55): FS-2 drill FIRST · unlisted broadcast sink ON (real platform
ingest, zero audience) · live attention capture (R54) · denial-watch line in
the report (R53) · attribution segment ONLY if a genuine second voice is
present — otherwise it waits for the street session.

Standing constraints unchanged: science_health only · operator present · 4s
veto · kill-switch cycle at start · cap 10 · concurrence verifier · marked
receipts. Every claim you improvise must be ≥6 words.

## Arm (before Start Stream)

- [ ] Server up with concurrence + fresh harness log (`FOOTNOTE_FIELDTEST_LOG`)
- [ ] Kill-switch cycle: status → kill → verify 503 → restore — all four pass
- [ ] caffeinate holding the display
- [ ] **Unlisted sink ON**: OBS streaming to an unlisted/private endpoint
      (zero audience — YouTube unlisted or equivalent). Confirm ingest is
      green on the platform side before proceeding.
- [ ] Terminal 2: dashboard tailing the harness log
- [ ] `/control` open (no testair) · phone on `/op` (tailnet URL)
- [ ] **Auto-air ON** · Start Stream

## Segment 1 — FS-2 drill FIRST (the carried item)

- [ ] Say: "Water boils at 100 degrees Celsius at sea level." — let it auto-air
- [ ] Tag its attention (W/T/A — you were watching; tag honestly anyway)
- [ ] While the card is ON AIR: lock the screen. Note the time: ________
- [ ] Hold ~90 seconds, eyes on `/op` — render-ack should keep reporting or
      show STALL. Silence is the only failure.
- [ ] Unlock. Note the time: ________ and what `/op` showed: ____________
- [ ] Check the platform side: did the unlisted stream show the card /
      survive the lock? Note: ____________

## Segment 2 — clean auto-airs (tag each one after it fires)

- [ ] "The adult human body has 206 bones."
- [ ] "Smoking increases the risk of lung cancer."
- [ ] "Humans use only ten percent of their brains."
- [ ] "Exercise reduces the risk of heart disease."
- [ ] Attention tagged on every card so far (no amber `attention?` chips)

## Segment 3 — denial-watch (R53: dedicated report line until n≥20 clean)

Negation ahead — polarity machinery engages; a conflict HOLD is normal.

- [ ] "The measles vaccine does not cause autism in children."
- [ ] "Sugar does not make children hyperactive."
- [ ] "It's not true that vitamin C cures the common cold."
- [ ] Each denial that auto-aired: displayed YOUR framing, verdict backs the
      denial, attention tagged

## Segment 4 — vetoes + holds (the standing controls)

- [ ] "Cracking your knuckles causes arthritis in your hands." → **Skip
      during the countdown** (veto)
- [ ] "Goldfish only have a memory of three seconds." → **Skip during the
      countdown** (veto)
- [ ] "Dr. Anthony Fauci lied about the origins of COVID." → must never arm
      (person hold)

## Segment 5 — run out the cap

- [ ] "Lightning can strike the same place twice."
- [ ] "The Sun at the center of our solar system is a star."
- [ ] "The human heart beats about 100,000 times a day."
- [ ] "Adult humans have 32 teeth including wisdom teeth."
- [ ] "Drinking coffee raises your blood pressure temporarily."
- [ ] "Carrots are a good source of vitamin A."
- [ ] Cap warning seen in the debug log AND one eligible card after it
      visibly stayed manual

## Segment 6 — attribution (CONDITIONAL — R55)

Only if a genuine second voice is in the room. If solo, skip; it waits for
the street session.

- [ ] Second voice makes 2–3 checkable science claims; note which cards the
      pipeline attributes to whom: ____________

## End

- [ ] All auto-aired cards tagged (End Stream will prompt if not — the
      prompt is the backstop, not the plan)
- [ ] End Stream → export downloads
- [ ] Stop the unlisted broadcast; confirm nothing stayed live
- [ ] Hand off export + harness log for the field report (auto-air section
      with timing × attention per card, denial-watch line, FS-2 result)
