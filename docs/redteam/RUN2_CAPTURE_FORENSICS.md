# RUN2 CAPTURE FORENSICS — where the 48 dead-airs and the 1839-fragment shred came from (2026-08-15)

FIX-ROUND packet P-B. FORENSICS ONLY — read-only across all three data sources (harness
log, OBS recording on LucidLink, relay journal). No config touched. Sources:

- Harness log: `eval/results/fieldtest-2026-08-15-run2.jsonl` (7415 lines; 48 `deadair`,
  1947 `gate`, 4 `air`/`testair_fire`).
- OBS recording (ground truth for "was audio present at OBS"):
  `/Volumes/banana-media/production/_ONE_MINUTE_ONE_TAKE/02_RAW_MEDIA/260815_LOS_FELIZ_IPHONE/2026-08-15_07-20-45.mp4`
  — 88.3 min, 48 kHz stereo AAC, wall-clock start 07:20:45 PDT. (The sibling
  `2026-08-15_09-04-18.mp4` is a separate post-walk OMOT take, not run2.)
- Relay journal: `ssh -i ~/.ssh/footnote-relay.pem ubuntu@54.203.255.224`,
  `srtla-rec` + `srt-out`, run window 14:10–16:00 UTC (relay clock is UTC; PDT = UTC−7).

---

## THE VERDICT (up front)

**The dead-air was PHONE-CAPTURE. The audio was genuinely absent / wind-buried at the
phone, NOT lost in the monitor chain and NOT lost on the bond.**

Three independent lines converge:

1. **The OBS recording is ALSO quiet during the dead-air windows.** If this were a
   monitor-chain fault (OBS→BlackHole→Deepgram), the recording — which is the OBS-received
   program audio — would contain clear speech exactly where STT got silence. It does not.
   Inside the 42 dead-air windows that fall within the recording, only **3.0%** of audio
   frames reach speech level (>−35 dB); outside those windows it is **18.2%** — a 6×
   contrast. The recording went quiet at the same instants STT did. **Monitor-chain RULED OUT.**

