// NIGHTSPRINT S2 — shared window→gate→extract→verify→air simulator.
//
// This is the ONE piece of logic both simulate.js modes (--real streaming through
// Deepgram, --replay of a recorded transcript) drive, so their scorecards are directly
// comparable. It is a faithful OFFLINE mirror of the live client path in app.js:
//
//     STT finals ──▶ rolling window (windowShouldExtract / windowExtract, app.js:1076)
//                 ──▶ checkUtterance gates (app.js:451):
//                       · fragment      (< 6 words, non-merged)          [app.js:462]
//                       · consecutive-dupe (t === lastUtterance)         [app.js:463]
//                       · ground        (grounding gate, /api/extract)   [grounding.js]
//                       · dedupe        (F2 claim-level, DUP_CLAIM_WINDOW)[app.js:516]
//                       · polarity-conflict / person-hold (maybeAutoAir) [app.js:735]
//                 ──▶ /api/extract  (real Haiku  OR replayed fixture)
//                 ──▶ /api/verify   (real Perplexity OR replayed fixture)
//                 ──▶ air decision  (maybeAutoAir gate chain)            [app.js:735]
//
// The window state machine is lifted verbatim from tools/bench/window-replay.js and
// app.js (both carry the same loop). The gate predicates come straight from
// src/core/utterance.js and src/core/grounding.js — the SAME modules the server route
// imports — so there is no second copy to drift.
//
// The caller supplies an `extractFn(text)` and `verifyFn(claim, polarity, utterance)`.
// In --real those hit a live local server; in --replay they read the fixture's recorded
// responses. Everything else — windowing, gating, air decision, timing — is identical.

import {
  WINDOW_WORDS, WINDOW_TRAIL_SILENCE_MS,
  windowShouldExtract, normalizeClaim, withinDupWindow, hasNegation,
} from "../../src/core/utterance.js";
import { groundedClaim } from "../../src/core/grounding.js";

const WINDOW_MAX = 60;   // app.js caps the rolling buffer at 60 words

/**
 * Decide whether a settled card would AUTO-AIR, mirroring maybeAutoAir() in app.js.
 * R72 (2026-08-18 ruling): the toggle IS the gate — every settled card airs when the
 * operator's Auto-Air checkbox is on. The pilot-era hold chain (person/harm/category/
 * tier/confidence) is gone; see git history for the old gate model.
 * @returns {{aired:boolean, reason:string}}
 */
export function airDecision(card, autoAirEnabled = true) {
  if (!autoAirEnabled) return { aired: false, reason: "autoair-off" };
  return { aired: true, reason: "aired" };
}

/**
 * Run the window state machine over a stream of STT finals and drive each extracted
 * window through the gate → extract → verify → air pipeline.
 *
 * @param {{t:number, text:string}[]} finals  timestamped STT finals (t in epoch-ms-like units)
 * @param {object} hooks
 *   @param {(text:string)=>Promise<{claim,polarity,harm_class,category,rejected,tripwire,ms,error}>} hooks.extractFn
 *   @param {(claim:string,polarity:string,utterance:string)=>Promise<{verdict,confidence,source,autoAirEligible,polarity_conflict,ms,error}>} hooks.verifyFn
 *   @param {boolean} [hooks.autoAir=true]
 * @returns {Promise<{windows:Array, checks:Array, finals:number, spokenWords:number}>}
 */
