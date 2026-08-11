// Footnote — adjudication cockpit tests. Covers the pure dedup/graduation logic
// (lib.js), prep.js end-to-end against the real drafts, apply.js append + idempotency
// against a TEMP golden file, queue/graduations schema round-trip, and a static check
// that the page wires its handlers (no headless-clicking, per the harness note).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeClaim, dedupeDrafts, parseNoteHints, nextId, buildGoldenEntry,
  alreadyGraduated, prefixForCategory, CATEGORIES, VERDICTS,
} from "../tools/adjudicate/lib.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TOOLDIR = path.join(ROOT, "tools", "adjudicate");

// ---- normalizeClaim ------------------------------------------------------------------
test("normalizeClaim folds casing/quotes/trailing-period, keeps distinct claims apart", () => {
  assert.equal(
    normalizeClaim("Peter Thiel is the president of the United States."),
    normalizeClaim("peter thiel is the president of the united states")
  );
  assert.equal(normalizeClaim('"Gold is worth more than silver."'), normalizeClaim("Gold is worth more than silver"));
  assert.notEqual(normalizeClaim("GDP growth in 2025 was 4%"), normalizeClaim("GDP growth in 2025 was 5%"));
});

// ---- dedupeDrafts --------------------------------------------------------------------
test("dedupeDrafts collapses repeats with correct repeatCount + source union", () => {
  const rows = [
    { id: "d1", expected_extraction: "Peter Thiel is the president of the United States", transcript_snippet: "a", adjudication_note: "pipeline said False @ conf 0.99" },
    { id: "d2", expected_extraction: "Peter Thiel is the president of the United States.", transcript_snippet: "b", adjudication_note: "pipeline said False @ conf 0.99" },
    { id: "d3", expected_extraction: "peter thiel is the PRESIDENT of the united states", transcript_snippet: "c", adjudication_note: "" },
    { id: "d4", expected_extraction: "Donald Trump is the president of the United States", transcript_snippet: "d", adjudication_note: "pipeline said True @ conf 0.99" },
  ];
  const out = dedupeDrafts(rows);
  assert.equal(out.length, 2);
  const thiel = out.find((e) => e.claim.toLowerCase().startsWith("peter thiel"));
  assert.equal(thiel.repeatCount, 3);
  assert.deepEqual(thiel.sourceDrafts.sort(), ["d1", "d2", "d3"]);
  assert.equal(thiel.pipelineVerdict, "False");
  const trump = out.find((e) => e.claim.toLowerCase().startsWith("donald"));
  assert.equal(trump.repeatCount, 1);
  assert.equal(trump.pipelineVerdict, "True");
});

test("dedupeDrafts keeps null-extraction (echo) drafts as separate cards", () => {
  const rows = [
    { id: "e1", expected_extraction: null, transcript_snippet: "meta 1", adjudication_note: "" },
    { id: "e2", expected_extraction: "", transcript_snippet: "meta 2", adjudication_note: "" },
  ];
  const out = dedupeDrafts(rows);
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => e.repeatCount === 1));
});

// ---- parseNoteHints ------------------------------------------------------------------
test("parseNoteHints extracts pipeline hint + explicit recommendation separately", () => {
  const h1 = parseNoteHints("DRAFT — live pipeline said Misleading @ conf 0.97");
  assert.equal(h1.pipelineVerdict, "Misleading");
  assert.equal(h1.suggestedVerdict, null);
  const h2 = parseNoteHints("Recommend: False · category person_claims");
  assert.equal(h2.suggestedVerdict, "False");
  assert.equal(h2.suggestedCategory, "person_claims");
});

// ---- nextId --------------------------------------------------------------------------
test("nextId continues the <prefix>-NNN sequence with zero-pad", () => {
  assert.equal(nextId("person", ["person-001", "person-020", "person-007"]), "person-021");
  assert.equal(nextId("stat", []), "stat-001");
  assert.equal(nextId("adv", ["adv-034"]), "adv-035");
});

// ---- buildGoldenEntry ----------------------------------------------------------------
test("buildGoldenEntry mirrors golden schema + null verdict forces null extraction", () => {
  const qe = { key: "claim::x", canonical: "X is Y", sampleTranscript: "he said X is Y", repeatCount: 26, sourceDrafts: ["d1", "d2"] };
  const e = buildGoldenEntry({ verdict: "False", category: "person_claims", note: "wrong", source_of_truth: "gov" }, qe, "person-021");
  assert.deepEqual(Object.keys(e), ["id", "transcript_snippet", "expected_extraction", "category", "ground_truth_verdict", "adjudication_note", "source_of_truth"]);
  assert.equal(e.id, "person-021");
  assert.equal(e.ground_truth_verdict, "False");
  assert.match(e.adjudication_note, /graduated from 26 field drafts/);

  const echo = buildGoldenEntry({ verdict: null, category: "adversarial", extraction: "I'm ready to extract…", note: "echo" }, { canonical: null, sampleTranscript: "t", repeatCount: 1, sourceDrafts: ["d9"] }, "adv-035");
  assert.equal(echo.expected_extraction, null);
  assert.equal(echo.ground_truth_verdict, null);
});

