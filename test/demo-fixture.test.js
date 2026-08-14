// DEMO MODE (packet G4) — fixture contract + privacy regression + boot smoke test.
//   - tools/demo/fixture.json parses; every card carries the required fields with the
//     real verdict vocabulary (src/core/editorial.js VERDICTS is the single source).
//   - privacy: neither the fixture nor tools/demo/run.js may contain tailnet addresses,
//     home paths, personal identifiers, or key-shaped strings — the demo ships in the
//     public repo and replays PUBLIC field data only.
//   - FS-1 regression: the four-minute-mile card must display the speaker's framing
//     (negation intact) with the verdict of the claim AS SPOKEN.
//   - smoke: boot tools/demo/run.js on an ephemeral port range, poll the real overlay
//     GET until a card lands, exercise op:"queue-read" with the demo key, kill it.
//     Skips gracefully when no port can be had.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VERDICTS } from "../src/core/editorial.js";
import { hasNegation } from "../src/core/utterance.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = path.join(ROOT, "tools", "demo", "fixture.json");
const RUN_PATH = path.join(ROOT, "tools", "demo", "run.js");
const fixtureRaw = fs.readFileSync(FIXTURE_PATH, "utf8");
const fixture = JSON.parse(fixtureRaw);

test("demo fixture: parses, room is 'demo', modest card count", () => {
  assert.equal(fixture.room, "demo");   // no real room ids in the public fixture
  assert.ok(Array.isArray(fixture.cards));
  assert.ok(fixture.cards.length >= 6 && fixture.cards.length <= 20,
    `modest set expected (got ${fixture.cards.length})`);
});

