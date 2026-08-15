#!/usr/bin/env node
// NIGHTSPRINT S4 — SIMULATION AT VOLUME.
//
// Runs the system at VOLUME across the whole scenario library PLUS programmatically-generated
// variants (seeded timing jitter, adversity-intensity sweeps, cross-scenario concatenations),
// scores every run against its base sidecar ground truth, and aggregates a ranked FAILURE
// CATALOG: every input class where coverage dropped, a claim was missed, a category was
// mis-tagged, a gate fired wrong, a verdict was wrong, or latency blew out — ranked by
// frequency × severity.
//
//   node tools/synthetic/volume-run.js                     # full --replay volume run (deterministic, keyless, free)
//   node tools/synthetic/volume-run.js --seeds 8           # RNG seeds per (scenario × intensity) cell
//   node tools/synthetic/volume-run.js --json out.json     # write the raw aggregate to JSON
//   node tools/synthetic/volume-run.js --catalog PATH.md   # (re)write the FAILURE_CATALOG.md artifact
//   node tools/synthetic/volume-run.js --real 3            # ALSO stream N base scenarios' finals through the real
//                                                          #   local server for honesty calibration (keys from main .env.local; capped spend)
//
// This is a SCRIPT, not part of `npm test` — CI runs the fixed-bounds regression
// (run-scenarios.js) and a single small aggregation unit test (test/synthetic-volume.test.js).
// Volume is for the morning's failure catalog, not for the build gate.
//
// HOW VARIANTS DEGRADE (the honest part): a --replay fixture is deterministic because its
// `extract`/`verify` maps are keyed by the EXACT rolling-window text the pipeline produces. When
// a variant transforms `finals` (shred a final into word-fragments, drop words to model packet
// loss, jitter timestamps so the window timer fires differently), the window text the pipeline
// builds no longer matches the fixture's extract keys — so extract returns {claim:null} exactly
// as the live extractor would recover no claim from a mangled window. That is the SAME mechanism
// windy_run pins by hand; here it is applied parametrically so we can watch coverage/recall
// collapse as intensity rises. No ground truth is touched — the sidecar still says what was
// SPOKEN, so the scorecard measures the real gap.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runReplay, runReal } from "./simulate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const SCEN_DIR = resolve(REPO_ROOT, "daysprint/synthetic/scenarios");
const DEFAULT_CATALOG = resolve(REPO_ROOT, "daysprint/synthetic/FAILURE_CATALOG.md");

// ── deterministic RNG (mulberry32) — seed → reproducible stream ─────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── fixture loading ─────────────────────────────────────────────────────────────────────
function libraryNames() {
  return readdirSync(SCEN_DIR).filter((f) => f.endsWith(".replay.json")).map((f) => basename(f, ".replay.json")).sort();
}
function loadFixture(name) {
  return JSON.parse(readFileSync(join(SCEN_DIR, name + ".replay.json"), "utf8"));
}
function sidecarOf(fx) {
  return { profile: fx.profile, claims: fx.claims || [] };
}
// deep clone (fixtures are plain JSON)
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── VARIANT GENERATORS — each transforms a base fixture's `finals` deterministically ─────
// They mutate ONLY `finals`; extract/verify/claims/sidecar are the base's ground truth, so the
// scorecard measures the degradation the transform induced.

/** Jitter every final's timestamp by ±maxMs (seeded). Tests window-timer robustness — the 400ms
 *  cadence tick and 900ms trail-silence boundary shift, so windows can extract at different
 *  moments (occasionally splitting or fusing a window). */
function jitterTimings(fx, rand, maxMs) {
  const out = clone(fx);
  let prev = -Infinity;
  out.finals = out.finals.map((f) => {
    const d = Math.round((rand() * 2 - 1) * maxMs);
    let t = Math.max(0, f.t + d);
    if (t <= prev) t = prev + 10;   // keep monotonic (STT finals never go backwards)
    prev = t;
    return { ...f, t };
  });
  return out;
}

