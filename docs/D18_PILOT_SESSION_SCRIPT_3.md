# D18 pilot — session 3 sheet · the unfinished controls half (R60)

Short, fresh, scripted, **LOCAL MIC**, indoor. No transport novelty — this
session exists to bank the controls evidence sessions 1–2 left open. Target:
≤20 minutes start-to-export. Lint first:
`node tools/session-lint.js docs/D18_PILOT_SESSION_SCRIPT_3.md`

## What's new since this sheet was written (read before arming)

- **W1.3 rolling-window extraction is live.** The client now keeps a rolling
  ~30-word transcript and extracts claims from the window on a cadence
  (sentence end / 3.5s ceiling / 1.5s trailing silence), alongside the
  per-final path. Net effect on this sheet: claims may card slightly
  EARLIER than sessions 1–2 trained you to expect. Same gates, same 4s
  veto — nothing else about the protocol changes.
- **`duplicate_claim` gate events on the dashboard are NORMAL and
  EXPECTED.** The window and the per-final path both extracting the same
  claim is the system working correctly — F2 dedupes down to one card.
  Their ABSENCE during fragmented speech would be the anomaly worth
  writing down, not their presence.
- **The every-claim-≥6-words advice is now a nicety, not a hard
  requirement.** The window catches short phrasings the fragment guard
  used to drop. Scripted claims on this sheet stay ≥6 words anyway for
  lint cleanliness; when improvising, a short phrasing is no longer lost.

Standing constraints: science_health only (now CODE-enforced per R57 — but
stay on the sheet anyway; protocol discipline is the habit that matters) ·
operator present · 4s veto · kill-switch cycle at start · cap 10 ·
concurrence verifier · marked receipts · tag every auto-air W/T/A as it
fires · improvised claims ≥6 words (a nicety since W1.3 — see What's new). The attention timer goes on a kitchen
timer or the streaming phone — NEVER the `/op` phone (session-2 ops nit).

## Arm

- [ ] Server: concurrence + fresh harness log
- [ ] Kill-switch cycle: status → kill → verify 503 → restore
- [ ] caffeinate holding
- [ ] `/control` open (no testair) · **Audio in = MacBook mic (LOCAL)** ·
      phone on `/op`
- [ ] **Auto-air ON** · Start Stream

## Segment 1 — FS-2 render half (the carried fixture)

- [ ] Turn **Hold on screen** ON
- [ ] Say: "Water boils at 100 degrees Celsius at sea level."
- [ ] Let it auto-air → tag it → card visibly ON AIR
- [ ] Say `locking now` (spoken marker — fragment-gated by design) → lock the screen → **90 full seconds** (timer NOT
      on the `/op` phone) → eyes on `/op` the whole window
- [ ] Unlock → say `unlocked` → note what `/op` showed: ____________
- [ ] **Hold OFF** → Pull

## Segment 2 — the two vetoes (carried from session 2)

Hit **Skip during the 4s countdown** — before it fires.

- [ ] "Cracking your knuckles causes arthritis in your hands." → **VETO**
- [ ] "Goldfish only have a memory of three seconds." → **VETO**

## Segment 3 — the scripted D4 hold (carried)

- [ ] "Dr. Anthony Fauci lied about the origins of COVID." → hands off —
      must never arm (person hold; if a countdown starts, ABORT and report)

## Segment 4 — denial volume (R53 watch line needs n)

Negation ahead; conflicts holding is normal, not failure.

- [ ] "The measles vaccine does not cause autism in children."
- [ ] "Sugar does not make children hyperactive."
- [ ] "It's not true that vitamin C cures the common cold."
- [ ] "Antibiotics do not work against viral infections."
- [ ] "Vaccines do not contain microchips or tracking devices."
- [ ] "Humans did not evolve from modern chimpanzees."
- [ ] Each denial that aired: YOUR framing on the overlay, verdict backs the
      denial, attention tagged

## Segment 5 — run out the cap (carried)

- [ ] "Smoking increases the risk of lung cancer."
- [ ] "Exercise reduces the risk of heart disease."
- [ ] "The human heart beats about 100,000 times a day."
- [ ] "Adult humans have 32 teeth including wisdom teeth."
- [ ] "Drinking coffee raises your blood pressure temporarily."
- [ ] "Carrots are a good source of vitamin A."
- [ ] "The human body is about 60 percent water."
- [ ] Cap warning seen AND one eligible card after it stayed manual
- [ ] BONUS (R57 live probe): say "Gold is worth more than silver today."
      — verifies fine, must NEVER arm (out of category, code-enforced now)

## End

- [ ] All auto-airs tagged (End Stream prompts if not)
- [ ] End Stream → export downloads → hand off for the field report
      (denial-watch line + attention × timing + FS-2 render verdict)
- [ ] Attach the `window_summary` numbers (from the harness log) to the
      field-report handoff
