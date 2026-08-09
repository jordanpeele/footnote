# Field test — local OBS session, 2026-08-08

**Scope:** pre-publish shakedown. Operator on camera in OBS, local single-process server
(`npm start`, memory state), server-token Deepgram path (first live session on the new
Member key), manual airs from /op + control. ~35 min continuous (16:33–17:08, machine
clock ET), one session. **PASS 1 (veto-everything) only — PASS 2 (`?testair=1`) was not
run**; TESTAIR + watermark remain field-untested beyond bench checks.

**Raw data:** `eval/results/fieldtest-2026-08-08.jsonl` (2,634 events: 958 interim / 581
final transcripts, 310 extracts, 51 verifies, 40 airs, 39 renders).
**Session record:** `~/Downloads/footnote-session-2026-08-08T21-09-15.json` (51 checked ·
40 aired · 2 skipped · 2 held · 7 expired · 0 errors · 0 auto).
**Golden drafts:** `eval/golden/drafts-2026-08-08-fieldtest.jsonl` (51 drafts, 20 unique
claims, adjudication pending).

## Latency — where the time actually goes

| stage | p50 | p95 | n | notes |
|---|---|---|---|---|
| extract (Haiku) | 989ms | 3,860ms | 310 | p95 spikes correlate with claim bursts |
| verify (Perplexity) | 2,975ms | 5,715ms | 51 | worst 12,087ms (session-open cold call) |
| operator decide | 2,786ms | 9,520ms | 39 | HUMAN time — thumb on /op |
| publish | 3ms | 8ms | 40 | in-memory; will be network+Redis in prod |
| air → render | 366ms | 2,015ms | 39 | bimodal — see F5, fully explained |
| **spoken → screen** | **8,392ms** | **16,698ms** | 39 | |

Machine floor (spoken→pending): p50 ≈ 4.4s. The rest of the p50 total is the operator's
decision (~3s). The pipeline is remarkably consistent; the tail is three specific causes:

**Worst-3 waterfalls (spoken→screen):**
1. 18,973ms — extract 3,953 + verify 2,347 + **decide 12,601** + render 69 (operator
   working a backlogged queue with a duplicate pair in it — see F2)
2. 18,367ms — extract 1,948 + **verify 12,087** (worst verify of the night, first claim
   of the session) + decide 4,172 + render 160
3. 16,698ms — extract 1,903 + verify 3,184 + **decide 11,275** + render 335

So: the p95 tail is (a) human decision under queue pressure, (b) one Perplexity outlier,
(c) never the publish/render path except via F5 below.

**F5 — air→render bimodality is the overlay poll window (mechanism confirmed).** Every
render lag >800ms (8 of 39) followed ≥31s of on-air idle; every sub-800ms render followed
<30s idle (median 28s). That is exactly `FAST_WINDOW=30000` in overlay.js: after 30s
without a change the poll drops to the 2.5s idle cadence, so the FIRST air after a quiet
stretch waits up to a full slow-poll. Street conversations are mostly quiet stretches —
this hits the most important air of any street exchange (the first one).

## Latency-improvement hypotheses — ranked, NOT implemented (round-4 candidates)

1. **Overlay wake-after-idle (fixes F5).** Cheapest real win on the board. Options, in
   ascending effort: extend FAST_WINDOW (60–120s); keep FAST while the room has pending
   cards (control already pushes queue snapshots — overlay could read the same signal);
   or the known R6 WS/SSE transport issue. Est. win: −1.6s on first-air-after-idle
   (air→render p95 2,015 → ~400ms). Risk: negligible (slightly more polling).
2. **Operator cue on /op (attacks the true p50 dominator).** Decide time is human
   (p50 2.8s, p95 9.5s under backlog). A vibration/sound cue when a card lands +
   biggest-thumb-first card ordering could take ~1–2s off every air. Risk: none to the
   pipeline; pure UX.
3. **STT endpointing + final-merge (also fixes F3 quality miss).** Deepgram
   `endpointing`/`utterance_end_ms` tuning plus a 2-final rolling join before extract.
   Win: recovers split-sentence claims (the biggest QUALITY miss) and trims perceived
   finalization delay; cost: a re-tune of the dupe guard; risk: over-merge → mushier
   extraction input — needs eval data.
4. **Extract batching/serialization.** 310 Haiku calls for 51 real claims; consecutive
   finals could batch (halves call count and burst-induced p95). Win: modest latency,
   real spend cut. Risk: low.
