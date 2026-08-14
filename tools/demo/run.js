#!/usr/bin/env node
// Footnote DEMO MODE — the no-keys front door.
//   npm run demo   →   a real Footnote server + real state channel + real surfaces
//                      (/overlay, /op, /receipts), fed by replayed field data.
//
// No API keys, no external calls, ever: the demo never touches extract/verify/
// transcribe. It replays tools/demo/fixture.json — real cards from the public field
// record (docs/FIELD_TEST_*.md, eval/golden drafts) — through the REAL /api/onair
// surface: queue snapshots (checking → pending) exactly like /control pushes them,
// then airs each card through the real op:"cmd" path. That means renders, render-acks,
// the receipts log, and operator AIR/SKIP from /op all work for real; only the AI
// pipeline is replaced by the recording.
//
// Mechanics:
//   1. spawns `node src/server/index.js` with FOOTNOTE_STATE=memory on its own port
//      (3400, walking upward if taken — an existing `npm start` on :3000 is untouched)
//   2. loops the fixture forever, replaying each card the way its era actually ran
//      (fixture demo.mode):
//        operator — checking → pending → a veto window where a visitor on /op can AIR
//                   or SKIP the card themselves → otherwise the demo airs it through
//                   the real op:"cmd" path (the human-path air).
//        auto     — the D18 pilot choreography: consecutive science cards arm, each runs
//                   the pilot's 4s veto countdown (a visitor SKIP/HOLD on /op vetoes it,
//                   exactly like the field sessions), then the MACHINE airs it — direct
//                   publish with autoAired:true, so receipts mark it AUTO · machine-aired.
//                   Machine airs land close enough together that the display-layer pacer
//                   (pacer.js) choreographs the takeovers on /overlay: 6s minimum dwell,
//                   exit → entrance beat, never a flash-replace.
//        testair  — the PASS-2 choreography: the settled verdict airs immediately with
//                   test:true (the overlay renders the TEST watermark).
//        hold     — the D4 person-claim posture: the card sits pending with its
//                   MANUAL — person tag on /op and is HELD, never machine-aired.
//        skip     — the R41 street norm: unverifiable → don't air.
//      Operator commands are consumed via the real op:"cmds-read" poll, and the server's
//      own N4 guards (hold/skip scan + air idempotency) arbitrate races between the
//      visitor's thumb and the demo's timer — same as a real session.
//   3. receipts growth is bounded by the memory adapter itself: appendLog LTRIMs the
//      per-room log to 500 entries (7-day TTL). One modest fixture pass (~10 airs) per
//      ~3-minute cycle can never grow past that cap, so the loop just repeats.
//
// Env knobs (used by the smoke test; harmless to humans):
//   FOOTNOTE_DEMO_PORT=n   base port to try (default 3400)
//   FOOTNOTE_DEMO_FAST=1   compress all delays (test mode)
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "demo", "fixture.json"), "utf8"));
const ROOM = fixture.room;                                   // "demo"
const KEY = "demo-" + randomBytes(8).toString("hex");        // fresh per run, printed below

const FAST = process.env.FOOTNOTE_DEMO_FAST === "1";
// autoVeto is the D18 pilot's REAL veto-window length (4s) — the demo replays it verbatim.
const T = FAST
  ? { checking: 150, veto: 500, autoVeto: 300, display: 1500, gap: 200, cyclePause: 500, cmdPoll: 100 }
  : { checking: 2200, veto: 6000, autoVeto: 4000, display: 6500, gap: 1800, cyclePause: 4000, cmdPoll: 1200 };

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- port: never fight an existing server (:3000 stays untouched) --------------------
const basePort = Number(process.env.FOOTNOTE_DEMO_PORT) || 3400;
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}
let PORT = 0;
for (let p = basePort; p < basePort + 10; p++) {
  if (await portFree(p)) { PORT = p; break; }
}
if (!PORT) { console.error(`demo: no free port in ${basePort}–${basePort + 9}`); process.exit(1); }
const BASE = `http://localhost:${PORT}`;

