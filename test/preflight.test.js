// Preflight aggregator contract — the walk-out-the-door GO/NO-GO gate.
//   - GO iff zero FAIL.
//   - WARN is printed but NEVER blocks (a rig full of WARNs still says GO).
//   - any single FAIL flips the whole verdict to NO-GO and lands in `fails`.
// Uses injected check results so the aggregation logic is tested independent of the
// network / filesystem / arm.sh probing that the runner does.
import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  evalRelayHealth,
  evalIngestAuth,
  evalTailscaleServe,
  evalKillSwitch,
  evalObsPreset,
  PASS,
  WARN,
  FAIL,
} from "../tools/street/preflight-checks.js";

const chk = (id, status) => ({ id, name: id, status, reason: `${id} ${status}` });

test("all PASS -> GO", () => {
  const r = aggregate([chk("a", PASS), chk("b", PASS), chk("c", PASS)]);
  assert.equal(r.decision, "GO");
  assert.equal(r.fails.length, 0);
});

test("WARNs are non-blocking -> still GO", () => {
  const r = aggregate([chk("a", PASS), chk("b", WARN), chk("c", WARN)]);
  assert.equal(r.decision, "GO");
  assert.equal(r.warns.length, 2);
  assert.equal(r.fails.length, 0);
});

test("a single FAIL -> NO-GO, and it's in fails", () => {
  const r = aggregate([chk("a", PASS), chk("b", WARN), chk("relay", FAIL)]);
  assert.equal(r.decision, "NO-GO");
  assert.equal(r.fails.length, 1);
  assert.equal(r.fails[0].id, "relay");
  // the WARN still rides along, non-blocking
  assert.equal(r.warns.length, 1);
});

test("multiple FAILs -> NO-GO lists all blockers", () => {
  const r = aggregate([chk("a", FAIL), chk("b", PASS), chk("c", FAIL)]);
  assert.equal(r.decision, "NO-GO");
  assert.deepEqual(r.fails.map((f) => f.id).sort(), ["a", "c"]);
});

test("empty check set -> GO (vacuously; zero FAIL)", () => {
  const r = aggregate([]);
  assert.equal(r.decision, "GO");
});

// ---- a few evaluator-level guards so the reason strings the aggregator counts on
//      actually carry the right status ----------------------------------------------

test("relay health: both services active -> PASS", () => {
  const c = evalRelayHealth({ ok: true, body: '{"srtla_rec":"active","srt_out":"active","uptime_s":123}' });
  assert.equal(c.status, PASS);
});

test("relay health: no answer -> FAIL (blocks)", () => {
  const c = evalRelayHealth({ ok: false, body: "" });
  assert.equal(c.status, FAIL);
});

test("relay health: one service down -> FAIL", () => {
  const c = evalRelayHealth({ ok: true, body: '{"srtla_rec":"active","srt_out":"inactive"}' });
  assert.equal(c.status, FAIL);
});

test("ingest auth: parked/not-applied -> WARN with the branch name", () => {
  const c = evalIngestAuth({ applied: false });
  assert.equal(c.status, WARN);
  assert.match(c.reason, /front door unauthenticated/);
  assert.match(c.reason, /daysprint\/2a-sec-ingest-auth-PARKED/);
});

test("ingest auth: applied -> PASS", () => {
  const c = evalIngestAuth({ applied: true, evidence: "enforced" });
  assert.equal(c.status, PASS);
});

test("tailscale serve: OFF -> FAIL", () => {
  const c = evalTailscaleServe({ serveOn: false, host: "", code: 0 });
  assert.equal(c.status, FAIL);
});

test("tailscale serve: ON + reachable -> PASS", () => {
  const c = evalTailscaleServe({ serveOn: true, host: "h.ts.net", code: 200 });
  assert.equal(c.status, PASS);
});

test("tailscale serve: ON but backend 502 -> WARN (arm.sh will start it)", () => {
  const c = evalTailscaleServe({ serveOn: true, host: "h.ts.net", code: 502 });
  assert.equal(c.status, WARN);
});

test("kill-switch: token present -> PASS and prints the shortcut URL", () => {
  const c = evalKillSwitch({ tokenPresent: true, envPath: ".env.local", shortcutUrl: "http://h/api/admin?token=<ADMIN_TOKEN>&op=kill" });
  assert.equal(c.status, PASS);
  assert.match(c.reason, /op=kill/);
});

test("kill-switch: token missing -> FAIL (blocks — no remote stop)", () => {
  const c = evalKillSwitch({ tokenPresent: false, envPath: ".env.local" });
  assert.equal(c.status, FAIL);
});

test("obs preset: present -> WARN-to-confirm (OBS state isn't readable)", () => {
  const c = evalObsPreset({ presetExists: true, presetPath: "tools/street/obs-audio-preset.md" });
  assert.equal(c.status, WARN);
});

test("obs preset: missing -> FAIL", () => {
  const c = evalObsPreset({ presetExists: false });
  assert.equal(c.status, FAIL);
});
