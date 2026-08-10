# Field test — STREET SESSION, 2026-08-10

**Scope:** first outdoor run of the full street rig: Moblin (iPhone A) → SRT over
cell+Tailscale → OBS (home Mac) → Restream, stream audio → BlackHole → pipeline,
operator on /op (iPhone B, cell) — veto-everything per D15, auto-air OFF throughout.
~90 min total (dry-run 08:19–08:45, street ~08:47–09:34 PT), operator solo with both
phones, home base unattended.

**Raw:** `eval/results/fieldtest-2026-08-10-street.jsonl` (2,287 events) ·
session record `footnote-session-2026-08-10T16-53-37.json` (39 checked · 30 aired,
21 from the phone · 6 skipped · 3 duplicate · 0 errors · 0 auto) ·
drafts `eval/golden/drafts-2026-08-10-street.jsonl` (39, 35 unique).

## Headline

**The rig works on the street.** Cell+tailnet carried both phones (SRT pushed
~300MB through WireGuard; /op airs flowed over Verizon), a mid-stream signal
blip self-healed with zero downstream restarts, arm's-length audio produced
verbatim transcripts, and the operator's thumb aired 21 cards from a pocket
phone. The machine stages were indistinguishable from indoor numbers — the
street added no pipeline latency. What the street DID expose: two HIGH
findings (one editorial-display, one operational) and the sharpest quality
lesson so far (proper nouns).

## Latency — street vs indoor, and the SRT stage

| stage | home (pass-2) | street session | verdict |
|---|---|---|---|
| SRT transport hop (Moblin→OBS→BlackHole) | n/a | **upstream of all instrumentation** | constant offset ≈ Moblin's configured SRT latency buffer (+encode+monitor); NOT directly measurable from pipeline clocks — our t=0 is the STT final. Operator to read the Moblin latency setting; typical 1–2s. Evidence it adds nothing else: every measured stage matches indoor. |
| extract | 779–1,007ms | 821ms p50 | unchanged |
| verify | 2,629ms | 2,572ms p50 | unchanged |
| spoken→pending (machine) | ~3.5s | 3,372ms p50 | unchanged |
| operator decide | 2.8s (indoor 08-08) | ~3–7s typical, 13–21s while mid-conversation | the street thumb is busier — expected, human |
| air→render | 274–306ms | **3 of 11 normal; 8 of 11 seconds-to-minutes late** | **FS-2 — display lock, see below** |
| spoken→air | 3.5s (test-air) | 7,629ms p50 / 16,380 p95 | = machine 3.4s + street decide |

## Findings

- **FS-1 · HIGH (editorial display) — polarity-flip cards read wrong on air.**
  Operator said *"**No** woman has run a mile faster than four minutes"* (true).
  Pipeline internals were CORRECT (canonical-positive extraction + polarity=denies;
  verifier falsified the positive form; flip concluded the spoken claim true) — but
  the card displayed the canonical positive text with the flipped verdict:
  *"A woman has run a mile faster than four minutes" ✓ TRUE* — a false statement
  wearing a TRUE badge, aired. First display-incoherent card in 4 sessions. This is
  the on-air face of adjudication question 1A (canonical-form policy). Fix
  direction: polarity-flipped cards must display the speaker's framing (or restate
  with the negation) — display layer only, gates untouched. Until fixed, street
  rule: **card text ≠ what was said → SKIP** (operator applied this correctly today).
- **FS-2 · HIGH (operational) — display lock throttled the overlay render loop.**
  The Mac's screen locked while the operator was out; the system stayed awake
  (event log continuous, stream kept broadcasting) but the OBS browser source's
  timers throttled: **8 of 11 street airs rendered seconds-to-minutes late — they
  missed their 10s on-air window on the actual broadcast.** The operator's phone
  showed AIR succeeding; viewers never saw those cards. Fix is operational + one
  line: keep the display awake during street ops (`caffeinate -d -u` added to
  tools/street/arm.sh, plus checklist line). Needs one re-verify next session.