test("demo fixture: every card has the required fields and valid verdict", () => {
  for (const c of fixture.cards) {
    const tag = JSON.stringify(c.claim);
    assert.ok(typeof c.claim === "string" && c.claim.trim() && c.claim.length <= 300, `claim ${tag}`);
    assert.ok(typeof c.canonical === "string" && c.canonical.trim(), `canonical ${tag}`);
    assert.ok(VERDICTS.includes(c.verdict), `verdict vocabulary: ${c.verdict} ${tag}`);
    assert.ok(typeof c.correction === "string" && c.correction.trim(), `correction ${tag}`);
    assert.ok(c.confidence === null || (typeof c.confidence === "number" && c.confidence >= 0 && c.confidence <= 1), `confidence ${tag}`);
    assert.ok(["quote_attribution", "person_private", "person_public", "none"].includes(c.harm_class), `harm_class ${tag}`);
    // source: {name,url,tier} — null allowed only for Unverifiable (no qualifying source is the point)
    if (c.source === null) {
      assert.equal(c.verdict, "Unverifiable", `null source only on Unverifiable ${tag}`);
    } else {
      assert.ok(typeof c.source.name === "string" && c.source.name.trim(), `source.name ${tag}`);
      assert.ok(/^https:\/\//.test(c.source.url), `source.url https ${tag}`);
      assert.ok(Number.isInteger(c.source.tier) && c.source.tier >= 0 && c.source.tier <= 3, `source.tier ${tag}`);
    }
    assert.ok(Array.isArray(c.citations), `citations array ${tag}`);
    for (const u of c.citations) assert.ok(/^https?:\/\//.test(u), `citation url ${tag}: ${u}`);
    if (c.source !== null) assert.ok(c.citations.length >= 1, `sourced card needs >=1 citation ${tag}`);
  }
});

test("demo fixture: demo.mode vocabulary + era annotations", () => {
  const MODES = ["operator", "auto", "testair", "hold", "skip"];
  for (const c of fixture.cards) {
    if (c.demo === undefined) continue;   // absent → operator default in run.js
    assert.ok(MODES.includes(c.demo.mode), `demo.mode ${c.demo.mode} for ${c.claim}`);
    assert.ok(typeof c.demo.era === "string" && c.demo.era.trim(), `demo.era for ${c.claim}`);
  }
});

test("demo fixture: covers the pilot eras (AUTO science, D17 denial, person-hold, TESTAIR)", () => {
  // ≥1 AUTO machine-aired science card, D18-eligible on the demo's own gate
  // (harm none, conf ≥ 0.9, tier 3, definitive verdict) — session-1 style
  const autos = fixture.cards.filter((c) => c.demo && c.demo.mode === "auto");
  assert.ok(autos.length >= 1, "needs an AUTO machine-aired card");
  for (const c of autos) {
    assert.equal(c.harm_class, "none", `auto card must be harm none: ${c.claim}`);
    assert.ok(c.confidence >= 0.9, `auto card conf >= 0.9: ${c.claim}`);
    assert.equal(c.source.tier, 3, `auto card tier 3: ${c.claim}`);
    assert.ok(c.verdict === "True" || c.verdict === "False", `auto card definitive verdict: ${c.claim}`);
  }
  // ≥1 denial with D17 speaker framing among the machine airs: displayed claim keeps
  // the speaker's negation, canonical is the positive form (the polarity-applied case)
  const denial = autos.find((c) => hasNegation(c.claim) && !hasNegation(c.canonical));
  assert.ok(denial, "needs a machine-aired denial with D17 speaker framing");
  assert.notEqual(denial.claim, denial.canonical, "denial display ≠ canonical");
  // ≥1 person-hold — the MANUAL tag card the machine may never air (D4)
  const hold = fixture.cards.find((c) => c.demo && c.demo.mode === "hold");
  assert.ok(hold, "needs a person-hold card");
  assert.ok(hold.harm_class === "person_public" || hold.harm_class === "person_private",
    "hold card carries a person harm_class (that's what draws the MANUAL tag)");
  // ≥1 TESTAIR-watermarked card (PASS-2 era)
  assert.ok(fixture.cards.some((c) => c.demo && c.demo.mode === "testair"), "needs a TESTAIR card");
});

test("demo fixture: spans the verdict palette", () => {
  const verdicts = new Set(fixture.cards.map((c) => c.verdict));
  assert.ok(verdicts.has("True"), "needs a True card");
  assert.ok(verdicts.has("False"), "needs a False card");
  assert.ok(verdicts.has("NeedsContext"), "needs a NeedsContext card");
  assert.ok(verdicts.has("Unverifiable"), "needs an Unverifiable card");
});

test("demo fixture: FS-1 shown correctly — four-minute-mile card keeps spoken framing", () => {
  const card = fixture.cards.find((c) => /mile faster than four minutes/i.test(c.canonical));
  assert.ok(card, "four-minute-mile card present");
  assert.ok(hasNegation(card.claim), "displayed claim must keep the speaker's negation");
  assert.equal(card.verdict, "True", "verdict is of the claim AS SPOKEN");
  assert.notEqual(card.claim, card.canonical, "display ≠ canonical (that gap WAS the FS-1 bug)");
});

test("demo privacy regression: no tailnet/home-path/key strings in fixture or run.js", () => {
  const runRaw = fs.readFileSync(RUN_PATH, "utf8");
  for (const [name, text] of [["fixture.json", fixtureRaw], ["run.js", runRaw]]) {
    assert.ok(!/\/Users\/[a-z]/i.test(text), `${name}: home path`);
    assert.ok(!/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+/.test(text), `${name}: tailnet CGNAT address`);
    assert.ok(!/\.ts\.net/i.test(text), `${name}: tailnet hostname`);
    assert.ok(!/tailscale|tailnet/i.test(text), `${name}: tailnet reference`);
    // vendor key shapes (Anthropic/Perplexity/OpenAI-style prefixes, long hex/base64 literals)
    assert.ok(!/sk-[A-Za-z0-9_-]{10,}/.test(text), `${name}: sk- key`);
    assert.ok(!/pplx-[A-Za-z0-9]{10,}/.test(text), `${name}: pplx- key`);
    assert.ok(!/(api|write)[_-]?key["']?\s*[:=]\s*["'][A-Za-z0-9+/]{16,}/i.test(text), `${name}: literal key assignment`);
    assert.ok(!/[A-Za-z0-9+/]{40,}={0,2}/.test(text.replace(/https?:\/\/\S+/g, "")), `${name}: long secret-shaped literal`);
    assert.ok(!/cobyweiss|coby weiss/i.test(text), `${name}: personal identifier`);
  }
});

// ---- smoke: boot the demo, watch a card land through the REAL surfaces ---------------
test("demo smoke: boots, replays a card onto the overlay state, queue-read works", async (t) => {
  // ephemeral-ish base port away from 3000/3400 defaults; run.js walks up to +9
  const basePort = 3500 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, [RUN_PATH], {
    env: { ...process.env, FOOTNOTE_DEMO_FAST: "1", FOOTNOTE_DEMO_PORT: String(basePort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const kill = () => { try { child.kill("SIGTERM"); } catch {} };
  t.after(kill);

  try {
    // wait for the banner (carries the actual port + demo key)
    const deadline = Date.now() + 20000;
    let m = null;
    while (Date.now() < deadline && !(m = out.match(/\/op\?room=demo&key=(demo-[a-f0-9]+)/))) {
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!m) {
      // no free port (or sandboxed bind) — skip, don't flake
      if (/no free port|EADDRINUSE|EPERM|server did not come up/.test(out) || child.exitCode !== null) {
        t.skip("demo could not bind a port in this environment"); return;
      }
      assert.fail("demo never printed its banner:\n" + out);
    }
    const key = m[1];
    const port = Number(out.match(/http:\/\/localhost:(\d+)\/overlay\?room=demo/)[1]);
    const base = `http://localhost:${port}`;

    // poll the REAL overlay GET until a fixture card lands on air
    let card = null;
    while (Date.now() < deadline && !card) {
      const r = await fetch(`${base}/api/onair?room=demo`).catch(() => null);
      if (r && r.ok) { const b = await r.json(); if (b.card) card = b.card; }
      if (!card) await new Promise((res) => setTimeout(res, 150));
    }
    assert.ok(card, "no card ever landed on the overlay state:\n" + out.slice(-2000));
    assert.ok(VERDICTS.includes(card.verdict), "aired card carries a real verdict");
    assert.ok(fixture.cards.some((c) => c.claim === card.claim), "aired card comes from the fixture");

    // the receipts log records the air
    const log = await (await fetch(`${base}/api/onair?room=demo&log=1`)).json();
    assert.ok(Array.isArray(log.log) && log.log.length >= 1, "receipts log has the aired check");

    // op queue-read with the printed demo key (the visitor-operator path) is live
    const qr = await fetch(`${base}/api/onair`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ room: "demo", writeKey: key, op: "queue-read" }),
    });
    assert.equal(qr.status, 200, "queue-read with the demo key");
    const q = await qr.json();
    assert.ok(Array.isArray(q.cards), "queue snapshot readable");
  } finally {
    kill();
  }
});
