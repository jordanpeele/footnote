// Editorial policy tests — round-3 fixes for red-team L3/L4/L5/L7 plus regression pins
// for the round-2 hotfixes (H3 gov-cc allowlist, autoAirEligible evidence floor).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanText, truncateOnAir, trustTier, prettyName, rankCitations, autoAirEligible, finalizeVerification,
} from "../src/core/editorial.js";

const rv = (over) => ({ verdict: "False", correction: "c", confidence: 0.9, citations: [], ...over });

// ---- L7: verdict casing normalized (case-insensitive onto canonical form) ----
test("L7: miscased vendor verdicts normalize to canonical, not Unverifiable", () => {
  assert.equal(finalizeVerification(rv({ verdict: "false" })).verdict, "False");
  assert.equal(finalizeVerification(rv({ verdict: " True" })).verdict, "True");
  assert.equal(finalizeVerification(rv({ verdict: "MISLEADING" })).verdict, "Misleading");
  assert.equal(finalizeVerification(rv({ verdict: "needscontext" })).verdict, "NeedsContext");
});
test("L7: unknown / non-string verdicts still fall back to Unverifiable", () => {
  assert.equal(finalizeVerification(rv({ verdict: "Probably" })).verdict, "Unverifiable");
  assert.equal(finalizeVerification(rv({ verdict: null })).verdict, "Unverifiable");
  assert.equal(finalizeVerification(rv({ verdict: 42 })).verdict, "Unverifiable");
});

// ---- L5: nested/repeated markdown strips to a fixpoint ----
test("L5: nested emphasis fully strips (no literal ** reaches the chyron)", () => {
  assert.equal(cleanText("**bold *ital* [link](https://u)**"), "bold ital link");
  assert.equal(cleanText("***both***"), "both");
  assert.equal(cleanText("`**code bold**`"), "code bold");
  assert.equal(cleanText("**__stacked__**"), "stacked");
});
test("L5: single-pass behavior unchanged for plain markdown", () => {
  assert.equal(cleanText("**bold** and *ital* and `code` [x](https://y) [1]"), "bold and ital and code x");
});

// ---- L3: shorteners are tier-0 (never surfaced) ----
test("L3: URL shorteners are blocklisted (tier 0)", () => {
  for (const h of ["t.co", "bit.ly", "youtu.be", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly"]) {
    assert.equal(trustTier(h), 0, h);
  }
  assert.equal(trustTier("sub.bit.ly"), 0, "subdomains of shorteners are tier 0 too");
});
test("L3: rankCitations drops shortener citations entirely", () => {
  const ranked = rankCitations(["https://t.co/abc", "https://reuters.com/x"]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].host, "reuters.com");
});

// ---- L3: sub-3-char derived display names fall back to the full host ----
test("L3: prettyName under 3 chars falls back to the full host", () => {
  assert.equal(prettyName("t.co"), "t.co");
  assert.equal(prettyName("ao.com"), "ao.com");
});
test("L3: prettyName unchanged for normal domains and .gov acronyms", () => {
  assert.equal(prettyName("brookings.edu"), "Brookings");
  assert.equal(prettyName("reuters.com"), "Reuters");           // PRETTY map still wins
  assert.equal(prettyName("va.gov"), "VA");                     // gov acronym path exempt by design
});

// ---- L4: surrogate-safe on-air truncation ----
test("L4: truncation strips a trailing lone high surrogate", () => {
  const t = truncateOnAir("a".repeat(239) + "\u{1F600}", 240);
  assert.equal(t, "a".repeat(239));
  assert.ok(t.isWellFormed());
});
test("L4: truncation leaves intact pairs and short strings alone", () => {
  assert.equal(truncateOnAir("hi \u{1F600}", 240), "hi \u{1F600}");
  assert.equal(truncateOnAir("a".repeat(238) + "\u{1F600}", 240), "a".repeat(238) + "\u{1F600}");   // pair fits exactly
});
test("L4: finalizeVerification correction is surrogate-safe at the 240 boundary", () => {
  const out = finalizeVerification(rv({ correction: "a".repeat(239) + "\u{1F600} more text" }));
  assert.equal(out.correction, "a".repeat(239));
  assert.ok(out.correction.isWellFormed());
});

// ---- P5F-3: curated display-name map + never-all-caps fallback ----
test("P5F-3: curated map covers the hosts that hit the field logs", () => {
  assert.equal(prettyName("archives.gov"), "National Archives");   // the "ARCHIVES" field bug
  assert.equal(prettyName("bea.gov"), "Bureau of Economic Analysis");
  assert.equal(prettyName("britannica.com"), "Encyclopædia Britannica");
  assert.equal(prettyName("wikipedia.org"), "Wikipedia");
  assert.equal(prettyName("federalreserve.gov"), "Federal Reserve");
});
test("P5F-3: deep hosts inherit the curated name via parent-suffix walk", () => {
  assert.equal(prettyName("data.census.gov"), "U.S. Census Bureau");
  assert.equal(prettyName("en.wikipedia.org"), "Wikipedia");
  assert.equal(prettyName("apps.bea.gov"), "Bureau of Economic Analysis");
});
test("P5F-3: unknown deep host → cleaned host (last ≤3 labels, leading capital, no path junk)", () => {
  assert.equal(prettyName("webspace.science.uu.nl"), "Science.uu.nl");   // field tier-1 citation
  assert.equal(prettyName("a.b.example.org"), "B.example.org");
});
test("P5F-3: long .gov label is title-cased, NEVER all-caps; short acronym path preserved", () => {
  assert.equal(prettyName("benefits.gov"), "Benefits");   // was "BENEFITS" — the ARCHIVES class of bug
  assert.equal(prettyName("hud.gov"), "HUD");
});

// ---- Regressions: round-2 hotfixes stay fixed ----
test("regression: reuters.com is tier 3", () => {
  assert.equal(trustTier("reuters.com"), 3);
});
test("regression H3: privately registrable gov.<cc> is NOT tier 3 (cdc.gov.io → 1)", () => {
  assert.equal(trustTier("cdc.gov.io"), 1);
  assert.equal(trustTier("gov.uk"), 3);                          // curated sovereign list still trusted
  assert.equal(trustTier("service.gov.uk"), 3);
});
test("regression: autoAirEligible — two distinct tier-2 hosts pass, one does not", () => {
  const two = rankCitations(["https://vox.com/a", "https://thehill.com/b"]);
  assert.equal(autoAirEligible(two), true);
  const one = rankCitations(["https://vox.com/a", "https://vox.com/b"]);   // same host twice ≠ independent
  assert.equal(autoAirEligible(one), false);
  const t3 = rankCitations(["https://reuters.com/x"]);
  assert.equal(autoAirEligible(t3), true);                       // tier-3 surfaced source passes alone
  assert.equal(autoAirEligible([]), false);
});
