// Synthetic-audio ground-truth SIDECAR builder (NIGHTSPRINT S1).
//
// A synthetic fixture is a .wav plus a ground-truth .json "sidecar": what was
// said, at which timestamps, which claims it carries, and the expected
// category / verdict / gate-outcome. S2 (scoring) and S3 consume the sidecar
// WITHOUT reading this code — the contract is docs/../SIDECAR_SCHEMA.md.
//
// This module is the pure, unit-tested core: given the parsed claim-script rows
// and the per-segment placement (start/end seconds, produced by the ffmpeg
// timeline in gen-audio.js), it assembles the sidecar object. No ffmpeg, no I/O
// here — the generator does the audio and hands us measured timings.

// Mirrors src/core/editorial.js VERDICTS (the on-air verdict vocabulary the
// sidecar reuses so S2 can compare against real pipeline output). "None" is a
// sidecar-only sentinel for segments that carry no claim (filler / opinion).
export const SIDECAR_VERDICTS = ["True", "False", "Misleading", "Unverifiable", "NeedsContext", "None"];
// Gate outcome the pipeline is expected to take for a segment. Mirrors the
// TESTAIR run's three real outcomes plus explicit sentinels:
//   air   — a settled verdict is expected to reach the lower-third
//   hold  — expected to land in operator review, not auto-air (harm/polarity/low-confidence)
//   drop  — no card at all (opinion→claim:null, dedupe suppression, filler)
export const SIDECAR_GATES = ["air", "hold", "drop"];
export const SIDECAR_POLARITIES = ["asserts", "denies"];

const SIDECAR_VERSION = 1;

/**
 * Normalize + validate one claim-script row into a sidecar-segment shape,
 * carrying the timing the generator measured. Throws on contract violations so
 * a malformed script fails loud at generation time (never ships a bad key).
 *
 * @param {object} row parsed claim-script row: { utterance, claim, expected_polarity, category, expected_verdict, expected_gate, id? }
 * @param {{index:number,start:number,end:number}} timing measured placement in the wav
 * @returns {object} sidecar segment
 */
export function buildSegment(row, timing) {
  if (row == null || typeof row !== "object") throw new Error("claim-script row must be an object");
  const { index, start, end } = timing || {};
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`segment ${row.id ?? index}: invalid timing start=${start} end=${end}`);
  }
  const utterance = String(row.utterance ?? "").trim();
  if (!utterance) throw new Error(`segment ${row.id ?? index}: empty utterance`);

  // claim may legitimately be null (filler/opinion) — coerce falsy/empty to null.
  const claimRaw = row.claim == null ? null : String(row.claim).trim();
  const claim = claimRaw ? claimRaw : null;

  const gate = row.expected_gate ?? (claim ? "air" : "drop");
  if (!SIDECAR_GATES.includes(gate)) {
    throw new Error(`segment ${row.id ?? index}: expected_gate '${gate}' not in ${SIDECAR_GATES.join("/")}`);
  }

  const verdict = row.expected_verdict ?? (claim ? "Unverifiable" : "None");
  if (!SIDECAR_VERDICTS.includes(verdict)) {
    throw new Error(`segment ${row.id ?? index}: expected_verdict '${verdict}' not in ${SIDECAR_VERDICTS.join("/")}`);
  }
  // A "None" verdict must not be asked to air, and an airing segment must carry a claim.
  if (verdict === "None" && gate === "air") {
    throw new Error(`segment ${row.id ?? index}: verdict None cannot pair with gate air`);
  }
  if (gate === "air" && !claim) {
    throw new Error(`segment ${row.id ?? index}: gate air requires a non-null claim`);
  }

  const polarity = row.expected_polarity ?? "asserts";
  if (!SIDECAR_POLARITIES.includes(polarity)) {
    throw new Error(`segment ${row.id ?? index}: expected_polarity '${polarity}' not in ${SIDECAR_POLARITIES.join("/")}`);
  }

  return {
    id: row.id ?? `seg-${String(index).padStart(3, "0")}`,
    start_s: round3(start),
    end_s: round3(end),
    utterance,
    claim,
    expected_polarity: polarity,
    category: String(row.category ?? "UNCATEGORIZED"),
    expected_verdict: verdict,
    expected_gate: gate,
    // note is free text the script author may attach (why this segment exists /
    // what adversity it stresses); passthrough so S2 can surface it in failures.
    ...(row.note ? { note: String(row.note) } : {}),
  };
}

/**
 * Assemble the full sidecar from the claim script, measured segment timings, and
 * the adversity profile that shaped the audio.
 *
 * @param {object} args
 * @param {object[]} args.rows parsed claim-script rows (jsonl order)
 * @param {{index:number,start:number,end:number}[]} args.timings one per row, same order
 * @param {object} args.profile { name, ...knobs } — the resolved adversity profile
 * @param {object} [args.audio] measured audio facts { path, duration_s, sample_rate, lra_lu, sub200_delta_db }
 * @param {object} [args.meta] extra metadata (generator version, script path, seed…)
 * @returns {object} sidecar
 */
export function buildSidecar({ rows, timings, profile, audio = {}, meta = {} }) {
  if (!Array.isArray(rows) || !Array.isArray(timings) || rows.length !== timings.length) {
    throw new Error("rows and timings must be arrays of equal length");
  }
  const segments = rows.map((row, i) => buildSegment(row, timings[i]));

  const claimCount = segments.filter((s) => s.claim).length;
  const byGate = {};
  for (const g of SIDECAR_GATES) byGate[g] = segments.filter((s) => s.expected_gate === g).length;

  return {
    schema: "footnote.synthetic.sidecar",
    schema_version: SIDECAR_VERSION,
    generated_at: meta.generated_at ?? new Date().toISOString(),
    profile: profile?.name ?? "unknown",
    profile_knobs: stripName(profile),
    audio: {
      path: audio.path ?? null,
      duration_s: audio.duration_s != null ? round3(audio.duration_s) : null,
      sample_rate: audio.sample_rate ?? null,
      // measured adversity facts (real numbers from ffmpeg, not the profile targets)
      measured: audio.measured ?? null,
    },
    speech_source: meta.speech_source ?? null,
    counts: {
      segments: segments.length,
      claims: claimCount,
      by_gate: byGate,
    },
    segments,
  };
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}
function stripName(profile) {
  if (!profile || typeof profile !== "object") return {};
  const { name, ...rest } = profile;
  return rest;
}
