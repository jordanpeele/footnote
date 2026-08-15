# Synthetic fixture SIDECAR schema (S1)

Every fixture the generator emits is a pair: `<name>.wav` (the audio) and
`<name>.sidecar.json` (the **ground truth**). S2 (scoring) and S3 consume the
sidecar to grade what the pipeline did against what was actually said — they do
**not** need to read the generator code. This file is the contract.

Producer: `tools/synthetic/sidecar.js` (`buildSidecar`). `schema_version` bumps
on any breaking change; consumers should assert it.

## Top level

```jsonc
{
  "schema": "footnote.synthetic.sidecar",   // constant identifier
  "schema_version": 1,                        // integer; assert this
  "generated_at": "2026-08-14T05:27:09.781Z", // ISO 8601 UTC
  "profile": "windy_run",                     // adversity profile name (see PROFILES.md)
  "profile_knobs": { ... },                   // fully-resolved knob values used (audit trail)
  "audio": { ... },                           // see "audio" below
  "speech_source": "macos-say:Alex",          // how the clean speech was synthesized
  "counts": { ... },                          // see "counts" below
  "segments": [ ... ]                         // see "segments" below — the scoring key
}
```

## `audio`

Measured facts about the emitted wav (real ffmpeg measurements, **not** the
profile targets):

```jsonc
"audio": {
  "path": "daysprint/synthetic/fixtures/windy_run.wav", // repo-relative
  "duration_s": 383.653,
  "sample_rate": 48000,
  "measured": {
    "lra_lu": 16.7,             // EBU R128 loudness range (ffmpeg ebur128 Summary)
    "integrated_lufs": -10.7,   // integrated loudness
    "peak_dbfs": 0.000265,      // sample peak (~0 dBFS = gusts slamming the ceiling)
    "fullband_mean_db": -10.0,  // volumedetect mean, full band
    "sub200_mean_db": -10.5,    // volumedetect mean after lowpass 200 Hz
    "sub200_delta_db": -0.5     // sub200_mean − fullband_mean; near 0 = wind rumble present
  }
}
```

`sub200_delta_db` is the wind fingerprint: on clean speech the sub-200 Hz band
trails the full band by ~4 dB (and 10-15 dB in real field recordings); under wind
it rises to within ~2 dB. `measured` is `null` if measurement was skipped.

## `counts`

```jsonc
"counts": {
  "segments": 31,              // total spoken segments
  "claims": 25,                // segments whose claim is non-null
  "by_gate": { "air": 22, "hold": 1, "drop": 8 }
}
```

## `segments` — the scoring key

Ordered by time. One entry per spoken utterance in the claim script.

```jsonc
{
  "id": "f1",                  // stable id from the claim script (or seg-000…)
  "start_s": 3.921,            // utterance start in the wav (post micro-gap injection)
  "end_s": 8.104,              // utterance end in the wav
  "utterance": "So here's one. Did you know Sam Altman is the current chairman of the FCC?",
  "claim": "Sam Altman is the chairman of the FCC.", // null for filler/opinion/injection
  "expected_polarity": "asserts",  // "asserts" | "denies"
  "category": "person_claims",     // matches eval/golden category vocabulary
  "expected_verdict": "False",     // see enum below
  "expected_gate": "air",          // see enum below
  "note": "absurd authority"       // optional: author's rationale / what it stresses
}
```

### `expected_verdict` enum

`"True"`, `"False"`, `"Misleading"`, `"Unverifiable"`, `"NeedsContext"` mirror
`src/core/editorial.js` `VERDICTS`. `"None"` is a **sidecar-only sentinel** for
segments carrying no factual claim (filler, opinion, prompt injection) — the
pipeline should produce no verdict at all.

### `expected_gate` enum

What the pipeline is expected to **do** with the segment, from the TESTAIR run's
real outcomes:

| gate   | meaning | example |
|--------|---------|---------|
| `air`  | a settled verdict reaches the lower third | a checkable claim |
| `hold` | lands in operator review, must NOT auto-air | named private person (harm hold), suspect polarity, low confidence |
| `drop` | no card at all | opinion → `claim:null`, dedupe suppression, filler, prompt injection |

### Timing semantics

`start_s`/`end_s` are measured **after** micro-gap injection, so they bound the
segment's audio span including any intra-segment shred silences. This is what a
consumer needs to align pipeline output (STT finals, cards) to the source
utterance. The window semantics that must reconstruct a claim from shredded
finals live in `src/core/utterance.js` (W1.3 rolling window); a scorer checks
whether the claim in each `air`/`hold` segment was recovered within
`[start_s, end_s]` (+ the trailing-silence flush tail).

## Consuming safely

1. Assert `schema === "footnote.synthetic.sidecar"` and `schema_version === 1`.
2. Iterate `segments`; for each, compare the pipeline's action within
   `[start_s, end_s]` against `expected_gate`, and (when `expected_gate` is
   `air`/`hold`) the produced verdict/category/polarity against the `expected_*`
   fields. `claim === null` segments must yield no card (`drop`).
3. Dedupe cases (`dupe-b`, gate `drop` with a non-null `claim`) test that the
   SECOND occurrence is suppressed — the claim IS present but must not card.
