// F2/F3 mirror sync — app.js is a classic script (no modules) so it cannot import
// src/core/utterance.js; it carries a copy of the module's MIRROR BLOCK (same pattern
// as prompt-sync.test.js: one intended editing surface, one mirror, a test that fails
// on drift). Both files delimit the block with the same markers; this test extracts
// both blocks and asserts they are byte-identical after normalizing indentation
// (app.js sits two spaces deep inside its IIFE).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "app.js");
const CORE = path.join(ROOT, "src", "core", "utterance.js");

const BEGIN = /\/\* ===== MIRROR BLOCK \(utterance guards\)[^]*?===== \*\//;
const END = "/* ===== END MIRROR BLOCK ===== */";

function mirrorBlock(file) {
  const src = fs.readFileSync(file, "utf8");
  const m = BEGIN.exec(src);
  assert.ok(m, `MIRROR BLOCK begin marker missing in ${path.basename(file)}`);
  const rest = src.slice(m.index + m[0].length);
  const end = rest.indexOf(END);
  assert.ok(end >= 0, `END MIRROR BLOCK marker missing in ${path.basename(file)}`);
  // normalize: strip leading indentation and trailing whitespace per line, drop blanks —
  // everything else (constants, regexes, JSDoc, logic) must match byte-for-byte
  return rest.slice(0, end)
    .split("\n")
    .map((l) => l.replace(/^\s+/, "").replace(/\s+$/, ""))
    .filter((l) => l.length)
    .join("\n");
}

test("app.js mirror block === src/core/utterance.js mirror block (constants, regexes, logic)", () => {
  const core = mirrorBlock(CORE);
  const app = mirrorBlock(APP);
  assert.ok(core.includes("DUP_CLAIM_WINDOW_MS"), "core mirror block lost its constants — markers moved?");
  assert.ok(core.includes("shouldMergeFinals"), "core mirror block lost shouldMergeFinals — markers moved?");
  assert.equal(
    app, core,
    "app.js utterance-guard mirror has drifted from src/core/utterance.js — edit the module, " +
    "then copy the MIRROR BLOCK verbatim into app.js (indentation aside)");
});
