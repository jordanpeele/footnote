// Red-team M7: prompts/extractor.md (the versioned, intended editing surface) and the
// inlined FALLBACK_PROMPT in the anthropic-haiku extractor adapter must stay in sync
// verbatim — the fallback exists precisely for the bundling-miss case, where drift would
// silently revert prod extraction to a stale prompt with no signal beyond a server log.
//
// FALLBACK_PROMPT is a named export (R14) — compare the real runtime value directly.
// (This test used to cook the template literal out of the adapter's source text; the
// export made that scraper unnecessary.)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK_PROMPT } from "../src/adapters/extractor/anthropic-haiku/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_MD = path.join(ROOT, "prompts", "extractor.md");

test("prompts/extractor.md body === adapter FALLBACK_PROMPT (verbatim)", () => {
  // Mirror the adapter's loadPrompt() exactly: strip the leading <!-- version comment -->, trim.
  const mdBody = fs.readFileSync(PROMPT_MD, "utf8").replace(/^\s*<!--[\s\S]*?-->/, "").trim();
  assert.ok(mdBody.length > 0, "prompts/extractor.md body is empty");

  assert.equal(
    FALLBACK_PROMPT, mdBody,
    "FALLBACK_PROMPT has drifted from prompts/extractor.md BODY — they must be byte-identical " +
    "(edit the .md, then copy the body verbatim into the adapter's FALLBACK_PROMPT)"
  );
});