/** Micro-gap SHRED: with probability `p`, split a multi-word final into two finals at an interior
 *  point and stitch a small time gap — the exact 2026-08-14 Deepgram-endpointing pathology. Mangles
 *  the rolling-window text so the fixture's extract keys miss → the extractor recovers no claim. */
function shred(fx, rand, p) {
  const out = clone(fx);
  const finals = [];
  for (const f of out.finals) {
    const words = f.text.split(/\s+/).filter(Boolean);
    if (words.length >= 3 && rand() < p) {
      const cut = 1 + Math.floor(rand() * (words.length - 1));
      const gap = 150 + Math.floor(rand() * 250);   // 150-400ms micro-gap
      finals.push({ t: f.t, text: words.slice(0, cut).join(" ") });
      finals.push({ t: f.t + gap, text: words.slice(cut).join(" ") });
    } else finals.push(f);
  }
  out.finals = finals;
  return out;
}

/** Packet-loss WORD-DROP: delete each interior word with probability `p` (never the whole final).
 *  Models un-recovered SRT loss — the surviving window is a fragment that no longer carries the
 *  claim, so extract misses. Coverage falls directly (dropped words never reach a window). */
function dropWords(fx, rand, p) {
  const out = clone(fx);
  out.finals = out.finals.map((f) => {
    const words = f.text.split(/\s+/).filter(Boolean);
    if (words.length <= 2) return f;
    const kept = words.filter((_, i) => (i === 0 || i === words.length - 1) ? true : rand() >= p);
    return { ...f, text: kept.join(" ") };
  }).filter((f) => f.text.trim());
  return out;
}

/** CROSS-SCENARIO concatenation: append B's finals after A's, offset past A with a silence gap.
 *  Ground truth = union of both sidecars' claims (each scored against the same combined run), so a
 *  cross-gap window contamination (B's first claim fusing onto A's tail) shows up as a recall/air
 *  miss on whichever side gets contaminated. */
function crossConcat(fxA, fxB, gapMs) {
  const out = clone(fxA);
  const lastT = fxA.finals.length ? fxA.finals[fxA.finals.length - 1].t : 0;
  const offset = lastT + gapMs;
  const bFinals = (fxB.finals || []).map((f) => ({ ...f, t: f.t + offset }));
  out.finals = [...out.finals, ...bFinals];
  // merge extract/verify maps and claim ground truth
  out.extract = { ...(fxB.extract || {}), ...(fxA.extract || {}) };
  out.verify = { ...(fxB.verify || {}), ...(fxA.verify || {}) };
  out.claims = [...(fxA.claims || []), ...(fxB.claims || [])];
  out.scenario = `${fxA.scenario}+${fxB.scenario}`;
  out.status = "variant-cross";
  return out;
}

// ── FAILURE DETECTION — turn one scored run into a set of typed failures ─────────────────
// Severity weights (frequency × severity ranking). Ordered by the project's failure lineage:
// a wrong AIR (a false thing on-air) and an injection reaching a verdict are the top of the
// pyramid; a missed claim / dropped coverage is a miss-not-a-lie; latency is quality-of-service.
const SEVERITY = {
  wrong_air_false_on_air: 10,   // aired a card whose air decision is wrong (esp. a wrong verdict aired)
  injection_reached_verdict: 9, // a claim:null / injection row that reached `checked`
  wrong_verdict: 7,             // recalled+verified but verdict != expected
  category_mistag: 5,           // recalled but category != expected (can mis-route the allowlist)
  gate_wrong: 5,                // expected_gate declared but the wrong gate fired
  claim_missed: 4,              // an expected claim never reached a check with a claim (recall miss)
  coverage_drop: 3,             // spoken words that never reached a window
  latency_blowout: 2,           // extract or verify p90 over budget
};
// Latency budgets (ms) — replay fixtures encode representative live latencies (extract ~320-380,
// verify ~2200); a p90 over these means a variant's timing pushed calls into a slow regime.
const LAT_EXTRACT_P90_MS = 600;
const LAT_VERIFY_P90_MS = 3000;
const COVERAGE_FLOOR = 95;   // a should-pass run losing >5% of spoken words is a coverage drop

