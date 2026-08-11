// Verifier META-adapter: concurrence (P?/gap F-3 — the second-verifier concurrence gate,
// built DARK). Runs TWO independent verifiers in PARALLEL and combines their raw verdicts
// into one RawVerification with the SAME shape src/core/editorial.js finalizeVerification
// consumes (D5). The point (calibration report #3, docs/VERIFY_TWOSTEP.md): a single
// verifier plateaus below the 95% auto-air bar because it over-commits on mid-tier /
// unverifiable claims. Requiring two genuinely different engines to AGREE before a
// definitive verdict is treated as air-eligible trades recall for precision on exactly
// that miss class.
//
// The pair is env-configurable so the two engines can be swapped without code changes:
//   FOOTNOTE_CONCURRENCE_A  (default: perplexity)
//   FOOTNOTE_CONCURRENCE_B  (default: brave-claude)
// Resolved through the registry's own verifier table (getVerifier below), so concurrence
// composes any registered verifier EXCEPT itself (self-reference is refused to avoid
// infinite recursion). Credentials are threaded per-call to BOTH sub-verifiers (D13/R8) —
// each sub-adapter resolves its own key at request-construction time; concurrence never
// touches env for credentials.
//
// Cost: this calls two verifiers, so latency ≈ max(A, B) (they run concurrently via
// Promise.all) and spend ≈ A + B (≈2x+ a single verifier). Accepted — precision play.
import { UpstreamError } from "../../../core/errors.js";

export const name = "concurrence";

const DEFAULT_A = "perplexity";
const DEFAULT_B = "brave-claude";

// Normalize a raw vendor verdict to core's canonical vocabulary, case-insensitively (the
// same normalization editorial.js applies). Anything off-list — or missing — becomes
// "Unverifiable", the maximally conservative bucket, so a garbled sub-verdict can never
// upgrade the merged result.
const CANON = ["True", "False", "Misleading", "Unverifiable", "NeedsContext"];
function canonVerdict(v) {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return CANON.find((c) => c.toLowerCase() === s) || "Unverifiable";
}
const DEFINITIVE = new Set(["True", "False"]);

// Lazy registry import to resolve the configured sub-verifiers. Imported inside the call
// (not at module top) so registry.js can import THIS module for registration without a
// circular-import hazard at load time.
async function getVerifier(id) {
  const { getVerifierByName } = await import("../../../core/registry.js");
  const adapter = getVerifierByName(id);
  if (!adapter || typeof adapter.verify !== "function") {
    throw new Error(`concurrence: sub-verifier "${id}" is not a registered verifier`);
  }
  if (adapter.name === name) {
    throw new Error(`concurrence: cannot compose itself as a sub-verifier ("${id}")`);
  }
  return adapter;
}

// Merge two normalized results into the concurrence verdict + air-eligibility flag.
//
//   MERGE TRUTH-TABLE (A verdict × B verdict → concurrence verdict, air-eligible?)
//   ─────────────────────────────────────────────────────────────────────────────
//   both definitive & SAME (True,True / False,False)  → that verdict          | ELIGIBLE
//   both definitive & OPPOSITE (True,False / False,..)→ NeedsContext (CONFLICT)| not eligible
//   one definitive, one non-definitive                → the non-definitive one | not eligible
//   both non-definitive & SAME                        → that verdict           | not eligible
//   both non-definitive & DIFFERENT                   → the LESS committal one  | not eligible
//
// "Less committal" ranking (most→least committal): True/False > Misleading > NeedsContext
// > Unverifiable. When two non-definitive verdicts differ, the higher-ranked (more
// committal) one is DROPPED and the lower wins — the conservative merge. Only mutual
// definitive agreement is ever air-eligible; concurrence never manufactures eligibility a
// lone verifier didn't already earn, and it strips eligibility whenever the two disagree.
const COMMITMENT = { True: 3, False: 3, Misleading: 2, NeedsContext: 1, Unverifiable: 0 };
function mergeVerdicts(va, vb) {
  const aDef = DEFINITIVE.has(va);
  const bDef = DEFINITIVE.has(vb);
  if (aDef && bDef) {
    if (va === vb) return { verdict: va, eligible: true, conflict: false };
    // opposite definitive verdicts — the strongest possible disagreement. Downgrade to
    // NeedsContext and flag the conflict; never air a card two engines contradict on.
    return { verdict: "NeedsContext", eligible: false, conflict: true };
  }
  // at least one non-definitive → conservative merge: the LESS committal verdict wins, and
  // the result is never air-eligible (definitive concurrence is the only eligibility path).
  const less = COMMITMENT[va] <= COMMITMENT[vb] ? va : vb;
  return { verdict: less, eligible: false, conflict: va !== vb };
}

