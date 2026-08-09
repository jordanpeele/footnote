// Env-shadowing warning test (P4-F4, field-test F6). The self-host loader's precedence is
// real environment > .env.local > .env; a stale shell export silently outranks a fresh
// file key. index.js must warn (once per variable) when a known vendor key in the real
// environment DIFFERS from the file's value — and must never print any part of either
// value.
//
// src/server/index.js is deliberately all side effects (loads env, imports api routes,
// binds a port), so we don't import it: we spawn it as a real subprocess with a controlled
// environment and read its startup output. That exercises the actual loader, not a copy.
// The positive case needs the repo's .env.local to define DEEPGRAM_API_KEY — on a clean
// clone (no .env.local) the tests skip rather than fail.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "src", "server", "index.js");

// Same parse the server does (test/credentials.test.js sets the precedent of asserting
// against real files); we only need one key's value, never printed anywhere.
function envLocalValue(key) {
  let text;
  try { text = readFileSync(path.join(ROOT, ".env.local"), "utf8"); } catch { return null; }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1] !== key) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    return v || null;
  }
  return null;
}

// Spawn the server with ONLY the env we pass (plus PORT), capture combined output until
// it either prints its "Footnote up" banner (env loading is long since done by then) or
// exits, then kill it. The shadow warnings print during env load — before listen — so
// even an EADDRINUSE crash can't hide one.
function runServer(extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: ROOT,
      env: { PORT: "3999", ...extraEnv },        // minimal env: no other vendor keys leak in
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const finish = () => { clearTimeout(timer); child.kill("SIGTERM"); resolve(out); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("server never started; output:\n" + out)); }, 15000);
    const onData = (d) => { out += d; if (out.includes("Footnote up")) finish(); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", () => { clearTimeout(timer); resolve(out); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

const fileValue = envLocalValue("DEEPGRAM_API_KEY");

test("shell env shadowing a DIFFERENT .env.local value warns, without leaking either value", { skip: !fileValue && ".env.local doesn't define DEEPGRAM_API_KEY" }, async () => {
  const sentinel = "p4f4-shadow-sentinel-not-a-real-key";
  const out = await runServer({ DEEPGRAM_API_KEY: sentinel });

  const warnings = out.split("\n").filter((l) => l.includes("DIFFERS"));
  assert.equal(warnings.length, 1, "exactly one shadow warning (one per variable):\n" + out);
  assert.match(warnings[0],
    /^note: DEEPGRAM_API_KEY comes from your shell environment and DIFFERS from \.env\.local — the shell value wins\. Unset it \(check ~\/\.zshenv, ~\/\.zshrc\) if you meant the file's value\.$/);

  // No part of either value may appear anywhere in startup output — not the whole
  // string, not a prefix.
  for (const secret of [sentinel, fileValue]) {
    assert.ok(!out.includes(secret), "output leaks a full value");
    assert.ok(!out.includes(secret.slice(0, 6)), "output leaks a value prefix");
  }
});

test("shell env matching the .env.local value stays silent (warning is difference-gated)", { skip: !fileValue && ".env.local doesn't define DEEPGRAM_API_KEY" }, async () => {
  const out = await runServer({ DEEPGRAM_API_KEY: fileValue });
  assert.ok(!out.includes("DIFFERS"), "no warning when values are identical:\n" + out.replaceAll(fileValue, "<redacted>"));
  assert.ok(!out.includes(fileValue), "output leaks the value");
});
