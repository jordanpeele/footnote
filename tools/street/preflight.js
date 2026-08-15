#!/usr/bin/env node
/* PREFLIGHT — the one command the operator runs before walking out the door.
   Probes every walk-readiness condition and prints a single GO / NO-GO with a
   per-check PASS/WARN/FAIL reason, so the operator on wake sees one answer.

   Usage:  node tools/street/preflight.js
   Exit code: 0 on GO, 1 on NO-GO (so it composes in scripts / a launchd wrapper).

   Read-only by contract: this NEVER starts a server, kills a process, or writes to the
   relay. It curls the relay health endpoint, asks tailscale for its serve state, invokes
   `arm.sh --check` (arm.sh's own dry-run — nothing is armed), and reads a few files.

   The checks (each -> PASS/WARN/FAIL, see tools/street/preflight-checks.js for the rules):
     1 Relay health (:8080, both services)         FAIL if down
     2 Relay ingest auth (parked fix applied?)      WARN if the front door is open
     3 tailscale serve ON + /op reachable
     4 Local server armable (arm.sh --check)
     5 Kill-switch (ADMIN_TOKEN in .env.local)
     6 OBS 120 Hz high-pass preset present          WARN-to-confirm (OBS isn't readable)
     7 R40 keyterms for the route                   WARN-to-fill
     8 Kit (Moblin URL + earbud/wired mic)          WARN reminder
   GO only when zero FAIL. WARN items print but never block. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evalRelayHealth,
  evalIngestAuth,
  evalTailscaleServe,
  evalArmable,
  evalKillSwitch,
  evalObsPreset,
  evalKeyterms,
  evalKit,
  aggregate,
  CONSTANTS,
  PASS,
  WARN,
  FAIL,
} from "./preflight-checks.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TS_BIN = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const RELAY_HEALTH_URL = CONSTANTS.RELAY_HEALTH_URL;
const C = process.stdout.isTTY
  ? { grn: "\x1b[32m", yel: "\x1b[33m", red: "\x1b[31m", b: "\x1b[1m", dim: "\x1b[2m", r: "\x1b[0m" }
  : { grn: "", yel: "", red: "", b: "", dim: "", r: "" };

// Resolve a repo-relative file that may live only in the MAIN worktree (this tool can run
// from an isolated git worktree). Checks here first, then the shared main working tree.
function resolveRepoFile(rel) {
  const here = path.join(REPO_ROOT, rel);
  if (fs.existsSync(here)) return here;
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: REPO_ROOT, encoding: "utf8",
    }).trim();
    const mainRoot = path.dirname(path.resolve(REPO_ROOT, commonDir));
    const there = path.join(mainRoot, rel);
    if (fs.existsSync(there)) return there;
  } catch { /* not a git worktree, or git unavailable */ }
  return null;
}

function curl(url, timeoutS = 6) {
  // Returns { ok, code, body }. Read-only GET. Never throws.
  try {
    const out = execFileSync(
      "curl",
      ["-s", "-m", String(timeoutS), "-w", "\n__HTTP__%{http_code}", url],
      { encoding: "utf8", timeout: (timeoutS + 2) * 1000 }
    );
    const marker = out.lastIndexOf("\n__HTTP__");
    const body = marker >= 0 ? out.slice(0, marker) : out;
    const code = marker >= 0 ? parseInt(out.slice(marker + 9), 10) || 0 : 0;
    return { ok: code > 0, code, body: body.trim() };
  } catch (e) {
    // curl exits nonzero on timeout/refused; recover whatever partial stdout exists.
    const out = (e.stdout || "").toString();
    const marker = out.lastIndexOf("\n__HTTP__");
    const body = marker >= 0 ? out.slice(0, marker).trim() : "";
    const code = marker >= 0 ? parseInt(out.slice(marker + 9), 10) || 0 : 0;
    return { ok: code > 0, code, body };
  }
}

function tailscale(args) {
  try {
    return execFileSync(TS_BIN, args, { encoding: "utf8", timeout: 8000 });
  } catch (e) {
    return (e.stdout || "").toString();
  }
}

// ---- gather real facts ----------------------------------------------------------------

function gatherRelayHealth() {
  const { ok, body } = curl(RELAY_HEALTH_URL, 6);
  return { ok, body };
}

function gatherIngestAuth() {
  // Source of truth for whether the parked passphrase fix has been applied to the LIVE
  // relay is the packet-2a-sec handoff. It records the fix as committed-but-NOT-applied
  // (the vulnerable config is still live). If a future apply flips a marker in that doc
  // (or a sibling APPLIED note appears), detect it here; otherwise report unauthenticated.
  // A dedicated *-APPLIED attestation is authoritative — it records a verified apply to
  // the live relay and is written ONLY after verify-ingest-auth.sh passes. Check it first.
  const appliedPath = resolveRepoFile("daysprint/handoffs/daysprint-handoff-2a-sec-APPLIED.md");
  if (appliedPath && /verify-ingest-auth\.sh:\s*6\/6\s*PASS/i.test(fs.readFileSync(appliedPath, "utf8"))) {
    return { applied: true, evidence: "per daysprint-handoff-2a-sec-APPLIED.md (verify 6/6 PASS)" };
  }
  const notePath = resolveRepoFile("daysprint/handoffs/daysprint-handoff-2a-sec.md");
  if (!notePath) {
    return { applied: false, evidence: "no packet-2a-sec handoff found; assume unauthenticated" };
  }
  const text = fs.readFileSync(notePath, "utf8");
  // An explicit "APPLIED" attestation to the live relay is the only positive signal.
  const appliedSignal =
    /applied to the live relay|APPLIED[:\s].*live relay|live relay.*APPLIED|now enforced on the (live )?relay/i.test(text) &&
    !/NOT\s+applied to the live relay/i.test(text);
  if (appliedSignal) {
    return { applied: true, evidence: `per ${path.basename(notePath)}` };
  }
  return {
    applied: false,
    evidence: "committed but NOT applied; vulnerable config still live per packet-2a-sec handoff",
  };
}

