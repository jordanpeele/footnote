#!/usr/bin/env node
// W1.1 endpointing sweep — stream the shredded fixture to Deepgram's realtime WS at a
// range of `endpointing` values and measure what each setting does to final shape.
//
//   node tools/bench/endpointing-sweep.js [--fixture <wav>] [--values 10,300,500,800,1200]
//                                         [--limit-seconds N] [--out <jsonl>]
//
// Per setting (one full real-time pass each):
//   finals/min        — is_final results with a nonempty transcript, per audio minute
//   median words/final— unit-of-meaning proxy (the 2026-08-14 run's median was ONE word)
//   added latency     — per final: wall-clock receipt minus the wall-clock moment the last
//                       audio sample covered by that final was SENT (p50/p95). This is the
//                       endpointing wait itself, isolated from pipeline stages.
//
// Requires DEEPGRAM_API_KEY (env, or .env / .env.local at repo root). Fixture must be
// 16 kHz mono s16le WAV (make-shredded-fixture.sh emits exactly that). Streams in real
// time (100 ms chunks), so a 5-min fixture x 5 values ≈ 30 min wall clock and ≈ 25
// billed audio-minutes (< $0.20 at nova-3 streaming rates).
//
// R62: this bench is TUNING INPUT ONLY — it changes no defaults; the rolling window is
// the architecture. Results doc: docs/BENCH_ENDPOINTING_2026-08-14.md.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(BENCH_DIR, "..", "..");

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : dflt;
}

const FIXTURE = path.resolve(arg("--fixture", path.join(BENCH_DIR, "results", "shredded-fixture.wav")));
const VALUES = arg("--values", "10,300,500,800,1200").split(",").map(Number);
const LIMIT_S = Number(arg("--limit-seconds", "0")) || 0; // 0 = whole fixture
const OUT = path.resolve(arg("--out", path.join(BENCH_DIR, "results", `endpointing-sweep-${new Date().toISOString().slice(0, 10)}.jsonl`)));

const CHUNK_MS = 100;

