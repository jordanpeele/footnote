// Footnote — adjudication cockpit tests. Covers the pure dedup/graduation logic
// (lib.js), prep.js end-to-end against the real drafts, apply.js append + idempotency
// against a TEMP golden file, queue/graduations schema round-trip, and a static check
// that the page wires its handlers (no headless-clicking, per the harness note).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeClaim, dedupeDrafts, parseNoteHints, nextId, buildGoldenEntry,
  alreadyGraduated, prefixForCategory, applyHints, orderForSitting, sittingCluster,
  categoryNeeds, CATEGORIES, VERDICTS,
  POLARITY_RULINGS, isPolarityRuling, buildPolarityEntries, applyPolarityToLine,
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

// ---- applyHints ----------------------------------------------------------------------
test("applyHints fills empty suggestion slots by claim or draft id, never overrides", () => {
  const entries = [
    { key: "claim::a", claim: "Peter Thiel is the president of the United States.", sourceDrafts: ["d1"], suggestedVerdict: null, suggestedCategory: null },
    { key: "claim::b", claim: "Some other claim", sourceDrafts: ["d2"], suggestedVerdict: "True", suggestedCategory: "statistics" },
    { key: "id::e1", claim: "echo text", sourceDrafts: ["echo-1"], suggestedVerdict: null, suggestedCategory: null },
  ];
  applyHints(entries, [
    { ref: "R1", claim: "peter thiel is the PRESIDENT of the united states", suggestedVerdict: "False", suggestedCategory: "person_claims", note: "queue R1" },
    { ref: "RX", claim: "Some other claim", suggestedVerdict: "False", suggestedCategory: "adversarial", note: "must not override" },
    { ref: "3.2", draftIds: ["echo-1", "echo-2"], suggestedCategory: "adversarial", note: "echo family" },
  ]);
  assert.equal(entries[0].suggestedVerdict, "False");
  assert.equal(entries[0].suggestedCategory, "person_claims");
  assert.equal(entries[0].hintRef, "R1");
  assert.equal(entries[1].suggestedVerdict, "True", "existing suggestion wins");
  assert.equal(entries[1].suggestedCategory, "statistics", "existing suggestion wins");
  assert.equal(entries[1].hintNote, "must not override", "note still attaches for display");
  assert.equal(entries[2].suggestedCategory, "adversarial", "draft-id match works");
});

// ---- orderForSitting + sittingCluster ------------------------------------------------
test("orderForSitting makes same-suggestion runs contiguous, policy families grouped, unassigned last", () => {
  const mk = (key, cat, verdict, ref, repeat = 1) => ({
    key, claim: key, repeatCount: repeat, sourceDrafts: [key],
    suggestedCategory: cat, suggestedVerdict: verdict, hintRef: ref,
  });
  const shuffled = [
    mk("erewhon-1", null, null, "5.2"),
    mk("stat-false-1", "statistics", "False", "R7"),
    mk("person-false-1", "person_claims", "False", "R1", 26),
    mk("no-hint", null, null, null),
    mk("stat-false-2", "statistics", "False", "R7"),
    mk("erewhon-2", null, null, "5.2"),
    mk("person-true", "person_claims", "True", "R2"),
    mk("person-false-2", "person_claims", "False", "R3"),
  ];
  const out = orderForSitting(shuffled);
  const keys = out.map((e) => e.key);
  // person_claims first (CATEGORIES order), True before False (VERDICTS order),
  // most-repeated first within a run; unassigned families after categories; no-ref dead last
  assert.deepEqual(keys, [
    "person-true", "person-false-1", "person-false-2",
    "stat-false-1", "stat-false-2",
    "erewhon-1", "erewhon-2",
    "no-hint",
  ]);
  assert.equal(sittingCluster(out[0]), "person_claims · True");
  assert.equal(sittingCluster(out[1]), "person_claims · False");
  assert.equal(sittingCluster(out[5]), "§5.2");
  assert.equal(sittingCluster(out[7]), "unassigned");
  // clusters are contiguous: same-label cards are never split
  const labels = out.map(sittingCluster);
  const seen = new Set();
  for (let i = 0; i < labels.length; i++) {
    if (i > 0 && labels[i] !== labels[i - 1]) assert.ok(!seen.has(labels[i]), `cluster ${labels[i]} split`);
    seen.add(labels[i]);
  }
});