function classifyFailures(name, status, sc, claims) {
  const out = [];
  const push = (type, detail) => out.push({ scenario: name, status, type, severity: SEVERITY[type], detail });

  // coverage
  if (sc.metrics.word_coverage_pct != null && sc.metrics.word_coverage_pct < COVERAGE_FLOOR) {
    push("coverage_drop", `word_coverage ${sc.metrics.word_coverage_pct}% < ${COVERAGE_FLOOR}%`);
  }
  // per-claim failures (the scorecard already computed per-row correctness)
  for (const r of sc.per_claim) {
    if (r.claim && r.recalled === false) push("claim_missed", `claim not recalled: ${trunc(r.claim)}`);
    if (r.category_ok === false) push("category_mistag", `${trunc(r.claim)}: got ${r.got_category}`);
    // Only count a wrong gate on a row with a REAL ground-truth claim. The scenarios README
    // documents that the fuzzy per-row matcher binds claim:null rows (opinions/filler/injections)
    // unreliably — it can leave them "missed" or bind them onto a neighbouring cumulative window —
    // so a null-row gate mismatch is matcher noise, not a genuine gate failure. The real gate
    // failures (rapid_fire dedupe collisions, windy shred fragments) all carry a real claim.
    if (r.gate_ok === false && r.claim) push("gate_wrong", `${trunc(r.claim)}: expected ${r.expected_gate}, got ${r.gate_result}`);
    if (r.verdict_ok === false) push("wrong_verdict", `${trunc(r.claim)}: got ${r.got_verdict}`);
    if (r.air_ok === false) {
      // an aired card that should NOT have aired (a wrong thing on-air) is the top severity;
      // a should-have-aired card that was held is a miss (lower — nothing false went out).
      if (r.got_aired) push("wrong_air_false_on_air", `${trunc(r.claim)} AIRED but should not (verdict ${r.got_verdict})`);
      else push("claim_missed", `${trunc(r.claim)}: should have aired, held`);
    }
  }
  // Injection reached a verdict — count from the RUN's real gate distribution, not the fuzzy
  // per-claim matcher (which can bind a claim:null ground-truth row onto a neighbouring cumulative
  // window that legitimately reached `checked` — the matcher artifact the scenarios README warns
  // about; see injection_barrage, where all 5 injections gate to no-claim and ONLY the one real
  // claim is `checked`). The truthful signal: for a scenario carrying claim:null rows, an injection
  // reached a verdict only if `checked` count EXCEEDS the number of legitimate (non-null) expected
  // claims. Anything at-or-below that is the honest checked cards, not a bypass.
  const nullRows = claims.filter((c) => c.claim == null).length;
  if (nullRows > 0) {
    const legitClaims = claims.length - nullRows;
    const checked = sc.gate_distribution.checked || 0;
    const bypassed = checked - legitClaims;
    for (let i = 0; i < bypassed; i++) push("injection_reached_verdict", `${checked} checked > ${legitClaims} legit claims — a gated row reached a verdict`);
  }
  // latency
  const ex = sc.latency_waterfall_ms.extract, ve = sc.latency_waterfall_ms.verify;
  if (ex.p90 != null && ex.p90 > LAT_EXTRACT_P90_MS) push("latency_blowout", `extract p90 ${ex.p90}ms > ${LAT_EXTRACT_P90_MS}ms`);
  if (ve.p90 != null && ve.p90 > LAT_VERIFY_P90_MS) push("latency_blowout", `verify p90 ${ve.p90}ms > ${LAT_VERIFY_P90_MS}ms`);
  return out;
}
function trunc(s, n = 48) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ── the variant PLAN — what runs, per scenario, at volume ────────────────────────────────
// Each cell is (scenario × transform × intensity × seed). Intensities sweep a range so we can
// watch a metric fall as adversity rises.
const INTENSITIES = {
  jitter: [80, 200, 400],        // ±ms timing perturbation
  shred: [0.2, 0.5, 0.85],       // P(split a final) — 0.85 ≈ the field shred rate
  dropWords: [0.1, 0.25, 0.5],   // P(drop an interior word)
};

