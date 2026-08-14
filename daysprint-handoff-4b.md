# DAYSPRINT handoff — packet 4b · DEMO REFRESH + README GIF

Branch: `worktree-agent-a716428a8a834649f` · committed, NOT pushed · 2026-08-14

Two deliverables: the demo fixture now replays a representative card set from
every PILOT era with each era's own choreography, and the README's
launch-era GIF placeholder is finally an actual GIF of `npm run demo`.

**Note:** this branch merged `main` first (fast-forward, no conflicts) to pick
up tonight's packet-0c pacing choreography — the GIF captures it (item 3's
"let the elegance mandate show" clause).

## 1 · Demo-mode refresh (`tools/demo/fixture.json` + `tools/demo/run.js`)

The fixture grew a per-card `demo: { mode, era }` annotation and run.js grew
scene handlers so each card replays the way its era actually ran. All cards
are real checks from the public record (docs field reports + eval/golden
adjudications — raw session JSONLs are gitignored and were not touched):

| mode | card(s) | era / receipt |
|---|---|---|
| `auto` ×3 | *Smoking increases the risk of lung cancer* (True ·99 · CDC), *Lightning can strike the same place twice* (True ·99 · NWS), ***Measles vaccine does not cause autism*** (True ·99 · CDC) | D18 pilot session 1 (2026-08-12): each runs the pilot's REAL 4s veto window on /op (a visitor SKIP genuinely vetoes — server N4 guards arbitrate), then the machine airs it via direct publish with `autoAired:true` → receipts show **AUTO · machine-aired**, /op shows the `AUTO n/10` cap chip (session cap 10, replayed). The measles card is one of the first machine-aired polarity-applied verdicts — D17 framing intact (claim keeps the speaker's denial, canonical is the positive form). |
| `testair` | *GDP growth in the United States in 2019 was 4%* (False ·99 · BEA) | PASS-2 (2026-08-09): settled verdict airs immediately with `test:true` → the overlay renders the **TEST watermark**. |
| `hold` | *The president of the United States is Peter Thiel* (False ·99 · AP) | Person-hold: `person_public` → **MANUAL — person** tag on /op, demo issues a real op:"cmd" HOLD — never aired. (Disposition is demo choreography — the card was operator-aired in its original 08-08 session; the fixture `$comment` says so.) |
| `skip` | *AI data centers… 40 states* (Unverifiable) | R41 street norm — don't air what we couldn't verify. |
| `operator` | gold/silver, Trump (person → MANUAL tag, human-aired), Kinshasa, crime (NeedsContext), FS-1 four-minute-mile | veto window then the human-path air (op:"cmd"), as before. |

Mechanics notes:
- Machine/TESTAIR airs use the **direct publish path** (the same wire /control
  uses for auto-air) — op:"cmd" is the human path and `slimQCard` correctly
  refuses to carry `test`/`autoAired`, so this split is faithful, not a hack.
- Consecutive `auto` cards batch into one D18 scene; machine airs land ~4.8s
  apart — inside the pacer's 6s dwell — so /overlay shows the 0c choreography
  (full dwell → exit → entrance beat, no flash-replace).
- Demo pacing tightened slightly (display 8s→6.5s, gap 2.5s→1.8s) and a
  capture-rig pre-roll knob added (`FOOTNOTE_DEMO_START_DELAY_MS`, capped 60s).
- README's demo one-liner also fixed: it claimed the demo runs on :3000 (it
  runs on :3400+) — now says "open the URLs it prints".

Tests: `test/demo-fixture.test.js` gained two contract tests — `demo.mode`
vocabulary, and a pilot-era coverage test (≥1 AUTO science card that passes the
D18-style gate shape, ≥1 machine-aired D17 denial where `hasNegation(claim)`
and not `hasNegation(canonical)`, ≥1 person-hold, ≥1 TESTAIR). Privacy
regression unchanged and passing.

## 2 · README demo GIF (`media/demo.gif`)

**941 KB · 19.4s · 97 frames @ 5fps · 1280×680**, ffmpeg palettegen/paletteuse
(256 colors, sierra2_4a). Replaces the `<!-- demo.gif lands from G4 -->`
placeholder with the image + a one-line caption.

What it honestly shows, in order: the gold/silver check lands in the /op queue
(CHECKING → verdict), the operator taps AIR (a real Playwright click on the
real /op page — logged as "AIRED by a visitor on /op"), the lower-third
renders on the program-feed stage with PRIMARY SOURCE tag and countdown bar,
retires — then the D18 burst: three science cards fill the queue, the
`AUTO 0/10 → 2/10` chip ticks as the machine airs them, and the smoking →
lightning takeover is **paced** by the 0c display choreography. One edit: a
~9s stretch where the overlay is empty (burst verify + first veto window) is
compressed to ~3s by frame-dropping; every rendered moment is real-time.

Capture rig (committed for reproducibility): `tools/demo/capture.html` — a
static stage that frames the two REAL demo pages (/overlay in a 16:9
"program feed" with a labeled stand-in backdrop, /op in a phone bezel).
Driven by Playwright MCP (`browser_run_code_unsafe`: wait for the gold card,
screenshot loop ~5fps, click AIR mid-loop). Frames → ffmpeg palettegen/
paletteuse → GIF. The demo server happily serves it at
`/tools/demo/capture.html?base=…&key=…` (static root serving, same as
/adjudicate).

## 3 · State

- `npm test`: **318 tests, 316 pass, 0 fail, 2 skipped** (both pre-existing
  env-dependent skips; the demo smoke test runs and passes with the new
  fixture + scene runner).
- Verified live twice end-to-end (full fixture pass on :3450, capture pass on
  :3455): receipts log carries `autoAired:true` ×3 + `test:true` on the GDP
  card; HOLD leaves the Thiel card unaired; visitor AIR beat the countdown
  when clicked mid-window.
- NOT pushed (per packet + standing push-authorization rule). GIF binary is
  committed on the branch as instructed.

## Open questions / residuals

- Cycle 1's smoking card can be visitor-aired (as any card can) — then it's
  not AUTO-marked on receipts for that pass. That's the veto working, not a
  bug; the next pass re-establishes the AUTO receipts.
- The pilot-session-1 raw log isn't public, so the three auto cards' aired
  sources are the golden-set adjudicated sources (CDC/NWS — tier-3 .gov,
  consistent with the report's "all ten passed the tier gate"). If the
  orchestrator wants receipt-exact sources, that needs the private session
  export.
- `media/demo.gif` can be regenerated with the committed rig; era set will
  drift as new pilots land — refresh cadence is an orchestrator call.
