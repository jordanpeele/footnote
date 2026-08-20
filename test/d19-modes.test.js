// D19 acceptance replays + posture-drift pins (2026-08-20 two-mode ruling).
//
// REPLAY: the 8/18 + 8/20 field sessions' aired cards, distilled to fixtures and run
// through the airDecision model under BOTH modes. Ruling's acceptance line, verbatim:
// "OPEN airs everything EXCEPT the person/polarity-conflict cards (which hold);
//  VERIFIED airs only the compliant subset. The Trump/Vance/Macron/Farage cards hold
//  in BOTH modes."
// harm_class was NOT persisted in those sessions' exports (pilot-ledger §11 — fixed by
// D19-5); the labels below are hand-assigned per the extractor's documented rules and
// marked as fixture ground truth, not session data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { airDecision } from "../tools/synthetic/window-sim.js";

const S = (claim, over) => ({ claim, polarity: "asserts", polarity_conflict: false, harm_class: "none", category: "other", verdict: "False", confidence: 0.97, autoAirEligible: true, source: { url: "https://example.gov/x", name: "x" }, ...over });

// ---- distilled from the two archived sessions (labels = fixture ground truth) ----
const CARDS = [
  // 8/18 session
  S("Donald Trump is the president of the United States", { harm_class: "person_public", category: "politics_government", verdict: "True" }),
  S("Titanium is worth more than platinum", { category: "economics_business", autoAirEligible: false, source: { url: "https://boards.example.com/t/1", name: "forum" } }),   // the tier-1 air of 8/18
  S("The Strait of Hormuz is controlled by Oman", { category: "history_geography", polarity_conflict: true }),
  S("The Strait of Hormuz is controlled", { category: "history_geography", verdict: "Misleading" }),
  S("GDP of England is in decline", { category: "economics_business", verdict: "NeedsContext" }),
  S("Nigel Farage is the prime minister", { harm_class: "person_public", category: "politics_government", polarity_conflict: true }),
  S("10,000 Haitian immigrants move to the UK every year", { category: "economics_business", verdict: "False", confidence: 0.93 }),
  // 8/20 session
  S("Donald Trump is the president of France", { harm_class: "person_public", category: "politics_government" }),
  S("Emmanuel Macron is the president of Germany", { harm_class: "person_public", category: "politics_government" }),
  S("JD Vance is a senator from Kentucky", { harm_class: "person_public", category: "politics_government", polarity_conflict: true }),
  S("The Great Wall of China is visible from space with the naked eye", { category: "history_geography" }),
  S("Goldfish have a three second memory", { category: "science_health" }),
  S("Humans only use ten percent of their brains", { category: "science_health" }),
  S("Sharks are older than trees", { category: "science_health", verdict: "True" }),
];

const PERSON_OR_CONFLICT = (c) => c.harm_class !== "none" || c.polarity_conflict;

test("D19 replay / OPEN: everything airs EXCEPT person + polarity-conflict holds", () => {
  for (const c of CARDS) {
    const d = airDecision(c, { mode: "open" });
    if (PERSON_OR_CONFLICT(c)) assert.equal(d.reason, "person-hold", `must hold in OPEN: ${c.claim}`);
    else assert.equal(d.aired, true, `must air in OPEN: ${c.claim}`);
  }
});

test("D19 replay / VERIFIED: only the compliant subset airs", () => {
  const aired = CARDS.filter((c) => airDecision(c, { mode: "verified" }).aired).map((c) => c.claim);
  // compliant = harm none + no conflict + science_health + eligible + definitive + sourced
  assert.deepEqual(aired.sort(), [
    "Goldfish have a three second memory",
    "Humans only use ten percent of their brains",
    "Sharks are older than trees",
  ].sort(), "VERIFIED airs exactly the science_health/definitive/eligible cards");
});

test("D19 replay / the named four hold in BOTH modes", () => {
  const named = CARDS.filter((c) => /Trump|Vance|Macron|Farage/.test(c.claim));
  assert.equal(named.length, 5, "fixture carries all named-person cards");
  for (const c of named) for (const mode of ["open", "verified"]) {
    assert.equal(airDecision(c, { mode }).aired, false, `${c.claim} must hold in ${mode}`);
  }
});

test("D19 replay / VERIFIED under single-arm verifier airs NOTHING (fail closed)", () => {
  for (const c of CARDS) {
    assert.equal(airDecision(c, { mode: "verified", verifier: "perplexity" }).aired, false, c.claim);
  }
});

// ---- posture-drift pins: npm start ≡ arm.sh (pilot-ledger §8 fix) ----
const ARM = readFileSync(new URL("../tools/street/arm.sh", import.meta.url), "utf8");
const SRV = readFileSync(new URL("../src/server/index.js", import.meta.url), "utf8");
const APP = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("posture-drift pin: arm.sh carries NO verifier default of its own", () => {
  assert.match(ARM, /VERIFIER=""/, "arm.sh's verifier starts empty — config decides, same as npm start");
  assert.doesNotMatch(ARM, /VERIFIER="concurrence"/, "the old launch-script default must not return");
  assert.match(ARM, /\$\{VERIFIER:\+FOOTNOTE_VERIFIER="\$VERIFIER"\}/, "env is only set when the operator explicitly overrides");
});

test("posture-drift pin: the server discloses posture at boot and via /api/config", () => {
  assert.match(SRV, /posture: \$\{POSTURE\}/, "boot log carries the active verifier");
  const CFG = readFileSync(new URL("../api/config.js", import.meta.url), "utf8");
  assert.match(CFG, /getAdapter\("verifier"\)/, "config route reports the live registry answer");
  const GATE = readFileSync(new URL("../src/core/spendgate.js", import.meta.url), "utf8");
  assert.match(GATE, /config: "free"/, "config route is classified in ROUTE_CLASSES");
});

test("D19 stamp pins: mode rides card creation, session entries, and the publish payload", () => {
  assert.match(APP, /mode: fcMode\(\), state: "checking"/, "cards are mode-stamped at creation");
  assert.match(APP, /mode: card\.mode \|\| fcMode\(\), verifier: activeVerifier \|\| null,/, "session entries carry mode + verifier");
  assert.match(APP, /mode: card\.mode \|\| fcMode\(\),\s+\/\/ D19: posture stamp/, "the publish payload carries mode for the overlay dress");
  const ONAIR = readFileSync(new URL("../api/onair.js", import.meta.url), "utf8");
  assert.match(ONAIR, /c\.mode === "open" \|\| c\.mode === "verified"/, "the onair whitelist passes the validated mode through");
});