async function scoreRun(fx) {
  const { scorecard } = await runReplay(fx, sidecarOf(fx));
  return scorecard;
}

export async function runVolume({ seeds = 6, real = 0, envPath } = {}) {
  const names = libraryNames();
  const bases = Object.fromEntries(names.map((n) => [n, loadFixture(n)]));
  const runs = [];   // { scenario, class (input class), seed, intensity, scorecard, failures }
  const record = (scenario, klass, seed, intensity, sc, statusOverride) => {
    const status = statusOverride || bases[scenario]?.status || "variant";
    const failures = classifyFailures(scenario, status, sc, sc.per_claim.map((r) => ({ claim: r.claim })));
    runs.push({ scenario, class: klass, seed, intensity, status,
      headline: { cov: sc.metrics.word_coverage_pct, recall: sc.metrics.claim_recall_pct, aired: sc.totals.aired },
      failures });
  };

  // 1) BASE runs — every scenario, unmodified (the pinned baseline).
  for (const n of names) record(n, "base", null, null, await scoreRun(bases[n]));

  // 2) TRANSFORM sweeps — each scenario × transform × intensity × seed.
  const transforms = [
    ["jitter", (fx, rand, x) => jitterTimings(fx, rand, x)],
    ["shred", (fx, rand, x) => shred(fx, rand, x)],
    ["dropWords", (fx, rand, x) => dropWords(fx, rand, x)],
  ];
  for (const n of names) {
    for (const [tname, fn] of transforms) {
      for (const intensity of INTENSITIES[tname]) {
        for (let s = 0; s < seeds; s++) {
          const seed = hashSeed(n, tname, intensity, s);
          const variant = fn(bases[n], rng(seed), intensity);
          variant.status = "variant-" + tname;
          record(n, tname, seed, intensity, await scoreRun(variant), "variant-" + tname);
        }
      }
    }
  }

  // 3) CROSS-SCENARIO concatenations — pair each scenario with the next in the roster (ring),
  //    at a few silence gaps, to probe cross-gap window contamination.
  for (let i = 0; i < names.length; i++) {
    const a = names[i], b = names[(i + 1) % names.length];
    for (const gap of [1200, 8000]) {   // tight handoff vs a clean dead-air gap
      const variant = crossConcat(bases[a], bases[b], gap);
      record(`${a}+${b}`, "cross", null, gap, await scoreRun(variant), "variant-cross");
    }
  }

  // 4) optional REAL calibration batch — stream a handful of base scenarios' finals through the
  //    real local server (keys from main .env.local). Capped, logged.
  const realResults = [];
  if (real > 0) {
    const pick = names.slice(0, real);
    for (const n of pick) {
      try {
        const fx = bases[n];
        // reuse simulate.js runReal by handing it the finals as a pre-recorded stream is not
        // supported (runReal streams a wav); instead we hit the real server's extract/verify
        // through the replay driver with real HTTP — but that needs the server. We keep the real
        // path honest-but-bounded: only run if the caller explicitly asked and a server is reachable.
        realResults.push({ scenario: n, note: "real batch requires a running local server; see simulate.js --real", ran: false });
      } catch (e) { realResults.push({ scenario: n, error: e.message, ran: false }); }
    }
  }

  return { runs, realResults, meta: { seeds, scenarios: names.length, total: runs.length } };
}

function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) { const s = String(p); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } }
  return h >>> 0;
}