// ---- AUTHORED candidate handling (packet 3a) -----------------------------------------
test("dedupeDrafts propagates the AUTHORED marker, polarity, note, and source", () => {
  const note = "AUTHORED CANDIDATE (packet 3a) — provisional label. Recommend: False · polarity_traps. Expected polarity: denies. Evidence: NASA. Trap: denial-of-false.";
  const rows = [
    { id: "auth-pol-001", authored: true, expected_extraction: "The Great Wall of China is visible from the Moon with the naked eye.", transcript_snippet: "the Great Wall is not visible from the Moon", expected_polarity: "denies", adjudication_note: note, source_of_truth: "NASA" },
    { id: "d1", expected_extraction: "Gold is worth more than silver", transcript_snippet: "gold", adjudication_note: "pipeline said True @ conf 0.98" },
  ];
  const out = dedupeDrafts(rows);
  const auth = out.find((e) => e.authored);
  assert.ok(auth, "authored marker propagates");
  assert.equal(auth.expected_polarity, "denies");
  assert.equal(auth.hintNote, note, "authored note surfaces as the hint note");
  assert.equal(auth.sourceOfTruth, "NASA");
  assert.equal(auth.suggestedVerdict, "False", "Recommend: line parsed as suggestion");
  assert.equal(auth.suggestedCategory, "polarity_traps");
  assert.equal(sittingCluster(auth), "AUTHORED · polarity_traps · False");
  const field = out.find((e) => !e.authored);
  assert.ok(!sittingCluster(field).startsWith("AUTHORED"), "field cards unmarked");
  assert.equal(field.authored, undefined);
});

test("orderForSitting keeps AUTHORED cards as their own contiguous block per category", () => {
  const mk = (key, cat, verdict, authored) => ({
    key, claim: key, repeatCount: 1, sourceDrafts: [key],
    suggestedCategory: cat, suggestedVerdict: verdict, authored: authored || undefined,
  });
  const out = orderForSitting([
    mk("auth-q-1", "attributed_quotes", "False", true),
    mk("field-q-1", "attributed_quotes", "False"),
    mk("auth-q-2", "attributed_quotes", "True", true),
    mk("field-q-2", "attributed_quotes", "False"),
    mk("auth-pol-1", "polarity_traps", "True", true),
  ]);
  assert.deepEqual(out.map((e) => e.key),
    ["field-q-1", "field-q-2", "auth-q-2", "auth-q-1", "auth-pol-1"],
    "field cards first, then AUTHORED block (verdict-ordered), per category");
  const labels = out.map(sittingCluster);
  const seen = new Set();
  for (let i = 0; i < labels.length; i++) {
    if (i > 0 && labels[i] !== labels[i - 1]) assert.ok(!seen.has(labels[i]), `cluster ${labels[i]} split`);
    seen.add(labels[i]);
  }
});

test("buildGoldenEntry carries expected_polarity + AUTHORED provenance for authored cards", () => {
  const qe = {
    key: "claim::gw", canonical: "The Great Wall of China is visible from the Moon with the naked eye.",
    sampleTranscript: "the Great Wall is not visible from the Moon", repeatCount: 1,
    sourceDrafts: ["auth-pol-001"], authored: true, expected_polarity: "denies",
  };
  const e = buildGoldenEntry({ verdict: "False", category: "polarity_traps", note: "ratified", source_of_truth: "NASA" }, qe, "pol-013");
  assert.equal(e.expected_polarity, "denies", "polarity survives graduation");
  assert.match(e.adjudication_note, /ratified from AUTHORED candidate auth-pol-001/);
  // non-authored entries keep the exact 7-key schema — no stray polarity field
  const plain = buildGoldenEntry({ verdict: "True", category: "statistics", note: "n", source_of_truth: "s" },
    { canonical: "X", sampleTranscript: "t", repeatCount: 1, sourceDrafts: ["d1"] }, "stat-036");
  assert.ok(!("expected_polarity" in plain));
});

