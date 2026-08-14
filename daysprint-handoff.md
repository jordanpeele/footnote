# DAYSPRINT handoff — packet 0c · STREET AUTO-AIR UX ("elegant" mandate)

Branch: `worktree-agent-a613e10ff441cd39d` · committed, NOT pushed · 2026-08-14

North star delivered: consecutive hands-free cards now air with broadcast-grade
pacing on BOTH display surfaces (control's local lower-third and the OBS
/overlay), and /op leads with a glance strip that reads at arm's length.
**Nothing in the decision layer moved**: eligibility, gates, caps, veto timing,
the category allowlist and every line of `maybeAutoAir` are byte-identical.

## 1 · What changed

### On-air pacing queue (display layer only)

- **`pacer.js` (NEW, repo root)** — shared classic `<script>` (also
  ESM-importable for tests via `globalThis.FootnotePacer`). Pure helpers
  (`dwellRemaining`, bounded-FIFO `enqueue`) + an injectable-clock state
  machine (`createPacer`). Tunables: `MIN_DWELL_MS 6000` (6s of the 10s hold),
  `EXIT_MS 260` (matches the CSS fade), `MAX_QUEUE 8` (bounds display drift;
  oldest *queued, never-shown* card drops from display only — session log /
  receipts are upstream and unaffected; drops emit a `pace:drop` event).
- **`app.js`** — `showOnAir` is now the paced entry; the old body is the
  painter `renderOnAirNow` (reached only through the pacer, with a legacy
  immediate-swap fallback if pacer.js failed to load). Every air funnels
  through it identically: operator click, keyboard `A`, auto-air, TESTAIR,
  second-phone AIR (`opApplyCmd`). Natural countdown end → `retire()`
  (promotes a queued card instantly — empty stage owes no dwell). PULL /
  stream boundaries (`pullOnAir`, `clearFactChecks`, `/op` pull) →
  `clearOnAir()` (flushes queued cards too). Pacing telemetry rides the
  existing FT sink (`ev:"pace"`, local-only).
- **`overlay.js`** — same pacer on the OBS surface. Extra care: a card that
  waited on the shelf gets `max(serverRemaining − waited, MIN_DWELL)` on
  screen; the R39 render-ack now fires at **paint** time (`onPaint` hook in
  the painter), not at poll-decision time, so ✓✓ still means pixels. Pulls
  (`seq` change, not live) flush the queue.
- **`index.html` / `overlay.html`** — load `/pacer.js` before the page script.
- **`src/server/index.js` / `vercel.json`** — `/pacer.js` added to the
  no-cache set.

### /op glanceability pass

- **`operator.html`** — new sticky **glance strip** under a demoted header:
  AUTO chip (`#gAuto`, the existing W4 chip relocated + enlarged), MUTE
  (`#gMute` — the state chip IS the toggle, amber `MIC MUTED` when latched;
  the old separate MIC MUTED banner is gone), last-aired verdict + one-line
  claim (`#gLastV`/`#gLastC` — persists after the card retires), and an
  aggregated STALL bar (`#gStall`).
- **`operator.js`** — strip wiring (`setLastAired` from the on-air poll,
  `updateGlance` aggregates any per-card stall), mute button/banner creation
  removed. **`STALL_MS` 5000 → 8000**: a paced takeover legitimately delays
  the paint/ack by dwell (6s) + exit + a poll tick, and the old 5s would
  false-alarm on every consecutive air (per-card AIRED✓/ON AIR✓✓/STALL
  machine otherwise unchanged; late acks still clear a stall).
- **`operator.css`** — glance styles, header demotion, dead mute-banner rules
  removed. Thumb targets: MUTE 48px min-height; AIR/HOLD/SKIP untouched.

### Tests

