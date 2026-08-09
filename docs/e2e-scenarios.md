# Browser-only e2e acceptance scenarios

These scenarios cover behavior the repo **cannot unit-test**: `app.js` is a classic browser
IIFE wired to live DOM, `localStorage`, timers, `window.confirm`, and real `/api/*` round-trips.
`node --test` never executes it. Until app.js is modularized, THIS document is the acceptance
harness — the scenarios are exact, repeatable recipes that were executed against the real app
(headless Playwright driving `/control`, no microphone needed). Where a scenario says
"simulated", that is an honest statement that the trigger was faked at the browser boundary
because the real trigger isn't reachable in a local dev run; what's under test in those cases
is the client behavior, which is fully exercised.

## Setup (all scenarios)

```
npm start            # single-process server, reads .env.local (real Anthropic/Perplexity keys)
# open http://localhost:3000/control  (headless: drive it with Playwright)
```

- **No mic required.** Click `● Start Stream`; in a headless browser `getUserMedia` may fail —
  that's fine: `streaming` is set and `gen` is bumped before the failure, and the **typed input**
  drives the full extract → verify → queue pipeline.
- Console hooks: `window.footnoteSession` (`.entries()`, `.summary()`) and `window.footnoteDebug`
  (`.events`).
- Gotcha: if another dev server holds `*:3000` on IPv6, `localhost` may route to it — use
  `http://127.0.0.1:3000/control`.
- Each `/control` origin+room persists a snapshot in `localStorage` (`footnote.session.<room>`);
  clear it (or use a fresh profile) for a clean run.

## 1 — P3-F generation guard: stale check across End/Start Stream (extract stage)

1. Click `● Start Stream` (gen → 1), tick **Auto-air**.
2. Submit a typed claim (≥ 6 words, e.g. *"The United States federal minimum wage is seven
   dollars and twenty five cents per hour and has not changed since 2009."*).
3. **Within ~400ms** (while `/api/extract` is in flight) click `■ End Stream` then
   `● Start Stream` (gen → 3).
4. Wait ~12s. Assert via `footnoteSession.entries()`:
   - the claim's entry has `action: "stale_generation"`, `aired: false`;
   - the queue contains **no** card for it; nothing is on air (`#onAir.hidden === true`);
   - DBG event `stale check dropped (stream ended during extract)`.

**Verified 2026-08-07:** entry `{action:"stale_generation", aired:false}`, 0 queue cards, on-air hidden.

## 2 — P3-F generation guard: stale check at verify stage (the auto-air window attack)

Same as #1, but flip End+Start **after** the card renders as "checking…" (extract done, verify
in flight — poll for `.fc-card.checking`, typically ~1s after submit). This is red-team H2's
worst case: without the guard, the verify result would land in the *new* stream's queue and
could auto-air inside the 4s veto window.

Assert: the checking card is **removed quietly** (no error card), its entry ends
`stale_generation`, nothing airs, DBG `stale check dropped (stream ended during verify)`.

**Verified 2026-08-07:** flip landed at +1004ms; entry 2 `stale_generation`; queue empty; on-air hidden.

## 3 — Positive control: a clean claim in the live stream still completes and auto-airs

With the stream live and Auto-air on, submit *"The Eiffel Tower is located in Paris France and
it was completed back in the year 1889."* and wait ~15s.

Assert: entry reaches a real disposition. If the server marks it `autoAirEligible` (D5 tier
gate — server-side and response-dependent), the card auto-airs after the 4s countdown:
`{action:"aired", aired:true, autoAired:true}` and the lower-third shows the claim. This proves
the new `c._gen === gen` timer condition does **not** block legitimate auto-air.

**Verified 2026-08-07:** first attempt returned `autoAirEligible:false` (server gate, correctly
held for manual); re-submit returned eligible and auto-aired: entry 4 `aired/autoAired:true`,
on-air visible. Both halves of the gate observed.

## 4 — M5: reload mid-check logs the orphaned card

