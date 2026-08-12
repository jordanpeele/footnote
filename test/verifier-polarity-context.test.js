// R50 fold-in tests: brave-claude's independent polarity emission + concurrence's
// polarity-disagreement downgrade. node:test, zero deps, fetch stubbed — no network.
//
// brave-claude — what must hold:
//   1. with ctx.utterance: the SAME step-2 Claude call carries VERDICT_PROMPT +
//      POLARITY_ADDENDUM and a "Speaker said:" line (one call, no extra spend), and the
//      parsed speaker_polarity comes back as `independent_polarity` (strictly normalized,
//      null on garble);
//   2. WITHOUT ctx.utterance: wire payload byte-identical to pre-R50 (system is exactly
//      VERDICT_PROMPT, no Speaker line) and NO independent_polarity key on the result.
//
// concurrence — what must hold (truth-table extension):
//   3. both arms read polarity and AGREE (and match ctx.claimedPolarity) → no change to
//      the verdict merge;
//   4. arm-vs-arm polarity disagreement → downgrades exactly like verdict disagreement:
//      definitive merged verdict → NeedsContext, eligibility stripped, conflict flagged,
//      confidence damped;
//   5. arms agree with each other but contradict ctx.claimedPolarity → same downgrade
//      (this is the mirror-class catch: the SHARED extractor mislabeled the polarity);
//   6. suspect_denies normalizes to denies for the claimed comparison;
//   7. one arm without a polarity read (e.g. perplexity) → extension inert: polarity note
//      null, merge unchanged (no signal is never treated as disagreement).
import test from "node:test";
import assert from "node:assert/strict";

import { verify as braveClaudeVerify, VERDICT_PROMPT, POLARITY_ADDENDUM } from "../src/adapters/verifier/brave-claude/index.js";
import { verify as concurrenceVerify } from "../src/adapters/verifier/concurrence/index.js";

const BRAVE_HOST = "api.search.brave.com";
const ANTHROPIC_HOST = "api.anthropic.com";
const PPLX_HOST = "api.perplexity.ai";

const braveOk = () => ({
  ok: true,
  json: async () => ({ web: { results: [{ title: "T", description: "D", url: "https://www.reuters.com/x" }] } }),
});
const claudeOk = (obj) => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify(obj) }] }),
});
const pplxOk = (verdict) => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify({ verdict, correction: "c", confidence: 0.95, source_name: "Reuters" }) } }],
    citations: ["https://www.reuters.com/p"],
  }),
});

// ---- brave-claude fold-in ----------------------------------------------------------------

test("brave-claude with ctx.utterance: addendum on the system prompt, Speaker line in the user turn, polarity returned", async () => {
  const captured = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(BRAVE_HOST)) return braveOk();
    if (u.includes(ANTHROPIC_HOST)) {
      captured.push(JSON.parse(opts.body));
      return claudeOk({ verdict: "True", correction: "c", confidence: 0.9, source_name: "Reuters", speaker_polarity: "denies" });
    }
    throw new Error("unexpected url: " + u);
  };
  try {
    const out = await braveClaudeVerify("The claim.", { utterance: "he never said that", claimedPolarity: "asserts" }, null);
    assert.equal(captured.length, 1, "polarity rides the SAME verdict call — no extra spend");
    assert.equal(captured[0].system, VERDICT_PROMPT + POLARITY_ADDENDUM);
    assert.ok(captured[0].messages[0].content.includes("Speaker said: he never said that"));
    assert.ok(captured[0].messages[0].content.startsWith("Claim: The claim."));
    assert.equal(out.independent_polarity, "denies");
    assert.equal(out.verdict, "True", "verdict untouched by the polarity read (flip stays above the interface, D5)");
  } finally { globalThis.fetch = real; }
});

