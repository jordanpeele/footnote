#!/usr/bin/env node
// R-audio RED-TEAM sweep harness (NIGHTSPRINT). Streams a fixture wav through the REAL
// Deepgram realtime WS (same params as the live client, app.js:1099), runs the W1.3
// rolling window over the finals, and scores WORD COVERAGE + shred stats against the
// S1 sidecar. NO extract/verify — coverage is a pure function of the finals the window
// receives, so this isolates the audio-path attack cheaply (no LLM spend, no local
// server). For full claim-recall/verdict scoring use simulate.js --real.
//
//   node tools/synthetic/redteam-sweep.js --wav FIXTURE.wav --sidecar SIDECAR.json \
//        [--endpointing N] [--highpass 120] [--label NAME] [--out results.json]
//
// --highpass HZ pre-filters the wav (ffmpeg highpass=f=HZ) BEFORE streaming — the
// 120Hz OBS preset lever from tools/street/obs-audio-preset.md; quantifies recovery.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWav } from "./simulate.js";
import { runPipeline } from "./window-sim.js";
import { score } from "./scorecard.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = { wav: null, sidecar: null, endpointing: null, highpass: null, label: null, out: null, env: "/Users/cobyweiss/Code/footnote/.env.local" };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--wav") a.wav = argv[++i];
    else if (x === "--sidecar") a.sidecar = argv[++i];
    else if (x === "--endpointing") a.endpointing = Number(argv[++i]);
    else if (x === "--highpass") a.highpass = Number(argv[++i]);
    else if (x === "--label") a.label = argv[++i];
    else if (x === "--out") a.out = argv[++i];
    else if (x === "--env") a.env = argv[++i];
    else { console.error("unknown arg", x); process.exit(2); }
  }
  return a;
}

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

function dgUrl(sampleRate, endpointing) {
  const KEYTERMS = ["Iran", "Tehran", "Khamenei", "Netanyahu", "Trump", "Federal Reserve", "Powell", "inflation", "recession", "Congress"];
  return `wss://api.deepgram.com/v1/listen?model=nova-3&language=en&encoding=linear16&sample_rate=${sampleRate}`
    + `&channels=1&punctuate=true&smart_format=true&interim_results=true&`
    + (endpointing ? `endpointing=${endpointing}&` : "")
    + KEYTERMS.map((t) => "keyterm=" + encodeURIComponent(t)).join("&");
}

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
  const frame = Math.round(sampleRate * 0.05);
  for (let i = 0; i < pcm.length; i += frame) {
    const slice = pcm.subarray(i, i + frame);
    ws.send(Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength));
    await sleep(50);
  }
  ws.send(JSON.stringify({ type: "CloseStream" }));
  await sleep(1500);
  try { ws.close(); } catch {}
  return finals;
}

// Extract-free hooks: coverage/window stats only. extractFn returns no claim so no
// verify fires; the window text still lands in run.windows for word_coverage scoring.
const NOOP_HOOKS = { extractFn: async () => ({ claim: null, ms: 0 }), verifyFn: async () => ({ verdict: null, ms: 0 }), autoAir: false };

function highpassWav(wavPath, hz) {
  const out = join(tmpdir(), `hp-${hz}-${Date.now()}.wav`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", wavPath, "-af", `highpass=f=${hz}`, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out]);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const env = { ...loadEnvFile(args.env) };
  const key = process.env.DEEPGRAM_API_KEY || env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("no DEEPGRAM_API_KEY in env or " + args.env);
  if (!args.wav || !args.sidecar) throw new Error("need --wav and --sidecar");

  let wavPath = resolve(args.wav);
  if (args.highpass) { wavPath = highpassWav(wavPath, args.highpass); }

  const sidecar = JSON.parse(readFileSync(resolve(args.sidecar), "utf8"));
  const wav = parseWav(readFileSync(wavPath));
  const durS = wav.pcm.length / wav.sampleRate;
  const finals = await streamDeepgram(wav.pcm, wav.sampleRate, key, args.endpointing);

  const run = await runPipeline(finals, NOOP_HOOKS);
  const sc = score(run, { profile: sidecar.profile, claims: sidecar.segments ? sidecar.segments.map((s) => ({ utterance: s.utterance, claim: s.claim })) : (sidecar.claims || []) });

  // shred stats
  const finalWordCounts = finals.map((f) => f.text.split(/\s+/).filter(Boolean).length);
  const medianWords = finalWordCounts.length ? finalWordCounts.slice().sort((a, b) => a - b)[Math.floor(finalWordCounts.length / 2)] : 0;
  const totalSttWords = finalWordCounts.reduce((a, b) => a + b, 0);

  const result = {
    label: args.label || sidecar.profile,
    highpass_hz: args.highpass || null,
    endpointing: args.endpointing || null,
    duration_s: Math.round(durS * 10) / 10,
    finals: finals.length,
    stt_words: totalSttWords,
    median_final_words: medianWords,
    windows: run.windows.length,
    word_coverage_pct: sc.metrics.word_coverage_pct,
    claim_recall_pct: sc.metrics.claim_recall_pct,
  };

  console.log(JSON.stringify(result));
  if (args.out) writeFileSync(resolve(args.out), JSON.stringify({ ...result, transcript: finals.map((f) => f.text) }, null, 2));
}

// The Deepgram WebSocket can keep the event loop alive after we have the finals;
// force a clean exit once results are written (we no longer need the socket).
main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
