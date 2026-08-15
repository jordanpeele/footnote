#!/usr/bin/env node
// NIGHTSPRINT S2 — STREAM SIMULATOR + SCORECARD.
//
// Feed synthetic audio (S1) through the REAL Footnote surfaces exactly as a live session
// would, then score every run against S1's ground-truth sidecar.
//
//   REAL  (streams a wav through Deepgram, then window→extract→verify on a local server):
//     node tools/synthetic/simulate.js --real --wav fixture.wav --sidecar fixture.json \
//          [--base http://localhost:PORT] [--out scorecard.json]
//
//   REPLAY (deterministic, free — consumes a recorded STT transcript + recorded API replies):
//     node tools/synthetic/simulate.js --replay fixture.replay.json [--sidecar fixture.json] \
//          [--out scorecard.json]
//
// Both modes drive the SAME window→gate→extract→verify→air logic (tools/synthetic/window-sim.js),
// so their scorecards are directly comparable. --real proves the live surfaces; --replay is the
// CI-safe regression that needs no keys and no network.
//
// The REAL path reuses the live client's Deepgram streaming contract (dgUrl params from app.js:1099)
// and the eval harness's throttling discipline (eval/run.js). Keys are read from the MAIN tree's
// .env.local (--env), never committed.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runPipeline } from "./window-sim.js";
import { score, summarize } from "./scorecard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
// The main tree (this worktree's keys live there per the packet).
const MAIN_ENV = "/Users/cobyweiss/Code/footnote/.env.local";

// ── args ──────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { mode: null, wav: null, sidecar: null, replay: null, base: null, out: null, env: MAIN_ENV, port: 3131, keepServer: false, endpointing: null };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--real") a.mode = "real";
    else if (x === "--replay") { a.mode = "replay"; if (argv[i + 1] && !argv[i + 1].startsWith("--")) a.replay = argv[++i]; }
    else if (x === "--wav") a.wav = argv[++i];
    else if (x === "--sidecar") a.sidecar = argv[++i];
    else if (x === "--base") a.base = argv[++i];
    else if (x === "--out") a.out = argv[++i];
    else if (x === "--env") a.env = argv[++i];
    else if (x === "--port") a.port = Number(argv[++i]);
    else if (x === "--endpointing") a.endpointing = Number(argv[++i]);
    else if (x === "--keep-server") a.keepServer = true;
    else if (x === "--help" || x === "-h") { usage(); process.exit(0); }
    else { console.error("unknown arg:", x); usage(); process.exit(2); }
  }
  return a;
}
function usage() {
  console.log(`usage:
  node tools/synthetic/simulate.js --real --wav FIXTURE.wav --sidecar SIDECAR.json [--base URL] [--port N] [--out FILE]
  node tools/synthetic/simulate.js --replay FIXTURE.replay.json [--sidecar SIDECAR.json] [--out FILE]`);
}

// ── env loading (mirror src/server/index.js precedence: real env > file) ────────────────
function loadEnvFile(file) {
  const out = {};
  let text; try { text = readFileSync(file, "utf8"); } catch { return out; }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1].startsWith("#")) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, "");
    if (v !== "") out[m[1]] = v;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── REPLAY mode ─────────────────────────────────────────────────────────────────────────
// Replay fixture shape (deterministic, keyless):
//   {
//     profile,
//     finals: [ { t, text }, ... ],                 // recorded STT finals (post-Deepgram)
//     extract: { "<utterance text>": {claim,polarity,category,harm_class,rejected,tripwire,ms} },
//     verify:  { "<claim text>":     {verdict,confidence,source,autoAirEligible,polarity_conflict,ms} }
//   }
// The extract/verify maps are keyed by the exact text the pipeline will send. A miss returns
// {claim:null} / a null verdict so the fixture author sees an unmapped path (rather than a crash).
export async function runReplay(fixture, sidecar) {
  const extractFn = async (text) => {
    const r = fixture.extract?.[text];
    if (r) return r;
    return { claim: null, ms: 0 };   // unmapped utterance → treated as no-claim
  };
  const verifyFn = async (claim /*, polarity, utterance */) => {
    const r = fixture.verify?.[claim];
    if (r) return r;
    return { verdict: null, error: "unmapped-claim", ms: 0 };
  };
  const run = await runPipeline(fixture.finals || [], { extractFn, verifyFn, autoAir: fixture.autoAir !== false });
  const sc = score(run, sidecar || { profile: fixture.profile, claims: fixture.claims || [] });
  return { run, scorecard: sc };
}

