# daysprint handoff — R-transport (red-team the transport)

**Branch:** `daysprint/Rtransport-deadair` · **npm test:** green (249 pass, 2 skip, 0 fail;
+6 new) · **do NOT push** (per packet).

## The adversarial question
When the transport fails mid-session — a bonded leg dies, the relay drops, the Deepgram WS
disconnects, bandwidth saturates — does the system fail **LOUD** (visible on `/op`) or
**SILENT**? Silent is the highest-severity class (the FS-2 render-ack lineage).

## Finding: 4 transport failure modes, all SILENT on `/op` before this sprint
The whole audio+STT chain lives in `app.js` on `/control` at home base. The only thing that
crosses to `/op` is the queue snapshot — and `/control` pushes it **only on card mutations**.
When the transport goes deaf there are no finals → no mutations → no push. `/op` keeps
rendering the last snapshot with a **green conn dot** (it can still reach the *server*),
**indistinguishable from a quiet speaker.**

Ranked silent findings (full table in `daysprint/handoffs/redteam-transport.md`):
1. **(b) Relay drop → pure silence, healthy-looking `/op`. CRITICAL.** DG socket stays open
   on silent audio; nothing detects it; nothing crosses to `/op`. Exact FS-2 shape. **This
   is the finding.** (a) leg-collapse and (d) full-saturation both degrade into this.
2. **(c) DG WS disconnect / wedged reconnect. HIGH.** A warn exists — but only in the
   `/control` DBG console the street can't see.
3. **(a) Bonded leg death that collapses the bond. HIGH.**
4. **(d) Bandwidth saturation → silence. MEDIUM→CRITICAL.**

(The only transport-ish failure already loud was the *wrong* one: `/op` losing the *server*
→ "offline" banner. That's the `/op`↔server link, not the feed.)

## Shipped: a dead-air detector (GREEN — display-layer, additive, no auth/relay touched)
- **`app.js`** — a watchdog stamps every real STT final (DG `is_final` + chunked fallback via
  `noteFinalHeard()`); a 2s check flips `sttStale` when `streaming && !muted && !pipelinePaused`
  and no final for `DEADAIR_MS` (12s), forcing a snapshot `pushNow()` so the signal reaches
  `/op` **with no card mutation**. Local `/control` status also goes red.
- **`api/onair.js`** — `op:"queue"` accepts `sttStale` as a **strict boolean** (like `muted`);
  `op:"queue-read"` returns it. Additive; disturbs no existing snapshot field.
- **`operator.js` + `operator.css`** — a **red, slow-pulsing** dead-air banner "⚠ NO AUDIO
  REACHING PIPELINE — check the feed / relay", deliberately distinct from the MUTE banner
  (intentional silence) and the offline conn dot (lost server). Driven every poll tick off
  `q.sttStale` (not gated on `qseq` — a deaf pipeline never advances it); suppressed while
  muted.

After the fix: (a)(b)(c)(d) all become **LOUD** at the 12s silent threshold — the critical
relay-drop case is now the loudest thing on the street phone.

## Tests
`test/deadair-flag.test.js` (6, all pass) pins the snapshot contract that carries the signal
end to end: true rides through, absent→false, strict-boolean rejection (no false alarm),
clear-on-restore, independence from `muted`, coexistence with cards/autoair/attn.

## Honest limits (not fixed — out of scope)
- 12s detection latency (deliberate floor vs pause false-trips; `DEADAIR_MS`-tunable, not
  yet field-measured).
- If `/control` *itself* dies, the snapshot's 180s TTL empties `/op` (pre-existing behavior);
  the detector reports a deaf pipeline, not a dead control host.
- No live-audio simulator exists — `tools/demo/` replays cards through `/api/onair`, bypassing
  transcribe. Per the packet, the sim is at the no-finals layer; the tests pin that contract.

## Files touched
`app.js`, `api/onair.js`, `operator.js`, `operator.css`, `test/deadair-flag.test.js` (new),
`daysprint/handoffs/redteam-transport.md` (new), this file.
