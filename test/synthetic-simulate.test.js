// NIGHTSPRINT S2 — determinism + scorecard test for the stream simulator.
// Runs the SAME window→gate→extract→verify→air logic the --real path uses, but in
// --replay mode over an INLINE fixture — so CI scores the pipeline with no keys and no
// network. Asserts (a) the run is deterministic (identical scorecard across two runs) and
// (b) each gate path is exercised and scored correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runReplay, parseWav } from "../tools/synthetic/simulate.js";
import { runPipeline, airDecision } from "../tools/synthetic/window-sim.js";
import { score } from "../tools/synthetic/scorecard.js";

// Inline fixture: extract/verify keys are the exact rolling-window texts window-sim emits
// over `finals`. Exercises checked+aired, F2 dedupe, and no-claim. (R72: the D4
// person-hold is gone — the Dave card now airs like everything else with the toggle on.)
const FIXTURE = {
  profile: "s2-inline-selftest",
  autoAir: true,
  finals: [
    { t: 0,     text: "So here is something people get wrong all the time." },
    { t: 3200,  text: "Vitamin C prevents the common cold in healthy adults." },
    { t: 7000,  text: "And honestly I think that is just obvious to everyone." },
    { t: 11000, text: "Vitamin C prevents the common cold in healthy adults." },
    { t: 15000, text: "Um." },
    { t: 18000, text: "The Great Wall of China is visible from space with the naked eye." },
    { t: 23000, text: "My neighbor Dave got fired from his job last week for no reason." },
    { t: 28000, text: "What do you all think about that whole situation anyway?" },
  ],
  extract: {
    "So here is something people get wrong all the time.": { claim: null, ms: 260 },
    "So here is something people get wrong all the time. Vitamin C prevents the common cold in healthy adults.":
      { claim: "Vitamin C prevents the common cold in healthy adults", polarity: "asserts", category: "science_health", harm_class: "none", ms: 480 },
    "So here is something people get wrong all the time. Vitamin C prevents the common cold in healthy adults. And honestly I think that is just obvious to everyone.":
      { claim: "Vitamin C prevents the common cold in healthy adults", polarity: "asserts", category: "science_health", harm_class: "none", ms: 455 },
    "the time. Vitamin C prevents the common cold in healthy adults. And honestly I think that is just obvious to everyone. Vitamin C prevents the common cold in healthy adults.":
      { claim: "Vitamin C prevents the common cold in healthy adults", polarity: "asserts", category: "science_health", harm_class: "none", ms: 470 },
    "think that is just obvious to everyone. Vitamin C prevents the common cold in healthy adults. Um. The Great Wall of China is visible from space with the naked eye.":
      { claim: "The Great Wall of China is visible from space with the naked eye", polarity: "asserts", category: "science_health", harm_class: "none", ms: 520 },
    "in healthy adults. Um. The Great Wall of China is visible from space with the naked eye. My neighbor Dave got fired from his job last week for no reason.":
      { claim: "Dave was fired from his job last week", polarity: "asserts", category: "other", harm_class: "person_private", ms: 500 },
    "visible from space with the naked eye. My neighbor Dave got fired from his job last week for no reason. What do you all think about that whole situation anyway?":
      { claim: null, ms: 300 },
  },
  verify: {
    "Vitamin C prevents the common cold in healthy adults":
      { verdict: "False", confidence: 0.94, source: { name: "NIH", url: "https://ods.od.nih.gov/factsheets/VitaminC", tier: 3 }, autoAirEligible: true, polarity_conflict: false, ms: 2600 },
    "The Great Wall of China is visible from space with the naked eye":
      { verdict: "False", confidence: 0.9, source: { name: "Scientific American", url: "https://www.scientificamerican.com/x", tier: 3 }, autoAirEligible: true, polarity_conflict: false, ms: 2400 },
    "Dave was fired from his job last week":
      { verdict: "Unverifiable", confidence: 0.3, source: { name: "source", url: null, tier: 0 }, autoAirEligible: false, polarity_conflict: false, ms: 1800 },
  },
  claims: [
    { utterance: "Vitamin C prevents the common cold in healthy adults.", claim: "Vitamin C prevents the common cold in healthy adults", expected_polarity: "asserts", category: "science_health", expected_verdict: "False", expected_gate: "checked", expected_air: true },
    { utterance: "The Great Wall of China is visible from space with the naked eye.", claim: "The Great Wall of China is visible from space with the naked eye", expected_polarity: "asserts", category: "science_health", expected_verdict: "False", expected_gate: "checked", expected_air: true },
    { utterance: "My neighbor Dave got fired from his job last week for no reason.", claim: "Dave was fired from his job last week", expected_polarity: "asserts", category: "other", expected_verdict: "Unverifiable", expected_gate: "checked", expected_air: true },
    { utterance: "What do you all think about that whole situation anyway?", claim: null, expected_gate: "no-claim" },
  ],
};