// ── REAL mode ────────────────────────────────────────────────────────────────────────────
// Stream the wav through Deepgram's realtime WS (same params as the live client, app.js:1099),
// collect finals, then drive window→extract→verify against a locally-spawned server.

// Parse a 16-bit PCM WAV: returns { sampleRate, pcm:Int16Array (mono) }.
export function parseWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let off = 12, fmt = null, dataOff = null, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = { audioFormat: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === "data") { dataOff = off + 8; dataLen = sz; }
    off += 8 + sz + (sz % 2);
  }
  if (!fmt || dataOff == null) throw new Error("missing fmt/data chunk");
  if (fmt.bits !== 16) throw new Error(`need 16-bit PCM, got ${fmt.bits}-bit`);
  let samples = new Int16Array(buf.buffer, buf.byteOffset + dataOff, Math.floor(dataLen / 2));
  if (fmt.channels > 1) {   // downmix to mono (take channel 0)
    const mono = new Int16Array(Math.floor(samples.length / fmt.channels));
    for (let i = 0; i < mono.length; i++) mono[i] = samples[i * fmt.channels];
    samples = mono;
  }
  return { sampleRate: fmt.sampleRate, pcm: Int16Array.from(samples) };
}

function dgUrl(sampleRate, endpointing) {
  const KEYTERMS = ["Iran","Tehran","Khamenei","Netanyahu","Trump","Federal Reserve","Powell","inflation","recession","Congress"];
  return `wss://api.deepgram.com/v1/listen?model=nova-3&language=en&encoding=linear16&sample_rate=${sampleRate}`
    + `&channels=1&punctuate=true&smart_format=true&interim_results=true&`
    + (endpointing ? `endpointing=${endpointing}&` : "")
    + KEYTERMS.map((t) => "keyterm=" + encodeURIComponent(t)).join("&");
}

// Stream PCM to Deepgram in realtime-paced chunks; resolve with the ordered finals.
async function streamDeepgram(pcm, sampleRate, apiKey, endpointing) {
  const ws = new WebSocket(dgUrl(sampleRate, endpointing), ["token", apiKey]);
  const finals = [];
  const t0 = Date.now();
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error("deepgram ws error: " + (e?.message || "open failed"))); });
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "Results" && m.is_final) {
      const text = m.channel?.alternatives?.[0]?.transcript?.trim();
      if (text) finals.push({ t: Date.now() - t0, text });
    }
  };
  // 50ms frames, paced to wall-clock so Deepgram endpoints like a live mic
  const frame = Math.round(sampleRate * 0.05);
  for (let i = 0; i < pcm.length; i += frame) {
    const slice = pcm.subarray(i, i + frame);
    ws.send(Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength));
    await sleep(50);
  }
  ws.send(JSON.stringify({ type: "CloseStream" }));
  await sleep(1500);   // drain trailing finals
  try { ws.close(); } catch {}
  // normalize timestamps to start near 0 (matches window-replay's expectation)
  return finals;
}