2. **The bond was UP during 46 of 48 dead-airs.** The relay shows the bonded pair (legs
   `166.199.109.65` + `76.32.135.77`) registered and flowing for the whole walk, with only
   two full-bond-drop events (`group removed (no connections)`) during the walk proper:
   14:56:31 and 15:46:07 UTC. Exactly **2 of 48** dead-airs sit within ±20 s of a bond drop
   (#26 at +9 s, #48 at −7 s). The other **46** fired while both carrier legs were connected
   and the relay was receiving. **Bond RULED OUT for 46/48.**

3. **What remains is the phone's own capture.** Bond up + OBS-side quiet ⇒ the phone
   sampled near-silence / wind and streamed it faithfully. The relay delivered what the phone
   sent; OBS recorded what the relay delivered; both are quiet. The loss is upstream of the
   uplink — at the mic.

Per-window classification (42 measurable + 6 pre-recording):

| class | count | meaning |
|---|---|---|
| SILENT_AT_OBS | 31 | recording <−40 dB through the window — genuinely no audio at OBS |
| LOW (wind/fragmentary) | 10 | ambient/wind floor with sub-speech peaks; nothing STT-lockable |
| SPEECH_PRESENT | 1 | window #15 — weak, wind-contaminated speech (sub-200 only 4 dB down) |
| pre-recording (unmeasurable) | 6 | dead-airs #1–#6 fired 07:14–07:20, before the 07:20:45 recording start |

The single SPEECH_PRESENT window (#15) is not a monitor-chain miss: it is weak
(full-band −35 dB) and wind-loaded (sub-200Hz only ~4 dB below the speech band), i.e. the
same low-SNR regime that produced 1-word fragments everywhere else — Deepgram simply could
not endpoint a clean word out of it. It is a capture-quality miss, not a chain-delivery miss.

---

## Method

**Timebase.** Harness `t` is epoch-ms UTC. Recording wall-clock start is the filename
`07-20-45` (PDT). Each `deadair` fires after ~12–14 s of no transcription (its `sinceMs`),
so the tested audio window is `[fire − sinceMs, fire]`, mapped into recording seconds by
`(deadair_pdt − 07:20:45)`.

**Energy.** `astats` per-frame `RMS_level` over the full recording (248,273 frames ≈ 48 fps),
aggregated per window. "Speech level" = RMS > −35 dB (median of the whole recording is
−49.9 dB; program voice peaks land −25 to −30 dB). VERDICT thresholds: >15% of frames
above −35 dB = SPEECH_PRESENT; else >15% above −40 dB = LOW; else = SILENT_AT_OBS.

**Bond.** `srtla-rec` link lifecycle (`group … registered`, `connection removed (timed out)`,
`Group … removed (no connections)`) — the last is the only true full-bond-down. Correlated
against the 48 dead-air UTC times at ±20 s.

---

## Per-window table (42 in-recording; PDT / recording-offset / energy / verdict)

```
idx  pdt       off_s   medRMS  maxRMS  %>-35  %>-40   VERDICT
 7  07:22:07    82.6   -67.1   -36.5    0.0    0.2    SILENT_AT_OBS
 8  07:33:19   754.6   -55.8   -30.5    0.5    1.3    SILENT_AT_OBS
 9  07:33:33   768.6   -55.4   -32.5    0.5    3.2    SILENT_AT_OBS
10  07:34:03   798.6   -55.6   -32.7    0.7    2.5    SILENT_AT_OBS
11  07:37:37  1012.6   -50.1   -15.6   11.6   16.4    LOW
12  07:38:21  1056.6   -45.5   -30.9    2.4   19.7    LOW
13  07:39:15  1110.6   -43.8   -27.0    4.4   25.4    LOW
14  07:39:41  1136.6   -50.7   -31.4    1.3    5.6    SILENT_AT_OBS
15  07:40:13  1168.6   -46.9   -20.8   18.8   27.0    SPEECH_PRESENT
16  07:44:09  1404.6   -55.6   -32.8    0.3    3.4    SILENT_AT_OBS
17  07:45:17  1472.6   -55.3   -33.1    0.3    2.4    SILENT_AT_OBS
18  07:47:39  1614.6   -43.4   -29.4    0.5   17.4    LOW
19  07:49:13  1708.6   -45.3   -34.8    0.2   10.5    SILENT_AT_OBS
20  07:49:55  1750.6   -50.5   -26.3    0.3    2.0    SILENT_AT_OBS
21  07:53:03  1938.6   -51.3   -16.5   10.7   17.7    LOW
22  07:53:33  1968.6   -46.6   -23.3    4.2   20.5    LOW
23  07:55:15  2070.6   -46.8   -21.3    3.7   10.6    SILENT_AT_OBS
24  07:55:45  2100.6   -45.8   -22.7    3.7   10.2    SILENT_AT_OBS
25  07:56:05  2120.6   -50.8   -33.9    0.2    1.6    SILENT_AT_OBS
26  07:56:21  2136.6    -inf   -33.3    0.6   14.0    SILENT_AT_OBS  <-- ±9s of bond drop 14:56:31
27  07:57:17  2192.6   -46.4   -29.3    0.9    8.0    SILENT_AT_OBS
28  07:58:07  2242.6   -43.9   -28.9    1.9   16.6    LOW
29  07:59:05  2300.6   -50.5   -24.2    4.6   10.2    SILENT_AT_OBS
30  07:59:33  2328.6   -51.6   -33.6    0.3    4.6    SILENT_AT_OBS
31  08:00:17  2372.6   -51.2   -38.4    0.0    1.3    SILENT_AT_OBS
32  08:01:25  2440.6   -51.3   -29.3    0.5    6.4    SILENT_AT_OBS
33  08:01:47  2462.6   -57.6   -36.3    0.0    1.5    SILENT_AT_OBS
34  08:02:21  2496.6   -54.8   -26.3    0.7    1.9    SILENT_AT_OBS
35  08:02:53  2528.6   -44.8   -36.1    0.0    5.0    SILENT_AT_OBS
36  08:04:59  2654.6   -51.4   -25.8    9.4   16.4    LOW
37  08:06:15  2730.6   -61.4   -26.4    4.1   11.4    SILENT_AT_OBS
38  08:07:15  2790.6   -51.1   -30.9    4.1   11.0    SILENT_AT_OBS
39  08:07:43  2818.6   -53.1   -32.8    0.2    5.4    SILENT_AT_OBS
40  08:09:01  2896.6   -46.3   -19.8   13.3   22.9    LOW
41  08:12:13  3088.6   -49.8   -33.2    0.2    4.0    SILENT_AT_OBS
42  08:16:55  3370.6   -52.2   -19.6    3.0    8.4    SILENT_AT_OBS
43  08:18:41  3476.6   -48.4   -19.0   12.0   21.9    LOW
44  08:20:01  3556.6   -53.2   -32.7    0.9    7.2    SILENT_AT_OBS
45  08:23:45  3780.6   -53.7   -18.7    5.5    8.9    SILENT_AT_OBS
46  08:33:43  4378.6   -56.0   -49.4    0.0    0.0    SILENT_AT_OBS
47  08:41:07  4822.6   -64.6   -35.6    0.0    0.6    SILENT_AT_OBS
48  08:46:13  5128.6    -inf    -inf    0.0    0.0    SILENT_AT_OBS  <-- ±7s of bond drop 15:46:07
```

Dead-airs #1–#6 (07:14:33–07:20:43 PDT) fired before the recording started and cannot be
energy-checked; the relay shows the bond was cycling through the auth-rollback rejects
(14:10–14:12 UTC) and re-establishing across that early stretch, so at least the earliest of
these overlap the auth churn rather than steady-state walk.

---

## Relay leg events (the bond timeline)

Two carrier legs: `166.199.109.65` and `76.32.135.77`. Full-bond-down events
(`Group … removed (no connections)`) across the run:

```
14:10:16 14:10:28 14:10:37 14:10:43 14:10:46 14:10:55 14:12:19   <- AUTH-ROLLBACK churn (pre-walk)
14:56:31                                                          <- brief mid-walk bond cycle (re-reg 14:56:28)
15:46:07                                                          <- late-walk bond cycle
```

The 14:10–14:12 cluster is the ingest-auth apply/rollback (relay rejected the unpassphrased
legs — `1011 Password required` — until the passphrase was stripped). Once the walk was
underway (~14:21 UTC on), the bond held: a single re-registration at 14:56:28 and otherwise
continuous flow. The frequent `RCV-DROPPED 1 packet` lines are normal SRT jitter-buffer
drops (sub-millisecond delays), not link loss. **Steady-state walk = bond stable.**

---

## (2) Audio regime — is the wind/clipping back? YES, and worse.

Measured the recording the way the 2026-08-14 report did:

| metric | 2026-08-14 | 2026-08-15 run2 | reading |
|---|---|---|---|
| LRA (loudness range) | 18.8 LU | **21.4 LU** | wider — big swings between wind gusts and speech |
| True peak | (gusts −0.3 dBFS) | **−4.9 dBFS** | no hard clipping this time, but hot transients |
| Integrated loudness | — | −25.0 LUFS | |
| sub-200Hz vs full-band | ~2 dB (very hot) | **~9 dB below** | improved but still LF-heavy (clean voice trails 10–15 dB) |
| sub-200Hz vs speech-band | — | **~7.8 dB below** | wind energy still competitive with voice |
| silence ≥2 s (−40 dB) | — | 67 periods, 8.0 min (9%) | incl. one 183 s dead stretch + 35.9/22.4/19.0/15.7 s gaps |

**Verdict on wind: present again.** The regime is the same family as 8/14 — very wide LRA
(21.4 vs 18.8 LU) and elevated sub-200Hz — meaning gust-dominated, low-SNR capture. It is
marginally *better* than 8/14 (sub-200 is ~9 dB down vs ~2 dB; no −0.3 dBFS clip), consistent
with a slightly less brutal wind day, but nowhere near a clean lav-near-mouth signal. This is
the mechanism behind the 1839-fragment shred: at this SNR Deepgram endpoints on wind and
emits 1–2-word finals (median **2 words**, 58% ≤2 words) instead of coherent utterances,
and drops into >12 s no-transcription stretches that fire the dead-air detector.

**The 8/14 prescriptions still stand and are now field-confirmed as the fix path:** mic near
the mouth (earbuds into Moblin), OBS 120 Hz high-pass + limiter on the relay source, and the
same high-pass in the relay's future ffmpeg tap. None of these are the window's job — the
window reassembles fragments it receives; it cannot manufacture audio the phone never captured.

---

## What this does and does not indict

- **Indicts:** the phone capture chain (open mic, wind, distance-from-mouth). This is the
  dominant cause of both the 48 dead-airs and the 1839-fragment shred.
- **Exonerates:** the monitor chain (OBS→BlackHole→Deepgram-WS) — the recording proves audio
  was not present to lose. And the bond — up for 46/48 dead-airs.
- **Caveat on the shred number specifically:** the *coverage collapse* (108/113 no_claim, 4
  airs) is still primarily the STALE CLIENT (window never ran — see
  `docs/STATUS_2026-08-15_RUN2_ORCHESTRATOR.md`). But even a fresh client would have been
  fed 1–2-word wind fragments; the window would reassemble what STT emits, and STT emitted
  shred because the *input* was shred. So capture quality caps the ceiling regardless of the
  client fix. Both must be fixed: fresh client (done, commit 79a4124) AND mic-to-mouth capture.

The indoor validation read (below) isolates the client/window question from the capture
question: clean-but-shredded input on a verified-fresh client should recover coverage toward
~100%, proving the window works. The street capture fix is a separate, orthogonal task.
