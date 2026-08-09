// Registry perimeter (red-team M2): stub adapters must be unreachable when
// NODE_ENV=production unless ALLOW_STUBS=1 (CI escape hatch), and adapter-selection
// errors must name the env var that caused them so an operator can fix the typo.
// Each case runs getAdapter in a SUBPROCESS with a controlled env — the registry reads
// process.env at call time but adapters may read it at import time, so a fresh process
// is the only airtight isolation (nothing leaks into other tests in this run).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Runs getAdapter(domain) in a child node process; returns "OK <adapterName>" or "ERR <message>".
function resolveInSubprocess(domain, envOverrides) {
  const script = `
    import { getAdapter } from "./src/core/registry.js";
    try { const a = getAdapter(${JSON.stringify(domain)}); console.log("OK " + (a.name || "?")); }
    catch (e) { console.log("ERR " + e.message); }
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    // baseline: neutral env (empty string is falsy for the registry's || default and
    // fails both the NODE_ENV===\"production\" and ALLOW_STUBS===\"1\" comparisons)
    env: {
      ...process.env,
      NODE_ENV: "", ALLOW_STUBS: "",
      FOOTNOTE_EXTRACTOR: "", FOOTNOTE_VERIFIER: "", FOOTNOTE_STT: "", FOOTNOTE_STATE: "",
      ...envOverrides,
    },
  });
  assert.equal(r.status, 0, `subprocess crashed:\n${r.stderr}`);
  return r.stdout.trim();
}

test("prod + stub adapter → throws, names the env var", () => {
  const out = resolveInSubprocess("verifier", { NODE_ENV: "production", FOOTNOTE_VERIFIER: "stub" });
  assert.match(out, /^ERR /);
  assert.match(out, /FOOTNOTE_VERIFIER/, "error must name the env var that selected the stub");
  assert.match(out, /stub adapters are disabled/i);
  assert.match(out, /ALLOW_STUBS/, "error must mention the escape hatch");
});

test("prod + stub + ALLOW_STUBS=1 → resolves (CI escape hatch)", () => {
  const out = resolveInSubprocess("verifier", { NODE_ENV: "production", FOOTNOTE_VERIFIER: "stub", ALLOW_STUBS: "1" });
  assert.match(out, /^OK /, out);
});

test("dev + stub → resolves", () => {
  const out = resolveInSubprocess("stt", { NODE_ENV: "development", FOOTNOTE_STT: "stub" });
  assert.match(out, /^OK /, out);
});

test("unset NODE_ENV + stub → resolves (local dev without NODE_ENV)", () => {
  const out = resolveInSubprocess("extractor", { FOOTNOTE_EXTRACTOR: "stub" });
  assert.match(out, /^OK /, out);
});

test("prod + default adapters → resolves for every domain (guard must not hit real vendors)", () => {
  for (const domain of ["extractor", "verifier", "stt", "state"]) {
    const out = resolveInSubprocess(domain, { NODE_ENV: "production" });
    assert.match(out, /^OK /, `${domain}: ${out}`);
  }
});

test("unknown adapter name → throws with the env var named", () => {
  const out = resolveInSubprocess("state", { FOOTNOTE_STATE: "garbage" });
  assert.match(out, /^ERR /);
  assert.match(out, /"garbage"/, "error must echo the bad value");
  assert.match(out, /FOOTNOTE_STATE/, "error must name the env var that caused it");
  assert.match(out, /have: /, "error must list the valid adapter names");
});