- **FS-3 · MED (quality) — proper-noun STT drift is the street's #1 quality tax.**
  "Erewhon" was transcribed SEVEN ways (Erwan, Erawan, Air Juan, Air one, Arawan,
  Taiwan, Like) producing claims about the wrong entity — *"Taiwan has four
  locations across Los Angeles"* reached the queue as a False t1 card. The human
  gate caught every one (skipped, not aired) — but on the street, conversations
  are ABOUT named local things. F8 escalates: the hardcoded news DG_KEYTERMS list
  needs a per-session/per-room keyterm field (operator types tonight's names
  before going out). Design note, not built.
- **FS-4 · MED (verifier scope) — hyperlocal claims are a verifier blind spot.**
  Store locations, store-vs-store prices → Unverifiable or tier-1 web junk. The
  trust roster is national/institutional by design; street conversations are
  hyperlocal by nature. THREE Unverifiables were aired by operator choice
  (allowed — but an Unverifiable card adds nothing for viewers). Orchestrator
  question: hyperlocal source policy (local news tier? maps data? or an explicit
  "don't air Unverifiable" street norm).
- **FS-5 · LOW — remote /op URL is hand-assembled.** The OPERATOR row mints a
  localhost-origin URL; the tailnet swap by hand cost a 403 (two mistranscribed
  key chars) mid-setup. Fix: OPERATOR row gains a second, tailnet-origin copy
  button when the server knows a non-loopback address.
- **FS-6 · LOW — no mute from /op.** Off-record control from the street is
  HOLD/SKIP + silence; push-to-mute lives on the home Mac only.
- **FS-7 · INFO — SRT audio choppiness drives merge volume.** 159 merge joins on
  291 finals (55%, vs ~29% on local mic) → extract volume +~50% on street audio.
  Spend note, not a defect; the merge is why choppy SRT audio still produced
  intact claims.

## What worked (the quiet wins)

Dedupe fired 3× on real repeats; grounding gate killed 2 echoes; 0 pipeline
errors across 90 min on cell infrastructure; 0 auto-airs (D15 held); the
operator's 6 skips were all correct editorial calls (wrong-entity and
polarity-suspect cards); blip recovery needed nothing from anyone. The Deepgram
socket survived the entire session including the Moblin outage — BlackHole's
silence-during-loss turns a transport drop into a non-event downstream.

## Session verdicts

30 aired: 9 True / 18 False / 3 Unverifiable. Spot-checked: no wrong verdict
relative to the VERIFIED claim text; the FS-1 card is the display-pairing
exception (verdict true of the spoken claim, wrong as displayed). The cumulative
"0 wrong verdicts aired" streak is therefore amended to: **0 wrong verdicts,
1 display-incoherent pairing (FS-1).** Honesty is the product.

## Street-readiness verdict

The transport/operator architecture is street-proven end-to-end. Before the
next PUBLIC street stream: fix FS-2 (one line, done in arm.sh), fix FS-1's
display pairing (small, display-only, needs the 1A adjudication call first or
an interim always-show-spoken-text rule), and add the per-session keyterm field
(FS-3). With those three, this rig is ready for a real audience.

## FS-8 · HIGH (post-report addendum, found in adjudication prep) — WRONG-VERDICT CARD AIRED

The R25 check came back positive: *"Women have XY sex chromosomes" ✓ TRUE @0.98*
(NIH tier-3 citation) WAS aired, from the phone, during the street session. Chain:
speaker ASSERTED the false claim → extractor emitted `polarity=denies` (no negation
exists in the transcript — a polarity misclassification) → verifier correctly found
the canonical form False → the polarity flip inverted it → True aired. This is the
first wrong-verdict card in the field record (ledger amended; R38's ratified language
was based on incomplete data and is contradicted — flagged to the orchestrator).

D17 does NOT close this class: the spoken framing is also an assertion, so the card
reads wrong either way. The closure is upstream. Proposed for orchestrator ruling
(NOT hotfixed — polarity handling is gate-adjacent): a deterministic negation
tripwire — when the extractor says `denies` but the utterance contains no negation
token, treat as `polarity_conflict` instead of silently flipping (existing conflict
machinery then applies: never auto-airs per D4, ⚠ tag on /op, spoken framing on
display). Replay evidence: this tripwire would have flagged today's card and the
08-08 "Teal" era has zero false positives against it (all other field denials
contain explicit negation tokens).
