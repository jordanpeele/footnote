# DAYSPRINT HANDOFF — packet P-B · RUN2 CAPTURE FORENSICS

Branch: `worktree-agent-aee528dec431c5d36` (committed, NOT pushed).

## THE FORENSICS VERDICT: PHONE-CAPTURE (mic/wind), not bond, not monitor-chain.

Run2 (2026-08-15, Los Feliz, 111 min) had 48 dead-air fires and a 1839-fragment shred
(median 2 words). We already knew the CLIENT was stale (W1.3 window never ran — explains the
4 airs). P-B answers the question run2 could not: was the audio present at OBS but lost by
STT (monitor-chain), or genuinely absent (phone/bond)? Cross-correlating the OBS recording's
audio energy, the harness dead-air timestamps, and the relay srtla leg events:

- **Monitor-chain RULED OUT.** The OBS recording (`2026-08-15_07-20-45.mp4`, the OBS-received
  program audio) is ALSO quiet during the dead-airs. Inside the 42 measurable dead-air windows
  only **3.0%** of frames reach speech level (>−35 dB) vs **18.2%** outside — a 6× contrast.
  If OBS→BlackHole→Deepgram had been the fault, the recording would hold clear speech there.
  It doesn't. Per-window: 31 SILENT_AT_OBS, 10 LOW (wind), 1 weak-SPEECH, 6 pre-recording.
- **Bond RULED OUT (46/48).** Relay shows the bonded pair up and flowing for the whole walk;
  only 2 full-bond-drop events during the walk (14:56:31, 15:46:07 UTC). Exactly **2 of 48**
  dead-airs sit within ±20 s of a bond drop. The 14:10–14:12 UTC churn is the ingest-auth
  apply/rollback, not the walk.
- **⇒ PHONE-CAPTURE.** Bond up + OBS-side quiet ⇒ the phone captured near-silence/wind and
  streamed it faithfully. The loss is at the mic, upstream of the uplink.

## Is the wind back? YES — same regime, marginally milder than 8/14.

| metric | 8/14 | run2 |
|---|---|---|
| LRA | 18.8 LU | **21.4 LU** (wider) |
| sub-200Hz vs full-band | ~2 dB (very hot) | ~9 dB below (still LF-heavy; clean voice trails 10–15 dB) |
| true peak | gusts −0.3 dBFS | −4.9 dBFS (no hard clip this time) |
| silence ≥2 s | — | 67 periods / 8.0 min (9%), incl. a 183 s dead stretch |

Gust-dominated, low-SNR capture — the mechanism behind the shred (Deepgram endpoints on wind,
emits 1–2-word finals; 58% of gates ≤2 words). Slightly better than 8/14 (no clip, LF less
hot) but far from clean lav-near-mouth. The 8/14 prescriptions hold and are now field-proven
as THE fix path: mic near the mouth (earbuds into Moblin), OBS 120 Hz high-pass + limiter on
the relay source, same high-pass in the relay's future ffmpeg tap. None of these are the
window's job.

## Indoor validation read — STAGED.

`daysprint/synthetic/scripts/indoor-validation-claims.md`: a 5-min shredded-cadence
science/health + mixed script to run on a VERIFIED-FRESH client (BlackHole, indoor) to finally
get the window's real coverage. Exact steps: `npm start` → `/control` → hard-reload → **confirm
the harness `client_version` log reads `2026-08-15-w13-window+deadair`** (logged, not painted —
check DevTools console/Network, and abort if any `client_error` fires) → pick BlackHole 2ch →
read the script shredded. Expect coverage to recover toward **~100%** (`shred_only` replay pin
+ `redteam-audio-sweep.json`: the window drops zero words it receives). Contrast to run2:
`window_extract` should fire on nearly every claim vs 0 in run2; fragment count should collapse.

## Deliverables
- `docs/redteam/RUN2_CAPTURE_FORENSICS.md` — the verdict + full 42-window energy table +
  relay bond timeline + audio-regime measurements + method.
- `daysprint/synthetic/scripts/indoor-validation-claims.md` — the staged read.
- `daysprint-handoff-PB.md` — this file.
- **npm test: 442 pass / 2 skip / 0 fail** (green).

## Notes / caveats
- Dead-airs #1–#6 (07:14–07:20 PDT) fired before the 07:20:45 recording start; unmeasurable by
  energy. They overlap the auth-rollback churn, so at least the earliest are bond/auth-adjacent,
  not steady-state.
- The coverage COLLAPSE remains primarily the stale client; capture quality is the separate
  ceiling. Both must be fixed: fresh client (commit 79a4124, main tree) AND mic-to-mouth capture.
- All three data sources were read-only. Relay config untouched.