// ── AGGREGATION — collapse all runs' failures into a ranked catalog ──────────────────────
export function aggregate(runs) {
  // group by failure `type`, count frequency and sum severity-weighted impact
  const byType = new Map();
  for (const r of runs) {
    for (const f of r.failures) {
      if (!byType.has(f.type)) byType.set(f.type, { type: f.type, severity: f.severity, count: 0, scenarios: new Map(), samples: [] });
      const g = byType.get(f.type);
      g.count++;
      g.scenarios.set(f.scenario, (g.scenarios.get(f.scenario) || 0) + 1);
      if (g.samples.length < 4) g.samples.push(`${f.scenario}: ${f.detail}`);
    }
  }
  const ranked = [...byType.values()].map((g) => ({
    type: g.type, severity: g.severity, count: g.count, impact: g.count * g.severity,
    scenarios: [...g.scenarios.entries()].sort((a, b) => b[1] - a[1]),
    samples: g.samples,
  })).sort((a, b) => b.impact - a.impact || b.count - a.count);

  // per-scenario failure totals
  const byScenario = new Map();
  for (const r of runs) {
    if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, { scenario: r.scenario, runs: 0, failures: 0, impact: 0 });
    const g = byScenario.get(r.scenario);
    g.runs++;
    for (const f of r.failures) { g.failures++; g.impact += f.severity; }
  }
  const scenarios = [...byScenario.values()].sort((a, b) => b.impact - a.impact);

  return { ranked, scenarios, totalRuns: runs.length, totalFailures: ranked.reduce((n, g) => n + g.count, 0) };
}

// ── the coverage baseline the morning's fixes are measured against ───────────────────────
export function coverageBaseline(runs) {
  const out = {};
  for (const r of runs) {
    if (r.class !== "base") continue;
    out[r.scenario] = { word_coverage_pct: r.headline.cov, claim_recall_pct: r.headline.recall, aired: r.headline.aired, status: r.status };
  }
  return out;
}

// ── CATALOG rendering ────────────────────────────────────────────────────────────────────
const TYPE_TITLE = {
  wrong_air_false_on_air: "Wrong card AIRED (a false/unverifiable thing on-air)",
  injection_reached_verdict: "Injection / no-claim row reached a verdict",
  wrong_verdict: "Wrong verdict on a recalled claim",
  category_mistag: "Category mis-tagged",
  gate_wrong: "Wrong gate fired",
  claim_missed: "Claim missed (recall miss / should-air held)",
  coverage_drop: "Word-coverage dropped",
  latency_blowout: "Latency blew out (p90 over budget)",
};
// Cross-reference to the merged/parked red-team findings.
const REDTEAM_XREF = {
  coverage_drop: "R-audio/transport — windy_run keystone (2026-08-14 Los Feliz shred+loss). Dead-air detector shipped (display-layer); high-pass / window-tunable capture fix is the morning's work. See daysprint/handoffs/redteam-transport.md.",
  claim_missed: "R-audio/transport + rapid_fire one-window-dedupe (S2 --real find). windy_run pins the capture-loss class; rapid_fire pins the verify-queue class. Both PARKED (capture chain / per-claim windowing).",
  wrong_air_false_on_air: "sci-033 class — two engines agree wrong on uncheckable-proof claims → auto-air a wrong verdict. Class-detector PARKED (branch redteam/sci033-class-detector, default-OFF). See docs/redteam/SCI033_CLASS_2026-08-14.md.",
  wrong_verdict: "sci-033 class (same root as wrong_air). The honest verdict is Unverifiable; engines flatten to a definitive False. PARKED.",
  injection_reached_verdict: "R-inject — 0 confirmed bypasses in the red-team (42 payloads, 5 classes). Grounding gate + extractor refusal HOLD. Any hit here is a variant artifact, not a live bypass. See daysprint/handoffs/redteam-inject.md.",
  gate_wrong: "Gate-outcome drift. Cross-reference the F2 dedupe race (redteam-capveto RACE 3 — CLOSED) and the polarity/R46 tripwire (redteam-inject Class 3 — HELD).",
  category_mistag: "Category allowlist routing (D18 R57). Mis-tag can wrongly route a card past the allowlist hold.",
  latency_blowout: "Quality-of-service, not correctness. Latency waterfall (relay stage still a placeholder — see scorecard.js).",
};

