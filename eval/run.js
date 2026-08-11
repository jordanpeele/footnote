#!/usr/bin/env node
// Footnote eval harness — dependency-free Node ESM (see eval/README.md).
//
//   node eval/run.js [--base https://footnote-live.vercel.app] [--category X]
//                    [--limit N | --all] [--extract-only] [--judge] [--delay MS]
//                    [--out eval/results/<stamp>.jsonl]
//
// Stage 1: POST /api/extract with the transcript snippet, score against expected_extraction.
// Stage 2 (unless --extract-only): POST /api/verify with the EXPECTED extraction — this
// isolates verifier performance from extractor performance on purpose.
//
// --judge (harness v2, Decision D11): meaning-level LLM judge (eval/judge.js) runs on
// every case where token scoring says pass-fuzzy OR fail with both sides non-null.
// Exact/null-null passes skip the judge (they can't be inverted); null-sided failures
// (missed/spurious) have no meaning to compare. Token score and judge verdict are both
// recorded; a token-pass the judge calls polarity_inverted/different_claim — or a
// token-fail the judge calls same_claim — is flagged "DISAGREEMENT" for human
// adjudication, never auto-resolved either way.
//
// The deployed API rate-limits per IP (api/_ratelimit.js call sites): extract 40/min,
// verify 20/min. The harness self-throttles below those and honors 429 Retry-After.

import { readFileSync, readdirSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { judge } from "./judge.js";
import { hasNegation } from "../src/core/utterance.js";   // Task 0: shipped tripwire predicate, reused for scoring

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, "golden");
const RESULTS_DIR = join(__dirname, "results");

// Per-endpoint limits (requests/minute) mirrored from the API. SAFETY > 1 keeps us under.
const LIMITS = { extract: 40, verify: 20 };
const SAFETY = 1.3;
const MAX_RETRIES = 3;
const FUZZY_F1_THRESHOLD = 0.6; // token-overlap F1 needed for a fuzzy extraction pass

function usage(code = 0) {
  console.log("usage: node eval/run.js [--base URL] [--category X] [--limit N | --all] [--extract-only] [--judge] [--delay MS] [--out FILE]");
  process.exit(code);
}

function parseArgs(argv) {
  const args = { base: "https://footnote-live.vercel.app", category: null, limit: 10, extractOnly: false, judge: false, out: null, delay: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") args.base = argv[++i];
    else if (a === "--category") args.category = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--all") args.limit = Infinity;
    else if (a === "--extract-only") args.extractOnly = true;
    else if (a === "--judge") args.judge = true;
    else if (a === "--delay") args.delay = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") usage();
    else { console.error(`unknown arg: ${a}`); usage(1); }
  }
  if (!Number.isFinite(args.limit) && args.limit !== Infinity) { console.error("--limit must be a number"); usage(1); }
  return args;
}

function loadGolden(categoryFilter) {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".jsonl")).sort();
  const byCategory = new Map();
  for (const f of files) {
    const lines = readFileSync(join(GOLDEN_DIR, f), "utf8").split("\n").filter((l) => l.trim());
    for (const [i, line] of lines.entries()) {
      let c;
      try { c = JSON.parse(line); } catch (e) { throw new Error(`bad JSONL in ${f} line ${i + 1}: ${e.message}`); }
      if (categoryFilter && c.category !== categoryFilter) continue;
      if (!byCategory.has(c.category)) byCategory.set(c.category, []);
      byCategory.get(c.category).push(c);
    }
  }
  // round-robin interleave categories so a small --limit still touches a spread of them
  const buckets = [...byCategory.values()];
  const out = [];
  for (let i = 0; buckets.some((b) => i < b.length); i++) {
    for (const b of buckets) if (i < b.length) out.push(b[i]);
  }
  return out;
}

// ---------- extraction scoring (no LLM judging in v1 — see README limitations) ----------
function norm(s) {
  return String(s).toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[.,;:!?]+$/, "").replace(/\s+/g, " ").trim();
}
function tokens(s) { return norm(s).replace(/[^a-z0-9%$. ]/g, " ").split(/\s+/).filter(Boolean); }