export async function runPipeline(finals, hooks) {
  const { extractFn, verifyFn, autoAir = true } = hooks;
  const windows = [];   // each window text handed to extract
  const checks = [];    // one record per checkUtterance call (the scored unit)

  // ---- window state machine (verbatim shape from app.js / window-replay.js) ----
  let winWords = [], winNewWords = 0, winLastSent = "";
  let winLastExtract = finals.length ? finals[0].t - 10000 : 0;
  const pending = [];   // {reason, text, at} to process after windowing (keeps timing deterministic)

  function windowExtract(reason, now) {
    const text = winWords.slice(-WINDOW_WORDS).join(" ").trim();
    winNewWords = 0; winLastExtract = now;
    if (!text || text === winLastSent) return;
    winLastSent = text;
    windows.push({ reason, text, at: now });
    pending.push({ reason, text, at: now });
  }

  for (let i = 0; i < finals.length; i++) {
    const f = finals[i];
    const prevT = i ? finals[i - 1].t : f.t;
    // the 400ms window timer ticks between the previous final and this one
    for (let tick = prevT + 400; tick < f.t; tick += 400) {
      if (winNewWords && windowShouldExtract(winNewWords, tick - winLastExtract, tick - prevT, false))
        windowExtract(tick - prevT >= WINDOW_TRAIL_SILENCE_MS ? "silence" : "cadence", tick);
    }
    const ws = f.text.split(/\s+/).filter(Boolean);
    winWords.push(...ws);
    if (winWords.length > WINDOW_MAX) winWords = winWords.slice(-WINDOW_MAX);
    winNewWords += ws.length;
    if (/[.!?]$/.test(f.text) && windowShouldExtract(winNewWords, f.t - winLastExtract, 0, true)) windowExtract("terminal", f.t);
  }
  if (winNewWords) windowExtract("end", finals.length ? finals[finals.length - 1].t + WINDOW_TRAIL_SILENCE_MS : 0);

  // ---- gate + extract + verify + air, per window (mirrors checkUtterance) ----
  const recentClaims = new Map();   // F2 dedupe: normalized claim → last card-creation "time"
  let lastUtterance = "";

  for (const w of pending) {
    const t = w.text.trim();
    const words = t.split(/\s+/).filter(Boolean);
    const rec = { text: t, reason: w.reason, at: w.at, words: words.length, gate: null, claim: null, polarity: null, category: null, verdict: null, airedReason: null, aired: false, latency: {} };

    // Windows enter checkUtterance with { merged:true } → word-min BYPASSED, but the
    // consecutive-dupe guard still applies. (A raw non-window path would fragment-drop
    // < 6 words; we surface that gate for scoring completeness on short windows.)
    if (words.length < 6 && w.reason !== "terminal" && w.reason !== "end" && w.reason !== "cadence" && w.reason !== "silence") {
      rec.gate = "fragment"; checks.push(rec); continue;
    }
    if (t === lastUtterance) { rec.gate = "consecutive-dupe"; checks.push(rec); continue; }
    lastUtterance = t;

    // ---- /api/extract (real or replayed) ----
    const ex = await extractFn(t);
    rec.latency.extract = ex.ms ?? null;
    if (ex.error) { rec.gate = "extract-error"; checks.push(rec); continue; }
    // v4 multi-claim: adapters return .claims; legacy fixture/single shapes wrap to one item.
    const items = Array.isArray(ex.claims) ? ex.claims : (ex.claim != null ? [ex] : []);
    if (!items.length) {
      // the server route already ran the grounding gate; no claims with rejected:"ungrounded"
      // is the ground gate firing, otherwise it's a plain no-claim.
      rec.gate = ex.rejected === "ungrounded" ? "ground" : "no-claim";
      checks.push(rec); continue;
    }
    // One rec per claim (mirrors checkUtterance's per-claim runClaim path); shared
    // extract latency, same window text — the scored unit stays "one claim's journey".
    for (const item of items) {
      const crec = { ...rec, latency: { ...rec.latency } };
      crec.claim = item.claim;
      crec.polarity = item.polarity ?? null;
      crec.category = item.category ?? null;
      crec.harm_class = item.harm_class ?? null;
      // Defensive: in --replay the fixture may hand back a claim without having run the
      // server-side grounding gate. Re-run it locally so the "ground" gate is scored the
      // same way in both modes (the real server already did this; groundedClaim is pure).
      if (ex.rejected !== "ungrounded") {
        const g = groundedClaim(item.claim, t);
        if (!g.ok) { crec.gate = "ground"; checks.push(crec); continue; }
      }
      // R46 negation tripwire: server returns polarity:"suspect_denies" when denies w/o negation.
      if (item.tripwire === "negation" || (item.polarity === "denies" && !hasNegation(t))) {
        crec.polarity = "suspect_denies";
      }

      // ---- F2 claim-level dedupe (uses window `at` as the clock, like Date.now() live) ----
      const normClaim = normalizeClaim(item.claim);
      if (withinDupWindow(recentClaims.get(normClaim), w.at)) { crec.gate = "dedupe"; checks.push(crec); continue; }
      recentClaims.set(normClaim, w.at);

      // ---- /api/verify (real or replayed) ----
      const vr = await verifyFn(item.claim, crec.polarity, t);
      crec.latency.verify = vr.ms ?? null;
      if (vr.error) { crec.gate = "verify-error"; checks.push(crec); continue; }
      crec.verdict = vr.verdict ?? null;
      crec.confidence = vr.confidence ?? null;
      crec.polarity_conflict = Boolean(vr.polarity_conflict) || crec.polarity === "suspect_denies";
      crec.autoAirEligible = vr.autoAirEligible === true;
      crec.source = vr.source || null;
      crec.gate = "checked";   // reached a verdict — passed all upstream gates

      // ---- air decision ----
      const air = airDecision({
        harm_class: crec.harm_class, polarity_conflict: crec.polarity_conflict, category: crec.category,
        autoAirEligible: crec.autoAirEligible, verdict: crec.verdict, confidence: crec.confidence, source: crec.source,
      }, autoAir);
      crec.aired = air.aired;
      crec.airedReason = air.reason;
      checks.push(crec);
    }
  }

  const spokenWords = finals.reduce((n, f) => n + f.text.split(/\s+/).filter(Boolean).length, 0);
  return { windows, checks, finals: finals.length, spokenWords };
}