test("S2 --replay is deterministic: identical scorecard across runs", async () => {
  const a = await runReplay(FIXTURE, { profile: FIXTURE.profile, claims: FIXTURE.claims });
  const b = await runReplay(FIXTURE, { profile: FIXTURE.profile, claims: FIXTURE.claims });
  assert.deepEqual(a.scorecard, b.scorecard, "scorecard must be byte-identical run-to-run");
});

test("S2 scorecard scores every gate path correctly on the inline fixture", async () => {
  const { scorecard: sc } = await runReplay(FIXTURE, { profile: FIXTURE.profile, claims: FIXTURE.claims });
  // gate distribution proves each path was exercised
  assert.equal(sc.gate_distribution.checked, 3, "three claims reach a verdict (R72: Dave's card airs instead of holding)");
  assert.equal(sc.gate_distribution.dedupe, 2, "F2 dedupe drops the repeated vitamin-C windows");
  assert.equal(sc.gate_distribution["person-hold"] ?? 0, 0, "R72: the person-hold gate no longer exists");
  assert.equal(sc.gate_distribution["no-claim"], 2, "filler + question produce no claim");
  // perfect scores on the paths the fixture pins
  assert.equal(sc.metrics.gate_correctness_pct, 100, "the right gate fired for every expected claim");
  assert.equal(sc.metrics.verdict_accuracy_pct, 100, "verdicts match ground truth");
  assert.equal(sc.metrics.air_accuracy_pct, 100, "air decisions match ground truth");
  assert.equal(sc.metrics.category_accuracy_pct, 100, "categories match");
  assert.equal(sc.totals.aired, 3, "every settled check auto-airs (R72 — the toggle is the gate)");
  // latency waterfall carries the RELAY placeholder stage
  assert.equal(sc.latency_waterfall_ms.relay.n, 0);
  assert.ok(sc.latency_waterfall_ms.relay.note.includes("PLACEHOLDER"));
  assert.equal(sc.latency_waterfall_ms.verify.n, 3); // vitamin-C, Great Wall, Dave all verify and all air
});

test("airDecision (R72): the toggle is the whole gate — everything settled airs, off means nothing airs", () => {
  assert.deepEqual(airDecision({ harm_class: "person_private", category: "other", verdict: "Unverifiable", confidence: 0.3, autoAirEligible: false, source: { url: null } }), { aired: true, reason: "aired" });
  assert.deepEqual(airDecision({ polarity_conflict: true, category: "economics", verdict: "False", confidence: 0.5 }), { aired: true, reason: "aired" });
  assert.deepEqual(airDecision({ category: "science_health", verdict: "False", confidence: 0.9, autoAirEligible: true, source: { url: "x" } }), { aired: true, reason: "aired" });
  assert.deepEqual(airDecision({ category: "science_health", verdict: "False", confidence: 0.9 }, false), { aired: false, reason: "autoair-off" });
});

test("runPipeline drives the shared window state machine (windows == app.js loop)", async () => {
  const run = await runPipeline(FIXTURE.finals, { extractFn: async () => ({ claim: null, ms: 0 }), verifyFn: async () => ({ verdict: null, ms: 0 }) });
  // eight punctuated finals with fresh words → seven terminal windows (first two collapse via winLastSent)
  assert.equal(run.windows.length, 7);
  assert.ok(run.windows.every((w) => w.reason === "terminal"));
  assert.equal(run.spokenWords, FIXTURE.finals.reduce((n, f) => n + f.text.split(/\s+/).length, 0));
});

// The --real path decodes a fixture WAV before streaming it to Deepgram. Prove the
// decoder (16-bit PCM, stereo→mono downmix) without needing keys or the network.
test("parseWav decodes 16-bit PCM and downmixes stereo to mono", () => {
  const build = (channels) => {
    const sr = 8000, frames = 400;
    const data = Buffer.alloc(frames * channels * 2);
    for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) data.writeInt16LE(c === 0 ? 1000 : -1000, (i * channels + c) * 2);
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
    h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
    h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36); h.writeUInt32LE(data.length, 40);
    return Buffer.concat([h, data]);
  };
  const mono = parseWav(build(1));
  assert.equal(mono.sampleRate, 8000);
  assert.equal(mono.pcm.length, 400);
  assert.equal(mono.pcm[0], 1000);
  const stereo = parseWav(build(2));
  assert.equal(stereo.pcm.length, 400, "stereo downmixes to channel-0 mono");
  assert.equal(stereo.pcm[0], 1000, "keeps channel 0");
  assert.throws(() => parseWav(Buffer.from("not a wav file padding padding")), /RIFF|WAVE/);
});

// score() is pure — a sidecar with no claims must not throw and returns null metrics.
test("score() tolerates an empty sidecar", () => {
  const sc = score({ windows: [], checks: [], finals: 0, spokenWords: 0 }, { profile: "empty", claims: [] });
  assert.equal(sc.metrics.claim_recall_pct, null);
  assert.equal(sc.totals.expected_claims, 0);
});
