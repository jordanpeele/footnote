# Run-test field report — 2026-08-14, Los Feliz (32:43, TESTAIR mode)

First out-of-apartment session: operator on a run, Mac home alone, Moblin on
cell → cloud relay → OBS caller → pipeline. Run in **TESTAIR** (every settled
verdict airs with a TEST watermark — a rig test, not a D18 pilot session; no
machine-aired editorial decisions were produced). Raw:
`eval/results/fieldtest-2026-08-14-runtest.jsonl`, the R20 export, and the
32:43 OBS recording (LucidLink, analyzed below).

## Headline

**The infrastructure held for 32 minutes on the street; the capture and the
ingestion frame did not.** Two findings, both now closed or prescribed:

1. **The STT final is not a unit of meaning** — 244 finals at median ONE
   word; 73% of spoken words never reached a check (24 checks, 3 airs, of
   642 words spoken). Closed same-day by W1.3 rolling-window extraction:
   replaying the run's own log through the window yields **100% word
   coverage**, and live extraction over those windows recovers every claim
   the runner spoke (Delaware/WWE/nitrogen/six-oxygen-atoms/macronutrient/
   Hoover…), correctly categorized. Commit `11f25bc`.
2. **The audio was wind, not transport.** Recording analysis (32:43, AAC
   160kbps 48kHz): integrated loudness a healthy -18.7 LUFS but **loudness
   range 18.8 LU with peaks at -0.3 dBFS** — wind gusts slamming an
   unprotected iPhone mic to near-full-scale over speech in the -30s.
   Sub-200Hz energy within ~2 dB of full-band at the loud stretch (clean
   voice trails by 10-15 dB) — wind rumble confirmed spectrally. No digital
   clipping; bitrate healthy end-to-end. **The SRT/relay/OBS chain delivered
   exactly what the phone captured; the capture is the problem.**

## What held

- **Relay chain, 32 minutes, zero transport failures**: Moblin bonded
  (home Wi-Fi leg naturally died when the runner left range — the live
  leg-kill — and cell carried the rest), relay reassembled, OBS caller
  consumed, zero home router config.
- **R57 category gate, first live firing**: the operator's warm-up claim
  extracted as `politics_government` and was structurally unarmable — the
  category code shipped 24h earlier worked on its first street contact.
- Kill-switch cycle at arm; `/op` + cap chip carried on the run.
- Two total-silence dropouts (2.0s and 2.6s, back-to-back at ~20:53) — cell
  handoff signature; the bond recovered both times. Final 4 minutes of the
  recording are silence: shutdown ordering (Moblin ended first), not a
  defect.

## What did not (and dispositions)

| finding | disposition |
|---|---|
| Final-centric ingestion discards shredded speech | **CLOSED** — W1.3 window (above) |
| Wind owns the capture | **PRESCRIBED** (below) |
| W1.2 assembler was in the served file and never executed, nothing logged | **UNRESOLVED mystery, class closed** — `window.onerror`/`unhandledrejection` now land in the harness as `client_error` events; silent code-path death is impossible without a trace. The assembler wiring is retired regardless (superseded by the window). |
| Operator improvised claims under 6 words all run | Moot under the window (any phrasing reaches an extract) |

## Audio prescriptions (next street session)

1. **Mic near the mouth, shielded**: wired-mic earbuds or AirPods as
   Moblin's input beat the phone's body mic at arm's length in wind, by a
   lot. A foam windscreen on a lav is the real answer for produced sessions.
2. **OBS audio filter on the relay media source**: high-pass at ~120 Hz +
   limiter — kills the rumble before it reaches BlackHole/Deepgram and the
   recording. Zero cost, do it before any next session.
3. Phase-2 note: when the pipeline moves cloud-side, the same high-pass
   belongs in the relay's ffmpeg audio tap.

## Latency + spend

Spoken→screen on the checks that did land: p50 ~8s (TESTAIR decide=0).
Session spend ≈ $2-3 (24 concurrence checks + extraction). The W1.3 window
raises extraction cadence (~1 call/3.5s of continuous speech ≈ $0.06/10min,
Haiku) — negligible; verify spend unchanged (F2 dedupes claims before any
verify fires).

## Carried forward

Session 3 (controls evidence, local mic) unchanged and ready · W1.1
endpointing bench: still worth running against a CLEAN fixture, but the
window demotes it from gate to tuning · the D18-scoped walk test (auto-air,
attention tags, both phones) now waits only on the window + audio
prescriptions being live-proven — which the next session gives us for free.