// ---- prep.js end-to-end --------------------------------------------------------------
test("prep.js produces a queue.json with expected unique-claim collapse", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "footnote-prep-"));
  const out = path.join(tmp, "queue.json");
  try {
    execFileSync("node", [path.join(TOOLDIR, "prep.js"), "--out", out], { cwd: ROOT });
    const q = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(q.draft_count, 99, "all three drafts files ingested");
    assert.ok(q.unique_count < q.draft_count, "dedup shrinks the list");
    assert.ok(q.unique_count >= 55 && q.unique_count <= 70, `~60 unique claims, got ${q.unique_count}`);
    const thiel = q.entries.find((e) => (e.claim || "").toLowerCase().startsWith("peter thiel"));
    assert.ok(thiel, "Thiel family present");
    assert.equal(thiel.repeatCount, 26, "26 Thiel repeats collapse to one card");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ---- apply.js append + idempotency ---------------------------------------------------
test("apply.js appends to a TEMP golden file and is idempotent on re-run", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "footnote-apply-"));
  try {
    const goldenDir = path.join(tmp, "golden");
    execFileSync("mkdir", ["-p", goldenDir]);
    // seed a person_claims file at person-020 so the next id must be person-021
    writeFileSync(path.join(goldenDir, "person_claims.jsonl"),
      JSON.stringify({ id: "person-020", transcript_snippet: "seed", expected_extraction: "seed claim", category: "person_claims", ground_truth_verdict: "True", adjudication_note: "", source_of_truth: "" }) + "\n");

    const queue = {
      generated_at: "x", entries: [
        { key: "claim::a", claim: "Peter Thiel is the president", canonical: "Peter Thiel is the president of the United States", sampleTranscript: "t", repeatCount: 26, sourceDrafts: ["d1"] },
      ],
    };
    const queuePath = path.join(tmp, "queue.json");
    writeFileSync(queuePath, JSON.stringify(queue));
    const gradPath = path.join(tmp, "graduations.json");
    writeFileSync(gradPath, JSON.stringify({
      decisions: [{ key: "claim::a", verdict: "False", category: "person_claims", note: "not the president", source_of_truth: "whitehouse.gov" }],
    }));

    // apply.js reports on stderr; capture it via spawnSync so the assertions can read it.
    const run = () => spawnSync("node", [path.join(TOOLDIR, "apply.js"), gradPath, "--queue", queuePath, "--golden-dir", goldenDir], { cwd: ROOT, encoding: "utf8" }).stderr;
    const first = run();
    assert.match(first, /\+ person-021/, "allocated next sequential id");
    let lines = readFileSync(path.join(goldenDir, "person_claims.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 2, "one entry appended");
    const added = JSON.parse(lines[1]);
    assert.equal(added.id, "person-021");
    assert.equal(added.ground_truth_verdict, "False");

    const second = run(); // idempotent re-run
    assert.match(second, /already graduated/, "second run detects the dup");
    lines = readFileSync(path.join(goldenDir, "person_claims.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 2, "no double-append on re-run");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ---- alreadyGraduated ----------------------------------------------------------------
test("alreadyGraduated matches by normalized claim + category, not by id", () => {
  const existing = [{ id: "person-021", expected_extraction: "Peter Thiel is the president of the United States", category: "person_claims" }];
  const dup = { id: "person-099", expected_extraction: "peter thiel is the PRESIDENT of the united states.", category: "person_claims" };
  assert.equal(alreadyGraduated(dup, existing), true);
  const diffCat = { id: "adv-001", expected_extraction: "Peter Thiel is the president of the United States", category: "adversarial" };
  assert.equal(alreadyGraduated(diffCat, existing), false);
});

// ---- queue / graduations schema round-trip -------------------------------------------
test("queue entry -> decision -> golden entry round-trips the load-bearing fields", () => {
  const qe = { key: "claim::gdp", claim: "GDP growth in 2025 was 4%", canonical: "GDP growth in the United States in 2025 was 4%", sampleTranscript: "gdp was 4 percent", repeatCount: 2, sourceDrafts: ["d016", "d039"], suggestedVerdict: null, suggestedCategory: null };
  const decision = { key: qe.key, verdict: "False", category: "statistics", extraction: qe.canonical, note: "BEA: ~2%", source_of_truth: "bea.gov" };
  const id = nextId("stat", ["stat-035"]);
  const golden = buildGoldenEntry(decision, qe, id);
  assert.equal(id, "stat-036");
  assert.equal(golden.expected_extraction, qe.canonical);
  assert.equal(golden.source_of_truth, "bea.gov");
  const reparsed = JSON.parse(JSON.stringify(golden));
  assert.deepEqual(reparsed, golden);
});

// ---- constants shared by page + apply are consistent ---------------------------------
test("every CATEGORY has a prefix and VERDICTS cover the golden vocabulary", () => {
  for (const c of CATEGORIES) assert.ok(prefixForCategory(c.name), `${c.name} has a prefix`);
  assert.deepEqual(new Set(VERDICTS.map((v) => v.value)), new Set(["True", "False", "Misleading", "NeedsContext", "Unverifiable"]));
});

// ---- static wiring check for the page (no headless click) ----------------------------
test("adjudicate.js wires handlers and syntax-checks clean", () => {
  execFileSync("node", ["--check", path.join(TOOLDIR, "adjudicate.js")], { cwd: ROOT });
  execFileSync("node", ["--check", path.join(TOOLDIR, "lib.js")], { cwd: ROOT });
  const src = readFileSync(path.join(TOOLDIR, "adjudicate.js"), "utf8");
  for (const h of ["addEventListener(\"keydown\"", "btn-decide", "btn-download", "queue.json", "setVerdict", "setCategory"]) {
    assert.ok(src.includes(h), `page wires ${h}`);
  }
  const html = readFileSync(path.join(TOOLDIR, "adjudicate.html"), "utf8");
  assert.ok(html.includes("/tools/adjudicate/adjudicate.js"), "html loads the module");
  assert.ok(existsSync(path.join(TOOLDIR, "adjudicate.css")), "css present");
});
