// Unit tests for the synthetic-audio ground-truth SIDECAR builder (S1).
// The sidecar is the scoring key S2/S3 consume, so its shape and validation are
// contract — these tests pin both.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSegment,
  buildSidecar,
  SIDECAR_VERDICTS,
  SIDECAR_GATES,
} from "../tools/synthetic/sidecar.js";

const T = (start, end, index = 0) => ({ index, start, end });

test("buildSegment: a claim-bearing row becomes an airing segment with rounded timing", () => {
  const seg = buildSegment(
    {
      id: "f1",
      utterance: "Sam Altman is the current chairman of the FCC.",
      claim: "Sam Altman is the chairman of the FCC.",
      expected_polarity: "asserts",
      category: "person_claims",
      expected_verdict: "False",
      expected_gate: "air",
    },
    T(1.23456, 4.98765)
  );
  assert.equal(seg.id, "f1");
  assert.equal(seg.start_s, 1.235);
  assert.equal(seg.end_s, 4.988);
  assert.equal(seg.claim, "Sam Altman is the chairman of the FCC.");
  assert.equal(seg.expected_verdict, "False");
  assert.equal(seg.expected_gate, "air");
  assert.equal(seg.expected_polarity, "asserts");
});

test("buildSegment: filler (null claim) defaults to verdict None / gate drop", () => {
  const seg = buildSegment(
    { id: "open", utterance: "Okay, we're rolling.", claim: null, category: "UNCATEGORIZED" },
    T(0, 2)
  );
  assert.equal(seg.claim, null);
  assert.equal(seg.expected_verdict, "None");
  assert.equal(seg.expected_gate, "drop");
});

test("buildSegment: empty-string claim coerces to null", () => {
  const seg = buildSegment({ utterance: "hi", claim: "   " }, T(0, 1));
  assert.equal(seg.claim, null);
});

test("buildSegment: passes through an author note", () => {
  const seg = buildSegment(
    { utterance: "x", claim: "X is true.", expected_verdict: "True", note: "sounds fake" },
    T(0, 1)
  );
  assert.equal(seg.note, "sounds fake");
});

test("buildSegment: rejects an unknown gate", () => {
  assert.throws(
    () => buildSegment({ utterance: "x", claim: "X.", expected_gate: "broadcast" }, T(0, 1)),
    /expected_gate/
  );
});

test("buildSegment: rejects an unknown verdict", () => {
  assert.throws(
    () => buildSegment({ utterance: "x", claim: "X.", expected_verdict: "Probably" }, T(0, 1)),
    /expected_verdict/
  );
});

test("buildSegment: rejects verdict None paired with gate air", () => {
  assert.throws(
    () => buildSegment({ utterance: "x", claim: "X.", expected_verdict: "None", expected_gate: "air" }, T(0, 1)),
    /None cannot pair with gate air/
  );
});

test("buildSegment: rejects gate air with a null claim", () => {
  assert.throws(
    () => buildSegment({ utterance: "x", claim: null, expected_verdict: "True", expected_gate: "air" }, T(0, 1)),
    /gate air requires a non-null claim/
  );
});

test("buildSegment: rejects invalid timing (end before start)", () => {
  assert.throws(() => buildSegment({ utterance: "x", claim: "X." }, T(5, 2)), /invalid timing/);
});

test("buildSegment: rejects empty utterance", () => {
  assert.throws(() => buildSegment({ utterance: "  ", claim: "X." }, T(0, 1)), /empty utterance/);
});

test("buildSidecar: assembles counts, gate histogram, and profile knobs", () => {
  const rows = [
    { id: "open", utterance: "rolling", claim: null, expected_gate: "drop", expected_verdict: "None" },
    { id: "f1", utterance: "false thing", claim: "A false thing.", expected_verdict: "False", expected_gate: "air" },
    { id: "priv1", utterance: "neighbor dave arrested", claim: "Dave was arrested.", expected_verdict: "Unverifiable", expected_gate: "hold" },
  ];
  const timings = [T(0, 2, 0), T(10, 13, 1), T(21, 24, 2)];
  const profile = { name: "windy_run", wind: { cutoff_hz: 200 }, microgaps: { rate_per_10s: 4 } };
  const sc = buildSidecar({
    rows,
    timings,
    profile,
    audio: { path: "x.wav", duration_s: 24.5, sample_rate: 48000, measured: { lra_lu: 16.7 } },
    meta: { speech_source: "macos-say:Alex", generated_at: "2026-08-14T00:00:00.000Z" },
  });
  assert.equal(sc.schema, "footnote.synthetic.sidecar");
  assert.equal(sc.schema_version, 1);
  assert.equal(sc.profile, "windy_run");
  assert.equal(sc.profile_knobs.wind.cutoff_hz, 200);
  assert.ok(!("name" in sc.profile_knobs), "profile name is not duplicated into knobs");
  assert.equal(sc.counts.segments, 3);
  assert.equal(sc.counts.claims, 2);
  assert.deepEqual(sc.counts.by_gate, { air: 1, hold: 1, drop: 1 });
  assert.equal(sc.audio.measured.lra_lu, 16.7);
  assert.equal(sc.speech_source, "macos-say:Alex");
  assert.equal(sc.segments.length, 3);
});

test("buildSidecar: rejects mismatched rows/timings lengths", () => {
  assert.throws(
    () => buildSidecar({ rows: [{ utterance: "x", claim: null }], timings: [], profile: { name: "clean" } }),
    /equal length/
  );
});

test("every gate/verdict the builder emits is in the documented enums", () => {
  // guardrail so the schema doc and code cannot silently drift on the vocabulary
  assert.deepEqual(SIDECAR_GATES, ["air", "hold", "drop"]);
  assert.deepEqual(SIDECAR_VERDICTS, ["True", "False", "Misleading", "Unverifiable", "NeedsContext", "None"]);
});
