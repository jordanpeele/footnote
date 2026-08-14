// R53 denial-watch counting logic (tools/fieldtest/session-summary.js) — the automated
// count behind the field-report line. Fixtures cover both artifact kinds and every
// exclusion the ledger cares about: manual airs, TESTAIR (R63), asserts, and the
// old-log fallback join (air events without their own polarity field).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPolarityApplied, summarizeHarness, summarizeExport, summarizeArtifact, denialWatch, renderMarkdown, parseJsonl,
} from "../tools/fieldtest/session-summary.js";

test("isPolarityApplied — only denial readings with a flippable verdict", () => {
  assert.equal(isPolarityApplied("denies", "True"), true);
  assert.equal(isPolarityApplied("denies", "False"), true);
  assert.equal(isPolarityApplied("suspect_denies", "True"), true);   // packet: denies/suspect both count when applied
  assert.equal(isPolarityApplied("asserts", "True"), false);
  assert.equal(isPolarityApplied(null, "True"), false);
  assert.equal(isPolarityApplied("denies", "Misleading"), false);    // applyPolarity never flips Misleading — not "applied"
});

/* Inline harness fixture — one session:
   u1 denies  → auto-aired True            → COUNTS (polarity from extract join; air lacks the field, old-log shape)
   u2 asserts → auto-aired True            → auto, not polarity-applied
   u3 denies  → MANUAL air                 → excluded (not auto)
   u4 denies  → auto TESTAIR (test:true)   → excluded from the whole machine-aired ledger (R63)
   u5 asserts → vetoed mid-countdown       → vetoed count
   u6 denies  → auto-aired, polarity ON the air event (new R53 shape) → COUNTS without any join */
const HARNESS = [
  { ev: "extract_done", cid: "u1", status: "ok", claim: "Vaccines cause autism", polarity: "denies", harm_class: "none" },
  { ev: "extract_done", cid: "u2", status: "ok", claim: "Smoking causes cancer", polarity: "asserts", harm_class: "none" },
  { ev: "extract_done", cid: "u3", status: "ok", claim: "Bats are blind", polarity: "denies", harm_class: "none" },
  { ev: "extract_done", cid: "u4", status: "ok", claim: "The moon is cheese", polarity: "denies", harm_class: "none" },
  { ev: "extract_done", cid: "u5", status: "ok", claim: "Goldfish memory", polarity: "asserts", harm_class: "none" },
  { ev: "extract_done", cid: "uX", status: "ok", claim: null, polarity: null },                    // no claim → not checked
  { ev: "verify_done", cid: "u1", verdict: "True", polarity_conflict: false },
  { ev: "verify_done", cid: "u3", verdict: "True", polarity_conflict: false },
  { ev: "air", id: 1, cid: "u1", verdict: "True", auto: true, test: false, claim: "Vaccines cause autism" },
  { ev: "air", id: 2, cid: "u2", verdict: "True", auto: true, test: false, claim: "Smoking causes cancer" },
  { ev: "air", id: 3, cid: "u3", verdict: "True", auto: false, test: false, claim: "Bats are blind" },
  { ev: "air", id: 4, cid: "u4", verdict: "True", auto: true, test: true, claim: "The moon is cheese" },
  { ev: "air", id: 6, cid: "u6", verdict: "False", auto: true, test: false, claim: "Einstein failed math", polarity: "denies", polarity_conflict: false },
  { ev: "mark", id: 5, action: "skipped", veto: true },
  { ev: "attention", id: 1, cid: "u1", state: "watching", source: "control" },
  { ev: "attention", id: 1, cid: "u1", state: "away", source: "op" },   // second tag — first wins
  { ev: "window_summary", windows: 7, suppressed: 2, words_in: 400, words_sent: 350, t: 1, seq: 9, page: "control" },
];

test("summarizeHarness — totals, ledger exclusions, attention, window passthrough", () => {
  const s = summarizeHarness(HARNESS);
  assert.equal(s.checked, 5);                       // uX's null claim never checked
  assert.equal(s.aired, 4);                         // u1 u2 u3 u6 — TESTAIR u4 excluded
  assert.equal(s.autoAired, 3);                     // u1 u2 u6
  assert.equal(s.manualAirs, 1);                    // u3
  assert.equal(s.testAirs, 1);                      // u4, reported separately
  assert.equal(s.vetoed, 1);
  assert.deepEqual(s.attention, { watching: 1, talking: 0, away: 0, uncaptured: 2 });   // first tag wins; u2/u6 untagged
  assert.deepEqual(s.windowSummary, { windows: 7, suppressed: 2, words_in: 400, words_sent: 350 });
  assert.deepEqual(s.polarityApplied.map((c) => c.cid).sort(), ["u1", "u6"]);   // join path + on-event path
  assert.equal(s.anomalies.length, 0);
});

test("summarizeExport — R20 entries with and without polarity", () => {
  const withPol = summarizeExport({
    session: { summary: { totalChecked: 3, aired: 2, autoAired: 2, vetoed: 0, attention: { watching: 0, talking: 2, away: 0, uncaptured: 0 } } },
    entries: [
      { id: 1, claim: "A", verdict: "True", aired: true, autoAired: true, polarity: "denies", polarity_conflict: false },
      { id: 2, claim: "B", verdict: "True", aired: true, autoAired: true, polarity: "asserts" },
      { id: 3, claim: "C", verdict: "False", aired: false, autoAired: false, polarity: "denies" },   // not aired — excluded
    ],
  });
  assert.equal(withPol.polarityKnown, true);
  assert.deepEqual(withPol.polarityApplied.map((c) => c.id), [1]);

  const preR53 = summarizeExport({
    session: { summary: { totalChecked: 20, aired: 13, autoAired: 10, vetoed: 2 } },
    entries: [{ id: 9, claim: "old", verdict: "True", aired: true, autoAired: true }],   // no polarity field
  });
  assert.equal(preR53.polarityKnown, false);        // reported as unknown, never silently 0
  assert.equal(preR53.polarityApplied.length, 0);
  assert.equal(preR53.autoAired, 10);
});

test("denialWatch — this-session vs cumulative vs target, and the pasteable line", () => {
  const a1 = summarizeHarness(HARNESS);                                        // 2 applied
  const a2 = summarizeArtifact("export.json", JSON.stringify({
    session: { summary: { totalChecked: 1, aired: 1, autoAired: 1, vetoed: 0 } },
    entries: [{ id: 1, claim: "D", verdict: "False", aired: true, autoAired: true, polarity: "denies" }],
  }));                                                                          // 1 applied — "this session"
  const dw = denialWatch([{ name: "log1.jsonl", ...a1 }, a2]);
  assert.equal(dw.thisSession, 1);
  assert.equal(dw.cumulative, 3);
  assert.equal(dw.target, 20);
  assert.match(dw.line, /1 polarity-applied auto-airs this session; cumulative 3 of the required 20 clean/);

  const md = renderMarkdown([{ name: "log1.jsonl", ...a1 }, a2]);
  assert.match(md, /Denial-watch line \(R53\)/);
  assert.match(md, /cumulative 3 of the required 20 clean/);
  assert.match(md, /u1, u6/);                                                  // supporting card ids surface
});

test("artifact detection — JSONL vs export, including JSONL lines that start with {", () => {
  const jsonl = HARNESS.map((e) => JSON.stringify(e)).join("\n");
  assert.equal(summarizeArtifact("a.jsonl", jsonl).kind, "harness");
  assert.equal(parseJsonl(jsonl).length, HARNESS.length);
  assert.equal(summarizeArtifact("b.json", JSON.stringify({ session: {}, entries: [] })).kind, "export");
});
