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

---

# PASS-2 ADDENDUM — vertical test-air session, 2026-08-09

**Scope:** the owed PASS-2 (R28 pre-street gate): `?testair=1` auto-air with TEST
watermark, VERTICAL 1080×1920 OBS canvas, ~9.5 min free-talk, OBS recording.
First field exposure for round-5 code: split-final merge (F3 fix), claim dedupe
(F2 fix), grounding gate (P4-F1), overlay wake (P4-F2), portrait layout (P5-F).
**Raw:** `eval/results/fieldtest-2026-08-09-pass2.jsonl` (177 in-session events) ·
session record `footnote-session-2026-08-09T23-09-50.json` (auto-exported by R20 —
worked) · drafts `eval/golden/drafts-2026-08-09-pass2.jsonl` (9).

## Test-air path verdict: WORKS

9/9 settled verdicts test-aired immediately (`autoAired: 9`), 9/9 renders carried
the TEST watermark, dispositions complete (0 errors/expired/stale). The watermark
itself only exists on screen because of the pre-session clip fix — first time it
has ever rendered.

## Portrait verdict: WORKS — with one OBS footgun (P5F-1)

Viewport probes confirm CEF handed the page 1080×1920 and aspect detection chose
portrait unaided (no `?layout=` override needed). Cards landed full-width in the
60–75% band. **P5F-1 (LOW, docs):** resizing an EXISTING browser source to
vertical left a stale scene-item transform that scaled a 16:9 page into the
portrait canvas — mid-frame miniature card, ~7 min of session lost to it. The
page was correctly rendering landscape for the viewport it was actually given;
detection was never wrong. Fix is OBS-side: Reset Transform after resizing, or
prefer delete-and-re-add / the shipped `Footnote 9:16` scene. Docs updated.

## The true machine number

Test-air removes operator-decide, so this is the pipeline floor (n=9, small):

| stage | pass-2 p50 | pass-2 p95 | Friday (manual) p50 |
|---|---|---|---|
| extract | 1,007ms | 1,895ms | 989ms |
| verify | 2,629ms | 4,015ms | 2,975ms |
| air → render | **274ms** | 560ms max | 366ms (p95 2,015) |
| **spoken → screen** | **~3.5–3.8s** | ~5.3s | 8,392ms |

Friday's 8.4s p50 was ~4.4s machine + ~4s human. The machine floor measured
today: **3.5s p50, 5.3s worst** — and the air→render tail is GONE (max 560ms vs
Friday's 2.4s spikes): the P4-F2 overlay wake did exactly what it was built for.
Every second beyond ~3.5s on the street is operator-decide time.

## Round-5 fixes in the field

- **F3 split-final merge: PROVEN.** 9 joins fired; **3 of 9 aired claims came
  from merged finals** ("Reggie Watts is the president of Afghanistan",
  "Isaac Newton invented black hole geometry", "Isaac Newton invented algebra")
  — all three would have been missed on Friday's build. Overhead as predicted:
  ~5 joins on backchannel filler ("That's cool. It's working.") burned extracts
  that gated null. 17 extracts for 24 finals ≈ +40% extract volume — within the
  P5-B estimate; watch MERGE_SHORT_WORDS if it grows.
- **P4-F1 grounding gate: FIRST LIVE FIRING.** One meta-speech fragment
  ("That didn't work. Isaac Newton invented…") drew an extractor echo and the
  gate killed it before verify. Zero garbage cards reached air.
- **F2 dedupe: NOT EXERCISED** — no claim was repeated inside the 60s window
  this session (the Kenya claims are distinct assertions, correctly NOT deduped).
  Unit-covered (102 tests); still owed a deliberate field repeat. Carry forward.

## Quality + transcription notes

- 9/9 verdicts correct, conf 0.97–0.99, sources: Britannica ×3, BEA ×2, Forbes,
  PBS, one "ARCHIVES" (display-name oddity, cosmetic — filed P5F-3 LOW) and one
  **tier-1** (`webspace.science.uu.nl` for the Newton/black-hole claim). That
  card aired because test-air bypasses eligibility BY DESIGN; in street veto
  mode the operator sees the tier chip. Noted, not a bug.
- STT: clean session — "Reggie Watts", "Muhammad Ali", "Isaac Newton" all
  transcribed correctly (no F8 keyterm candidates earned); one suspected slip
  ("resuming deep" ≈ "resuming demo", inconsequential). 24 finals / 45 interims.

## Findings filed

| id | sev | finding |
|---|---|---|
| P5F-1 | LOW/docs | OBS resize-in-place leaves stale transform → landscape render in portrait canvas (docs updated; scene download is the safe path) |
| P5F-2 | INFO | merge joins fire on backchannel filler → ~+40% extract volume; tunables to watch |
| P5F-3 | LOW | verifier source display-name "ARCHIVES" (non-domain caps name) — prettyName pass candidate |
| — | carry | F2 dedupe still needs one deliberate field repeat; Meet-call capture test still owed |

**R28 pre-street gate: CLEARED** (pass-2 run, vertical, recorded). Street
posture unchanged: veto-everything, /op is the authority, machine floor ~3.5s.
