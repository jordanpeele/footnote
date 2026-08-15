#!/usr/bin/env node
// NIGHTSPRINT S3 — scenario AUTHORING tool.
//
// A scenario is authored as a `<name>.scenario.json` MANIFEST (human-readable intent) and
// compiled into a `<name>.replay.json` FIXTURE (the deterministic, keyless artifact CI scores).
// The compile step is what makes the fixtures reproducible: it runs the SAME window state
// machine simulate.js/window-sim.js use to discover the EXACT rolling-window text each extract
// call will receive, then keys the extract/verify replay maps by those exact strings. Author
// by INTENT (a trigger substring + the claim/verify you want that utterance to produce); the
// tool resolves intent → exact window keys. No hand-transcription of 30-word window buffers.
//
//   node tools/synthetic/author-scenario.js compile daysprint/synthetic/scenarios/NAME.scenario.json
//   node tools/synthetic/author-scenario.js compile-all           # recompile the whole library
//
// The manifest also carries `expected_scorecard` (bounds asserted by run-scenarios.js) and a
// `status` (should-pass-clean | known-degraded) — see daysprint/synthetic/scenarios/README.md.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline } from "./window-sim.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCEN_DIR = resolve(__dirname, "..", "..", "daysprint/synthetic/scenarios");

// Discover the exact rolling-window texts the pipeline will hand to extract, given `finals`.
// Returns the ordered list of { reason, text, at } windows.
async function discoverWindows(finals) {
  const seen = [];
  await runPipeline(finals, {
    extractFn: async (text) => { seen.push(text); return { claim: null, ms: 0 }; },
    verifyFn: async () => ({ verdict: null, ms: 0 }),
  });
  return seen;
}

// Pick the window that carries an intended utterance. Windows are CUMULATIVE (the rolling
// buffer grows), so one physical window often contains several claims and every later window
// contains every trigger — but each window→extract call in the pipeline yields ONE extraction.
// To assign each intent its OWN window we consume windows left-to-right IN INTENT ORDER: an
// intent claims the EARLIEST not-yet-consumed window that contains its trigger. Since claims
// complete in speech order and intents are authored in speech order, intent i lands on the
// window where claim i first became the newest content. Throws loudly if no unconsumed window
// contains the trigger (author bug) — never ship a fixture whose intent silently never fires.
function pickWindowFor(trigger, windowTexts, consumed, name, id) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const t = norm(trigger);
  for (let i = 0; i < windowTexts.length; i++) {
    if (consumed.has(i)) continue;
    if (norm(windowTexts[i]).includes(t)) { consumed.add(i); return windowTexts[i]; }
  }
  throw new Error(
    `[${name}] intent '${id}': trigger ${JSON.stringify(trigger)} matched NO unconsumed window.\n` +
    `  windows were:\n` + windowTexts.map((w, i) => `    ${i}: ${(consumed.has(i) ? "[used] " : "")}${JSON.stringify(w)}`).join("\n")
  );
}

