#!/usr/bin/env node
// Generate the 5-minute street test fixture audio from test-script-5min.md.
//
//   node tools/street/generate-test-audio.js [--voice <elevenlabs-voice-id>] [--force]
//
// Requires ELEVENLABS_API_KEY (env, or .env / .env.local at repo root) and ffmpeg.
// Silence gaps are stitched as real audio via ffmpeg — the acoustic gaps are
// load-bearing for the merge/dedupe timing tests, so never rely on punctuation.
//
// Per-segment mp3s are cached in scratch-audio/ and reused unless --force or the
// segment text changed (text hash is in the filename), so editing one line in the
// fixture only re-bills that line.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const STREET_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(STREET_DIR, "..", "..");
const SCRIPT_MD = path.join(STREET_DIR, "test-script-5min.md");
const SCRATCH = path.join(STREET_DIR, "scratch-audio");
const OUT = path.join(STREET_DIR, "test-audio-5min.mp3");

// "Chris" — ElevenLabs premade, casual conversational. Override with --voice.
const DEFAULT_VOICE = "iP95p4xoKVk53GoZ742B";
const MODEL_ID = "eleven_multilingual_v2"; // 1 credit/char, standard quality

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}
const VOICE = arg("--voice") || process.env.ELEVEN_VOICE_ID || DEFAULT_VOICE;
const FORCE = process.argv.includes("--force");

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  for (const f of [".env", ".env.local"]) {
    const p = path.join(REPO_ROOT, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error(
    "ELEVENLABS_API_KEY not found. Export it or add it to .env / .env.local. Never commit it."
  );
  process.exit(1);
}

function loadSegments() {
  const md = fs.readFileSync(SCRIPT_MD, "utf8");
  const m = md.match(/```json\n([\s\S]+?)\n```/);
  if (!m) {
    console.error("No ```json fixture block found in " + SCRIPT_MD);
    process.exit(1);
  }
  return JSON.parse(m[1]);
}

async function tts(key, text, outFile) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TTS ${res.status} for voice ${VOICE}: ${body.slice(0, 300)}`);
  }
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}

function duration(file) {
  return parseFloat(
    execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      file,
    ]).toString()
  );
}

async function main() {
  const key = loadKey();
  const segments = loadSegments();
  fs.mkdirSync(SCRATCH, { recursive: true });

  let chars = 0;
  const wavs = [];
  const silences = new Map(); // pause seconds -> wav path

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const hash = crypto.createHash("sha1").update(seg.text).digest("hex").slice(0, 8);
    const base = path.join(SCRATCH, `${String(i).padStart(2, "0")}-${seg.id}-${hash}`);
    const mp3 = base + ".mp3", wav = base + ".wav";

    if (FORCE || !fs.existsSync(mp3)) {
      process.stdout.write(`tts ${seg.id} (${seg.text.length} chars)... `);
      await tts(key, seg.text, mp3);
      chars += seg.text.length;
      console.log("ok");
    } else {
      console.log(`tts ${seg.id}: cached`);
    }
    ffmpeg(["-i", mp3, "-ar", "44100", "-ac", "1", wav]);
    wavs.push(wav);

    if (seg.pauseAfter > 0) {
      if (!silences.has(seg.pauseAfter)) {
        const sil = path.join(SCRATCH, `silence-${seg.pauseAfter}s.wav`);
        ffmpeg([
          "-f", "lavfi",
          "-i", "anullsrc=r=44100:cl=mono",
          "-t", String(seg.pauseAfter),
          sil,
        ]);
        silences.set(seg.pauseAfter, sil);
      }
      wavs.push(silences.get(seg.pauseAfter));
    }
  }

  const list = path.join(SCRATCH, "concat.txt");
  fs.writeFileSync(list, wavs.map((w) => `file '${w}'`).join("\n"));
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-b:a", "128k", OUT]);

  const secs = duration(OUT);
  const mm = Math.floor(secs / 60), ss = Math.round(secs % 60);
  console.log(`\nwrote ${path.relative(REPO_ROOT, OUT)}`);
  console.log(`duration: ${mm}:${String(ss).padStart(2, "0")} (${secs.toFixed(1)}s)`);
  console.log(`segments: ${segments.length}, new chars billed this run: ${chars}`);
  console.log(
    `cost: ~${chars} ElevenLabs credits (${MODEL_ID} = 1 credit/char; ` +
      `~$${((chars / 1000) * 0.22).toFixed(2)} at Creator-plan rates)`
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
