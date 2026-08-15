// NIGHTSPRINT S2 — scorecard: compare a runPipeline() result against the S1 sidecar's
// ground truth. Pure, dependency-free, no I/O — so the determinism test can call it.
//
// S1 sidecar contract (assumed; adapt when S1's schema lands in daysprint/synthetic/):
//   { profile, claims: [ { utterance, claim, expected_polarity, category,
//                          expected_verdict, expected_gate, t_start, t_end } ] }
//
// Metrics produced:
//   · word_coverage    — % of unique spoken words that reached an extracted window
//   · claim_recall     — % of expected claims that reached a CHECK (extract returned a claim)
//   · category_accuracy— of recalled claims, % whose extractor category matched expected
//   · gate_correctness — of expected claims declaring expected_gate, % where the right gate fired
//   · verdict_accuracy — of recalled+verified claims, % whose verdict matched expected
//   · air_accuracy     — % of expected claims whose air decision (aired/held) matched expectation
//   · latency waterfall— extract / verify / RELAY(placeholder) percentiles

const STOP = new Set(["the","a","an","and","or","but","of","to","in","on","at","is","are","was","were","it","that","this","for","with","as","by","be","he","she","they","we","i","you"]);

function normWords(s) {
  return String(s || "").toLowerCase().split(/\s+/).map((w) => w.replace(/[^\w%]/g, "")).filter(Boolean);
}
function contentTokens(s) {
  return new Set(normWords(s).filter((w) => w.length >= 3 && !STOP.has(w)));
}
/** token-overlap F1 between two strings — used to match an expected claim to a check */
function overlapF1(a, b) {
  const A = contentTokens(a), B = contentTokens(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return A.size + B.size ? (2 * inter) / (A.size + B.size) : 0;
}

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : null; }

function percentiles(xs) {
  const v = xs.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, p50: null, p90: null, max: null };
  const at = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  return { n: v.length, p50: at(0.5), p90: at(0.9), max: v[v.length - 1] };
}

/**
 * Match an expected claim to the best check the pipeline produced. A check "covers" an
 * expected claim when its window text OR its extracted claim overlaps the expected
 * utterance/claim above threshold — whichever the pipeline reached.
 */