function loadKey() {
  if (process.env.DEEPGRAM_API_KEY) return process.env.DEEPGRAM_API_KEY;
  for (const f of [".env", ".env.local"]) {
    const p = path.join(REPO_ROOT, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^DEEPGRAM_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error("DEEPGRAM_API_KEY not found (env, or .env / .env.local at repo root). Never commit it.");
  process.exit(1);
}

// Minimal RIFF walk: returns { sampleRate, channels, bitsPerSample, pcm }.
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    throw new Error(`${file} is not a RIFF/WAVE file`);
  let off = 12, fmt = null, pcm = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === "data") {
      pcm = buf.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !pcm) throw new Error("missing fmt/data chunk");
  if (fmt.audioFormat !== 1 || fmt.channels !== 1 || fmt.sampleRate !== 16000 || fmt.bitsPerSample !== 16)
    throw new Error(`need 16kHz mono s16le PCM, got fmt=${fmt.audioFormat} ch=${fmt.channels} sr=${fmt.sampleRate} bits=${fmt.bitsPerSample}`);
  return { ...fmt, pcm };
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pctl = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

function runPass(key, pcm, endpointing) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({
      model: "nova-3",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      punctuate: "true",
      smart_format: "true",
      interim_results: "true",
      endpointing: String(endpointing),
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${qs}`, ["token", key]);
    const finals = [];
    let streamStart = null; // wall-clock ms when byte 0 was sent
    let closed = false;
    const bytesPerMs = (16000 * 2) / 1000;
    const chunkBytes = CHUNK_MS * bytesPerMs;

    const fail = (e) => { if (!closed) { closed = true; clearTimeout(watchdog); try { ws.close(); } catch {} reject(e); } };
    const finishTimer = () => setTimeout(() => { try { ws.close(); } catch {} }, 15000);
    let hardStop = null;
    // watchdog: a WS stuck in CONNECTING fires neither open nor error, which would hang
    // the pass promise forever (observed live on a retry attempt — hours, not seconds).
    // Budget = real-time audio length + 90s of connect/flush slack.
    const watchdog = setTimeout(
      () => fail(new Error(`pass watchdog fired (endpointing=${endpointing})`)),
      pcm.length / bytesPerMs + 90000
    );

    ws.onerror = () => fail(new Error(`ws error (endpointing=${endpointing})`));
    ws.onclose = (ev) => {
      if (closed) return;
      closed = true;
      clearTimeout(watchdog);
      if (hardStop) clearTimeout(hardStop);
      if (streamStart === null) return reject(new Error(`ws closed before streaming: ${ev.code} ${ev.reason}`));
      resolve({ finals, streamStart });
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type !== "Results" || !msg.is_final) return;
      const alt = msg.channel?.alternatives?.[0] || {};
      const transcript = (alt.transcript || "").trim();
      const audioEndS = (msg.start || 0) + (msg.duration || 0);
      const lastWord = alt.words?.[alt.words.length - 1];
      finals.push({
        t_recv: Date.now(),
        audio_end_s: audioEndS,
        // end of the last recognized WORD — the final's own window extends through the
        // endpoint silence, so latency must be measured from here, not audio_end_s
        last_word_end_s: lastWord ? lastWord.end : null,
        speech_final: Boolean(msg.speech_final),
        words: transcript ? transcript.split(/\s+/).length : 0,
        transcript,
      });
    };
    ws.onopen = () => {
      streamStart = Date.now();
      let sent = 0;
      const pump = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // drift-corrected pacing: send every chunk whose real-time slot has arrived
        const due = Math.min(pcm.length, Math.ceil(((Date.now() - streamStart) * bytesPerMs + chunkBytes) / chunkBytes) * chunkBytes);
        while (sent < due) {
          const next = Math.min(sent + chunkBytes, pcm.length);
          ws.send(pcm.subarray(sent, next));
          sent = next;
        }
        if (sent >= pcm.length) {
          ws.send(JSON.stringify({ type: "CloseStream" }));
          hardStop = finishTimer(); // resolve via onclose; force-close if server dawdles
          return;
        }
        setTimeout(pump, CHUNK_MS);
      };
      pump();
    };
  });
}

async function main() {
  const key = loadKey();
  const wav = readWav(FIXTURE);
  let pcm = wav.pcm;
  if (LIMIT_S > 0) pcm = pcm.subarray(0, LIMIT_S * 16000 * 2);
  const audioMin = pcm.length / (16000 * 2) / 60;
  console.log(`fixture: ${FIXTURE} (${(audioMin * 60).toFixed(1)}s), values: [${VALUES.join(", ")}]`);
  console.log(`streaming real-time; total wall ≈ ${(audioMin * VALUES.length).toFixed(1)} min\n`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const rows = [];
  for (const ep of VALUES) {
    process.stdout.write(`endpointing=${ep}ms ... `);
    // transient WS drops mid-pass are real (observed on pass 2 of the first run):
    // retry the whole pass up to 3 times — a partial pass would corrupt the metrics
    let result = null;
    for (let attempt = 1; attempt <= 3 && !result; attempt++) {
      try {
        result = await runPass(key, pcm, ep);
      } catch (e) {
        if (attempt === 3) throw e;
        process.stdout.write(`[${e.message}; retry ${attempt}] `);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
    const { finals, streamStart } = result;
    const nonEmpty = finals.filter((f) => f.words > 0);
    // added latency: receipt wall-clock minus the wall-clock moment the last recognized
    // word finished being SENT (streamStart + last_word_end, pacing ≈ real time). This is
    // "speech stopped → final landed", i.e. the endpointing wait + network, isolated from
    // every downstream pipeline stage.
    const latencies = nonEmpty
      .filter((f) => f.last_word_end_s !== null)
      .map((f) => f.t_recv - (streamStart + f.last_word_end_s * 1000));
    const row = {
      endpointing_ms: ep,
      finals: nonEmpty.length,
      empty_finals: finals.length - nonEmpty.length,
      finals_per_min: +(nonEmpty.length / audioMin).toFixed(1),
      speech_finals: nonEmpty.filter((f) => f.speech_final).length,
      median_words_per_final: median(nonEmpty.map((f) => f.words)),
      p50_added_latency_ms: Math.round(pctl(latencies, 50) ?? 0),
      p95_added_latency_ms: Math.round(pctl(latencies, 95) ?? 0),
      total_words: nonEmpty.reduce((s, f) => s + f.words, 0),
    };
    rows.push(row);
    fs.appendFileSync(OUT, JSON.stringify({ ...row, fixture: FIXTURE, finals_detail: finals }) + "\n");
    console.log(`${row.finals} finals (${row.finals_per_min}/min), median ${row.median_words_per_final} words/final, p50 +${row.p50_added_latency_ms}ms`);
  }

  console.log("\n| endpointing (ms) | finals/min | median words/final | p50 added latency (ms) | p95 (ms) | total words |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows)
    console.log(`| ${r.endpointing_ms} | ${r.finals_per_min} | ${r.median_words_per_final} | ${r.p50_added_latency_ms} | ${r.p95_added_latency_ms} | ${r.total_words} |`);
  console.log(`\nraw per-final detail: ${OUT}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
