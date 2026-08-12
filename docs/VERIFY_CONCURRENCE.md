# Concurrence verifier + brave-claude — gap F-3, built dark

**Status: DARK.** Both `brave-claude` and `concurrence` are registered in
`src/core/registry.js` but are never the default. They run only when
`FOOTNOTE_VERIFIER` names them explicitly, and stay dark until a spend-authorized
calibration eval clears the promotion bar (same D15 gate as `perplexity-twostep`,
docs/VERIFY_TWOSTEP.md). No route, overlay, or editorial code changed — both are drop-in
`Verifier`s (`src/core/interfaces/verifier.js`) behind the same `finalizeVerification`
policy layer (D5).

> ⚠️ **`brave-claude` is interface-scaffolding, NOT a live-proven adapter.** It is written
> to the `Verifier` contract and fully unit-tested against a **stubbed** `fetch`, but it has
> **never run against the live Brave or Anthropic APIs.** `BRAVE_API_KEY` is not provisioned
> and no eval has spent against it. The exact Brave request shape (endpoint, query params,
> `web.results` response field) and the Claude response parsing are best-effort-to-spec, to
> be validated on the first live run. Do not treat green unit tests as live proof.

## Why this exists

Calibration report #3 (docs/CALIBRATION_REPORT_3_TWOSTEP_2026-08-09.md) showed a **single
verifier plateaus** below the 95% auto-air bar. The two-step structural fix killed
under-commitment (hedging on definitive evidence: 2.3% → 1.4%) and wrong-direction verdicts
(3 → 0), but bought those wins by **over-committing on the mid-tier / unverifiable claims**
(55% → 65%) that the D15 controls exist to protect. Best category precision was 93.8% vs
the 95% requirement, and the regression guard was explicitly violated (adv-010: single-shot
right, two-step confident-False on a private anecdote).

That report named **"a second-verifier concurrence gate for auto-air"** as a candidate next
lever. The thesis: a *single* engine's over-committed definitive verdict is exactly the
failure mode auto-air must avoid; requiring **two genuinely different engines to agree**
before a definitive verdict is treated as air-eligible trades recall for precision on that
miss class. Concurrence needs two independent engines, so this ships both pieces:

1. **`brave-claude`** (issue #5) — the SECOND independent verifier, deliberately different
   from the Perplexity adapters on *both* axes: a different **search backend** (Brave Web
   Search, not Perplexity's own retrieval) and a different **verdict model** (Claude
   `claude-opus-4-8`, adaptive thinking, not `sonar-pro`). Same two-step split as
   `perplexity-twostep` — step 1 gathers evidence (Brave), step 2 commits a verdict against
   ONLY that evidence (Claude) — and the SAME `RawVerification` shape out.
2. **`concurrence`** — a meta-verifier that runs two configured verifiers in parallel and
   combines their raw verdicts (below).

## The merge truth-table

`concurrence` normalizes each sub-verdict to core's canonical vocabulary (case-insensitive;
off-list/missing → `Unverifiable`, the most conservative bucket), then merges:

| A verdict | B verdict | → concurrence verdict | air-eligible? | note |
|---|---|---|---|---|
| definitive, **same** (True,True / False,False) | | that verdict | **ELIGIBLE** | the only eligibility path |
| definitive, **opposite** (True,False) | | `NeedsContext` | no | conflict flagged |
| definitive | non-definitive | the **non-definitive** one | no | |
| non-definitive | non-definitive, same | that verdict | no | |
| non-definitive | non-definitive, different | the **less committal** one | no | conservative merge |

"Definitive" = `True` or `False`. "Less committal" ranking (most → least):
`True`/`False` (3) > `Misleading` (2) > `NeedsContext` (1) > `Unverifiable` (0). When two
non-definitive verdicts differ, the **higher-ranked (more committal) one is dropped** and
the lower wins.

**Only mutual definitive agreement is ever air-eligible.** Concurrence never manufactures
eligibility a lone verifier didn't already earn, and it strips eligibility whenever the two
disagree. (Editorial's auto-air floor is still structural — source tier, D5 —
`autoAirEligible`; the concurrence `eligible` flag is an *additional* signal in the
`concurrence` block of the output, not a replacement for the tier gate.)

Confidence handling: on agreement, the merged confidence is the **lower** of the two inputs
(a merged card should never read more confident than its weakest engine); on any
disagreement or downgrade, it is additionally **halved**, so an over-confident lone engine
can't ride a disagreement in above the confidence floor.

Citations are **unioned and deduped** across both engines — core ranks them and picks the
single surfaced source (D5), so more high-trust URLs only helps.

## The one-verifier-errors policy (and why)

Both sub-verifiers run under `Promise.allSettled`, so one failure does not reject the whole
`verify()`. When **exactly one** sub-verifier errors:

- **Policy: fail-closed to the survivor's verdict, but floor any definitive down to
  `NeedsContext`, flag the error, and never air.** The survivor's correction / source /
  citations are carried through; its verdict is used as-is **only if it was already
  non-definitive** (`Misleading` / `NeedsContext` / `Unverifiable`); a survivor `True`/`False`
  is degraded to `NeedsContext`. Air-eligibility is impossible (it requires mutual definitive
  agreement). Confidence is damped.