- **`test/pacing.test.js` (NEW)** — 14 tests, deterministic fake clock/timer:
  dwell math, bounded FIFO purity, immediate first paint, burst spacing with
  the **no-collision invariant** (exactly one exit between any two consecutive
  renders, entrance exactly EXIT_MS after it), post-dwell instant takeover,
  retire-promotes-immediately, clear-flushes (incl. mid-exit-gap), drop-oldest
  with event, hold-card yielding, tunable pins, and a wiring guard that both
  HTML pages load pacer.js before their app script.
- `npm test`: **257 pass / 0 fail** (2 pre-existing environment skips).

## 2 · E2E proof (TESTAIR, stub adapters, no keys)

Server: `FOOTNOTE_EXTRACTOR=stub FOOTNOTE_VERIFIER=stub
FOOTNOTE_FIELDTEST_LOG=… PORT=3400 node src/server/index.js`; driven with
Playwright at `/control?testair=1`, burst of **6** typed claims fired in one
tick (all six settled and queued within **14ms** of each other).

Observed choreography — control lower-third (40ms DOM sampler; times relative
to burst):

| card (settle order) | painted at | dwell on screen | gap to next |
|---|---|---|---|
| 1 | 0.25s | 6.03s | 241ms |
| 2 | 6.52s | 6.00s | 279ms |
| 3 | 12.80s | 6.00s | 240ms |
| 4 | 19.04s | 6.00s | 279ms |
| 5 | 25.32s | 6.00s | 239ms |
| 6 | 31.56s | **10.04s** (full window — nothing queued behind it) | — |

FT telemetry agrees to the millisecond: presents at 0 / 6257 / 12520 / 18783 /
25048 / 31312 — a 6260ms cadence (6000 dwell + 260 exit), takeover events at
each dwell boundary. **No-collision assertion: at no sampled instant did one
card replace another without an off-air exit gap between them; zero
flash-replaces; 6/6 cards aired; zero drops** (bound 8 never hit).

Same burst driven on `/overlay` via the public paced API
(`footnoteOverlay.air` ×5): strict FIFO, dwells 5.96/6.00/6.00/6.00s, final
card 11.0s (full overlay DUR), gaps ~280ms.

Note (expected, decision-layer): TESTAIR airs on *verify settle*, and stub
verifies complete in parallel — so burst *air order* is settle order, not
typed order. The pacer is strictly FIFO on airs (proven in the overlay run).

Artifacts (untracked, in `artifacts/`): `pace-card1-onair.png` (control,
card 1 up), `pace-overlay-card2.png` (overlay mid-burst), `op-glance-strip.png`
(/op at 390×844: strip with AUTO 3/10 + last-aired FALSE line + live on-air +
queue card), `op-glance-muted.png` (amber MIC MUTED latch; last-aired line
persisting after the on-air card retired), `footnote-pace-e2e.jsonl` (full FT
log incl. the `pace` events above).

## 3 · Risks / notes for the next shard

- **Server state is still last-write-wins.** The pacer is display-side; a
  fast burst can outrun the overlay's 400ms poll so the OBS surface may skip
  an intermediate card the control surface showed (pre-existing behavior,
  now the only remaining gap; receipts always have everything). A server-side
  air queue would close it but is a protocol change — deliberately not
  touched.
- **Superseded-card acks 409.** A card that waits behind another can ack an
  id the server no longer holds current → per-card ✓✓ may not appear when
  control is down (cosmetic; card still paints; documented in overlay.js).
- **STALL_MS 8000** trades ~3s of stall-detection latency for zero
  false alarms under pacing (alerting noise is net-negative). Deep machine
  bursts (>1 queued) can still show a transient STALL that self-clears.
- **Display can trail live by up to ~48s** in a pathological 8-deep queue
  (TESTAIR-only in practice; D18 cap 10 bounds the auto path). `MAX_QUEUE`
  is the knob if the field wants tighter.
- Correction cards ride the same pacing (they're just cards to this layer) —
  a correction aired during a burst waits its turn like everything else.
- Not touched: `maybeAutoAir` (verified byte-identical), veto timer, caps,
  category allowlist, harm holds, spendgate, /api routes.