// Spawn `npm start` on a spare port with the keys injected; wait until it answers.
async function startServer(env, port) {
  const child = spawn(process.execPath, [join(REPO_ROOT, "src/server/index.js")], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env, PORT: String(port), HOST: "127.0.0.1", FOOTNOTE_STATE: "memory" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stderr.write("[server] " + d));
  child.stderr.on("data", (d) => process.stderr.write("[server:err] " + d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + "/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "" }) }); if (r.status) return { child, base }; } catch {}
    await sleep(150);
  }
  child.kill(); throw new Error("server did not come up on " + base);
}

// Throttled POST (eval/run.js discipline — stay under extract 40/min, verify 20/min).
const lastCall = { extract: 0, verify: 0 };
async function throttledPost(base, endpoint, body) {
  const minGap = Math.ceil((60000 / (endpoint === "extract" ? 40 : 20)) * 1.3);
  const wait = lastCall[endpoint] + minGap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[endpoint] = Date.now();
  const t = Date.now();
  const r = await fetch(`${base}/api/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, ms: Date.now() - t };
}

export async function runReal(args, sidecar) {
  const env = { ...loadEnvFile(args.env), ...pickShellKeys() };
  const need = ["DEEPGRAM_API_KEY", "ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`--real needs ${missing.join(", ")} (looked in ${args.env} + shell env)`);

  const wav = parseWav(readFileSync(resolve(args.wav)));
  console.error(`[real] wav: ${(wav.pcm.length / wav.sampleRate).toFixed(1)}s @ ${wav.sampleRate}Hz — streaming through Deepgram...`);
  const finals = await streamDeepgram(wav.pcm, wav.sampleRate, env.DEEPGRAM_API_KEY, args.endpointing);
  console.error(`[real] ${finals.length} finals captured; starting local server on :${args.port}...`);

  let server = null, base = args.base;
  if (!base) { server = await startServer(env, args.port); base = server.base; }
  try {
    const extractFn = async (text) => {
      const { status, json, ms } = await throttledPost(base, "extract", { text });
      if (status !== 200) return { error: `extract-http-${status}`, ms };
      return { claim: json.claim ?? null, polarity: json.polarity ?? null, category: json.category ?? null, harm_class: json.harm_class ?? null, rejected: json.rejected ?? null, tripwire: json.tripwire ?? null, ms };
    };
    const verifyFn = async (claim, polarity, utterance) => {
      const { status, json, ms } = await throttledPost(base, "verify", { claim, polarity, utterance });
      if (status !== 200) return { error: `verify-http-${status}`, ms };
      return { verdict: json.verdict ?? null, confidence: json.confidence ?? null, source: json.source ?? null, autoAirEligible: json.autoAirEligible === true, polarity_conflict: Boolean(json.polarity_conflict), ms };
    };
    const run = await runPipeline(finals, { extractFn, verifyFn, autoAir: true });
    const sc = score(run, sidecar);
    return { run, scorecard: sc, finals };
  } finally {
    if (server && !args.keepServer) server.child.kill();
  }
}
function pickShellKeys() {
  const out = {};
  for (const k of ["DEEPGRAM_API_KEY", "ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY", "BRAVE_API_KEY"]) if (process.env[k]) out[k] = process.env[k];
  return out;
}

// ── sidecar loading (adapts to S1's schema as it lands) ─────────────────────────────────
function loadSidecar(path) {
  if (!path) return { profile: null, claims: [] };
  const j = JSON.parse(readFileSync(resolve(path), "utf8"));
  // S1 contract: { profile, claims:[...] }. Tolerate a top-level array or {sidecar:{...}}.
  if (Array.isArray(j)) return { profile: null, claims: j };
  if (j.claims) return j;
  if (j.sidecar) return j.sidecar;
  return { profile: j.profile ?? null, claims: [] };
}

// ── main ─────────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (!args.mode) { usage(); process.exit(2); }

  let result;
  if (args.mode === "replay") {
    if (!args.replay) { console.error("--replay needs a fixture path"); process.exit(2); }
    const fixture = JSON.parse(readFileSync(resolve(args.replay), "utf8"));
    const sidecar = args.sidecar ? loadSidecar(args.sidecar) : { profile: fixture.profile, claims: fixture.claims || [] };
    result = await runReplay(fixture, sidecar);
  } else {
    if (!args.wav) { console.error("--real needs --wav"); process.exit(2); }
    const sidecar = loadSidecar(args.sidecar);
    result = await runReal(args, sidecar);
  }

  const outPath = args.out || null;
  const payload = { generated_at: new Date().toISOString(), mode: args.mode, scorecard: result.scorecard };
  if (outPath) { writeFileSync(resolve(outPath), JSON.stringify(payload, null, 2)); console.error(`[scorecard] JSON → ${outPath}`); }
  console.log(summarize(result.scorecard));
  if (!outPath) { console.log("\n--- scorecard JSON ---"); console.log(JSON.stringify(payload, null, 2)); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
