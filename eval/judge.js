#!/usr/bin/env node
// Footnote eval — meaning-level LLM judge (harness v2, Decision D11). Dependency-free
// Node ESM, same zero-dep fetch style as src/adapters/.
//
// Module:  import { judge } from "./judge.js"
//          await judge(expected, actual, snippet)
//            -> {match: "same_claim"|"polarity_inverted"|"different_claim"|"partial", note}
//            -> {match: "judge_error", note} on unparseable output or upstream failure
//
// CLI:     node eval/judge.js "<expected>" "<actual>" ["<snippet>"] [--no-cache]
//
// The prompt lives in eval/judge-prompt.md (versioned; text between the BEGIN/END
// markers is sent verbatim as the system prompt). Results are cached on disk in
// eval/.judge-cache.json, keyed on sha256(prompt + inputs) — editing the prompt
// automatically invalidates the cache. judge_error results are never cached, so
// re-runs retry them.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, "judge-prompt.md");
const CACHE_PATH = join(__dirname, ".judge-cache.json");

const MODEL = "claude-haiku-4-5-20251001"; // same model family as the extractor adapter
const LABELS = new Set(["same_claim", "polarity_inverted", "different_claim", "partial"]);

// Self-throttle well under Anthropic RPM limits; the verify throttle in run.js already
// dominates full-run wall time, so this adds little.
const JUDGE_RPM = 40;
const SAFETY = 1.3;
const MIN_GAP_MS = Math.ceil((60000 / JUDGE_RPM) * SAFETY);
const MAX_RETRIES = 3;

// ---------- prompt + key (lazy — importing this module must never throw) ----------
let _prompt = null;
function loadPrompt() {
  if (_prompt) return _prompt;
  const raw = readFileSync(PROMPT_PATH, "utf8");
  const m = raw.match(/<!-- PROMPT BEGIN -->([\s\S]*?)<!-- PROMPT END -->/);
  if (!m || !m[1].trim()) throw new Error(`no PROMPT BEGIN/END block found in ${PROMPT_PATH}`);
  _prompt = m[1].trim();
  return _prompt;
}

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const env = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
    const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  throw new Error("ANTHROPIC_API_KEY not found in env or .env.local");
}

// ---------- disk cache ----------
let _cache = null;
function loadCache() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")); }
  catch { _cache = {}; }
  return _cache;
}
let _noPersist = false; // --no-cache: keep cache in memory only, don't touch disk
function saveCache() {
  if (_noPersist) return;
  try { writeFileSync(CACHE_PATH, JSON.stringify(_cache, null, 1)); }
  catch (e) { process.stderr.write(`  [judge cache write failed: ${e.message}]\n`); }
}
function cacheKey(expected, actual, snippet) {
  return createHash("sha256")
    .update([loadPrompt(), expected, actual, snippet].join("\u0000")) // NUL delimiter avoids field-boundary collisions
    .digest("hex");
}

// ---------- robust one-line-JSON parse (fences / prefix tolerance) ----------
function parseVerdict(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const brace = t.match(/\{[\s\S]*?\}/); // first {...} — tolerates prefixed prose
  if (brace) t = brace[0];
  try {
    const j = JSON.parse(t);
    if (LABELS.has(j.match)) return { match: j.match, note: String(j.note ?? "").slice(0, 300) };
    return { match: "judge_error", note: `unknown label ${JSON.stringify(j.match)}` };
  } catch {
    return { match: "judge_error", note: `unparseable judge output: ${String(text).slice(0, 160)}` };
  }
}

// ---------- throttled Anthropic Messages call ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

/**
 * Judge whether `actual` asserts the same claim as `expected`. Both must be non-null
 * strings — null-sided failures (missed/spurious extraction) have no meaning to compare
 * and are handled by token scoring alone; run.js gates on that.
 */
export async function judge(expected, actual, snippet = "") {
  if (typeof expected !== "string" || typeof actual !== "string" || !expected.trim() || !actual.trim()) {
    throw new TypeError("judge(expected, actual, snippet): expected and actual must be non-empty strings");
  }
  const key = cacheKey(expected, actual, snippet);
  const cache = loadCache();
  if (cache[key]) return { ...cache[key], cached: true };

  const user =
    `<transcript_snippet>${snippet}</transcript_snippet>\n` +
    `<expected_extraction>${expected}</expected_extraction>\n` +
    `<actual_extraction>${actual}</actual_extraction>`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 200, temperature: 0,
          system: loadPrompt(),
          messages: [{ role: "user", content: user }],
        }),
      });
    } catch (e) {
      if (attempt === MAX_RETRIES) return { match: "judge_error", note: `network: ${e.message}` };
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after")) || 2 * (attempt + 1);
      if (attempt === MAX_RETRIES) return { match: "judge_error", note: `http ${res.status} after retries` };
      process.stderr.write(`  [judge ${res.status} — backing off ${ra}s]\n`);
      await sleep(ra * 1000 + 250);
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      return { match: "judge_error", note: `http ${res.status}: ${detail}` };
    }
    const j = await res.json().catch(() => ({}));
    const verdict = parseVerdict(j?.content?.[0]?.text);
    if (verdict.match !== "judge_error") { // never cache errors — re-runs should retry
      cache[key] = verdict;
      saveCache();
    }
    return verdict;
  }
  return { match: "judge_error", note: "gave up after retries" };
}

// ---------- CLI ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2).filter((a) => a !== "--no-cache");
  if (process.argv.includes("--no-cache")) { _cache = {}; _noPersist = true; } // fresh in-memory cache, no disk writes
  const [expected, actual, snippet] = argv;
  if (!expected || !actual) {
    console.error('usage: node eval/judge.js "<expected>" "<actual>" ["<snippet>"] [--no-cache]');
    process.exit(1);
  }
  judge(expected, actual, snippet || "").then((v) => {
    console.log(JSON.stringify(v));
    process.exit(v.match === "judge_error" ? 2 : 0);
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
