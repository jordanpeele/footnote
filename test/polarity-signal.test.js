// Independent polarity signal (R50, mirror-class guard). node:test, zero deps, fetch
// stubbed — no network. What must hold:
//   1. wire payload: one Haiku call (claude-haiku-4-5-20251001), temperature 0, small
//      max_tokens, SIGNAL_PROMPT verbatim as system, the raw utterance verbatim as the
//      only user message;
//   2. strict output parsing: exactly ASSERTS / DENIES (case-insensitive, tolerating only
//      whitespace + trailing sentence punctuation) — everything else is null;
//   3. FAIL-SAFE null: empty utterance (no fetch at all), vendor non-2xx, network throw,
//      malformed body, UNCLEAR — all null, never a throw, never a forced hold;
//   4. credentials per-call (R8): credentials?.anthropicKey || env, no env mutation;
//   5. signalDisagrees: the comparison table incl. suspect_denies→denies normalization
//      and the absent-claimed=asserts convention.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  independentPolarity,
  parseSignal,
  signalDisagrees,
  SIGNAL_PROMPT,
  SIGNAL_MODEL,
  SIGNAL_MAX_TOKENS,
} from "../src/core/polarity-signal.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ok = (text) => ({ ok: true, json: async () => ({ content: [{ type: "text", text }] }) });

function stub(response) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (typeof response === "function") return response();
    return response;
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("wire payload: Haiku model, temperature 0, capped tokens, SIGNAL_PROMPT system, utterance verbatim", async () => {
  const { calls, restore } = stub(ok("DENIES"));
  try {
    const out = await independentPolarity("Nixon didn't finish his second term.", null);
    assert.equal(out, "denies");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("api.anthropic.com/v1/messages"));
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.model, SIGNAL_MODEL);
    assert.equal(body.model, "claude-haiku-4-5-20251001");
    assert.equal(body.temperature, 0);
    assert.equal(body.max_tokens, SIGNAL_MAX_TOKENS);
    assert.ok(body.max_tokens <= 50, "the signal is a ~50-output-token call, not an essay");
    assert.equal(body.system, SIGNAL_PROMPT);
    assert.deepEqual(body.messages, [{ role: "user", content: "Nixon didn't finish his second term." }]);
    // independence from the extractor: the canonical claim is never in the payload —
    // the signal sees ONLY the speaker's words (the single user message asserted above).
    assert.equal(body.messages.length, 1);
    assert.ok(!body.messages[0].content.includes("Claim:"), "no canonical claim rides along");
  } finally { restore(); }
});

test("strict parsing: the two literals in any case/whitespace, trailing punctuation tolerated", () => {
  assert.equal(parseSignal("ASSERTS"), "asserts");
  assert.equal(parseSignal("  asserts \n"), "asserts");
  assert.equal(parseSignal("Denies."), "denies");
  assert.equal(parseSignal("DENIES!"), "denies");
});

test("strict parsing: anything else is null — UNCLEAR, prose, explained answers, empties", () => {
  assert.equal(parseSignal("UNCLEAR"), null);
  assert.equal(parseSignal("The speaker asserts the claim."), null);
  assert.equal(parseSignal("DENIES — because the speaker says 'never'"), null);
  assert.equal(parseSignal("asserts denies"), null);
  assert.equal(parseSignal(""), null);
  assert.equal(parseSignal(null), null);
  assert.equal(parseSignal(undefined), null);
});

test("fail-safe: empty/whitespace/non-string utterance → null WITHOUT any fetch", async () => {
  const { calls, restore } = stub(ok("ASSERTS"));
  try {
    assert.equal(await independentPolarity(""), null);
    assert.equal(await independentPolarity("   "), null);
    assert.equal(await independentPolarity(null), null);
    assert.equal(await independentPolarity(undefined), null);
    assert.equal(await independentPolarity(42), null);
    assert.equal(calls.length, 0, "no spend on an empty signal input");
  } finally { restore(); }
});