test("brave-claude: garbled/missing speaker_polarity normalizes to null (fail-safe)", async () => {
  const real = globalThis.fetch;
  let reply = { verdict: "True", speaker_polarity: "definitely-asserting" };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes(BRAVE_HOST)) return braveOk();
    if (u.includes(ANTHROPIC_HOST)) return claudeOk(reply);
    throw new Error("unexpected url: " + u);
  };
  try {
    let out = await braveClaudeVerify("c", { utterance: "words" }, null);
    assert.equal(out.independent_polarity, null);
    reply = { verdict: "True" };   // field absent entirely
    out = await braveClaudeVerify("c", { utterance: "words" }, null);
    assert.equal(out.independent_polarity, null);
    reply = { verdict: "True", speaker_polarity: " ASSERTS " };   // case/space tolerated
    out = await braveClaudeVerify("c", { utterance: "words" }, null);
    assert.equal(out.independent_polarity, "asserts");
  } finally { globalThis.fetch = real; }
});

test("brave-claude WITHOUT ctx.utterance: wire payload and result shape byte-identical to pre-R50", async () => {
  const captured = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes(BRAVE_HOST)) return braveOk();
    if (u.includes(ANTHROPIC_HOST)) {
      captured.push(JSON.parse(opts.body));
      return claudeOk({ verdict: "True", correction: "c", confidence: 0.9, source_name: "Reuters" });
    }
    throw new Error("unexpected url: " + u);
  };
  try {
    for (const ctx of [{}, undefined, { claimedPolarity: "asserts" }]) {
      const out = await braveClaudeVerify("The claim.", ctx, null);
      assert.ok(!("independent_polarity" in out), "no additive field without an utterance");
    }
    for (const body of captured) {
      assert.equal(body.system, VERDICT_PROMPT, "system prompt exactly the pre-R50 payload");
      assert.ok(!body.messages[0].content.includes("Speaker said:"));
    }
  } finally { globalThis.fetch = real; }
});

// ---- concurrence polarity-disagreement downgrade -----------------------------------------
// Both engines set to brave-claude so BOTH arms emit independent_polarity; the stub hands
// each successive Claude call its own scripted speaker_polarity.

function stubBothBraveClaude(polarities, verdict = "True") {
  let claudeCall = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes(BRAVE_HOST)) return braveOk();
    if (u.includes(ANTHROPIC_HOST)) {
      const sp = polarities[Math.min(claudeCall++, polarities.length - 1)];
      return claudeOk({ verdict, correction: "c", confidence: 0.9, source_name: "Reuters", speaker_polarity: sp });
    }
    throw new Error("unexpected url: " + u);
  };
  return () => { globalThis.fetch = real; };
}

function withEngines(a, b, fn) {
  const prevA = process.env.FOOTNOTE_CONCURRENCE_A;
  const prevB = process.env.FOOTNOTE_CONCURRENCE_B;
  process.env.FOOTNOTE_CONCURRENCE_A = a;
  process.env.FOOTNOTE_CONCURRENCE_B = b;
  return fn().finally(() => {
    if (prevA === undefined) delete process.env.FOOTNOTE_CONCURRENCE_A; else process.env.FOOTNOTE_CONCURRENCE_A = prevA;
    if (prevB === undefined) delete process.env.FOOTNOTE_CONCURRENCE_B; else process.env.FOOTNOTE_CONCURRENCE_B = prevB;
  });
}

test("concurrence: both arms agree on polarity AND match claimed → verdict merge unchanged, still eligible", () =>
  withEngines("brave-claude", "brave-claude", async () => {
    const restore = stubBothBraveClaude(["denies", "denies"], "False");
    try {
      const out = await concurrenceVerify("The claim.", { utterance: "he never said it", claimedPolarity: "denies" }, null);
      assert.equal(out.verdict, "False");
      assert.equal(out.concurrence.eligible, true, "polarity agreement leaves definitive concurrence eligible");
      assert.equal(out.concurrence.conflict, false);
      assert.deepEqual(out.concurrence.polarity, { a: "denies", b: "denies", claimed: "denies", conflict: false });
    } finally { restore(); }
  }));