export async function compileManifest(manifest, name) {
  const finals = manifest.finals || [];
  const windowTexts = await discoverWindows(finals);

  const extract = {};
  const verify = {};
  const claims = [];
  const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

  // `extract_prefix` intents (used by rapid_fire): map EVERY discovered window whose text
  // starts with `prefix` to the SAME extraction — models an extractor that keys off the
  // leading claim of a cumulative window, so co-window claims never get their own check and
  // F2 dedupe drops the repeats. These are applied FIRST so per-trigger intents can still
  // override a specific window if needed.
  for (const pfx of manifest.extract_prefix || []) {
    const p = norm(pfx.prefix);
    let matched = 0;
    for (const w of windowTexts) {
      if (norm(w).startsWith(p)) {
        extract[w] = pfx.claim == null
          ? { claim: null, ms: pfx.ms ?? 120 }
          : { claim: pfx.claim, polarity: pfx.polarity ?? "asserts", category: pfx.category ?? "UNCATEGORIZED", harm_class: pfx.harm_class ?? "none", ms: pfx.ms ?? 320 };
        matched++;
      }
    }
    if (!matched) throw new Error(`[${name}] extract_prefix ${JSON.stringify(pfx.prefix)} matched NO window.`);
    if (pfx.claim != null && pfx.verify) {
      verify[pfx.claim] = { verdict: pfx.verify.verdict ?? null, confidence: pfx.verify.confidence ?? null, source: pfx.verify.source ?? null, autoAirEligible: pfx.verify.autoAirEligible === true, polarity_conflict: Boolean(pfx.verify.polarity_conflict), ms: pfx.verify.ms ?? 2200 };
    }
  }

  const consumed = new Set();   // window indices already claimed by an earlier intent
  for (const intent of manifest.intents || []) {
    const id = intent.id || intent.trigger?.slice(0, 24) || "?";
    // Map the exact window text → the extraction this intent wants that utterance to yield.
    if (intent.trigger != null) {
      const key = pickWindowFor(intent.trigger, windowTexts, consumed, name, id);
      // `lost:true` — the shred/dropout mangled this window so the extractor recovers NO claim
      // (the window text no longer carries the thought). Maps to a null extraction, so the
      // scorecard records a recall MISS. Used by known-degraded scenarios to pin lost claims.
      if (intent.lost) {
        if (!(key in extract)) extract[key] = { claim: null, ms: intent.ms ?? 200 };
      } else if (!(key in extract) || intent.claim != null) {
      // claim:null intents (filler, injection, opinion) simply map the window to a no-claim
      // extraction — but only if not already mapped by an earlier intent to a real claim.
        extract[key] = intent.claim == null
          ? { claim: null, ms: intent.ms ?? 120 }
          : {
              claim: intent.claim,
              polarity: intent.polarity ?? "asserts",
              category: intent.category ?? "UNCATEGORIZED",
              harm_class: intent.harm_class ?? "none",
              ...(intent.rejected ? { rejected: intent.rejected } : {}),
              ...(intent.tripwire ? { tripwire: intent.tripwire } : {}),
              ms: intent.ms ?? 380,
            };
      }
    }
    // Verify replay keyed by the exact claim text.
    if (intent.claim != null && intent.verify) {
      verify[intent.claim] = {
        verdict: intent.verify.verdict ?? null,
        confidence: intent.verify.confidence ?? null,
        source: intent.verify.source ?? null,
        autoAirEligible: intent.verify.autoAirEligible === true,
        polarity_conflict: Boolean(intent.verify.polarity_conflict),
        ms: intent.verify.ms ?? 2200,
      };
    }
    // Scorecard ground-truth row for this intent (scorecard `claims[]` schema — the
    // pipeline-outcome gate vocabulary: checked | person-hold | polarity-conflict | ground |
    // no-claim | dedupe | fragment, plus expected_air).
    if (intent.expected) {
      claims.push({
        utterance: intent.expected.utterance ?? intent.trigger ?? "",
        claim: intent.expected.claim !== undefined ? intent.expected.claim : (intent.claim ?? null),
        expected_polarity: intent.expected.expected_polarity ?? intent.polarity ?? "asserts",
        category: intent.expected.category ?? intent.category ?? null,
        expected_verdict: intent.expected.expected_verdict ?? intent.verify?.verdict ?? null,
        expected_gate: intent.expected.expected_gate ?? null,
        ...(intent.expected.expected_air !== undefined ? { expected_air: intent.expected.expected_air } : {}),
        ...(intent.expected.note ? { note: intent.expected.note } : {}),
      });
    }
  }

  return {
    profile: manifest.profile ?? name,
    scenario: name,
    status: manifest.status ?? "should-pass-clean",
    autoAir: manifest.autoAir !== false,
    _generated: "COMPILED from " + name + ".scenario.json by tools/synthetic/author-scenario.js — do not hand-edit; edit the manifest and recompile.",
    finals,
    extract,
    verify,
    claims,
    expected_scorecard: manifest.expected_scorecard ?? null,
  };
}

function compileFile(path) {
  const manifest = JSON.parse(readFileSync(resolve(path), "utf8"));
  const name = manifest.name || basename(path).replace(/\.scenario\.json$/, "");
  return compileManifest(manifest, name).then((fixture) => {
    const outPath = join(SCEN_DIR, name + ".replay.json");
    writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n");
    console.error(`[author] ${name}: ${fixture.finals.length} finals → ${Object.keys(fixture.extract).length} extract keys, ${Object.keys(fixture.verify).length} verify keys, ${fixture.claims.length} scored claims → ${outPath}`);
    return { name, outPath, fixture };
  });
}

function manifestFiles() {
  return readdirSync(SCEN_DIR).filter((f) => f.endsWith(".scenario.json")).sort().map((f) => join(SCEN_DIR, f));
}

async function main() {
  const [, , cmd, arg] = process.argv;
  if (cmd === "compile") {
    if (!arg) { console.error("usage: author-scenario.js compile PATH.scenario.json"); process.exit(2); }
    await compileFile(arg);
  } else if (cmd === "compile-all") {
    for (const f of manifestFiles()) await compileFile(f);
  } else {
    console.error("usage:\n  author-scenario.js compile PATH.scenario.json\n  author-scenario.js compile-all");
    process.exit(2);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
