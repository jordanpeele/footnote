# Endpointing bench — synthetic shredded fixture · 2026-08-14

Tuning-grade sweep (R62: the window is the architecture; endpointing is a
knob). Fixture: `tools/bench/make-shredded-fixture.sh` — the 5:49 test read
with 94 speech-plausible micro-gaps (150-400ms) + 22 low-frequency wind
bursts injected to imitate the 2026-08-14 run profile (schedule committed as
`results/shredded-fixture.schedule.json`; seed inside). One realtime Deepgram
streaming pass per value, identical audio. Raw per-final detail:
`tools/bench/results/endpointing-sweep-2026-08-14.jsonl`.

| endpointing | finals/min | median words/final | p50 added latency | p95 |
|---|---|---|---|---|
| 10 (vendor default) | 11.7 | 4.5 | 231ms | 2345ms |
| 300 | 8.6 | 7 | 499ms | 2689ms |
| 500 | 7.6 | **8** | 712ms | 5467ms |
| 800 | 8.1 | 8 | 984ms | 3413ms |

(ep=1200 skipped: 500→800 already shows the plateau — median words flat at 8
while p50 latency climbs +272ms. Methodology note: the first three passes ran
under the original packet agent; ep=800 was run by the dispatcher with the
same script after taking the packet over; ep=1200 was cut, not lost.)

## Recommendation (tuning input — NO default changed, per R62)

**`?ep=500` for routed/bonded-audio sessions.** The knee is unambiguous:
median final length doubles (4.5→8 words) between default and 500, and 800
buys nothing further while costing ~270ms more p50. Under the W1.3 window
this is comfort, not survival — the window rebuilds shredded speech at any
setting — but longer finals mean fewer window fires, fewer duplicate-gate
events, and lower extract spend. Local-mic sessions: leave the default
(session-1 finals were already sentence-length).

The p95 outlier at 500 (5.5s) tracks the fixture's longest wind burst
swallowing a phrase — present in all passes, worst-sampled there; treat p50
as the planning number.