test("concurrence: arm-vs-arm polarity disagreement → NeedsContext, eligibility stripped, conflict, damped confidence", () =>
  withEngines("brave-claude", "brave-claude", async () => {
    const restore = stubBothBraveClaude(["asserts", "denies"], "True");
    try {
      const out = await concurrenceVerify("The claim.", { utterance: "words", claimedPolarity: "asserts" }, null);
      assert.equal(out.verdict, "NeedsContext", "definitive verdict downgraded exactly like a verdict disagreement");
      assert.equal(out.concurrence.eligible, false);
      assert.equal(out.concurrence.conflict, true);
      assert.equal(out.concurrence.polarity.conflict, true);
      // both arms carried confidence 0.9 → min 0.9, damped ×0.5 on the downgrade path
      assert.equal(out.confidence, 0.45, "a polarity-conflicted card never rides in above the confidence floor");
      // the arms' reads are surfaced (order between arms is not asserted — both engines
      // are the same adapter here, so a/b attribution is scheduling-dependent)
      assert.deepEqual([out.concurrence.polarity.a, out.concurrence.polarity.b].sort(), ["asserts", "denies"]);
    } finally { restore(); }
  }));

test("concurrence: arms agree with each other but CONTRADICT the extractor's claimed polarity → same downgrade (mirror-class catch)", () =>
  withEngines("brave-claude", "brave-claude", async () => {
    const restore = stubBothBraveClaude(["denies", "denies"], "True");
    try {
      const out = await concurrenceVerify("The claim.", { utterance: "that never happened", claimedPolarity: "asserts" }, null);
      assert.equal(out.verdict, "NeedsContext");
      assert.equal(out.concurrence.eligible, false);
      assert.equal(out.concurrence.conflict, true);
      assert.deepEqual(out.concurrence.polarity, { a: "denies", b: "denies", claimed: "asserts", conflict: true });
    } finally { restore(); }
  }));

test("concurrence: suspect_denies compares as denies for the claimed reference", () =>
  withEngines("brave-claude", "brave-claude", async () => {
    const restore = stubBothBraveClaude(["denies", "denies"], "False");
    try {
      const out = await concurrenceVerify("The claim.", { utterance: "words", claimedPolarity: "suspect_denies" }, null);
      assert.equal(out.concurrence.polarity.conflict, false, "suspect_denies→denies agrees with both arms");
      assert.equal(out.verdict, "False");
      assert.equal(out.concurrence.eligible, true);
    } finally { restore(); }
  }));

test("concurrence: one arm without a polarity read (perplexity) → extension inert, note null, merge unchanged", () =>
  withEngines("perplexity", "brave-claude", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes(PPLX_HOST)) return pplxOk("True");
      if (u.includes(BRAVE_HOST)) return braveOk();
      if (u.includes(ANTHROPIC_HOST)) return claudeOk({ verdict: "True", correction: "c", confidence: 0.9, source_name: "Reuters", speaker_polarity: "denies" });
      throw new Error("unexpected url: " + u);
    };
    try {
      const out = await concurrenceVerify("The claim.", { utterance: "words", claimedPolarity: "asserts" }, null);
      assert.equal(out.verdict, "True", "no signal from one arm never counts as disagreement");
      assert.equal(out.concurrence.eligible, true);
      assert.equal(out.concurrence.polarity, null);
    } finally { globalThis.fetch = real; }
  }));

test("concurrence: no ctx at all → pre-R50 behavior, polarity note null", () =>
  withEngines("brave-claude", "brave-claude", async () => {
    const restore = stubBothBraveClaude([undefined, undefined], "True");
    try {
      const out = await concurrenceVerify("The claim.", {}, null);
      assert.equal(out.verdict, "True");
      assert.equal(out.concurrence.eligible, true);
      assert.equal(out.concurrence.polarity, null);
    } finally { restore(); }
  }));
