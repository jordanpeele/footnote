#!/usr/bin/env node
// Synthetic street-audio GENERATOR (NIGHTSPRINT S1) — the keystone fixture maker.
//
//   node tools/synthetic/gen-audio.js \
//     --script <claims.jsonl> --profile <name> --out <basename> [--seed N] [--gap 8]
//
// Emits <basename>.wav (48kHz mono) + <basename>.sidecar.json (ground truth:
// what was said, when, which claims, expected category/verdict/gate — the scoring
// key S2 consumes). The sidecar contract is daysprint/synthetic/SIDECAR_SCHEMA.md;
// the adversity knobs/profiles are tools/synthetic/profiles.js + PROFILES.md.
//
// SPEECH SOURCE: macOS `say` (deterministic, free, offline, no API key). The run
// report's failure is acoustic (wind + micro-gap shred), so a TTS voice with
// clean diction is the RIGHT clean source — the adversity, not the voice, is the
// variable under test. (ElevenLabs is used elsewhere for the produced street
// fixture; here determinism + zero-cost regeneration matter more than timbre.)
//
// Requires: macOS `say`, ffmpeg, ffprobe. Builds on the mechanics proven in
// tools/bench/make-shredded-fixture.sh's spirit (gap + wind injection) but as a
// composable, sidecar-emitting Node tool.

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { resolveProfile } from "./profiles.js";
import { buildSidecar } from "./sidecar.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const SR = 48000;

// ---- args -------------------------------------------------------------------
function arg(flag, dflt = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SCRIPT = arg("--script");
const PROFILE_NAME = arg("--profile", "windy_run");
const OUT = arg("--out");
const SEED = parseInt(arg("--seed", "1337"), 10);
const GAP_S = parseFloat(arg("--gap", "8")); // silence after each segment (verify headroom)
const VOICE = arg("--voice", "Alex");

if (!SCRIPT || !OUT) {
  console.error("usage: gen-audio.js --script <claims.jsonl> --profile <name> --out <basename> [--seed N] [--gap 8] [--voice Alex]");
  process.exit(2);
}

// ---- deterministic PRNG (mulberry32) ---------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

// ---- ffmpeg helpers ---------------------------------------------------------
function ff(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}
function probeDur(file) {
  return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}
// ffmpeg analysis filters print to STDERR; capture it (stdout is empty for -f null).
function measure(file, af) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", af, "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  return (r.stderr || "").toString();
}
function measureLRA(file) {
  const out = measure(file, "ebur128");
  const m = out.match(/Summary:[\s\S]*?LRA:\s*(-?[\d.]+)\s*LU/);
  const im = out.match(/Summary:[\s\S]*?I:\s*(-?[\d.]+)\s*LUFS/);
  return { lra: m ? parseFloat(m[1]) : null, integrated: im ? parseFloat(im[1]) : null };
}
function meanVol(file, extraFilter) {
  const af = (extraFilter ? extraFilter + "," : "") + "volumedetect";
  const out = measure(file, af);
  const m = out.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return m ? parseFloat(m[1]) : null;
}
function peakDb(file) {
  const out = measure(file, "astats=metadata=1");
  const m = out.match(/Peak level dB:\s*(-?[\d.inf]+)/i);
  return m ? parseFloat(m[1]) : null;
}

// ---- claim-script parse -----------------------------------------------------
function loadScript(p) {
  const abs = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
  const lines = fs.readFileSync(abs, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`script line ${i + 1} is not valid JSON: ${e.message}`); }
  });
}

// ---- micro-gap injection ----------------------------------------------------
// Split ONE spoken segment's wav at speech-plausible points and stitch 150-400ms
// silences in — the exact SRT-endpointing shred cause. Deterministic per seed.
function injectMicrogaps(inWav, outWav, knob, tmp) {
  if (!knob) { fs.copyFileSync(inWav, outWav); return; }
  const dur = probeDur(inWav);
  const nGaps = Math.max(0, Math.round((dur / 10) * knob.rate_per_10s));
  if (nGaps === 0 || dur < 0.6) { fs.copyFileSync(inWav, outWav); return; }
  // pick cut points in the interior (avoid the first/last 0.15s)
  const cuts = [];
  for (let i = 0; i < nGaps; i++) cuts.push(0.15 + rand() * (dur - 0.3));
  cuts.sort((a, b) => a - b);
  const parts = [];
  let prev = 0;
  const listFiles = [];
  for (let i = 0; i < cuts.length; i++) {
    const seg = path.join(tmp, `mg-${path.basename(inWav)}-${i}.wav`);
    ff(["-i", inWav, "-ss", String(prev), "-to", String(cuts[i]), "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", seg]);
    listFiles.push(seg);
    const gapMs = knob.min_ms + rand() * (knob.max_ms - knob.min_ms);
    const sil = path.join(tmp, `mgsil-${path.basename(inWav)}-${i}.wav`);
    ff(["-f", "lavfi", "-i", `anullsrc=r=${SR}:cl=mono`, "-t", (gapMs / 1000).toFixed(3), "-c:a", "pcm_s16le", sil]);
    listFiles.push(sil);
    prev = cuts[i];
  }
  const tail = path.join(tmp, `mg-${path.basename(inWav)}-tail.wav`);
  ff(["-i", inWav, "-ss", String(prev), "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", tail]);
  listFiles.push(tail);
  concat(listFiles, outWav, tmp);
}