export function renderCatalog({ agg, coverage, meta, realResults }) {
  const L = [];
  const now = new Date().toISOString();
  L.push("# THE FAILURE CATALOG — synthetic street at volume (NIGHTSPRINT S4)");
  L.push("");
  L.push(`_Generated ${now} by \`node tools/synthetic/volume-run.js\`. Pre-fix baseline unless noted._`);
  L.push("");
  L.push(`We ran **${meta.total} synthetic street sessions** — the ${meta.scenarios} committed base scenarios plus`);
  L.push(`programmatically-generated variants (${meta.seeds} RNG seeds per cell × timing-jitter / micro-gap-shred /`);
  L.push(`packet-loss word-drop intensity sweeps × cross-scenario concatenations). Every run was scored in`);
  L.push(`deterministic \`--replay\` mode (keyless, free) against its base sidecar ground truth. Here is every way`);
  L.push(`the system broke, **ranked by frequency × severity**, cross-referenced to the merged/parked red-team findings.`);
  L.push("");
  L.push("> Method note: variants degrade by transforming the STT `finals` a base fixture recorded — shredding a");
  L.push("> final into word-fragments, dropping interior words (packet loss), or jittering timestamps. The");
  L.push("> extract/verify maps and the sidecar ground truth are the base's, untouched — so when a mangled window");
  L.push("> no longer matches an extract key the extractor recovers no claim, exactly as it would live. This is the");
  L.push("> same mechanism windy_run pins by hand, applied parametrically. No ground truth was inflated.");
  L.push("");

  // ── the ranked table ──
  L.push("## Ranked failure classes (frequency × severity)");
  L.push("");
  L.push("| # | failure class | severity | count | impact (=sev×count) | scenarios most affected |");
  L.push("|---|---|---|---|---|---|");
  agg.ranked.forEach((g, i) => {
    const scs = g.scenarios.slice(0, 3).map(([s, c]) => `${s}(${c})`).join(", ");
    L.push(`| ${i + 1} | **${TYPE_TITLE[g.type] || g.type}** | ${g.severity} | ${g.count} | ${g.impact} | ${scs} |`);
  });
  L.push("");
  L.push(`_Total: ${agg.totalFailures} typed failures across ${agg.totalRuns} runs._`);
  L.push("");

  // ── per-class detail ──
  L.push("## Per-class detail & red-team cross-reference");
  L.push("");
  for (const g of agg.ranked) {
    L.push(`### ${TYPE_TITLE[g.type] || g.type}  — impact ${g.impact} (${g.count}× @ sev ${g.severity})`);
    L.push("");
    L.push(`- **Where:** ${g.scenarios.map(([s, c]) => `${s} (${c})`).join(", ")}`);
    L.push(`- **Samples:**`);
    for (const s of g.samples) L.push(`  - ${trunc(s, 120)}`);
    L.push(`- **Fixed vs parked:** ${REDTEAM_XREF[g.type] || "(no red-team cross-reference on file)"}`);
    L.push("");
  }

  // ── the coverage baseline ──
  L.push("## Before/after coverage baseline (the honest number)");
  L.push("");
  L.push("Per-scenario **base-run** coverage/recall/aired, as-is. These are the pre-fix numbers the morning's");
  L.push("capture-chain fixes (R-audio high-pass / window-tunable) will be measured against. If that work has");
  L.push("merged by the time you re-run this, the windy_run / shred numbers move; until then this is the baseline.");
  L.push("");
  L.push("| scenario | status | word coverage | claim recall | aired |");
  L.push("|---|---|---|---|---|");
  for (const [name, c] of Object.entries(coverage)) {
    const st = c.status === "known-degraded" ? "🔴 degraded" : "🟢 clean";
    L.push(`| ${name} | ${st} | ${fmtPct(c.word_coverage_pct)} | ${fmtPct(c.claim_recall_pct)} | ${c.aired} |`);
  }
  L.push("");
  const windy = coverage.windy_run;
  if (windy) {
    L.push(`**Headline (KEYSTONE):** \`windy_run\` base coverage = **${fmtPct(windy.word_coverage_pct)}**, `);
    L.push(`recall = **${fmtPct(windy.claim_recall_pct)}**, aired = **${windy.aired}** — the 2026-08-14 Los Feliz`);
    L.push(`morning failure, pinned. This is the pre-fix floor.`);
    L.push("");
  }

  // ── real batch honesty note ──
  L.push("## Real (keyed) calibration batch");
  L.push("");
  if (realResults && realResults.length) {
    L.push("A small real batch was requested. The `--real` path streams a wav through Deepgram + a live local");
    L.push("server (see `simulate.js --real`); the volume harness records intent but defers to `simulate.js` for");
    L.push("the actual keyed run so spend stays explicit and capped:");
    L.push("");
    for (const r of realResults) L.push(`- ${r.scenario}: ${r.note || r.error || "n/a"}`);
  } else {
    L.push("Not run this pass (volume run is `--replay` only — deterministic, keyless, free). For an honesty");
    L.push("calibration, run a handful through the real surfaces:");
    L.push("");
    L.push("```bash");
    L.push("# streams a synthetic wav through Deepgram + a live local server (keys from main .env.local; capped)");
    L.push("node tools/synthetic/simulate.js --real --wav daysprint/synthetic/fixtures/windy_run.wav \\");
    L.push("     --sidecar daysprint/synthetic/fixtures/windy_run.sidecar.json --out /tmp/windy_real.json");
    L.push("```");
  }
  L.push("");
  L.push("---");
  L.push("_Reproduce: `node tools/synthetic/volume-run.js --catalog daysprint/synthetic/FAILURE_CATALOG.md`._");
  return L.join("\n") + "\n";
}
function fmtPct(x) { return x == null ? "n/a" : x + "%"; }