// ---- boot the real self-host server --------------------------------------------------
const child = spawn(process.execPath, [path.join(ROOT, "src", "server", "index.js")], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", FOOTNOTE_STATE: "memory" },
  stdio: ["ignore", "pipe", "pipe"],
});
// The server prints its own startup lines (including a "missing keys" note that does NOT
// apply here — the demo never calls those stages). Show them dimmed, then our banner.
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => { for (const line of chunk.split("\n")) if (line.trim()) console.log(dim("  server │ " + line)); });
}
let shuttingDown = false;
child.on("exit", (code) => {
  if (shuttingDown) return;
  console.error(`demo: server exited unexpectedly (code ${code})`);
  process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    shuttingDown = true;
    console.log("\ndemo: shutting down");
    child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 300).unref();
  });
}

async function api(body) {
  const r = await fetch(BASE + "/api/onair", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// wait for the server to answer
{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/onair?room=${ROOM}`); if (r.ok) { up = true; break; } } catch {}
    await sleep(150);
  }
  if (!up) { console.error("demo: server did not come up"); child.kill("SIGTERM"); process.exit(1); }
}

console.log(`
${bold("FOOTNOTE — DEMO MODE")}  (replayed field data · zero API keys · no external calls)

  ${bold("OVERLAY")}   ${BASE}/overlay?room=${ROOM}
            the on-air lower third — add it to OBS as a browser source, or just open it

  ${bold("OPERATOR")}  ${BASE}/op?room=${ROOM}&key=${KEY}
            open on a phone and play operator: your AIR / SKIP taps really work —
            beat the demo's timer to the card

  ${bold("RECEIPTS")}  ${BASE}/receipts?room=${ROOM}
            the public aired-check log, growing as cards land

  Cards are real checks from Footnote's field record — the first field test, the
  TESTAIR pass, the street session, and the D18 supervised auto-air pilot (see
  docs/FIELD_TEST_*.md + docs/D18_PILOT_FIELD_REPORT_*.md) — each replayed with its
  era's own choreography through the same server paths a live session uses:
  operator airs, machine airs (marked AUTO on receipts), a TEST-watermarked air,
  a person-claim hold, and a street-norm skip.
  Ctrl-C to stop.
`);

// ---- queue snapshot + operator-command plumbing (the real /control wire shapes) ------
async function pushQueue(cards, onAirId = null, autoair = null) {
  const { status, body } = await api({ room: ROOM, writeKey: KEY, op: "queue", cards, onAirId, autoair });
  if (status === 403) { console.error("demo: room key rejected (is another demo already running in this room?)"); process.exit(1); }
  return body;
}
const autoAirEligible = (c) => c.harm_class === "none" && typeof c.confidence === "number" && c.confidence >= 0.9
  && c.source?.tier === 3 && (c.verdict === "True" || c.verdict === "False");
function queueCard(c, id, spokenAt, state) {
  const q = { id, state, claim: c.claim, spokenAt, harm_class: c.harm_class,
    verdict: null, correction: null, confidence: null, source: null, autoAirEligible: false };
  if (state === "pending") {
    Object.assign(q, {
      verdict: c.verdict, correction: c.correction, confidence: c.confidence,
      source: c.source ? { name: c.source.name, url: c.source.url } : null,
      canonical: c.canonical, citations: c.citations.length ? c.citations : undefined,
      autoAirEligible: autoAirEligible(c),
    });
    if (c.source && Number.isInteger(c.source.tier)) q.tier = c.source.tier;
  }
  return q;
}

let lastCmdId = "";
async function readNewCmds() {
  const { status, body } = await api({ room: ROOM, writeKey: KEY, op: "cmds-read", after: lastCmdId });
  if (status !== 200 || !Array.isArray(body.cmds) || !body.cmds.length) return [];
  lastCmdId = body.cmds[body.cmds.length - 1].id;   // oldest → newest
  return body.cmds;
}
await readNewCmds();   // baseline (also performs the room's TOFU key registration)

// veto window: give a visitor on /op first shot at the card; returns how it resolved
async function vetoWindow(id, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (const cmd of await readNewCmds()) {
      if (cmd.cardId !== id) continue;
      if (cmd.action === "air") return "visitor-aired";
      if (cmd.action === "skip" || cmd.action === "hold") return "visitor-" + cmd.action;
    }
    await sleep(T.cmdPoll);
  }
  return "timer";
}

const VERDICT_ICON = { True: "✓", False: "✗", Misleading: "⚠", NeedsContext: "◐", Unverifiable: "?" };
const mode = (c) => (c.demo && c.demo.mode) || "operator";
const sayEra = (c) => { if (c.demo && c.demo.era) console.log(dim(`  ── ${c.demo.era}`)); };
const sayVerdict = (c, tail) =>
  console.log(`  ${VERDICT_ICON[c.verdict] || "?"} ${c.verdict}${c.source ? dim(" · " + c.source.name) : ""}${tail ? " — " + tail : ""}`);

// direct publish — the SAME wire /control uses for auto-air and TESTAIR (op:"cmd" is the
// human path; machine airs never ride it). flags: { autoAired, test } land on the aired
// log, so receipts mark machine airs and the overlay renders the TEST watermark.
async function airDirect(c, flags = {}) {
  const card = {
    verdict: c.verdict, claim: c.claim, canonical: c.canonical, correction: c.correction,
    source: c.source ? { name: c.source.name, url: c.source.url } : null,
    citations: c.citations && c.citations.length ? c.citations : undefined,
  };
  if (c.source && Number.isInteger(c.source.tier)) card.tier = c.source.tier;
  if (flags.autoAired) card.autoAired = true;
  if (flags.test) card.test = true;
  const { status } = await api({ room: ROOM, writeKey: KEY, card, durationMs: T.display });
  return status === 200;
}

// hold/skip through the real op:"cmd" path, so the server's N4 scan sees the mark too
async function markCard(action, id) {
  await api({ room: ROOM, writeKey: KEY, op: "cmd", cmd: { action, cardId: id } });
}

// ---- scenes (one per fixture demo.mode) ----------------------------------------------

// operator / hold / skip: checking → pending → visitor-first veto window → disposition
async function operatorScene(c, id) {
  const spokenAt = Date.now();
  sayEra(c);
  console.log(dim(`  checking… “${c.claim}”`));
  await pushQueue([queueCard(c, id, spokenAt, "checking")]);
  await sleep(T.checking);

  await pushQueue([queueCard(c, id, spokenAt, "pending")]);
  const m = mode(c);
  const person = c.harm_class === "person_public" || c.harm_class === "person_private";
  sayVerdict(c, person ? "MANUAL — person (D4: auto-air never touches person claims)" : "waiting on the operator…");

  const resolution = await vetoWindow(id, T.veto);
  let aired = false;
  if (resolution === "visitor-aired") {
    console.log(bold("    → AIRED by a visitor on /op"));
    aired = true;
  } else if (resolution.startsWith("visitor-")) {
    const verb = resolution === "visitor-skip" ? "SKIPPED" : "HELD";
    console.log(bold(`    → ${verb} by a visitor on /op — card not aired`));
  } else if (m === "hold") {
    await markCard("hold", id);
    console.log(bold("    → HELD for a human — person claims never auto-air (D4)"));
  } else if (m === "skip") {
    await markCard("skip", id);
    console.log(dim("    → skipped — street norm: don't air what we couldn't verify (R41)"));
  } else {
    const { status } = await api({ room: ROOM, writeKey: KEY, op: "cmd",
      cmd: { action: "air", cardId: id }, durationMs: T.display });
    if (status === 200) { aired = true; console.log(dim("    → aired (demo plays the operator)")); }
    else if (status === 409) console.log(dim("    → already handled on /op"));   // N4 guard won the race
    else console.log(dim(`    → air failed (${status})`));
  }
  await pushQueue([], aired ? id : null);              // card leaves the queue (aired, held or skipped)
  if (aired) await sleep(T.display);                   // let the lower third run its course
  await sleep(T.gap);
}

// testair: the PASS-2 choreography — the settled verdict airs immediately, TEST watermark on
async function testairScene(c, id) {
  const spokenAt = Date.now();
  sayEra(c);
  console.log(dim(`  checking… “${c.claim}”`));
  await pushQueue([queueCard(c, id, spokenAt, "checking")]);
  await sleep(T.checking);
  await pushQueue([queueCard(c, id, spokenAt, "pending")]);
  sayVerdict(c);
  const ok = await airDirect(c, { test: true, autoAired: true });
  console.log(ok ? bold("    ⚡ TESTAIR — aired immediately, TEST watermark on")
    : dim("    → test-air failed"));
  await pushQueue([], ok ? id : null);
  if (ok) await sleep(T.display);
  await sleep(T.gap);
}

// auto batch: the D18 pilot choreography. All cards verify into the queue, then each runs
// the pilot's 4s veto countdown and — absent a human veto — the MACHINE airs it. Machine
// airs land ~4s apart, inside the display pacer's 6s minimum dwell, so /overlay shows the
// 0c choreography: full dwell, exit → entrance beat, never a flash-replace.
async function autoScene(batch, ids) {
  const spokenAt = Date.now();
  sayEra(batch[0]);
  const cap = 10;                                        // the D18 session cap, replayed
  let count = 0;
  const aa = () => ({ on: true, count, cap });
  const qc = (state, only = null) => batch
    .map((c, i) => ({ c, id: ids[i] }))
    .filter((x) => !only || only.includes(x.id))
    .map((x) => queueCard(x.c, x.id, spokenAt, state));
  for (const c of batch) console.log(dim(`  checking… “${c.claim}”`));
  await pushQueue(qc("checking"), null, aa());
  await sleep(T.checking);

  let live = ids.slice();                                // ids still pending
  await pushQueue(qc("pending", live), null, aa());
  let onAirId = null;
  for (let i = 0; i < batch.length; i++) {
    const c = batch[i], id = ids[i];
    sayVerdict(c, `eligible — AUTO countdown, ${Math.round(T.autoVeto / 1000)}s veto window on /op`);
    const resolution = await vetoWindow(id, T.autoVeto);
    let aired = false;
    if (resolution === "visitor-aired") {
      console.log(bold("    → AIRED by a visitor on /op (beat the countdown)"));
      aired = true;
    } else if (resolution.startsWith("visitor-")) {
      console.log(bold("    → VETOED by a visitor on /op — card not aired (vetoes don't consume the cap)"));
    } else if (count < cap) {
      aired = await airDirect(c, { autoAired: true });
      if (aired) { count++; console.log(bold(`    → AUTO · machine-aired (${count}/${cap}) — no human tap`)); }
      else console.log(dim("    → auto-air failed"));
    } else {
      console.log(dim("    → cap wall — the 11th eligible card never arms (D18)"));
    }
    live = live.filter((x) => x !== id);
    if (aired) onAirId = id;
    await pushQueue(qc("pending", live), onAirId, aa());
  }
  await sleep(T.display);                                // let the last card run its course
  await pushQueue([], null);                             // scene over — queue empties, AUTO chip drops
  await sleep(T.gap);
}

// ---- the replay loop -----------------------------------------------------------------
// optional pre-roll (README-GIF capture rig: gives a recorder time to attach before the
// first card moves; harmless to humans — the banner is already up)
{
  const delay = Number(process.env.FOOTNOTE_DEMO_START_DELAY_MS) || 0;
  if (delay > 0) await sleep(Math.min(delay, 60000));
}
let nextId = 1;
let cycle = 0;
while (true) {
  cycle++;
  let i = 0;
  while (i < fixture.cards.length) {
    const c = fixture.cards[i];
    if (mode(c) === "auto") {
      // consecutive auto cards replay as one D18 batch — that burst is what makes the
      // display pacer's choreography visible on /overlay
      const batch = [];
      while (i < fixture.cards.length && mode(fixture.cards[i]) === "auto") batch.push(fixture.cards[i++]);
      const ids = batch.map(() => nextId++);
      await autoScene(batch, ids);
    } else if (mode(c) === "testair") {
      await testairScene(c, nextId++); i++;
    } else {
      await operatorScene(c, nextId++); i++;
    }
  }
  console.log(dim(`  — fixture pass ${cycle} complete (${fixture.cards.length} cards) — replaying —`));
  await sleep(T.cyclePause);
}
