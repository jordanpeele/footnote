# Red-team: the transport — does mid-session failure fail LOUD or SILENT?

NIGHTSPRINT packet R-transport. The highest-severity failure class in this project's
lineage is SILENT failure (the FS-2 render-ack lineage: the system breaks without `/op`
showing it). Adversarial question, per failure mode: **when the transport fails
mid-session, is there an operator-visible signal on `/op`, or does dead air look identical
to a quiet speaker?**

## The one architectural fact that decides everything

The entire audio + STT chain lives in **`app.js`, in the `/control` browser at home base**:
`getUserMedia` → BlackHole/mic → `AudioContext` → ScriptProcessor → Deepgram WebSocket
(`dgWs`). The **only** thing that crosses to `/op` is the **queue snapshot**
(`op:"queue"` → `op:"queue-read"`), and `/control` pushes that snapshot **only on card
mutations** (`opBridge.scheduleQueuePush` / `pushNow`, fired from `schedulePersist` and
dismissals) plus a baseline at Start Stream.

Consequence: **when no STT finals arrive, no cards mutate, so no snapshot is pushed.** The
server holds the last snapshot for its 180s TTL; `/op` keeps polling and re-rendering it
with a **green conn dot** — because `/op`'s `connDot` reflects only whether `/op` can reach
the *server* (`api/onair.js` `queue-read`), never whether audio is reaching the *pipeline*.
Every transport failure below funnels into the same observable: **"no finals," which before
this sprint was indistinguishable from a quiet speaker.**

## Failure-mode × loud-or-silent × severity