- **Justification.** The conservative choice is *between* two options: (a) fail-closed to the
  survivor's raw verdict, or (b) drop to `NeedsContext`. We take a hybrid that lands on the
  conservative side of both: we keep the survivor's *material* (so a real correction still
  reaches the operator to consider) but refuse to let a **single engine's definitive verdict
  reach air through the concurrence gate** — which is the exact single-verifier failure mode
  the gate exists to close. Falling back to the survivor's definitive verdict would silently
  re-introduce it. Dropping definitive → `NeedsContext` is the strictly safer of the two
  conservative readings, so that's what we do.

When **both** error, there is no verdict to give — the first `UpstreamError` propagates and
the route surfaces it exactly as for a single-verifier failure.

## Env vars

| var | default | meaning |
|---|---|---|
| `FOOTNOTE_VERIFIER` | `perplexity` | pipeline verifier selector; set to `brave-claude` or `concurrence` to opt in (dark otherwise) |
| `FOOTNOTE_CONCURRENCE_A` | `perplexity` | concurrence engine A — any registered verifier key except `concurrence` |
| `FOOTNOTE_CONCURRENCE_B` | `brave-claude` | concurrence engine B — same |
| `BRAVE_API_KEY` | *(unset)* | brave-claude's Brave Web Search key. **Not provisioned** — required before any live run |
| `ANTHROPIC_API_KEY` | *(set)* | brave-claude's Claude verdict key (shared with the extractor); also per-call BYOK via `credentials.anthropicKey` |
| `PERPLEXITY_API_KEY` | *(set)* | used when `perplexity`/`perplexity-twostep` is a concurrence engine |

Per-call BYOK (D13/R8): `credentials` bundle keys are `perplexityKey`, `braveKey`,
`anthropicKey`. Concurrence threads the same bundle to both sub-verifiers; each resolves its
own key at request-construction time. No adapter mutates `process.env` for credentials
(statically enforced by the R8 tests).

Self-composition (`FOOTNOTE_CONCURRENCE_A=concurrence`) is **refused** at resolve time to
avoid infinite recursion.

## How to eval it later (needs owner spend authorization)

Same harness as the two-step eval (docs/VERIFY_TWOSTEP.md): `eval/run.js` drives a deployed
base URL's `/api/verify`; the adapter is selected server-side by `FOOTNOTE_VERIFIER`, read
at call time by `src/core/registry.js`. Point the harness at a server that has the flag set
— **never production**, which stays on the single-shot default.

```sh
# terminal 1 — serve the pipeline with the concurrence adapter selected.
# needs PERPLEXITY_API_KEY + BRAVE_API_KEY + ANTHROPIC_API_KEY in .env.local.
# BRAVE_API_KEY MUST be provisioned first (it is not today).
FOOTNOTE_VERIFIER=concurrence \
FOOTNOTE_CONCURRENCE_A=perplexity \
FOOTNOTE_CONCURRENCE_B=brave-claude \
npm start

# terminal 2 — smoke a handful of cases FIRST (validate brave-claude live before the full run)
node eval/run.js --base http://localhost:3000 --limit 6

# then the full harness-v2 calibration run (260 scorable cases, both scorers)
node eval/run.js --base http://localhost:3000 --all --judge

# report — per-category precision at the floor + auto-air eligibility
node eval/report.js
```

**Cost warning — ~2x+ a single verifier.** Every `concurrence` verify calls **two** engines
(perplexity = 1 sonar-pro call; brave-claude = 1 Brave search + 1 opus-4-8 call). A full run
is ~260 verifies → ~260 sonar-pro + ~260 Brave + ~260 opus-4-8 calls, plus Haiku extractions
and judge calls. Budget accordingly and get spend authorization before the full `--all` run —
the two-step eval's envelope was $5–6 for a single engine; concurrence roughly doubles the
verifier spend and adds Claude/Brave pricing on top. Smoke with `--limit 6` first; if the
first live `brave-claude` calls 4xx, the request shape needs fixing before spending on the
full run.

**Promotion bar.** Unchanged from D15 / VERIFY_TWOSTEP.md: ≥95% verdict precision per
category at the floor, n ≥ 30/category, both scorers clean with zero uninvestigated
inversions, and the mid-tier regression guard held. A passing eval only makes flipping the
default *its own decision* (with the calibration report as the artifact); a failing one keeps
both adapters dark. The interesting new metric for concurrence specifically: **precision
among the `concurrence.eligible === true` subset** — the hypothesis is that mutual definitive
agreement is materially more precise than either engine alone, at the cost of recall (fewer
claims reach eligible).

## R50 — the independent polarity signal (why concurrence alone can't catch polarity)