/** @type {import("../../../core/interfaces/verifier.js").Verifier["verify"]} */
export async function verify(claim, ctx = {}, credentials = null) {
  const idA = process.env.FOOTNOTE_CONCURRENCE_A || DEFAULT_A;
  const idB = process.env.FOOTNOTE_CONCURRENCE_B || DEFAULT_B;
  const [vA, vB] = await Promise.all([getVerifier(idA), getVerifier(idB)]);

  // Run BOTH sub-verifiers concurrently. Credentials threaded per-call to each (R8): the
  // sub-adapters resolve their own vendor keys from the SAME credential bundle.
  // allSettled — not all — so ONE failure does not reject the whole verify(): fail-closed
  // (see the one-errors policy below), not fail-open.
  const [rA, rB] = await Promise.allSettled([
    vA.verify(claim, ctx, credentials),
    vB.verify(claim, ctx, credentials),
  ]);

  // ONE-VERIFIER-ERRORS POLICY (documented, conservative): if exactly one sub-verifier
  // errors, do NOT trust the survivor's definitive verdict as if it were concurred. We
  // can't know whether the dead engine would have agreed, so eligibility (which requires
  // mutual definitive agreement) is impossible by construction — and we go further and
  // FLOOR the merged verdict at NeedsContext, degrading any survivor True/False to
  // NeedsContext with the error noted. Rationale: concurrence exists precisely to stop a
  // single engine from putting a definitive verdict on air; falling back to the survivor's
  // raw verdict would silently re-introduce the single-verifier failure mode the gate is
  // meant to close. If BOTH error, propagate the first UpstreamError (route surfaces it) —
  // there is no verdict to give.
  const okA = rA.status === "fulfilled";
  const okB = rB.status === "fulfilled";

  if (!okA && !okB) {
    const err = pickUpstream(rA.reason, rB.reason);
    throw err;
  }

  if (okA !== okB) {
    const survivor = okA ? rA.value : rB.value;
    const failedId = okA ? idB : idA;
    const sVerdict = canonVerdict(survivor.verdict);
    // floor a survived definitive verdict down to NeedsContext (never air a single-engine
    // definitive through the concurrence gate); leave already-non-definitive alone.
    const merged = DEFINITIVE.has(sVerdict) ? "NeedsContext" : sVerdict;
    return {
      verdict: merged,
      correction: survivor.correction,
      confidence: dampConfidence(survivor.confidence),
      sourceName: survivor.sourceName,
      citations: Array.isArray(survivor.citations) ? survivor.citations : [],
      raw: survivor.raw,
      concurrence: {
        a: { id: idA, ok: okA, verdict: okA ? sVerdict : null },
        b: { id: idB, ok: okB, verdict: okB ? sVerdict : null },
        errored: failedId,
        eligible: false,
        conflict: false,
        merged,
      },
    };
  }

  // both succeeded — the normal concurrence path.
  const a = rA.value;
  const b = rB.value;
  const va = canonVerdict(a.verdict);
  const vb = canonVerdict(b.verdict);
  const { verdict, eligible, conflict } = mergeVerdicts(va, vb);

  // Pick the raw material (correction/source/citations) from the sub-result whose verdict
  // the merged verdict matches; on conflict/downgrade, prefer the more conservative side so
  // the on-air correction never over-claims. Citations are UNIONED (deduped) — core ranks
  // them and picks the single surfaced source, so more high-trust URLs only helps.
  const primary = verdict === va ? a : verdict === vb ? b : (COMMITMENT[va] <= COMMITMENT[vb] ? a : b);
  const citations = dedupe([
    ...(Array.isArray(a.citations) ? a.citations : []),
    ...(Array.isArray(b.citations) ? b.citations : []),
  ]);

  return {
    verdict,
    correction: primary.correction,
    // agreement keeps the lower of the two confidences (conservative); disagreement damps
    // further. Editorial's auto-air floor is structural (source tier), so this is belt-and-
    // suspenders, but a merged card should never read MORE confident than its weakest input.
    confidence: eligible ? minConfidence(a.confidence, b.confidence) : dampConfidence(minConfidence(a.confidence, b.confidence)),
    sourceName: primary.sourceName,
    citations,
    raw: primary.raw,
    concurrence: {
      a: { id: idA, ok: true, verdict: va },
      b: { id: idB, ok: true, verdict: vb },
      errored: null,
      eligible,
      conflict,
      merged: verdict,
    },
  };
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const u of arr) {
    if (typeof u === "string" && u && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}
function num(x) { return typeof x === "number" && Number.isFinite(x) ? x : 0.5; }
function minConfidence(a, b) { return Math.min(num(a), num(b)); }
// downgrade path: halve, so a disagreement can't ride in above the confidence floor on the
// strength of one over-confident engine.
function dampConfidence(c) { return num(c) * 0.5; }
function pickUpstream(ea, eb) {
  if (ea instanceof UpstreamError) return ea;
  if (eb instanceof UpstreamError) return eb;
  return ea instanceof Error ? ea : new Error(String(ea));
}
