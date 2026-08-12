#!/usr/bin/env node
// R56 (post-pilot-1): session-script linter — validates a session sheet's spoken claims
// against the pipeline's own client-side guards BEFORE anyone reads them into a live mic.
// Born from D18 pilot session 1, where six scripted claims sat under the 6-word fragment
// guard and silently vanished, costing live minutes of confusion.
//
//   node tools/session-lint.js docs/D18_PILOT_SESSION_SCRIPT_2.md
//
// Checks (mirror the guards in app.js checkUtterance — change both together):
//   ERROR  <6 words        → dropped silently as an STT fragment (fragment guard)
//   ERROR  <8 chars        → extract route answers { claim: null } (api/extract.js)
//   ERROR  exact duplicate → consecutive-dupe guard / F2 claim dedupe will eat the repeat
//   WARN   negation token  → polarity path engages (denies / R50 signal); expect a
//                            possible polarity_conflict HOLD — fine if the sheet says so
//   WARN   >280 chars      → far past any real spoken sentence; probably a paste error
// Exit 1 on any ERROR (CI-able); warnings are informational.
//
// Sheet convention (enforced socially, not here): EVERYTHING in double/curly quotes is
// treated as a spoken claim. Quote only what the operator will say; put UI strings and
// log messages in `backticks` so the linter doesn't read them as claims.
import { readFileSync } from "node:fs";

const MIN_WORDS = 6;      // app.js fragment guard
const MIN_CHARS = 8;      // api/extract.js short-text guard
// mirror of hasNegation in app.js (R46) — keep in sync
const NEGATION = /\b(no|not|never|isn't|wasn't|aren't|doesn't|don't|didn't|hasn't|haven't|won't|can't|cannot)\b|n't\b/i;

const file = process.argv[2];
if (!file) { console.error("usage: node tools/session-lint.js <session-sheet.md>"); process.exit(2); }
const text = readFileSync(file, "utf8");

// claims are anything the sheet quotes for the operator to SAY — straight or curly quotes
const claims = [];
const re = /"([^"\n]+)"|“([^”\n]+)”/g;
let m;
const lines = text.split("\n");
lines.forEach((line, i) => {
  re.lastIndex = 0;
  while ((m = re.exec(line))) {
    const q = (m[1] || m[2] || "").trim();
    if (q) claims.push({ q, line: i + 1 });
  }
});

if (!claims.length) { console.error(`${file}: no quoted claims found — nothing to lint`); process.exit(2); }

let errors = 0, warnings = 0;
const seen = new Map();
for (const { q, line } of claims) {
  const words = q.split(/\s+/).filter(Boolean).length;
  const probs = [];
  if (words < MIN_WORDS) { probs.push(`ERROR ${words} words — fragment guard drops finals under ${MIN_WORDS} (silently on old builds)`); errors++; }
  if (q.length < MIN_CHARS) { probs.push(`ERROR ${q.length} chars — extract answers claim:null under ${MIN_CHARS}`); errors++; }
  if (seen.has(q)) { probs.push(`ERROR exact duplicate of line ${seen.get(q)} — the dedupe guards will eat the repeat`); errors++; }
  else seen.set(q, line);
  if (NEGATION.test(q)) { probs.push(`warn  negation token — polarity path engages; a conflict HOLD here is normal, not a failure`); warnings++; }
  if (q.length > 280) { probs.push(`warn  ${q.length} chars — longer than any real spoken sentence`); warnings++; }
  if (probs.length) {
    console.log(`line ${line}: "${q}"`);
    probs.forEach((p) => console.log("   " + p));
  }
}
console.log(`\n${file}: ${claims.length} claims · ${errors} error(s) · ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