**The structural hole (R50's rationale, verbatim):** "the polarity field is emitted by the
SHARED extractor upstream of both verifier arms; the flip is applied above the Verifier
interface (D5); therefore concurrence over verifiers is structurally blind to polarity
misclassification — both arms would confirm the same mirrored card." Two engines can agree
all day on the *canonical assertive claim* and the card still airs inverted, because the
inversion happens in the one component both arms share (the extractor's `polarity` field)
and in the flip applied *after* both arms return (`applyPolarity` in api/verify.js).
Calibration #4 quantified it: the MIRROR class (denies mislabeled asserts) is the last
unguarded polarity direction — R46 catches the other direction (11/11), but cannot catch
this one (negation-present + asserts is riddled with false positives).

**The guard (src/core/polarity-signal.js):** a second, *independent* polarity instrument —
one cheap Haiku call (`claude-haiku-4-5-20251001`, temperature 0, ≤50 output tokens) that
reads ONLY the speaker's raw words (different prompt than the extractor, no canonical claim
shown) and answers one question: is the speaker ASSERTING or DENYING the factual
proposition they reference? Strict one-word parsing; anything unreadable/ambiguous/errored
is `null` — **fail-safe: null means "no signal", never a forced hold**. The signal can only
ever ADD a hold, never clear one.

**Wiring (api/verify.js):** the client may now send the optional `utterance` (the speaker's
raw words) in the verify POST body (string, trimmed, capped at 1000 chars). When present
and `FOOTNOTE_POLARITY_SIGNAL !== "off"`, the signal runs **in parallel** with the verifier
(`Promise.all` — verify is ~2.6s, the signal is sub-1s Haiku, so zero added wall latency).
After the existing `applyPolarity` step, a non-null signal that disagrees with the claimed
polarity (`suspect_denies` normalizes to `denies` for comparison; absent claimed polarity
means `asserts`) forces `polarity_conflict: true` — routing into the EXISTING hold
machinery: never auto-airs per D4, ⚠ on /op, spoken framing per D17 (R46's exact pattern).
Additive response field: `polarity_signal` (`"asserts"|"denies"|null`), present only when
the request carried an utterance. **Requests without `utterance` are byte-identical to the
pre-R50 contract** — the eval harness doesn't send it yet.

**Verifier interface (additive):** `verify(claim, ctx, credentials)` now documents an
optional `VerifyContext` — `{utterance?, claimedPolarity?}`. Adapters may ignore it
entirely; `{}` behaves exactly as before. `RawVerification` gains optional
`independent_polarity` (`"asserts"|"denies"|null`).

**brave-claude fold-in:** when `ctx.utterance` is present, the SAME step-2 Claude verdict
call carries a `POLARITY_ADDENDUM` on the system prompt plus a `Speaker said:` line, and
emits one extra JSON field (`speaker_polarity`) returned as `independent_polarity` — one
call, no extra spend. Without an utterance the wire payload is byte-identical to pre-R50.

### Truth-table extension (concurrence)

Applied AFTER the verdict merge, only when BOTH arms returned a readable
`independent_polarity` (requires `ctx.utterance` + both adapters supporting the fold-in;
with the default perplexity pairing the extension is inert — perplexity has no fold-in yet).
Let pA/pB be the arms' reads and pC the extractor's `claimedPolarity`
(`suspect_denies`→`denies`; malformed/absent pC skipped):

| condition | effect |
|---|---|
| pA = pB = pC (or pC absent) | no change to the verdict merge |
| pA ≠ pB, or either ≠ pC | downgrade **exactly like verdict disagreement**: definitive merged verdict → NeedsContext, eligibility stripped, `conflict: true`, confidence damped ×0.5 |
| either arm's read is null | extension inert — no signal is never treated as disagreement |

The concurrence result carries `concurrence.polarity = {a, b, claimed, conflict}` (or
`null` when the extension didn't engage; always `null` on the one-arm-errored path).

### Env switches

| var | default | meaning |
|---|---|---|
| `FOOTNOTE_POLARITY_SIGNAL` | *(on)* | set `off` to bypass the independent signal (no Haiku call; `polarity_signal: null` when an utterance was sent; never a forced conflict) |

Cost/latency per verify with an utterance: +1 Haiku call (~50 output tokens ≈ fractions of
a cent), 0 added wall latency (parallel; measured mean ~0.8s vs the ~2.6s verifier).

### Acceptance replay (R50, live, 2026-08-12)

`node tools/bench/polarity-replay.mjs` — 12 live Haiku calls against the mirror class
(pol-001, geo-029), all four field-session denials, and six clean assertions. Result:
**geo-029 CAUGHT (denies), zero false holds across all ten legitimate cases**; pol-001 read
"asserts" — which agrees with pol-001's own `adjudication_note` ("Expected polarity:
asserts", "final on-air verdict: False") and with quote-001 (byte-identical snippet,
`expected_polarity: "asserts"`). pol-001's `expected_polarity: "denies"` is a golden data
contradiction (a signal returning "denies" there would false-hold every approvingly-repeated
quote attribution); flagged for an orchestrator ruling — under the adjudication-note-corrected
reading the mirror class is 1 case, and the replay PASSES. Verbatim tables in
`tools/bench/results/polarity-replay-2026-08-12T15-42-03.{txt,jsonl}`.
