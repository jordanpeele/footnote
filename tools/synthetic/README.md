# tools/synthetic — synthetic street-audio generator (S1)

Manufactures realistic street-audio fixtures with controllable adversity plus a
ground-truth **sidecar** JSON, so field failures (wind, endpointing shred,
handoff dropouts) reproduce on demand for the scoring harness (S2) and beyond.

- `gen-audio.js` — the generator. `--script <claims.jsonl> --profile <name> --out <basename>`.
  Synthesizes speech (macOS `say`), injects adversity per profile, measures the
  result, and emits `<basename>.wav` + `<basename>.sidecar.json`.
- `gen-fixtures.js` — rebuilds the committed sample fixtures (`npm run synth:fixtures`).
- `profiles.js` — adversity knobs + named profiles (documented in `../daysprint/synthetic/PROFILES.md`).
- `sidecar.js` — pure, unit-tested ground-truth sidecar builder (schema in `../daysprint/synthetic/SIDECAR_SCHEMA.md`).
- `scripts/street-claims.jsonl` — the claim script that reproduces the 2026-08-14 run's content.

## Claim-script format (jsonl, one row per utterance)

```jsonc
{"id":"f1","utterance":"Did you know Sam Altman is chairman of the FCC?",
 "claim":"Sam Altman is the chairman of the FCC.","expected_polarity":"asserts",
 "category":"person_claims","expected_verdict":"False","expected_gate":"air","note":"absurd authority"}
```

`claim:null` = filler/opinion/injection (no card expected). Verdict/gate enums and
sidecar shape: `../daysprint/synthetic/SIDECAR_SCHEMA.md`.

## Quick start

```bash
npm run synth:fixtures    # clean, windy_run (keystone), shred_only
npm run synth -- --script tools/synthetic/scripts/street-claims.jsonl --profile busy_street --out /tmp/busy
```

Requires macOS `say`, `ffmpeg`, `ffprobe`. `.wav` output is gitignored (regenerable); sidecars are committed.