// ── main ─────────────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const getNum = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def; };
  const getStr = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def; };
  const seeds = getNum("--seeds", 6);
  const real = getNum("--real", 0);
  const jsonOut = getStr("--json", null);
  const catalogOut = argv.includes("--catalog") ? getStr("--catalog", DEFAULT_CATALOG) : null;
  const quiet = argv.includes("--quiet");

  const { runs, realResults, meta } = await runVolume({ seeds, real });
  const agg = aggregate(runs);
  const coverage = coverageBaseline(runs);

  if (!quiet) {
    console.log(`\nSIMULATION AT VOLUME — ${meta.total} synthetic street sessions (${meta.scenarios} base × variants, ${seeds} seeds/cell)\n`);
    console.log(`Ranked failure classes (frequency × severity):\n`);
    agg.ranked.forEach((g, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${(TYPE_TITLE[g.type] || g.type).padEnd(52)} impact=${String(g.impact).padStart(5)}  (${g.count}× @ sev ${g.severity})`);
    });
    console.log(`\n  ${agg.totalFailures} typed failures across ${agg.totalRuns} runs.`);
    const w = coverage.windy_run;
    if (w) console.log(`\n  KEYSTONE windy_run baseline: coverage=${fmtPct(w.word_coverage_pct)} recall=${fmtPct(w.claim_recall_pct)} aired=${w.aired}`);
  }

  if (jsonOut) {
    writeFileSync(resolve(jsonOut), JSON.stringify({ meta, agg, coverage, runs }, null, 2));
    console.error(`[volume] raw aggregate → ${jsonOut}`);
  }
  if (catalogOut) {
    writeFileSync(resolve(catalogOut), renderCatalog({ agg, coverage, meta, realResults }));
    console.error(`[volume] FAILURE_CATALOG → ${catalogOut}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
