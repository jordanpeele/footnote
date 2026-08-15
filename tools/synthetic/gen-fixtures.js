#!/usr/bin/env node
// Regenerate the committed sample fixtures (S1 proof set) deterministically.
//   npm run synth:fixtures
// The .wav files are gitignored (large, regenerable); the .sidecar.json ground
// truth is committed. This script is the single source of the fixture set so the
// audio can be rebuilt byte-stable from script + profile + seed on any Mac.

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.join(HERE, "gen-audio.js");
const SCRIPT = path.join(HERE, "scripts", "street-claims.jsonl");
const OUTDIR = "daysprint/synthetic/fixtures";

// [profile, seed] — seed pinned so regeneration is reproducible.
const FIXTURES = [
  ["clean", 1337],          // control
  ["windy_run", 1337],      // KEYSTONE — reproduces 2026-08-14 Los Feliz
  ["shred_only", 1337],     // micro-gap shred, no wind
  ["dropout_siege", 1337],  // R-audio RED-TEAM: the WORST profile found — 8 mid-claim
                            // total-silence dropouts collapse word coverage to ~40%
                            // (words never reach STT; the window loses nothing it gets).
                            // See daysprint/handoffs/redteam-audio.md.
];

for (const [profile, seed] of FIXTURES) {
  console.log(`\n=== ${profile} (seed ${seed}) ===`);
  execFileSync("node", [
    GEN,
    "--script", SCRIPT,
    "--profile", profile,
    "--seed", String(seed),
    "--out", path.join(OUTDIR, profile),
  ], { stdio: "inherit" });
}