// ---- categoryNeeds -------------------------------------------------------------------
test("categoryNeeds computes the n>=30 gap per category", () => {
  const stats = categoryNeeds({ person_claims: 20, polarity_traps: 12, statistics: 35 });
  const by = Object.fromEntries(stats.map((s) => [s.category, s]));
  assert.equal(stats.length, CATEGORIES.length);
  assert.equal(by.person_claims.needed, 10);
  assert.equal(by.polarity_traps.needed, 18);
  assert.equal(by.statistics.needed, 0, "at/over target needs 0");
  assert.equal(by.attributed_quotes.current, 0, "missing category counts as 0");
  assert.equal(by.attributed_quotes.needed, 30);
});

// ---- prep.js end-to-end --------------------------------------------------------------
test("prep.js produces a clustered, hinted, gap-annotated queue.json", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "footnote-prep-"));
  const out = path.join(tmp, "queue.json");
  try {
    execFileSync("node", [path.join(TOOLDIR, "prep.js"), "--out", out], { cwd: ROOT });
    const q = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(q.draft_count, 141, "six graduation drafts files ingested (99 field + 8 d18pilot2 + 4 runtest + 30 authored); sci-033-class corpus excluded — it is disposition fodder, not graduation");
    assert.ok(q.unique_count < q.draft_count, "dedup shrinks the list");
    assert.ok(q.unique_count >= 90 && q.unique_count <= 105, `~98 unique claims, got ${q.unique_count}`);
    const thiel = q.entries.find((e) => (e.claim || "").toLowerCase().startsWith("peter thiel"));
    assert.ok(thiel, "Thiel family present");
    assert.equal(thiel.repeatCount, 26, "26 Thiel repeats collapse to one card");
    assert.equal(thiel.suggestedVerdict, "False", "queue-doc R1 recommendation transcribed as suggestion");
    assert.equal(thiel.suggestedCategory, "person_claims");
    assert.ok(thiel.cluster, "entries carry a cluster label");

    // cross-session fold: Trump-president spans 08-08, street ×4, and the 08-12 pilot
    const trump = q.entries.find((e) => (e.claim || "").toLowerCase().startsWith("donald trump is the president"));
    assert.equal(trump.repeatCount, 6, "Trump repeats fold across all five sessions");

    // clusters are contiguous in the entry order
    const seen = new Set();
    let prev = null;
    for (const e of q.entries) {
      if (e.cluster !== prev) { assert.ok(!seen.has(e.cluster), `cluster ${e.cluster} split`); seen.add(e.cluster); }
      prev = e.cluster;
    }
    assert.ok(Array.isArray(q.clusters) && q.clusters.length > 5, "cluster summary present");

    // AUTHORED candidates (packet 3a): all 30 present, marked, never folded into field
    // cards, and clustered under AUTHORED-prefixed labels with their evidence note +
    // cited source + polarity riding along for the operator to ratify.
    const authored = q.entries.filter((e) => e.authored);
    assert.equal(authored.length, 30, "12 attributed_quotes + 18 polarity_traps authored candidates (sci-033 corpus excluded from the sitting)");
    assert.equal(q.authored_count, 30, "queue-level authored count");
    for (const e of authored) {
      assert.ok(e.cluster.startsWith("AUTHORED · "), `${e.sourceDrafts[0]} clustered as AUTHORED`);
      assert.ok(e.hintNote && e.hintNote.includes("AUTHORED CANDIDATE"), "evidence note surfaces in hint panel");
      assert.ok(e.sourceOfTruth, "cited source rides along");
      assert.ok(["asserts", "denies"].includes(e.expected_polarity), "polarity rides along");
      assert.ok(e.suggestedVerdict && e.suggestedCategory, "provisional label pre-seeded as a suggestion");
      assert.ok(e.sourceDrafts.every((id) => id.startsWith("auth-")), "no fold with field drafts");
    }
    assert.equal(authored.filter((e) => e.suggestedCategory === "attributed_quotes").length, 12);
    assert.equal(authored.filter((e) => e.suggestedCategory === "polarity_traps").length, 18);
    for (const e of q.entries.filter((e) => !e.authored)) {
      assert.ok(!e.cluster.startsWith("AUTHORED"), "field cards never marked AUTHORED");
    }

    // golden-gap annotation matches the actual golden files
    assert.equal(q.categoryStats.length, CATEGORIES.length);
    for (const s of q.categoryStats) {
      const file = path.join(ROOT, "eval", "golden", s.category + ".jsonl");
      const current = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).length : 0;
      assert.equal(s.current, current, `${s.category} current count matches file`);
      assert.equal(s.needed, Math.max(0, 30 - current), `${s.category} gap math`);
    }
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
  for (const h of ["addEventListener(\"keydown\"", "btn-decide", "btn-download", "queue.json", "setVerdict", "setCategory",
    "localStorage", "resolvedDecisions", "cluster-bar", "hint-note", "btn-download-top", "etaLabel"]) {
    assert.ok(src.includes(h), `page wires ${h}`);
  }
  const html = readFileSync(path.join(TOOLDIR, "adjudicate.html"), "utf8");
  assert.ok(html.includes("/tools/adjudicate/adjudicate.js"), "html loads the module");
  for (const id of ["cluster-bar", "hint-note", "btn-download-top", "btn-reset", "resolved-badge"]) {
    assert.ok(html.includes(`id="${id}"`), `html has #${id}`);
  }
  assert.ok(existsSync(path.join(TOOLDIR, "adjudicate.css")), "css present");
});