test("fail-safe: vendor non-2xx → null, no throw", async () => {
  const { restore } = stub({ ok: false, status: 529, text: async () => "overloaded" });
  try {
    assert.equal(await independentPolarity("some words"), null);
  } finally { restore(); }
});

test("fail-safe: network throw → null, no throw", async () => {
  const { restore } = stub(() => { throw new Error("ECONNRESET"); });
  try {
    assert.equal(await independentPolarity("some words"), null);
  } finally { restore(); }
});

test("fail-safe: malformed vendor body (json() throws / no content) → null", async () => {
  const { restore } = stub({ ok: true, json: async () => { throw new Error("bad json"); } });
  try {
    assert.equal(await independentPolarity("some words"), null);
  } finally { restore(); }
  const { restore: r2 } = stub({ ok: true, json: async () => ({ nope: true }) });
  try {
    assert.equal(await independentPolarity("some words"), null);
  } finally { r2(); }
});

test("multi-block responses concatenate text blocks (thinking blocks can't hide the word)", async () => {
  const { restore } = stub({
    ok: true,
    json: async () => ({ content: [{ type: "thinking" }, { type: "text", text: "ASS" }, { type: "text", text: "ERTS" }] }),
  });
  try {
    assert.equal(await independentPolarity("words"), "asserts");
  } finally { restore(); }
});

test("credentials per-call (R8): anthropicKey when provided, env default otherwise", async () => {
  process.env.ANTHROPIC_API_KEY = "ENV_KEY";
  const { calls, restore } = stub(ok("ASSERTS"));
  try {
    await independentPolarity("words", { anthropicKey: "ROOM_KEY" });
    await independentPolarity("words", null);
    assert.equal(calls[0].opts.headers["x-api-key"], "ROOM_KEY");
    assert.equal(calls[1].opts.headers["x-api-key"], "ENV_KEY");
  } finally { restore(); }
});

test("R8 static: the signal module never assigns to process.env", () => {
  const src = readFileSync(path.join(ROOT, "src/core/polarity-signal.js"), "utf8");
  assert.doesNotMatch(src, /process\.env\.[A-Z_]+\s*=(?!=)/, "env assignment in the credential path");
  assert.doesNotMatch(src, /process\.env\[[^\]]+\]\s*=(?!=)/, "computed env assignment");
});

test("signalDisagrees: the comparison table", () => {
  // real disagreement — the mirror class (signal denies, extractor claimed asserts)
  assert.equal(signalDisagrees("denies", "asserts"), true);
  assert.equal(signalDisagrees("denies", undefined), true, "absent claimed = asserts (applyPolarity convention)");
  assert.equal(signalDisagrees("denies", null), true);
  assert.equal(signalDisagrees("denies", ""), true);
  // the FS-8 direction (signal asserts, extractor claimed denies)
  assert.equal(signalDisagrees("asserts", "denies"), true);
  // agreement
  assert.equal(signalDisagrees("asserts", "asserts"), false);
  assert.equal(signalDisagrees("denies", "denies"), false);
  assert.equal(signalDisagrees("asserts", undefined), false);
  assert.equal(signalDisagrees("asserts", "ASSERTS "), false, "claimed is normalized");
  // suspect_denies (R46 rewrite) compares as denies
  assert.equal(signalDisagrees("denies", "suspect_denies"), false);
  assert.equal(signalDisagrees("asserts", "suspect_denies"), true);
  // null signal NEVER disagrees — fail-safe
  assert.equal(signalDisagrees(null, "asserts"), false);
  assert.equal(signalDisagrees(null, "denies"), false);
  assert.equal(signalDisagrees(undefined, "denies"), false);
  // malformed claimed polarity is applyPolarity's tripwire, not ours — never disagree
  assert.equal(signalDisagrees("asserts", "negates"), false);
  assert.equal(signalDisagrees("denies", "negates"), false);
});