function matchExtraction(expected, got) {
  if (expected == null && got == null) return { pass: true, type: "null-null" };
  if (expected == null) return { pass: false, type: "spurious-extraction" }; // should have stayed silent
  if (got == null) return { pass: false, type: "missed-extraction" };        // should have extracted
  const e = norm(expected), g = norm(got);
  if (e === g) return { pass: true, type: "exact" };
  if (e.includes(g) || g.includes(e)) return { pass: true, type: "fuzzy-containment" };
  const et = new Set(tokens(e)), gt = new Set(tokens(g));
  let inter = 0;
  for (const t of et) if (gt.has(t)) inter++;
  const f1 = et.size + gt.size ? (2 * inter) / (et.size + gt.size) : 0;
  if (f1 >= FUZZY_F1_THRESHOLD) return { pass: true, type: "fuzzy-overlap", f1: +f1.toFixed(3) };
  return { pass: false, type: "mismatch", f1: +f1.toFixed(3) };
}

// ---------- throttled HTTP ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastCall = { extract: 0, verify: 0 };

async function throttledPost(base, endpoint, body, delayOverride) {
  const minGap = delayOverride ?? Math.ceil((60000 / LIMITS[endpoint]) * SAFETY);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const wait = lastCall[endpoint] + minGap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall[endpoint] = Date.now();
    let res;
    try {
      res = await fetch(`${base}/api/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt === MAX_RETRIES) return { status: 0, json: {}, error: e.message };
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after")) || 60;
      process.stderr.write(`  [429 on /${endpoint} — backing off ${ra}s]\n`);
      await sleep(ra * 1000 + 500);
      continue;
    }
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }
  return { status: 429, json: {}, error: "gave up after retries" };
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv);
  const cases = loadGolden(args.category).slice(0, args.limit === Infinity ? undefined : args.limit);
  if (!cases.length) { console.error("no golden cases matched (check --category spelling)"); process.exit(1); }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = args.out || join(RESULTS_DIR, `${stamp}${args.extractOnly ? "-extract-only" : ""}.jsonl`);

  const perCase = args.extractOnly
    ? Math.ceil((60000 / LIMITS.extract) * SAFETY)
    : Math.ceil((60000 / LIMITS.extract) * SAFETY) + Math.ceil((60000 / LIMITS.verify) * SAFETY);
  console.log(`footnote eval: ${cases.length} case(s) against ${args.base}`);
  console.log(`stages: extract${args.extractOnly ? " only" : " + verify"} — est. ~${Math.ceil((perCase * cases.length) / 1000)}s (throttled under API rate limits)`);
  console.log(`results -> ${outPath}\n`);

  let extractPass = 0, verdictPass = 0, verdictScored = 0, judgeInversions = 0, judgeDisagreements = 0;
  let polarityPass = 0, polarityScored = 0;   // Task 0
  for (const [i, c] of cases.entries()) {
    const result = { id: c.id, category: c.category, transcript_snippet: c.transcript_snippet, expected_extraction: c.expected_extraction ?? null, ground_truth_verdict: c.ground_truth_verdict ?? null };

    // stage 1 — extraction
    const ex = await throttledPost(args.base, "extract", { text: c.transcript_snippet }, args.delay);
    result.extract_status = ex.status;
    result.got_extraction = ex.status === 200 ? (ex.json.claim ?? null) : null;
    // Task 0: record the FULL extract response, not just the claim. The run-#2 harness
    // dropped these, which is why a correct canonical-positive extraction of a denial was
    // indistinguishable from an FS-8 inversion. got_polarity is the load-bearing one.
    if (ex.status === 200) {
      result.got_polarity = ex.json.polarity ?? null;        // "asserts" | "denies" | "suspect_denies" (R46 tripwire)
      result.got_harm_class = ex.json.harm_class ?? null;
      result.got_tripwire = ex.json.tripwire ?? null;        // R46 negation tripwire fired
      result.got_rejected = ex.json.rejected ?? null;        // grounding gate rejected
    }
    if (ex.status !== 200) {
      result.extract_pass = false;
      result.extract_match = "http-error";
      result.error = ex.json?.error || ex.error || `http ${ex.status}`;
    } else {
      const m = matchExtraction(c.expected_extraction ?? null, result.got_extraction);
      result.extract_pass = m.pass;
      result.extract_match = m.type;
      if (m.f1 != null) result.extract_f1 = m.f1;
      if (m.pass) extractPass++;
    }

    // Task 0: polarity scoring — only when the golden declares expected_polarity (else skipped,
    // backward-compatible). "suspect_denies" is the R46 tripwire firing at extract time; it
    // counts as a denies for the match but is flagged separately so the report can show the
    // tripwire catching what would otherwise be an FS-8 inversion.
    if (c.expected_polarity != null && result.got_polarity != null) {
      const gp = result.got_polarity === "suspect_denies" ? "denies" : result.got_polarity;
      result.expected_polarity = c.expected_polarity;
      result.polarity_pass = gp === c.expected_polarity;
      // The FS-8 signature: extractor says denies but the utterance carries NO negation token.
      // Whether the shipped R46 tripwire would fire on it (independent of what the API returned).
      result.polarity_no_negation = result.got_polarity !== "asserts" && result.got_polarity != null
        && !hasNegation(c.transcript_snippet || "");
      if (result.polarity_pass) polarityPass++;
      polarityScored++;
    }

    // stage 1b — meaning-level judge (harness v2). Marker `judged: true` on every row of
    // a --judge run lets report.js tell "run without judge" from "nothing needed judging".
    if (args.judge) {
      result.judged = true;
      const needsJudge = ["fuzzy-containment", "fuzzy-overlap", "mismatch"].includes(result.extract_match)
        && typeof result.got_extraction === "string" && typeof c.expected_extraction === "string";
      if (needsJudge) {
        const jv = await judge(c.expected_extraction, result.got_extraction, c.transcript_snippet);
        result.judge_match = jv.match;
        result.judge_note = jv.note;
        const judgeBad = jv.match === "polarity_inverted" || jv.match === "different_claim";
        if ((result.extract_pass && judgeBad) || (!result.extract_pass && jv.match === "same_claim")) {
          result.disagreement = "DISAGREEMENT"; // human adjudicates; never auto-resolved
        }
        if (jv.match === "polarity_inverted") judgeInversions++;
        if (result.disagreement) judgeDisagreements++;
      }
    }

    // stage 2 — verify the EXPECTED extraction (isolates verifier from extractor)
    if (!args.extractOnly && c.expected_extraction) {
      const vr = await throttledPost(args.base, "verify", { claim: c.expected_extraction }, args.delay);
      result.verify_status = vr.status;
      if (vr.status === 200) {
        result.got_verdict = vr.json.verdict ?? null;
        result.confidence = typeof vr.json.confidence === "number" ? vr.json.confidence : null;
        result.source_tier = vr.json.source?.tier ?? null;
        result.source_name = vr.json.source?.name ?? null;
        result.correction = vr.json.correction ?? null;
        if (c.ground_truth_verdict) {
          result.verdict_pass = result.got_verdict === c.ground_truth_verdict;
          verdictScored++;
          if (result.verdict_pass) verdictPass++;
        }
      } else {
        result.got_verdict = null;
        result.verdict_pass = false;
        result.verify_error = vr.json?.error || vr.error || `http ${vr.status}`;
      }
    }

    appendFileSync(outPath, JSON.stringify(result) + "\n");
    const tag = result.extract_pass ? "ok " : "FAIL";
    const jtag = result.judge_match ? ` | judge: ${result.judge_match}${result.disagreement ? " ⚠ DISAGREEMENT" : ""}` : "";
    const vtag = result.got_verdict != null ? ` | verify: ${result.got_verdict}${result.verdict_pass === false ? " (WRONG, wanted " + c.ground_truth_verdict + ")" : ""}` : "";
    console.log(`[${i + 1}/${cases.length}] ${c.id} extract:${tag} (${result.extract_match})${jtag}${vtag}`);
  }

  console.log(`\nextraction: ${extractPass}/${cases.length} pass`);
  if (polarityScored) console.log(`polarity:   ${polarityPass}/${polarityScored} correct (on goldens with expected_polarity)`);
  if (args.judge) console.log(`judge:      ${judgeInversions} polarity inversion(s), ${judgeDisagreements} disagreement(s) flagged for adjudication`);
  if (verdictScored) console.log(`verdicts:   ${verdictPass}/${verdictScored} correct`);
  console.log(`\nfull calibration report:  node eval/report.js ${outPath.startsWith("/") ? outPath : basename(outPath)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
