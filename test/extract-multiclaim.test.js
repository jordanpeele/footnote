// Prompt v4 multi-claim extraction (2026-08-18): rapid-fire speech packs several distinct
// claims into one transcript window; the v3 single-claim contract silently dropped all but
// one (desk session 2026-08-18: "a million Haitian immigrants move to the UK every year"
// lost to a neighboring claim in the same window). These tests pin the new envelope's
// parse contract and its degradation paths — a model regression to the old single-claim
// shape must WRAP, never drop.
import test from "node:test";
import assert from "node:assert/strict";
import { parseExtraction, parseExtractionMulti } from "../src/adapters/extractor/anthropic-haiku/index.js";

const item = (claim, over) => JSON.stringify({ claim, polarity: "asserts", harm_class: "none", category: "other", ...over });

test("multi: a claims array parses to one validated item per distinct claim, in order", () => {
  const raw = `{"claims": [${item("10,000 Haitian immigrants move to the UK every year")}, ${item("20,000 Moroccans move to the UK every year", { category: "history_geography" })}]}`;
  const p = parseExtractionMulti(raw);
  assert.equal(p.claims.length, 2);
  assert.equal(p.claims[0].claim, "10,000 Haitian immigrants move to the UK every year");
  assert.equal(p.claims[1].claim, "20,000 Moroccans move to the UK every year");
  assert.equal(p.claims[1].category, "history_geography");
  assert.ok(p.claims.every((c) => c.polarity === "asserts" && c.harm_class === "none"));
});

test("multi: repeated propositions inside one envelope collapse to one entry", () => {
  const raw = `{"claims": [${item("Gold is worth more than silver")}, ${item("gold is worth more than silver")}]}`;
  assert.equal(parseExtractionMulti(raw).claims.length, 1);
});

test("multi: the parser caps a runaway array at 4 (verify-spend bound)", () => {
  const raw = `{"claims": [${Array.from({ length: 9 }, (_, i) => item(`Claim number ${i} is true`)).join(",")}]}`;
  assert.equal(parseExtractionMulti(raw).claims.length, 4);
});

test("multi: junk entries (missing claim, non-objects) are skipped, valid ones survive", () => {
  const raw = `{"claims": [{"polarity":"asserts"}, "just a string", ${item("The Nile is the longest river")}, {"claim": 42}]}`;
  const p = parseExtractionMulti(raw);
  assert.equal(p.claims.length, 1);
  assert.equal(p.claims[0].claim, "The Nile is the longest river");
});

test("multi: per-item field validation matches the single-claim parser (unknown category → other)", () => {
  const raw = `{"claims": [${item("X causes Y", { category: "finance", harm_class: "banana" })}]}`;
  const p = parseExtractionMulti(raw);
  assert.equal(p.claims[0].category, "other");
  assert.equal(p.claims[0].harm_class, "none");
});

test("multi: NONE and empty arrays both mean no claims", () => {
  assert.deepEqual(parseExtractionMulti("NONE"), { claims: [] });
  assert.deepEqual(parseExtractionMulti('{"claims": []}'), { claims: [] });
  assert.deepEqual(parseExtractionMulti(""), { claims: [] });
});

test("multi: a legacy single-claim envelope WRAPS (regression to v3 degrades, never drops)", () => {
  const p = parseExtractionMulti('{"claim": "Unemployment went up last month", "polarity": "denies", "harm_class": "none", "category": "economics_business"}');
  assert.equal(p.claims.length, 1);
  assert.equal(p.claims[0].claim, "Unemployment went up last month");
  assert.equal(p.claims[0].polarity, "denies");
});

test("multi: bare non-JSON text falls back to the v1 bare-claim path and wraps", () => {
  const p = parseExtractionMulti("The Great Wall is visible from space");
  assert.equal(p.claims.length, 1);
  assert.equal(p.claims[0].claim, "The Great Wall is visible from space");
  assert.equal(p.claims[0].category, "other", "unparseable envelope can never forge a canonical category");
});

test("multi: fenced claims envelope still parses (model wraps JSON in ```)", () => {
  const raw = "```json\n" + `{"claims": [${item("Silver is worth more than bronze")}]}` + "\n```";
  assert.equal(parseExtractionMulti(raw).claims.length, 1);
});

test("single-claim parseExtraction contract is unchanged (legacy consumers + fallback path)", () => {
  const p = parseExtraction('{"claim": "X is Y", "polarity": "asserts", "harm_class": "none", "category": "science_health"}');
  assert.deepEqual(p, { claim: "X is Y", polarity: "asserts", harm_class: "none", category: "science_health" });
  assert.deepEqual(parseExtraction("NONE"), { claim: null });
});
