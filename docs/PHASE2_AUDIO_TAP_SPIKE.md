# Phase-2 spike — the ffmpeg audio tap at the relay, measured

**2026-08-14 · DAYSPRINT packet 2a.** Everything here shipped **DARK**: four `static`
systemd units on the relay that cannot auto-start, cannot even be `enable`d, and change
nothing for current sessions. The relay's live services were never interrupted —
attestation at the bottom. Design context: [PHASE2_DESIGN.md](./PHASE2_DESIGN.md);
installer: `tools/relay/setup-tap.sh`.

The question this spike answers: **can fact-checking audio peel off at the relay's SRT
ingest** (retiring the OBS → BlackHole capture chain), and is that audio as good as, or
better than, what the Phase-1 path hears?

Answers: yes, and measurably better.

## Experiment 1 — can the tap be a second caller on `:4001`? **No.**

The cheap design would be an ffmpeg caller sitting next to home OBS on the existing
`srt-out` hand-off listener. Tested live on the box (test stream pushed from the Mac
through the real srtla front door):

| condition | result |
|---|---|
| caller 1 (Mac, OBS-equivalent) alone | full stream, 794,616 B WAV in 25 s |
| caller 2 (box-local) **while caller 1 connected** | SRT handshake completes, then **0 bytes** in 10 s |
| caller 2 alone (control) | 824,568 B in 10 s |

`srt-live-transmit` accepts the second connection at the library level but only ever
services the first — worse than a refusal, because the second caller *looks* connected.
**Conclusion:** the tap cannot ride `:4001`. Redesign: terminate SRT once and tee the
MPEG-TS on loopback (the unit set in `setup-tap.sh`; topology in the design doc).

## Experiment 2 — ingest auth finding (security, carried to a hardening packet)

`srt-out`'s *input* listener (`127.0.0.1:4000`, fed by `srtla_rec` from `udp/5000`)
declares **no passphrase**. Measured consequences, both directions:

- a **passphrase-less** push from the Mac through `udp/5000` was accepted end-to-end;
- a push carrying the session passphrase was **rejected** at handshake (libsrt enforced
  encryption: pw-caller vs no-pw-listener fails).

So Moblin must currently push passphrase-less to this relay, and anyone who finds
`udp/5000` can push video into the operator's compositor. `setup-relay.sh`'s comment
claims the passphrase closes this at both hops — it is true only of the `:4001` (read)
hop. Not fixed in this packet (nothing live changes tonight); the tee's `:4000`
listener is the natural place to add the passphrase when tap mode flips for real.

## The build — tap mode, dark

`tools/relay/setup-tap.sh` installed (see design doc for the topology diagram):
`footnote-tap.target`, `srt-tee.service` (ffmpeg SRT-listener → two `-c copy` MPEG-TS
UDP branches), `srt-out-tap.service` (byte-identical `:4001` contract for OBS),
`audio-tap.service` (pcm16 mono 16 kHz → 60 s WAV segments + `udp://127.0.0.1:9877`
s16le stub, 640 B = 20 ms datagrams). All `static`, disabled, `Conflicts=srt-out` so a
deliberate start swaps modes and a reboot always comes up Phase-1.

Unit smoke test (safe, loopback-only): 12 s tone fed to the tap input → stub counted
**384,992 B = 12.0 s** decoded audio, WAV segment written. Found and fixed in the
process: ffmpeg ignores SIGTERM while blocked on a quiet UDP/SRT input (90 s stop
timeout → unit marked `failed`), so both ffmpeg units carry
`KillSignal=SIGKILL` + `SuccessExitStatus=SIGKILL` — stops are instant and clean; the
in-flight WAV segment keeps a provisional RIFF header (debug artifact, acceptable).

## Head-to-head 1 — the designed chain, both branches, same stream

The plan was a Mac push into a test-port replica (shifted ports 5010/4010/4011) — 
blocked correctly by the **AWS Security Group**, which only passes the provisioned
ports; opening one is a security-boundary change and was not made (the two temporary
ufw rules added during the attempt were reverted; ufw sits inside the SG anyway).
Replanned with zero new inbound ports:

**Method:** box-local ffmpeg push of `tools/street/test-audio-5min.mp3` (349.44 s
speech with a metronome of ~8.3 s silences — a built-in gap fingerprint) + testsrc
video, aac 128k/48 kHz, into a full test-port replica of the tap chain living entirely
on loopback. Both branches captured simultaneously: **A** = audio-tap WAV segments,
**B** = OBS-position capture from the tap-mode `:4001` hand-off (`-c copy` TS).
Analysis: silence-run fingerprint matching + normalized cross-correlation probes of
1 s high-energy windows against the source (numpy, 16 kHz).

| metric | tap (A) | OBS-position (B) |
|---|---|---|
| captured | 340.97 s in 6 segments | 341.57 s (joined stream +6 s) |
| silence runs matched to source | **54/54** | 53/54 (the 54th = its own 6.2 s decoder-priming lead-in) |
| run-start jitter vs source | median +5.2 ms, spread 21.2 ms | median +6.3 ms, spread 21.2 ms |
| probe residual (8 probes spanning 68→335 s) | constant +9.62 ms, **spread 0.00 ms** | constant +10.75 ms, **spread 0.00 ms** |
| inserted gaps | **0** | **0** |