| # | Failure mode | What the pipeline sees | `/op` signal BEFORE fix | Loud/Silent | Severity |
|---|---|---|---|---|---|
| a | **A bonded leg dies** (one SRTLA carrier drops; bond continues on the other) | Nothing — srtla reassembles; if the surviving leg holds, audio is continuous. If the bond can't cover, audio gaps/stops. | none (audio path is invisible to `/op`; conn dot green) | **SILENT** | **HIGH** if the bond collapses to dead-air; LOW if the surviving leg carries |
| b | **The relay drops entirely** (OBS caller loses its SRT source; BlackHole feeds pure silence into the pipeline) | Pure silence → **zero STT finals**. DG WS stays *open* (it's a healthy socket carrying silent audio) so `onclose`/reconnect never fires. | none — no cards, no mutation, no push; green conn dot | **SILENT** | **CRITICAL** — the worst case: the feed is dead, the mic looks hot, and `/op` looks perfectly healthy |
| c | **Deepgram WS disconnect mid-session** | `dgWs.onclose` fires. If `dgEverWorked`, capped-backoff auto-reconnect (`dgRetryT`, 0.5→5s). During the gap: no finals. | `DBG.event("warn", "Deepgram WS dropped…")` — but **DBG is a `/control` console only; it never crosses to `/op`.** Reconnect is silent to the street. | **SILENT on `/op`** (loud in the `/control` DBG log nobody on the street sees) | **HIGH** — a wedged reconnect (auth 4xx loop, quota) is dead-air with a "self-healing" label |
| d | **Bandwidth saturation** (partial/garbled audio) | DG still returns finals, but shredded/garbled — the session-2 endpointing pathology. Some claims get through mangled; worst case degrades toward (b). | Cards still flow (garbled), so snapshots still push. Partial visibility. Full saturation → silence → same as (b). | **PARTIAL → SILENT** at the limit | MEDIUM (garbled) → CRITICAL (full) |
| — | *(baseline: `/op` loses the server itself)* | n/a | conn dot → degraded/down + "offline — retrying" banner (poll loop, `FAILS_BEFORE_BANNER`) | **LOUD** (already) | — this is the ONLY transport-ish failure that was already loud, and it's the wrong one — it's the `/op`↔server link, not the feed |

### Ranked SILENT findings (the deliverable)

1. **(b) Relay drop → pure silence with a healthy-looking `/op`. CRITICAL.** The DG socket
   stays open on silent audio, so *nothing* in the client detects it and *nothing* crosses
   to `/op`. This is the exact shape of the FS-2 failure: the operator's console reports
   health while the broadcast is dead. **This is the finding.** A leg-collapse (a) or a
   full saturation (d) both degrade into this same observable.
2. **(c) DG WS disconnect / wedged reconnect. HIGH.** There *is* a signal —
   `DBG.event("warn", …)` — but it lands in the `/control` debug overlay at home base, which
   the street operator cannot see. From `/op` it is identical to (b). Auto-reconnect that
   never succeeds (rejected token, quota) is indefinite silent dead-air wearing a
   "self-healing" label.
3. **(a) Bonded leg death that collapses the bond. HIGH.** Same terminal observable as (b);
   listed separately because the leg-kill drill (P7-D, scrubbed in D18 pilot 2) is meant to
   prove survival — but survival was never *observable on `/op`*, only inferable from cards
   still flowing.
4. **(d) Bandwidth saturation, partial. MEDIUM→CRITICAL.** Garbled finals still push cards
   (partial visibility); full saturation is (b).

The through-line: **four distinct transport failures, one silent observable — "the finals
stopped" — and before this sprint that was byte-identical to a speaker who paused.**

## The GREEN fix shipped this sprint — a dead-air detector

Display-layer, additive, FS-2 lineage ("making dead-air legible is high-value"). **Touches
no auth/relay infra (RED/BLACK) — this is observability of failure, not prevention.**

- **`app.js` (`/control`) — the watchdog.** Every real STT final (Deepgram `is_final`, and
  the chunked-fallback transcript) stamps `lastFinalAt` via `noteFinalHeard()`. A 2s
  interval (`deadairCheck`, armed at Start Stream, cleared at End Stream) flips `sttStale`
  when **`streaming && !muted && !pipelinePaused`** and no final has arrived for
  **`DEADAIR_MS` (12s)**. The transition — both to stale and back — forces an immediate
  `opBridge.pushNow()`, so the signal crosses to `/op` **even though no card mutated**
  (closing the exact gap above). Locally it also flips the `/control` status line to
  "⚠ NO AUDIO REACHING PIPELINE".
  - *Why gated on `!muted`*: muting zeroes the bus on purpose (no finals expected) — a MUTE
    banner already owns that silence; the watchdog must not cry wolf on it.
  - *Why edge-pushed, level-held*: `/control` pushes `sttStale:true` once; the server holds
    it in the snapshot (180s TTL) so every `/op` poll reads it; audio restoring pushes
    `false`. No per-tick spam.
- **`api/onair.js` — the contract.** `op:"queue"` accepts `sttStale` as a **strict boolean**
  (`=== true`, same discipline as `muted` — a truthy non-boolean must never trip the
  banner); `op:"queue-read"` returns it. Additive to the existing
  `{cards,muted,attn,autoair,renderedId}` snapshot; disturbs none of them.
- **`operator.js` + `operator.css` (`/op`) — the banner.** A dead-air banner distinct from
  BOTH the MUTE banner (solid amber = intentional silence) AND the offline conn dot (lost
  *server* link): **red, slow-pulsing, "⚠ NO AUDIO REACHING PIPELINE — check the feed /
  relay"**, meaning *the link is fine but no audio is reaching the pipeline*. Driven every
  poll tick off `q.sttStale` (not gated on `qseq`, because a deaf pipeline never advances
  `qseq`). Suppressed while muted — MUTE owns that silence.

### What the detector makes LOUD

| # | Failure mode | After the fix |
|---|---|---|
| a | leg death → bond collapse → silence | **LOUD** — 12s of no finals trips the dead-air banner on `/op` |
| b | relay drop → pure silence | **LOUD** — the critical case is now the loudest: red pulsing banner on the street phone |
| c | DG WS disconnect | **LOUD if the gap exceeds 12s** — the reconnect no longer hides behind `/control`-only DBG; a wedged reconnect stays lit until finals resume |
| d | saturation → silence | **LOUD** at the silent limit; garbled-but-flowing is unchanged (cards still surface) |

### Honest limits (not fixed — out of red-team scope)

- **12s latency to detection** — a deliberate floor so a normal between-sentence pause never
  false-trips. Tunable via `DEADAIR_MS`; not yet field-measured against real pacing.
- **If `/control` itself dies** while stale, the snapshot's 180s TTL lapses and `/op` empties
  (pre-existing "dead control" behavior). The detector reports a deaf *pipeline*, not a dead
  *control host* — that's the queue-TTL's job.
- **No live-audio simulator exists.** `tools/demo/` replays *cards* through `/api/onair`,
  bypassing extract/verify/transcribe — so a transport drop can't be reproduced by injecting
  silent audio. Per the packet, the simulation is at the STT-disconnect / no-finals layer;
  the shipped tests (`test/deadair-flag.test.js`) pin the snapshot contract that carries the
  signal end to end (`op:"queue"` → `op:"queue-read"`), including strict-boolean rejection,
  independence from `muted`, clear-on-restore, and coexistence with the other snapshot
  fields.

## Verdict

Before this sprint: **4 transport failure modes, all SILENT on `/op`** (the only "loud"
transport signal was the wrong one — the `/op`↔server link, not the feed). The dead-air
detector converts the silent-observable core ("the finals stopped while the mic is hot")
into a loud, distinct, street-visible red banner — the FS-2 lineage applied to the transport
instead of the render. Silent-failure count going in: **4** (a, b, c, d). Detector shipped:
**yes.**