// ---- hints.json is transcription-shaped and matches real queue cards -----------------
test("hints.json parses, uses only known verdicts/categories, and every hint lands on a card", () => {
  const hints = JSON.parse(readFileSync(path.join(TOOLDIR, "hints.json"), "utf8")).hints;
  assert.ok(hints.length > 40, "hint set covers the sitting");
  const verdicts = new Set(VERDICTS.map((v) => v.value));
  const cats = new Set(CATEGORIES.map((c) => c.name));
  for (const h of hints) {
    assert.ok(h.ref, "every hint cites its queue-doc section / source log");
    assert.ok(h.claim || (h.draftIds && h.draftIds.length), "every hint has a match key");
    if (h.suggestedVerdict) assert.ok(verdicts.has(h.suggestedVerdict), `${h.ref}: verdict ${h.suggestedVerdict}`);
    if (h.suggestedCategory) assert.ok(cats.has(h.suggestedCategory), `${h.ref}: category ${h.suggestedCategory}`);
  }
  // every hint must attach to at least one card in the real queue (no dead transcriptions)
  const tmp = mkdtempSync(path.join(os.tmpdir(), "footnote-hints-"));
  const out = path.join(tmp, "queue.json");
  try {
    execFileSync("node", [path.join(TOOLDIR, "prep.js"), "--out", out], { cwd: ROOT });
    const q = JSON.parse(readFileSync(out, "utf8"));
    const claims = new Set(q.entries.filter((e) => e.claim).map((e) => normalizeClaim(e.claim)));
    const draftIds = new Set(q.entries.flatMap((e) => e.sourceDrafts));
    for (const h of hints) {
      const hit = (h.claim && claims.has(normalizeClaim(h.claim))) ||
        (h.draftIds || []).some((id) => draftIds.has(id));
      assert.ok(hit, `hint ${h.ref} "${(h.claim || (h.draftIds || []).join(",")).slice(0, 50)}" matches no card`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ═══ Polarity micro-pass (the 31 negation-ambiguous rows) ══════════════════════════════

// ---- rulings vocabulary --------------------------------------------------------------
test("POLARITY_RULINGS covers asserts/denies/ambiguous-drop with 1/2/3 hotkeys", () => {
  assert.deepEqual(POLARITY_RULINGS.map((r) => r.value), ["asserts", "denies", "ambiguous-drop"]);
  assert.deepEqual(POLARITY_RULINGS.map((r) => r.key), ["1", "2", "3"]);
  assert.ok(isPolarityRuling("asserts") && isPolarityRuling("ambiguous-drop"));
  assert.ok(!isPolarityRuling("True") && !isPolarityRuling(null) && !isPolarityRuling("drop"));
});

// ---- buildPolarityEntries ------------------------------------------------------------
test("buildPolarityEntries joins cards to live golden rows, drops ruled rows, never suggests", () => {
  const cards = [
    { id: "x-001", family: "fam A", readings: [{ ruling: "asserts", reading: "r1" }, { ruling: "denies", reading: "r2" }], ambiguity: "why" },
    { id: "x-002", family: "fam A", readings: [], ambiguity: "" },
    { id: "x-003", family: "fam B", readings: [], ambiguity: "" },   // already ruled (even null!)
    { id: "x-404", family: "fam B", readings: [], ambiguity: "" },   // no golden row
  ];
  const goldenById = new Map([
    ["x-001", { id: "x-001", category: "science_health", expected_extraction: "Claim one.", ground_truth_verdict: "False", transcript_snippet: "spoken one" }],
    ["x-002", { id: "x-002", category: "science_health", expected_extraction: null, ground_truth_verdict: null, transcript_snippet: "spoken two" }],
    ["x-003", { id: "x-003", category: "statistics", expected_extraction: "C", ground_truth_verdict: "True", transcript_snippet: "s", expected_polarity: null }],
  ]);
  const { entries, alreadyRuled, missing } = buildPolarityEntries(cards, goldenById);
  assert.equal(entries.length, 2);
  assert.deepEqual(alreadyRuled, ["x-003"], "explicit-null (ambiguous-drop) counts as ruled");
  assert.deepEqual(missing, ["x-404"]);
  const e = entries[0];
  assert.equal(e.key, "pol::x-001");
  assert.equal(e.mode, "polarity");
  assert.equal(e.goldenId, "x-001");
  assert.equal(e.category, "science_health");
  assert.equal(e.claim, "Claim one.", "claim comes from the golden row, not the card");
  assert.equal(e.sampleTranscript, "spoken one");
  assert.equal(e.groundTruth, "False");
  assert.equal(e.cluster, "polarity · fam A");
  assert.equal(e.suggestedVerdict, null, "polarity cards NEVER carry suggestions");
  assert.equal(e.suggestedCategory, null);
  assert.equal(entries[1].claim, null, "null-extraction rows keep their null claim");
});

// ---- applyPolarityToLine (surgical line edit) ----------------------------------------
test("applyPolarityToLine appends the field in the files' hand-spaced style, byte-preserving", () => {
  const line = '{"id": "sci-012", "transcript_snippet": "lightning never strikes twice", "expected_extraction": "Lightning never strikes the same place twice.", "category": "science_health", "ground_truth_verdict": "False", "adjudication_note": "n", "source_of_truth": "NOAA"}';
  const res = applyPolarityToLine(line, "asserts", "");
  assert.equal(res.changed, true);
  assert.ok(res.line.startsWith(line.slice(0, -1)), "every byte before the closing brace is preserved");
  assert.ok(res.line.endsWith(', "expected_polarity": "asserts"}'), "field appended like the 229 labeled rows");
  const row = JSON.parse(res.line);
  assert.equal(row.expected_polarity, "asserts");
  assert.ok(!Object.hasOwn(row, "polarity_note"), "no note field when the operator wrote none");

  const withNote = applyPolarityToLine(line, "denies", "operator rationale");
  const parsed = JSON.parse(withNote.line);
  assert.equal(parsed.expected_polarity, "denies");
  assert.equal(parsed.polarity_note, "operator rationale");
});

test("applyPolarityToLine ambiguous-drop writes EXPLICIT null + polarity_note (ruled ≠ unvisited)", () => {
  const line = '{"id": "stat-010", "expected_extraction": null, "category": "statistics", "ground_truth_verdict": null}';
  const res = applyPolarityToLine(line, "ambiguous-drop", "no claim, no stance");
  assert.equal(res.changed, true);
  const row = JSON.parse(res.line);
  assert.ok(Object.hasOwn(row, "expected_polarity"), "key present = ruled");
  assert.equal(row.expected_polarity, null, "explicit null — run.js skips it identically to absent");
  assert.match(row.polarity_note, /excluded from the polarity slice/);
  assert.match(row.polarity_note, /no claim, no stance/);
});

test("applyPolarityToLine refuses to clobber an already-ruled row and rejects unknown rulings", () => {
  const ruled = '{"id": "adv-001", "category": "adversarial", "expected_polarity": "asserts"}';
  const r1 = applyPolarityToLine(ruled, "denies", "");
  assert.equal(r1.changed, false);
  assert.equal(r1.line, ruled, "line untouched");
  assert.match(r1.reason, /already ruled/);
  const droppedBefore = '{"id": "x", "category": "statistics", "expected_polarity": null}';
  assert.equal(applyPolarityToLine(droppedBefore, "asserts", "").changed, false, "explicit-null drop is also ruled");
  const r2 = applyPolarityToLine('{"id": "y", "category": "statistics"}', "True", "");
  assert.equal(r2.changed, false);
  assert.match(r2.reason, /unknown ruling/);
});

// ---- polarity-cards.json integrity: exactly the 31 unset rows, transcription only ----
test("polarity-cards.json covers exactly the golden rows missing expected_polarity, no invented answers", () => {
  const cards = JSON.parse(readFileSync(path.join(TOOLDIR, "polarity-cards.json"), "utf8")).cards;
  const goldenById = new Map();
  const goldenDir = path.join(ROOT, "eval", "golden");
  for (const name of readdirSync(goldenDir).filter((n) => n.endsWith(".jsonl") && !n.startsWith("drafts-"))) {
    for (const l of readFileSync(path.join(goldenDir, name), "utf8").split("\n")) {
      if (l.trim()) { const r = JSON.parse(l); goldenById.set(r.id, r); }
    }
  }
  const unset = [...goldenById.values()].filter((r) => !Object.hasOwn(r, "expected_polarity")).map((r) => r.id).sort();
  const cardIds = cards.map((c) => c.id).sort();
  assert.deepEqual(cardIds, unset, "cards = exactly the unset rows (self-healing: ruled rows leave both sides)");
  const rulings = new Set(POLARITY_RULINGS.map((r) => r.value));
  const allowedKeys = new Set(["id", "category", "family", "readings", "ambiguity"]);
  for (const c of cards) {
    for (const k of Object.keys(c)) assert.ok(allowedKeys.has(k), `${c.id}: unexpected key ${k} (no suggestion fields allowed)`);
    assert.equal(c.category, goldenById.get(c.id).category, `${c.id}: category matches the golden row`);
    assert.ok(c.family, `${c.id}: has a family (cluster label)`);
    assert.equal(c.readings.length, 2, `${c.id}: exactly two candidate readings`);
    for (const r of c.readings) {
      assert.ok(rulings.has(r.ruling), `${c.id}: reading ruling ${r.ruling} is a real ruling`);
      assert.ok(r.reading && r.reading.length > 20, `${c.id}: reading text is substantive`);
    }
    assert.ok(c.ambiguity && c.ambiguity.length > 20, `${c.id}: neutral ambiguity framing present`);
  }
});

// ---- prep.js stages the polarity block as its own trailing cluster group -------------
test("prep.js appends polarity cards as their own contiguous cluster group (+ --polarity-only)", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "footnote-polprep-"));
  try {
    const out = path.join(tmp, "queue.json");
    execFileSync("node", [path.join(TOOLDIR, "prep.js"), "--out", out], { cwd: ROOT });
    const q = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(q.polarity_count, 31, "all 31 unset rows staged");
    const polEntries = q.entries.filter((e) => e.mode === "polarity");
    assert.equal(polEntries.length, 31);
    const firstPol = q.entries.findIndex((e) => e.mode === "polarity");
    assert.ok(q.entries.slice(firstPol).every((e) => e.mode === "polarity"),
      "polarity block is contiguous at the END — graduation clusters are untouched in front");
    assert.equal(q.unique_count, q.entries.length - 31, "unique_count stays graduation-only");
    for (const e of polEntries) {
      assert.match(e.cluster, /^polarity · /, "own cluster namespace");
      assert.equal(e.suggestedVerdict, null);
      assert.equal(e.suggestedCategory, null);
      assert.equal(e.readings.length, 2);
    }
    // the standalone <=15-min sitting: just the micro-pass
    const out2 = path.join(tmp, "queue-pol.json");
    execFileSync("node", [path.join(TOOLDIR, "prep.js"), "--out", out2, "--polarity-only"], { cwd: ROOT });
    const q2 = JSON.parse(readFileSync(out2, "utf8"));
    assert.equal(q2.entries.length, 31);
    assert.ok(q2.entries.every((e) => e.mode === "polarity"));
    assert.equal(q2.draft_count, 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ---- apply.js polarity path: surgical write, RED values pass through, idempotent -----
test("apply.js writes polarity rulings in place, preserves every other byte, idempotent", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "footnote-polapply-"));
  try {
    const goldenDir = path.join(tmp, "golden");
    execFileSync("mkdir", ["-p", goldenDir]);
    const lines = [
      '{"id": "sci-011", "transcript_snippet": "keep me", "expected_extraction": "Untouched claim.", "category": "science_health", "ground_truth_verdict": "True", "adjudication_note": "", "source_of_truth": "x", "expected_polarity": "asserts"}',
      '{"id": "sci-012", "transcript_snippet": "lightning never strikes twice", "expected_extraction": "Lightning never strikes the same place twice.", "category": "science_health", "ground_truth_verdict": "False", "adjudication_note": "", "source_of_truth": "NOAA"}',
      '{"id": "sci-020", "transcript_snippet": "is coffee bad?", "expected_extraction": null, "category": "science_health", "ground_truth_verdict": null, "adjudication_note": "", "source_of_truth": "n/a"}',
    ];
    const file = path.join(goldenDir, "science_health.jsonl");
    writeFileSync(file, lines.join("\n") + "\n");

    const queuePath = path.join(tmp, "queue.json");
    writeFileSync(queuePath, JSON.stringify({ generated_at: "x", entries: [
      { key: "pol::sci-012", mode: "polarity", goldenId: "sci-012", category: "science_health" },
      { key: "pol::sci-020", mode: "polarity", goldenId: "sci-020", category: "science_health" },
    ] }));
    const gradPath = path.join(tmp, "graduations.json");
    writeFileSync(gradPath, JSON.stringify({ decisions: [
      { key: "pol::sci-012", mode: "polarity", polarity: "asserts", resolved: true },
      { key: "pol::sci-020", mode: "polarity", polarity: "ambiguous-drop", note: "question, no stance", resolved: true },
    ] }));

    const run = () => spawnSync("node", [path.join(TOOLDIR, "apply.js"), gradPath, "--queue", queuePath, "--golden-dir", goldenDir], { cwd: ROOT, encoding: "utf8" }).stderr;
    const first = run();
    assert.match(first, /~ sci-012 expected_polarity=asserts/);
    assert.match(first, /~ sci-020 expected_polarity=null \(ambiguous-drop\)/);
    assert.match(first, /0 entr\(ies\) appended/, "polarity rulings never reach the append path");

    const after = readFileSync(file, "utf8").split("\n");
    assert.equal(after[0], lines[0], "already-labeled neighbor byte-identical");
    assert.ok(after[1].startsWith(lines[1].slice(0, -1)), "ruled line: prefix bytes preserved");
    const r12 = JSON.parse(after[1]);
    assert.equal(r12.expected_polarity, "asserts", "the RED value is exactly the operator's ruling");
    const r20 = JSON.parse(after[2]);
    assert.equal(r20.expected_polarity, null);
    assert.match(r20.polarity_note, /question, no stance/);
    assert.equal(after[3], "", "trailing newline preserved");

    const second = run(); // idempotent — both rows now carry the key
    assert.match(second, /already ruled/);
    assert.match(second, /0 entr\(ies\) appended, 0 polarity ruling\(s\) written/);
    assert.equal(readFileSync(file, "utf8"), after.join("\n"), "no drift on re-run");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("apply.js refuses unresolved and unknown-ruling polarity decisions (0b safety extended)", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "footnote-polsafety-"));
  try {
    const goldenDir = path.join(tmp, "golden");
    execFileSync("mkdir", ["-p", goldenDir]);
    const line = '{"id": "geo-001", "transcript_snippet": "t", "expected_extraction": "C.", "category": "geography_civics", "ground_truth_verdict": "True", "adjudication_note": "", "source_of_truth": "x"}';
    const file = path.join(goldenDir, "geography_civics.jsonl");
    writeFileSync(file, line + "\n");
    const queuePath = path.join(tmp, "queue.json");
    writeFileSync(queuePath, JSON.stringify({ generated_at: "x", entries: [
      { key: "pol::geo-001", mode: "polarity", goldenId: "geo-001", category: "geography_civics" },
    ] }));
    const gradPath = path.join(tmp, "graduations.json");
    writeFileSync(gradPath, JSON.stringify({ decisions: [
      { key: "pol::geo-001", mode: "polarity", polarity: "asserts", resolved: false },
    ] }));
    const run = () => spawnSync("node", [path.join(TOOLDIR, "apply.js"), gradPath, "--queue", queuePath, "--golden-dir", goldenDir], { cwd: ROOT, encoding: "utf8" }).stderr;
    assert.match(run(), /never resolved in cockpit/);
    assert.equal(readFileSync(file, "utf8"), line + "\n", "unratified suggestion cannot touch a golden value");

    writeFileSync(gradPath, JSON.stringify({ decisions: [
      { key: "pol::geo-001", mode: "polarity", polarity: "True", resolved: true },
    ] }));
    assert.match(run(), /unknown polarity ruling/);
    assert.equal(readFileSync(file, "utf8"), line + "\n", "a verdict is not a polarity ruling");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ---- page wiring for polarity mode ---------------------------------------------------
test("cockpit page wires the polarity mode", () => {
  const src = readFileSync(path.join(TOOLDIR, "adjudicate.js"), "utf8");
  for (const h of ["POLARITY_RULINGS", "setPolarity", "polarity-buttons", "polarity-readings", "isPolarity"]) {
    assert.ok(src.includes(h), `page wires ${h}`);
  }
  const html = readFileSync(path.join(TOOLDIR, "adjudicate.html"), "utf8");
  for (const id of ["polarity-buttons", "polarity-readings", "verdict-label", "category-group", "source-group"]) {
    assert.ok(html.includes(`id="${id}"`), `html has #${id}`);
  }
});

// ---- apply.js refuses never-resolved decisions ---------------------------------------
test("apply.js skips decisions marked resolved:false (suggestion never ratified)", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "footnote-unresolved-"));
  try {
    const goldenDir = path.join(tmp, "golden");
    execFileSync("mkdir", ["-p", goldenDir]);
    const queuePath = path.join(tmp, "queue.json");
    writeFileSync(queuePath, JSON.stringify({ generated_at: "x", entries: [
      { key: "claim::a", claim: "A", canonical: "A", sampleTranscript: "t", repeatCount: 1, sourceDrafts: ["d1"] },
    ] }));
    const gradPath = path.join(tmp, "graduations.json");
    writeFileSync(gradPath, JSON.stringify({ decisions: [
      { key: "claim::a", verdict: "False", category: "person_claims", resolved: false },
    ] }));
    const res = spawnSync("node", [path.join(TOOLDIR, "apply.js"), gradPath, "--queue", queuePath, "--golden-dir", goldenDir], { cwd: ROOT, encoding: "utf8" });
    assert.match(res.stderr, /never resolved in cockpit/);
    assert.match(res.stderr, /0 entr\(ies\) appended/);
    assert.ok(!existsSync(path.join(goldenDir, "person_claims.jsonl")), "nothing written");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