1. Submit a typed claim; the instant the persisted snapshot contains a card with
   `state:"checking"` (poll `localStorage["footnote.session.<room>"]`), reload the page.
   (Timing matters: reload after verify settles and you'll just see a normal `pending` entry.)
2. After reload, assert:
   - the card is restored as an **error** card reading *"interrupted by reload — retry"*;
   - `footnoteSession.entries()` now contains an entry for it with `action:"error"`,
     `restored:true` (before M5 this card ended the night **unlogged**);
   - one DBG event `restored session {cards, entries, age_min}`.

**Verified 2026-08-07:** entry 6 `{action:"error", restored:true}`, error card rendered,
`restored session {"cards":4,"entries":6}`.

## 5 — M6: second tab on the same room

1. With tab A open on `/control`, open tab B on the same URL (same origin → same room).
2. Tab B blocks on `window.confirm`: *"Another control tab is live for this room. OK = take
   over… Cancel = open read-only"*. Choose **Cancel**.
3. In tab B assert:
   - queue header shows the badge `👁 read-only — another tab is live`;
   - clicking **AIR** on a pending card does nothing (card stays pending, no session mutation);
   - submitting a typed claim runs **no** check (entry count unchanged);
   - one DBG warn `read-only tab — action suppressed…`.
4. Take-over / losing-tab path (heartbeat-key simulation is acceptable and exact — the losing
   tab only ever sees the key): in the writer tab run
   `localStorage.setItem("footnote.tab.<room>", JSON.stringify({nonce:"foreign", t:Date.now()+50}))`
   and wait ≥ 2 heartbeat ticks (~4s). Assert the tab drops to read-only automatically
   (badge + warn `a newer control tab took over`) and stops writing the heartbeat key.

**Verified 2026-08-07:** confirm dialog fired on tab B load; Cancel → badge shown, AIR click and
typed check both suppressed (entries 6 → 6); simulated takeover → writer auto-dropped in < 4.5s,
key still held the foreign nonce (writer stopped writing).

## 6 — L2: honest p95 in summary()

Run fewer than 4 checks, then `footnoteSession.summary().latency`.

Assert every stage reports `{p50, p95, n}` with `p95: null` while `n < 4` (a 1-sample "p95" is
a lie); `p50` is always the median of whatever exists (`null` only when `n === 0`).

**Verified 2026-08-07:** `extract {p50:963, p95:null, n:3}`, `verify {p50:2099, p95:null, n:2}`,
`spokenToAir {p50:null, p95:null, n:0}`.

## 7 — Kill-switch paused UX (503 `{paused:true}`)

The real trigger is the D14 spendgate (`kill:global` via `/api/admin`), which **fails open
without a configured Upstash store** — so in a storeless local run the pause is *simulated at
the browser boundary* by patching `window.fetch` for `/api/extract` to return
`503 {"error":"paused by operator","paused":true}`. The server contract is pinned by
`test/` (spendgate unit tests); this scenario tests the client's reaction, which is identical
for a real 503.

1. Patch fetch (or engage the real kill switch on a store-backed deployment).
2. Submit **two** typed claims. Assert:
   - status line: `⏸ paused by operator — pipeline disabled` with class `ctrl-status paused` (amber);
   - **one** DBG warn total, not one per utterance;
   - **zero** cards created (no error dress — a pause is not a failure);
   - both claims logged with terminal `action:"paused"` (the record shows the gap honestly).
3. Unpatch (lift the switch), submit a clean claim. Assert the first non-paused response
   restores the normal status (`live` class) and emits `pipeline resumed (kill-switch lifted)`;
   the new claim completes normally.

**Verified 2026-08-07:** paused: amber status, 2 `paused` entries, 0 cards, 1 warn; resumed:
status `typed input · overlay live (no camera)` (class `ctrl-status live`), resume event, new
claim reached `pending`.

## Disposition model (the invariant these scenarios protect)

Every logged claim ends in exactly one terminal action:
`aired | skipped | held | error | expired | stale_generation | paused`.
Flags (`corrected`, `vetoed`, `autoAired`, `restored`) never replace a disposition.
`pending` is the only non-terminal action and only exists while a card is actionable.
See the comment block above `SESSION` in `app.js` for the full path enumeration.