5. **Verify: racing, not two-step.** P4-C two-step verify will NOT reduce latency (it
   adds a round-trip; it's a *precision* play). If verify latency ever matters more than
   spend: race sonar-pro against a lighter model and air the first definitive answer.
   Est. p95 −2–4s at 2× verify cost; must pass the eval gate before any such change.

## Quality findings

- **Verifier: 0 wrong verdicts observed on real claims.** 51 verifies: 43 False (the
  scripted false-claim diet), 1 True, 3 NeedsContext, 3 Unverifiable, 1 Misleading.
  Spot-checked all distinct claims: Thiel/Trump/McDonald's/AOC/GDP verdicts all correct,
  tier-3 sources (BEA for GDP), and the no-year GDP variants correctly softened to
  Misleading/NeedsContext instead of guessing. Tiers: 46× t3, 2× t2, 3× t1 (the t1s are
  all the F1 garbage below).
- **Harm gate: 36/36 correct.** Every person_public claim rendered ◆ manual-only;
  none armed auto-air. (No person_private case occurred — the scripted one wasn't
  spoken. Still zero field evidence on that gate.)
- **Opinion/meta gating: solid.** 259 no_claim gates; reviewed the 127 ≥10-word ones —
  they're overwhelmingly genuine non-claims (show narration). No false-positive cards
  from opinions.

### Bugs (severity-ordered; none fixed mid-test)

- **F1 · HIGH — extractor prompt-echo becomes a live claim.** 4× the extractor returned
  its own assistant preamble ("I'm ready to extract a checkable claim…") as the claim
  when the utterance was meta-speech about claims ("they make a claim like, …"). Each
  one burned a verify call and entered the operator queue (verdicts NeedsContext/
  Unverifiable, tier-1); a rushed operator could AIR one. Extractor output must be
  validated as grounded in the utterance (or at minimum reject first-person/instruction
  text). Also: exactly the kind of case D8 (speech is adversarial) predicted — a viewer
  could induce this on purpose.
- **F2 · MED — duplicate claim double-air.** Same claim re-extracted 3× within 20s
  (interleaved finals defeat the consecutive-utterance dupe guard); u51/u54 BOTH aired
  2s apart on stream. Needs claim-level dedupe at enqueue (~30–60s window, normalized
  claim text).
- **F3 · MED — split-final claims are missed.** STT endpointing split "GDP growth in
  the United States in 2025?" / "Was 4%." across finals → no claim either side; the
  operator had to re-speak it in one breath (happened repeatedly). See hypothesis 3.
- **F5 · MED — first-air-after-idle render lag** (mechanism above).
- **F6 · MED (dev-env) — shell env key shadowing.** `~/.zshenv`/`~/.zshrc` export an old
  Deepgram key that silently outranks `.env.local` (documented server precedence),
  producing 403s on token mint while the key itself tested fine. Cost ~10 min of setup.
  Candidate: `npm start` warning when a vendor key comes from the shell env while
  `.env.local` defines a different one.
- **F7 · NOTE (operational/privacy).** A personal phone call was transcribed mid-session
  while the stream stayed live. No pipeline fault — but the street protocol needs a
  hard habit: End Stream (or a future push-to-mute) before any off-record moment.
  Transcript content excluded from this report.
- **F8 · LOW — proper-noun STT drift.** "Thiel"→"Teal" produced a claim about the wrong
  string (verifier still got it right); repeated brand-name mishears ("slop era" →
  "slap/stop era"). nova-3 `keyterm` prompting with show-specific names is the cheap fix.
- **F4 · LOW (harness-only).** Dashboard's ≥8-word "checkable?" heuristic is noisy
  (127 flags, ~all benign). Fine for a shakedown; would want claim-shaped heuristics
  before trusting it as a miss-detector.

## Eval ingest

51 session entries → `eval/golden/drafts-2026-08-08-fieldtest.jsonl` (20 unique claims;
ground_truth left null per the drafts contract — human adjudication pending). Of note
for adjudication: the 4 F1 prompt-echo drafts (extraction ground truth should be null —
they're extractor-failure cases, a new failure class for the golden set), the "Teal"
STT-drift case, and the no-year GDP ambiguity family (good NeedsContext exemplars).

## Street-ready verdict

**The editorial core is street-ready; the rig around it is one fix short.** In 35
unscripted minutes the pipeline produced zero wrong verdicts, zero errors, gated every
person-claim to manual, cited tier-3 sources on demand, and held a consistent ~4.4s
machine floor with a 100%-aired-what-was-aired record under veto-everything — the D15
posture held up in practice. What is NOT street-ready: F1 (a garbage claim can reach the
queue — and speech is adversarial on the street), F2 (double-air on stream looks
amateurish), and F5 (the first air of any exchange — the money moment — eats an extra
~2s). Fix F1/F2/F5 and re-run a short confirmation session (including the un-run PASS 2
and a real person_private case) before pointing this at a stranger.