function concat(files, outWav, tmp) {
  const list = path.join(tmp, `concat-${path.basename(outWav)}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"));
  ff(["-f", "concat", "-safe", "0", "-i", list, "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", outWav]);
}

function silenceWav(seconds, outWav) {
  ff(["-f", "lavfi", "-i", `anullsrc=r=${SR}:cl=mono`, "-t", seconds.toFixed(3), "-c:a", "pcm_s16le", outWav]);
}

// ---- wind bed ---------------------------------------------------------------
function windExpr(knob) {
  // sum of sparse, tall gust oscillators → bimodal loud/quiet distribution (drives LRA)
  const terms = knob.gust_periods_s.map((p, i) => {
    const phase = (i * 1.3).toFixed(2);
    return `${knob.gust_amp}*pow(max(0\\, sin(2*PI*t/${p}+${phase}))\\, ${knob.gust_sharpness})`;
  });
  const floor = knob.floor > 0 ? `${knob.floor} + ` : "";
  return floor + terms.join(" + ");
}
function makeWind(dur, knob, outWav) {
  const lp = `lowpass=f=${knob.cutoff_hz},lowpass=f=${knob.cutoff_hz}`;
  const vol = `volume=volume='${windExpr(knob)}':eval=frame`;
  ff([
    "-f", "lavfi", "-i", `anoisesrc=d=${dur.toFixed(3)}:c=${knob.color}:a=1:r=${SR}`,
    "-af", `${lp},${vol},alimiter=limit=${knob.limit},aformat=channel_layouts=mono`,
    "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", outWav,
  ]);
}

// ---- ambience bed -----------------------------------------------------------
function makeAmbience(dur, knob, outWav) {
  // traffic = pink noise low-shelved; cafe = pink noise + brown murmur
  const filt = knob.kind === "cafe"
    ? `lowpass=f=1200,volume=${knob.gain}`
    : `lowpass=f=600,volume=${knob.gain}`;
  ff([
    "-f", "lavfi", "-i", `anoisesrc=d=${dur.toFixed(3)}:c=pink:a=1:r=${SR}`,
    "-af", `${filt},aformat=channel_layouts=mono`,
    "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", outWav,
  ]);
}

// ---- packet-loss / handoff mutes on the assembled speech --------------------
// Returns an ffmpeg volume-mute expression that zeroes given [start,dur] windows.
function muteExpr(windows) {
  if (!windows.length) return null;
  const conds = windows.map(([s, d]) => `between(t\\,${s.toFixed(3)}\\,${(s + d).toFixed(3)})`);
  return `volume=volume='if(${conds.join("+")}\\,0\\,1)':eval=frame`;
}

// ---- distance drift ---------------------------------------------------------
function distanceExpr(knob) {
  const span = knob.max_gain - knob.min_gain;
  return `volume=volume='${knob.min_gain} + ${span}*(0.5+0.5*sin(2*PI*t/${knob.period_s}))':eval=frame`;
}

// ---- main -------------------------------------------------------------------
function main() {
  const rows = loadScript(SCRIPT);
  const profile = resolveProfile(PROFILE_NAME);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "footnote-synth-"));

  const outBase = path.isAbsolute(OUT) ? OUT : path.join(REPO_ROOT, OUT);
  fs.mkdirSync(path.dirname(outBase), { recursive: true });

  // 1. Synthesize each utterance with `say`, inject micro-gaps, then a silence gap.
  const clipFiles = [];
  const timings = [];
  let cursor = 0;
  const gapWav = path.join(tmp, "gap.wav");
  silenceWav(GAP_S, gapWav);

  for (let i = 0; i < rows.length; i++) {
    const text = String(rows[i].utterance || "").trim();
    const aiff = path.join(tmp, `say-${i}.aiff`);
    const rawWav = path.join(tmp, `raw-${i}.wav`);
    const segWav = path.join(tmp, `seg-${i}.wav`);
    execFileSync("say", ["-v", VOICE, text, "-o", aiff]);
    ff(["-i", aiff, "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", rawWav]);
    injectMicrogaps(rawWav, segWav, profile.microgaps, tmp);

    const segDur = probeDur(segWav);
    timings.push({ index: i, start: cursor, end: cursor + segDur });
    cursor += segDur;
    clipFiles.push(segWav);

    // gap after every segment except the last
    if (i < rows.length - 1) { clipFiles.push(gapWav); cursor += GAP_S; }
  }

  // 2. Concat into the dry speech track.
  const speechWav = path.join(tmp, "speech.wav");
  concat(clipFiles, speechWav, tmp);
  const totalDur = probeDur(speechWav);

  // 3. Speech-domain adversity: distance drift, packet-loss + bonded-handoff mutes.
  let speechFilters = [];
  if (profile.distance) speechFilters.push(distanceExpr(profile.distance));

  const muteWindows = [];
  if (profile.packet_loss) {
    const k = profile.packet_loss;
    const nBursts = Math.max(0, Math.round((totalDur / 60) * k.bursts_per_min));
    for (let i = 0; i < nBursts; i++) {
      const at = rand() * Math.max(0.1, totalDur - 0.3);
      const d = (k.burst_min_ms + rand() * (k.burst_max_ms - k.burst_min_ms)) / 1000;
      muteWindows.push([at, d]);
    }
  }
  if (profile.handoff) {
    const k = profile.handoff;
    for (let i = 0; i < k.count; i++) {
      const at = (k.at_fraction[i] ?? (0.5 + i * 0.05)) * totalDur;
      muteWindows.push([at, k.dur_s[i] ?? 2.0]);
    }
  }
  const mExpr = muteExpr(muteWindows);
  if (mExpr) speechFilters.push(mExpr);

  let stagedSpeech = speechWav;
  if (speechFilters.length) {
    stagedSpeech = path.join(tmp, "speech-staged.wav");
    ff(["-i", speechWav, "-af", speechFilters.join(","), "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", stagedSpeech]);
  }

  // 4. Build + mix beds (wind, ambience, crosstalk).
  const mixInputs = [stagedSpeech];
  if (profile.wind) {
    const w = path.join(tmp, "wind.wav");
    makeWind(totalDur, profile.wind, w);
    mixInputs.push(w);
  }
  if (profile.ambience) {
    const a = path.join(tmp, "amb.wav");
    makeAmbience(totalDur, profile.ambience, a);
    mixInputs.push(a);
  }
  if (profile.crosstalk) {
    // one crosstalk voice reading a filler line, gained down, placed mid-file
    const ct = profile.crosstalk;
    const ctAiff = path.join(tmp, "ct.aiff");
    const ctWav = path.join(tmp, "ct.wav");
    execFileSync("say", ["-v", ct.voice, "yeah no totally, i was just saying the same thing, it's wild out here", "-o", ctAiff]);
    ff(["-i", ctAiff, "-af", `volume=${ct.gain},adelay=${Math.round(totalDur * 300)}|${Math.round(totalDur * 300)}`, "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", ctWav]);
    mixInputs.push(ctWav);
  }

  const wavOut = outBase.endsWith(".wav") ? outBase : outBase + ".wav";
  if (mixInputs.length === 1) {
    ff(["-i", mixInputs[0], "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", wavOut]);
  } else {
    const inputs = mixInputs.flatMap((f) => ["-i", f]);
    const labels = mixInputs.map((_, i) => `[${i}:a]`).join("");
    ff([...inputs, "-filter_complex", `${labels}amix=inputs=${mixInputs.length}:duration=first:normalize=0[a]`, "-map", "[a]", "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", wavOut]);
  }

  // 5. Measure real adversity facts.
  const { lra, integrated } = measureLRA(wavOut);
  const fullDb = meanVol(wavOut, null);
  const subDb = meanVol(wavOut, `lowpass=f=200`);
  const measured = {
    lra_lu: lra,
    integrated_lufs: integrated,
    peak_dbfs: peakDb(wavOut),
    fullband_mean_db: fullDb,
    sub200_mean_db: subDb,
    sub200_delta_db: subDb != null && fullDb != null ? Math.round((subDb - fullDb) * 10) / 10 : null,
  };

  // 6. Build + write sidecar.
  const sidecar = buildSidecar({
    rows, timings, profile,
    audio: {
      path: path.relative(REPO_ROOT, wavOut),
      duration_s: probeDur(wavOut),
      sample_rate: SR,
      measured,
    },
    meta: { speech_source: `macos-say:${VOICE}`, generated_at: new Date().toISOString() },
  });
  const jsonOut = wavOut.replace(/\.wav$/, "") + ".sidecar.json";
  fs.writeFileSync(jsonOut, JSON.stringify(sidecar, null, 2) + "\n");

  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`profile: ${PROFILE_NAME}  seed: ${SEED}`);
  console.log(`wrote ${path.relative(REPO_ROOT, wavOut)}  (${sidecar.audio.duration_s}s, ${rows.length} segments, ${sidecar.counts.claims} claims)`);
  console.log(`wrote ${path.relative(REPO_ROOT, jsonOut)}`);
  console.log(`measured: LRA ${measured.lra_lu} LU · integrated ${measured.integrated_lufs} LUFS · peak ${measured.peak_dbfs} dBFS`);
  console.log(`          sub-200Hz ${measured.sub200_mean_db} dB vs full-band ${measured.fullband_mean_db} dB → delta ${measured.sub200_delta_db} dB`);
}

main();