function matchCheck(expected, checks, threshold = 0.34) {
  let best = null, bestScore = 0;
  for (const c of checks) {
    const s = Math.max(
      overlapF1(expected.utterance || expected.claim, c.text),
      c.claim ? overlapF1(expected.claim, c.claim) : 0,
    );
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return bestScore >= threshold ? best : null;
}

/**
 * @param {{windows:Array, checks:Array, finals:number, spokenWords:number}} run  runPipeline output
 * @param {{profile?:string, claims:Array}} sidecar  S1 ground-truth sidecar
 * @returns {object} scorecard
 */
export function score(run, sidecar) {
  const claims = Array.isArray(sidecar?.claims) ? sidecar.claims : [];

  // ---- word coverage ----
  const spokenSet = new Set();
  for (const c of claims) for (const w of normWords(c.utterance || "")) spokenSet.add(w);
  // fall back to the run's own window words if the sidecar lacks utterances
  const windowWordSet = new Set();
  for (const w of run.windows) for (const word of normWords(w.text)) windowWordSet.add(word);
  const coveredWords = [...spokenSet].filter((w) => windowWordSet.has(w));
  const word_coverage = spokenSet.size ? pct(coveredWords.length, spokenSet.size) : null;

  // ---- per-claim scoring ----
  const perClaim = [];
  let recalled = 0, catScored = 0, catRight = 0, gateScored = 0, gateRight = 0,
      verdictScored = 0, verdictRight = 0, airScored = 0, airRight = 0;

  for (const exp of claims) {
    const check = matchCheck(exp, run.checks);
    const row = { claim: exp.claim, expected_gate: exp.expected_gate ?? null, matched: !!check };
    if (check) {
      row.check_text = check.text;
      row.got_claim = check.claim;
      row.got_gate = check.gate;
      row.got_category = check.category;
      row.got_verdict = check.verdict;
      row.got_aired = check.aired;
      row.air_reason = check.airedReason;
    }
    // claim-recall: an expected claim "reached a check" when its matched check produced a claim
    const reached = !!(check && check.claim);
    if (reached) recalled++;
    row.recalled = reached;

    // category accuracy (only on recalled claims with an expected category)
    if (reached && exp.category != null) {
      catScored++;
      if (check.category === exp.category) { catRight++; row.category_ok = true; } else row.category_ok = false;
    }
    // gate-outcome correctness (only when the sidecar declares an expected_gate)
    if (exp.expected_gate != null) {
      gateScored++;
      // expected_gate values map onto rec.gate/airedReason from window-sim:
      //   fragment | ground | dedupe | person-hold | polarity-conflict | checked | no-claim
      const got = check ? gotGate(check) : "missed";
      row.gate_result = got;
      if (gateMatches(exp.expected_gate, got)) { gateRight++; row.gate_ok = true; } else row.gate_ok = false;
    }
    // verdict accuracy (only when reached, verified, and expected declares one)
    if (reached && check.verdict != null && exp.expected_verdict != null) {
      verdictScored++;
      if (check.verdict === exp.expected_verdict) { verdictRight++; row.verdict_ok = true; } else row.verdict_ok = false;
    }
    // air-decision correctness (only when the sidecar says what SHOULD air)
    if (exp.expected_verdict != null && (exp.expected_gate === "checked" || exp.expected_air != null)) {
      const shouldAir = exp.expected_air != null ? Boolean(exp.expected_air) : false;
      const didAir = !!(check && check.aired);
      airScored++;
      if (didAir === shouldAir) { airRight++; row.air_ok = true; } else row.air_ok = false;
    }
    perClaim.push(row);
  }

  // ---- latency waterfall (with RELAY placeholder) ----
  const extractL = percentiles(run.checks.map((c) => c.latency?.extract));
  const verifyL = percentiles(run.checks.map((c) => c.latency?.verify));

  return {
    profile: sidecar?.profile ?? null,
    totals: {
      finals: run.finals,
      windows_extracted: run.windows.length,
      checks: run.checks.length,
      expected_claims: claims.length,
      cards_reached_verdict: run.checks.filter((c) => c.gate === "checked").length,
      aired: run.checks.filter((c) => c.aired).length,
    },
    metrics: {
      word_coverage_pct: word_coverage,
      claim_recall_pct: pct(recalled, claims.length),
      category_accuracy_pct: pct(catRight, catScored),
      gate_correctness_pct: pct(gateRight, gateScored),
      verdict_accuracy_pct: pct(verdictRight, verdictScored),
      air_accuracy_pct: pct(airRight, airScored),
    },
    scored_counts: {
      recall: `${recalled}/${claims.length}`,
      category: `${catRight}/${catScored}`,
      gate: `${gateRight}/${gateScored}`,
      verdict: `${verdictRight}/${verdictScored}`,
      air: `${airRight}/${airScored}`,
    },
    latency_waterfall_ms: {
      extract: extractL,
      verify: verifyL,
      relay: { n: 0, p50: null, p90: null, max: null, note: "PLACEHOLDER — relay/on-air stage not exercised offline; wire when the relay bench lands" },
    },
    gate_distribution: gateHistogram(run.checks),
    per_claim: perClaim,
  };
}

/** collapse a window-sim check record to a canonical gate label for comparison */
function gotGate(check) {
  if (check.polarity_conflict && check.gate === "checked") return "polarity-conflict";
  if (check.gate === "checked") {
    if (check.airedReason === "person-hold" || check.airedReason === "harm-hold") return "person-hold";
    return "checked";
  }
  return check.gate;   // fragment | ground | dedupe | no-claim | consecutive-dupe | extract-error | verify-error
}

/** expected_gate synonyms → the got-gate label space */
function gateMatches(expected, got) {
  const alias = {
    "fragment": ["fragment"],
    "ground": ["ground", "no-claim"],
    "grounding": ["ground", "no-claim"],
    "dedupe": ["dedupe"],
    "person-hold": ["person-hold"],
    "polarity-conflict": ["polarity-conflict"],
    "polarity": ["polarity-conflict"],
    "checked": ["checked"],
    "no-claim": ["no-claim"],
  };
  const acc = alias[expected] || [expected];
  return acc.includes(got);
}

function gateHistogram(checks) {
  const h = {};
  for (const c of checks) { const g = gotGate(c); h[g] = (h[g] || 0) + 1; }
  return h;
}

/** human-readable one-screen summary of a scorecard */
export function summarize(sc) {
  const L = [];
  L.push(`Footnote synthetic scorecard — profile: ${sc.profile ?? "(none)"}`);
  L.push("");
  L.push(`  finals=${sc.totals.finals}  windows=${sc.totals.windows_extracted}  checks=${sc.totals.checks}  expected-claims=${sc.totals.expected_claims}  verdicts=${sc.totals.cards_reached_verdict}  aired=${sc.totals.aired}`);
  L.push("");
  const m = sc.metrics, c = sc.scored_counts;
  const line = (label, v, cnt) => `  ${label.padEnd(22)} ${v == null ? "  n/a" : (v + "%").padStart(6)}   (${cnt})`;
  L.push(line("word coverage", m.word_coverage_pct, "spoken words seen"));
  L.push(line("claim recall", m.claim_recall_pct, c.recall));
  L.push(line("category accuracy", m.category_accuracy_pct, c.category));
  L.push(line("gate correctness", m.gate_correctness_pct, c.gate));
  L.push(line("verdict accuracy", m.verdict_accuracy_pct, c.verdict));
  L.push(line("air decision", m.air_accuracy_pct, c.air));
  L.push("");
  const w = sc.latency_waterfall_ms;
  const wl = (label, s) => `  ${label.padEnd(10)} p50=${fmt(s.p50)}  p90=${fmt(s.p90)}  max=${fmt(s.max)}  (n=${s.n})`;
  L.push("  latency waterfall (ms):");
  L.push(wl("extract", w.extract));
  L.push(wl("verify", w.verify));
  L.push(wl("relay", w.relay) + "  ← " + w.relay.note);
  L.push("");
  L.push("  gate distribution: " + Object.entries(sc.gate_distribution).map(([k, v]) => `${k}=${v}`).join("  "));
  return L.join("\n");
}
function fmt(x) { return x == null ? "  —" : String(Math.round(x)).padStart(4); }