function gatherTailscaleServe() {
  const serveStatus = tailscale(["serve", "status"]);
  const serveOn = /:3000|127\.0\.0\.1:3000|proxy http:\/\/127\.0\.0\.1:3000/.test(serveStatus);
  // Host from serve status ("https://<host> (tailnet only)") falling back to status --json.
  let host = "";
  const m = /https:\/\/([^\s/]+)/.exec(serveStatus);
  if (m) host = m[1];
  if (!host) {
    const statusJson = tailscale(["status", "--json"]);
    try {
      const s = JSON.parse(statusJson);
      host = ((s.Self && s.Self.DNSName) || "").replace(/\.$/, "");
    } catch { /* leave empty */ }
  }
  let code = 0;
  if (serveOn && host) code = curl(`https://${host}/op`, 6).code;
  return { serveOn, host, code };
}

function gatherArmable() {
  const armSh = path.join(REPO_ROOT, "tools/street/arm.sh");
  const armShExists = fs.existsSync(armSh);
  if (!armShExists) return { armShExists: false, checkRan: false, exitCode: -1, output: "" };
  try {
    const output = execFileSync("bash", [armSh, "--check"], {
      cwd: REPO_ROOT, encoding: "utf8", timeout: 30000,
    });
    return { armShExists: true, checkRan: true, exitCode: 0, output };
  } catch (e) {
    return {
      armShExists: true,
      checkRan: true,
      exitCode: e.status == null ? 1 : e.status,
      output: (e.stdout || "").toString(),
    };
  }
}

function gatherKillSwitch() {
  // ADMIN_TOKEN lives in the MAIN-tree .env.local (never committed; not in the worktree).
  const envPath = resolveRepoFile(".env.local");
  if (!envPath) return { tokenPresent: false, envPath: ".env.local (not found)", shortcutUrl: shortcutUrl(null) };
  let tokenPresent = false;
  try {
    const text = fs.readFileSync(envPath, "utf8");
    const m = /^ADMIN_TOKEN=(.*)$/m.exec(text);
    tokenPresent = !!(m && m[1].trim().length > 0);
  } catch { /* unreadable */ }
  // Prefer the real tailnet host in the printed Shortcut URL so it's copy-ready.
  const host = gatherServeHostCached();
  return { tokenPresent, envPath: prettyPath(envPath), shortcutUrl: shortcutUrl(host) };
}

let _cachedHost;
function gatherServeHostCached() {
  if (_cachedHost !== undefined) return _cachedHost;
  const statusJson = tailscale(["status", "--json"]);
  try {
    const s = JSON.parse(statusJson);
    _cachedHost = ((s.Self && s.Self.DNSName) || "").replace(/\.$/, "") || null;
  } catch { _cachedHost = null; }
  return _cachedHost;
}

function shortcutUrl(host) {
  const h = host || "<mac-tailnet-host>";
  return `http://${h}/api/admin?token=<ADMIN_TOKEN>&op=kill`;
}

function gatherObsPreset() {
  const p = resolveRepoFile("tools/street/obs-audio-preset.md");
  return { presetExists: !!p, presetPath: p ? prettyPath(p) : null };
}

function prettyPath(abs) {
  const rel = path.relative(REPO_ROOT, abs);
  return rel.startsWith("..") ? abs : rel;
}

// ---- run ------------------------------------------------------------------------------

function runChecks() {
  return [
    evalRelayHealth(gatherRelayHealth()),
    evalIngestAuth(gatherIngestAuth()),
    evalTailscaleServe(gatherTailscaleServe()),
    evalArmable(gatherArmable()),
    evalKillSwitch(gatherKillSwitch()),
    evalObsPreset(gatherObsPreset()),
    evalKeyterms(),
    evalKit(),
  ];
}

function color(status) {
  if (status === PASS) return C.grn;
  if (status === WARN) return C.yel;
  return C.red;
}

function print(result) {
  const { decision, checks, fails, warns } = result;
  const width = 74;
  console.log("");
  console.log(`${C.b}FOOTNOTE PREFLIGHT${C.r} ${C.dim}· ${new Date().toISOString()}${C.r}`);
  console.log("─".repeat(width));
  for (const c of checks) {
    const tag = `${color(c.status)}${c.status.padEnd(4)}${C.r}`;
    console.log(`${tag}  ${C.b}${c.name}${C.r}`);
    console.log(`      ${C.dim}${c.reason}${C.r}`);
  }
  console.log("─".repeat(width));
  const verdictColor = decision === "GO" ? C.grn : C.red;
  console.log(`${C.b}${verdictColor}=== ${decision} ===${C.r}`);
  if (decision === "NO-GO") {
    console.log(`${C.red}Blocking (fix before walking):${C.r}`);
    for (const f of fails) console.log(`  ${C.red}✗${C.r} ${f.name}: ${f.reason}`);
  } else {
    console.log(`${C.grn}Zero FAIL — clear to walk.${C.r}`);
  }
  if (warns.length) {
    console.log(`${C.yel}Confirm (non-blocking):${C.r}`);
    for (const w of warns) console.log(`  ${C.yel}!${C.r} ${w.name}: ${w.reason}`);
  }
  console.log("");
}

function main() {
  const checks = runChecks();
  const result = aggregate(checks);
  print(result);
  process.exit(result.decision === "GO" ? 0 : 1);
}

// Only run when invoked directly (so tests can import preflight-checks without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { runChecks, resolveRepoFile };
