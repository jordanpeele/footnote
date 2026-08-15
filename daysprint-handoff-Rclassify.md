# Day-sprint handoff — R-classify (sci-033 class hunt)

**Packet:** NIGHTSPRINT R-classify — hunt the sci-033 CLASS (two engines agree wrong via a
shared cultural prior). Analysis + failing-fixture corpus + ranked mitigation proposals. The
FIX is RED (parked, not applied). Isolated worktree, uses existing golden + cal#5 data only.

**Branch (committed, NOT pushed):** `worktree-agent-a92b32a55cfd41a33`
**Parked code fix (P1 scaffold, default-OFF):** branch `redteam/sci033-class-detector`

---

## What shipped this session

1. **`docs/redteam/SCI033_CLASS_2026-08-14.md`** — the class definition, detection heuristic,
   full quantification, near-miss table, floor sweep, mechanism, and the ranked RED proposals.
2. **`eval/golden/drafts-sci033-class-2026-08-14.jsonl`** — 18 authored synthetic claims
   (auth-sci033-001…018), `drafts-` prefix → auto-excluded from runs, `authored:true` →
   provisional labels pending morning ratification. Shapes: commercial-internal-study,
   private-poll, first-person-anecdote (controls), studies-show-uncited, unfalsifiable-
   superlative. Mostly Unverifiable, each with a why-two-engines-miss-it note.
3. **`test/golden-drafts-exclusion.test.js`** — pins the drafts-exclusion contract; explicitly
   asserts the new sci-033 file is present, authored, mostly-Unverifiable, and fully excluded
   from `loadGolden`. (Required exporting `loadGolden` from `eval/run.js` — the only src change
   on this branch; matches the existing `deriveAired` export pattern.)
4. **`npm test` green: 247 tests, 245 pass, 2 skipped, 0 fail** (the 2 new exclusion tests
   included).

## Class size

- **Fit the shape:** 13 of 260 goldens (7 Unverifiable + 6 Misleading/NeedsContext of the
  self-report / uncheckable-proof / debunked-framing shapes; person-007/015 excluded as
  harm-class).
- **Actually slipped in cal#5** (both arms agreed a definitive verdict, eligible, conf ≥ 0.85
  → would AUTO-AIR wrong): **7 of 13** — sci-033, stat-017, stat-030, hist-029, hist-030,
  geo-019, curr-031. These are exactly the 7 would-air-wrong cards cal#5 already names.

## Floor-analysis verdict

**Do NOT raise the floor to chase this class.** The 7 wrong cards' confidences are
`0.85, 0.85, 0.90, 0.90, 0.95, 0.95, 0.97` — interleaved with correct cards, not clustered
low. **Zero near-misses in cal#5:** the floor caught NONE of them (the famous sci-033-at-0.72
catch was R49; in cal#5 sci-033 merged at exactly 0.85 and slipped). Floor 0.86 catches only 2
of 7 (costs 1 good card); catching all 7 needs floor 0.98, which kills 44 correct auto-air
cards. Confidence is the wrong instrument — the shared-prior mode's signature IS high, agreeing
confidence, which is exactly what the floor is built to trust. 0.85 stays; the class needs a
class-aware lean, not a floor move.

## Top mitigation proposal

**P1 — a class-detector that forces an Unverifiable/NeedsContext LEAN pre-merge.** Tag a claim
sci-033-suspect via the heuristic (self-referential proof verbs on a private/interested/
unindexed subject; "studies show" with no nameable study; commercial efficacy superlatives;
private polls; first-person anecdotes). When tagged, cap eligibility: a both-arm definitive
agreement is downgraded to its non-definitive floor and HELD for the operator — never auto-air.
Targets claim SHAPE, not confidence, so it catches all 7 regardless of how certain the engines
are. Risk: false-positive HOLDs on legitimately-verifiable superlatives (California most
populous, LeBron scoring record) — must condition on "load-bearing source is private/
interested/unindexed," which needs a small Haiku classifier, not a bare regex (my first-pass
regex over-triggered on all the checkable superlatives). Validation before any ruling: run the
detector over all 260 goldens, ship only if it holds all 7 slipped cards while HOLDing <2% of
the ~200 correct auto-air cards. Runners-up: P2 third disagreeing "skeptic" arm (breaks the
monoculture but +cost, +recall loss, model-independence question); P3 floor→0.86 (hygiene only,
2/7); P4 entity-self-report floor raise (misses the nuance-collapse sub-shape).

## Ratification fodder for the morning sitting

- Ratify the 18 auth-sci033-* labels (mostly Unverifiable; controls 008/009 are the "engines
  already handle this" cases).
- Rule on P1 vs P2 as the class fix; P1 needs the control-set validation run described above.
- Note for the graduation sitting: science_health still CLEARS its bars, but sci-033 would have
  aired in cal#5 — the D18 operator skepticism re-read should read this class doc before enabling.

## Reproduce the numbers

The scan scripts were ad-hoc (in /tmp, not committed — regenerable). Inputs: `eval/golden/*.jsonl`
(drafts excluded) cross-referenced against `eval/results/calibration5-2026-08-14.jsonl`
(read-only in the main tree) on `id`, `concurrence.{a,b}.verdict`, `concurrence.eligible`,
`confidence`, and golden `ground_truth_verdict`.