The constant ~10 ms residual is codec/mux delay; zero spread across probes that
straddle the 60/120/300 s WAV segment boundaries means the segments concatenate
sample-continuously. The UDP stub independently counted **11,160,884 B = 348.8 s** of
the 349.44 s source (the 0.6 s = encoder edges); the WAV files end 7.9 s earlier only
because the harness hard-killed the capture ffmpeg at collection time — a harness
artifact, quantified by the stub, not a tap loss. **Verdict: the tee's audio branch is
bit-honest — it hears exactly what the OBS hand-off hears.**

CPU/memory during this run (which included an x264 *encoder* the production box never
runs): stream stayed clean with MemAvailable bottoming ~135 MB; at rest the box sits
~210–225 MB available. Sizing implications in the design doc.

## Head-to-head 2 — the WAN leg (production path, the BlackHole proxy)

**Method:** Mac push through the **live** front door (`srtla_send` → `udp/5000` →
`srtla_rec` → `srt-out`), Mac ffmpeg caller pulling the **live** `:4001` — the exact
SRT hop home OBS rides, stream copied to TS and analyzed the same way. This is the
path Phase-1's ears sit behind (plus BlackHole plus a browser, which this test is
*charitable* to — it skips them).

- Captured 347.09 s. Through t≈290 s: sample-continuous (probe spread 0.00 ms),
  49/57 silence runs matched.
- The receiving ffmpeg logged **6 corrupt-packet events** (video PID) at dts ≈ 36,
  117, 182, 246, 296, 308 s; the earlier smoke run also logged `RCV-DROPPED 15
  packet(s)` on this hop.
- At ~293 s the source's 8.30 s silence came through **truncated to 7.94 s**, and
  every subsequent silence run lands shifted **−350 ms**: ≈**360 ms of audio was lost
  mid-stream** and the timeline spliced. One additional unexplained 151 ms silence at
  67.5 s.

Attribution caveat, stated honestly: this run had *two* WAN hops (Mac uplink to the
relay, Mac downlink from it) and no tap was running, so the 360 ms loss can't be
pinned to one hop from this data alone. What is not in doubt: the downlink hop
demonstrably dropped packets in both sessions where it was watched, run 1 proved the
tap position adds zero loss of its own, and the tap is exposed to **one** WAN hop
where the Phase-1 ears are exposed to **two** (then BlackHole, then a browser tab).

## Latency notes

- First tap audio lands ~5.4 s after stream start: ≈2.0 s SRT ingest latency
  (configured) + ffmpeg demux probe on the tee + audio-tap open. One-time, per
  session, not per utterance. The bridge packet can shave the probe with
  `-analyzeduration/-probesize` if it matters.
- Steady state is realtime: the stub's per-second cadence held ~1,000±100 ms of audio
  per wall-second for the full run.
- Consumers should take the **UDP stub** (20 ms datagrams), not the WAV files — the
  file branch sits behind a ~256 KB write buffer (~8 s of pcm16/16k). The files are
  the debug/archive artifact.
- Mac↔box clocks agreed within ~0.5 s (chrony on the box); all cross-machine
  timestamps above carry that error bar.

## Ops findings (reconfirmed the hard way)

- **srtla_rec start-order wedge is real**: the test `srtla_rec` came up before its
  hand-off listener, logged `Failed to confirm that a SRT server is reachable`, and
  never recovered until restarted — exactly the session-2 finding the production
  units' ordering encodes. The tap units keep that ordering (`After=` chain).
- **`srt-live-transmit` opens its output lazily**: `:4001`/`:4011` callers that dial
  before source data flows get a handshake error. OBS retries so production never
  notices; test harnesses (and the future bridge's reconnect loop) must too.

## What was installed on the relay (complete log)

| item | state |
|---|---|
| apt: `ffmpeg` 6.1.1-3ubuntu5 (arm64) + deps | installed (disk 3.6 → 2.9 GB free) |
| `/etc/systemd/system/footnote-tap.target` | static, never enabled/started |
| `/etc/systemd/system/srt-tee.service` | static, never started |
| `/etc/systemd/system/srt-out-tap.service` | static, never started |
| `/etc/systemd/system/audio-tap.service` | static, started twice in loopback smoke tests, stopped, `inactive` |
| `/etc/footnote/tap.env` | root:root 0600, holds SRT_PASSPHRASE (same secret `srt-out.service` embeds) |
| `/var/lib/footnote-tap/` | nobody:nogroup, empty |
| `/home/ubuntu/setup-tap.sh`, `/home/ubuntu/tap-stub-listen.py` | installer + stub copies |

Transient and reverted: ufw `5010/udp` + `4011/udp` (removed, ufw back to the original
four rules), `/tmp/tap-h2h/` test artifacts (removed), all test processes (none left).
No Security Group changes. The Stagehand box was not touched.

## Relay-state attestation

Health endpoint `http://54.203.255.224:8080/`:

- **before:** `{"srtla_rec":"active","srt_out":"active","uptime_s":128058}`
- **after:** `{"srtla_rec":"active","srt_out":"active","uptime_s":136515}`

`srtla-rec`, `srt-out`, `relay-health`: `ActiveEnterTimestamp=Thu 2026-08-13 02:55:47
UTC` and `NRestarts=0` — identical before and after. The live services were never
restarted or interrupted.
