// Adversity KNOBS and named PROFILES for the synthetic-audio generator (S1).
//
// Each knob is one documented dimension of street-capture adversity mapped to a
// real-world cause (see daysprint/synthetic/PROFILES.md). gen-audio.js turns
// these into an ffmpeg filtergraph; the defaults reproduce the 2026-08-14 Los
// Feliz run report (wind LRA ~18.8, sub-200Hz within ~2 dB of full band, 150-400ms
// SRT micro-gaps that shredded speech, two ~2s bonded-handoff dropouts).
//
// A "knob" is an object the generator knows how to render. Absent/false knobs are
// no-ops. A PROFILE is a named composition of knobs.

// ---- KNOB DEFAULTS (documented in PROFILES.md) -------------------------------

// wind/gust — low-frequency rumble that gusts to near full-scale over speech.
// Reproduces the run report's "wind owns the capture": LRA blows out because loud
// gust windows sit next to quiet speech windows; sub-200Hz rises to within a couple
// dB of the full band (clean voice trails the sub-band by 10-15 dB).
export const WIND_DEFAULT = {
  // brown noise = -6 dB/oct, the natural spectral tilt of wind rumble
  color: "brown",
  // hard low-frequency shelf: two cascaded lowpasses at this cutoff (Hz)
  cutoff_hz: 200,
  // gust envelope: sparse, tall spikes so some 3s loudness windows saturate near
  // 0 dBFS while most stay at quiet-speech level — this bimodality is what drives LRA.
  // periods (s) of the incommensurate gust oscillators; amp/sharpness tune height/width.
  gust_periods_s: [23.0, 37.0, 53.0],
  gust_amp: 20.0,       // pre-limiter gain on each gust term
  gust_sharpness: 40,   // exponent on max(0,sin) — higher = narrower, sparser gusts
  floor: 0.0,           // between-gust rumble floor (0 = quiet lulls, maximizes LRA)
  limit: 0.99,          // alimiter ceiling (near-0 dBFS peaks, matches the run report)
};

// srt_microgaps — 150-400ms silences dropped INTO speech at speech-plausible
// intervals. This is the shred cause: Deepgram finalizes at each micro-gap, so one
// spoken thought arrives as 2-5 one-word finals (the run's 244 finals / median 1 word).
export const MICROGAPS_DEFAULT = {
  min_ms: 150,
  max_ms: 400,
  // expected gaps per 10s of speech (Poisson-ish spacing via deterministic PRNG)
  rate_per_10s: 4,
};

// packet_loss — short burst mutes (transport, not handoff): brief 40-160ms dropouts
// clustered in bursts, the audible signature of un-recovered SRT packet loss.
export const PACKET_LOSS_DEFAULT = {
  burst_min_ms: 40,
  burst_max_ms: 160,
  bursts_per_min: 3,
};

// bonded_handoff — full ~2s silences: the run saw two back-to-back total-silence
// dropouts (2.0s + 2.6s) at a cell handoff; the bond recovered both. Models the
// worst-case gap the window/assembler must survive.
export const HANDOFF_DEFAULT = {
  count: 2,
  dur_s: [2.0, 2.6],
  // where to place them, as a fraction of total duration (0..1)
  at_fraction: [0.55, 0.58],
};

// distance/level — slow gain drift as the speaker moves toward/away from the mic.
export const DISTANCE_DEFAULT = {
  min_gain: 0.45,
  max_gain: 1.0,
  period_s: 23.0,
};

// crosstalk — a second synthetic speaker bleeds in under the primary (bystander).
export const CROSSTALK_DEFAULT = {
  voice: "Samantha",
  gain: 0.28,
  // fraction of segments that get a crosstalk bleed
  density: 0.25,
};

// ambience — steady café/traffic bed (pink noise + optional low hum).
export const AMBIENCE_DEFAULT = {
  kind: "traffic", // "traffic" | "cafe"
  gain: 0.12,
};

// ---- PROFILES ---------------------------------------------------------------

/** Deep-merge a knob default with an override (override wins per key). */
function knob(def, override) {
  if (override === false) return false;
  if (override == null || override === true) return { ...def };
  return { ...def, ...override };
}

/**
 * Resolve a named profile into a fully-specified knob set the generator renders.
 * @param {string} name
 * @returns {object} { name, wind, microgaps, packet_loss, handoff, distance, crosstalk, ambience }
 */
export function resolveProfile(name) {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown profile '${name}'. Known: ${Object.keys(PROFILES).join(", ")}`);
  return {
    name,
    wind: p.wind ? knob(WIND_DEFAULT, p.wind) : false,
    microgaps: p.microgaps ? knob(MICROGAPS_DEFAULT, p.microgaps) : false,
    packet_loss: p.packet_loss ? knob(PACKET_LOSS_DEFAULT, p.packet_loss) : false,
    handoff: p.handoff ? knob(HANDOFF_DEFAULT, p.handoff) : false,
    distance: p.distance ? knob(DISTANCE_DEFAULT, p.distance) : false,
    crosstalk: p.crosstalk ? knob(CROSSTALK_DEFAULT, p.crosstalk) : false,
    ambience: p.ambience ? knob(AMBIENCE_DEFAULT, p.ambience) : false,
    description: p.description ?? "",
  };
}

export const PROFILES = {
  // Baseline: clean speech, no adversity. The control S2 scores everything against.
  clean: {
    description: "Clean synthesized speech with silence gaps. No adversity. Control fixture.",
  },

  // THE KEYSTONE — reproduces 2026-08-14 Los Feliz: wind-owned capture + the
  // micro-gap shred + the two bonded-handoff dropouts. Everything else is a lens
  // on this one.
  windy_run: {
    description: "Reproduces the 2026-08-14 Los Feliz run: wind gusts (LRA ~18.8, sub-200Hz within ~2 dB of full band), SRT micro-gaps that shred speech into 1-word finals, and two ~2s bonded-handoff dropouts.",
    wind: true,
    microgaps: true,
    handoff: true,
    distance: { min_gain: 0.5, max_gain: 1.0, period_s: 31.0 },
  },

  // Isolated shred: micro-gaps only, no wind. For proving the W1.3 window recovers
  // coverage when the ONLY adversity is endpointing-driven shredding.
  shred_only: {
    description: "SRT micro-gaps only (no wind). Isolates the endpointing-shred failure the rolling window is meant to fix.",
    microgaps: { rate_per_10s: 6 },
  },

  // Transport stress: packet-loss bursts + a bonded handoff, no wind. Proves the
  // pipeline survives dropped audio that is NOT the capture's fault.
  bonded_dropout: {
    description: "Packet-loss bursts plus bonded-handoff total-silence dropouts. Transport adversity with clean capture.",
    packet_loss: true,
    handoff: true,
  },

  // Busy street: ambience bed + crosstalk + mild wind + distance drift. The
  // 'everything at once, moderate' profile for realistic-but-survivable capture.
  busy_street: {
    description: "Café/traffic ambience, a second-speaker bleed, mild wind, and distance drift. Realistic busy-sidewalk capture.",
    ambience: true,
    crosstalk: true,
    wind: { gust_amp: 9.0, gust_sharpness: 18, floor: 0.03 },
    distance: true,
  },

  // ===== R-audio RED-TEAM PROFILES (NIGHTSPRINT) ================================
  // Adversarial sweep against the W1.3 window. Each cranks one knob past the
  // keystone or stacks them, to hunt for the setting where word-coverage collapses
  // toward the 27% run-test baseline. See daysprint/handoffs/redteam-audio.md.

  // Extreme sustained wind: a high floor (constant rumble, no lulls) + tall dense
  // gusts. The floor is the weapon — a between-gust rumble ~0.35 pre-limiter sits
  // ON TOP of speech for the whole file, not just in gust windows, so Deepgram sees
  // sub-200Hz energy above voice continuously (the run report's "sub-band within
  // 2 dB of full band", made permanent). Tests: does STT drop words when rumble
  // never lets up?
  wind_extreme: {
    description: "RED-TEAM: sustained near-full-scale wind — high constant rumble floor plus dense tall gusts. No quiet windows. Hunts the level where wind rumble masks speech into Deepgram dropping words.",
    wind: { floor: 0.38, gust_amp: 34.0, gust_sharpness: 10, gust_periods_s: [7.0, 11.0, 17.0], limit: 0.995 },
  },

  // Dense micro-gaps BELOW the window's silence threshold. rate_per_10s cranked so
  // Deepgram finalizes constantly (1-word finals), but every gap < WINDOW_TRAIL_SILENCE
  // (1500ms) so the trailing-silence flush never fires early — the window must ride on
  // cadence + min-new-words alone. Directly attacks the shred the window claims to fix.
  microgap_storm: {
    description: "RED-TEAM: dense micro-gaps (rate 12/10s, 150-380ms, all below the 1500ms window silence threshold). Maximal endpointing shred that never trips the silence flush. The window's home-turf attack.",
    microgaps: { rate_per_10s: 12, min_ms: 150, max_ms: 380 },
  },

  // Long bonded dropouts placed MID-CLAIM: many multi-second total-silence mutes
  // scattered across the file (not just at 0.55). Each can bisect a spoken claim so
  // half the words never reach STT. Tests window survival of transport black holes.
  dropout_siege: {
    description: "RED-TEAM: eight 2.5-4s bonded-handoff total-silence dropouts scattered across the file, each able to bisect a claim. Transport black holes vs the window.",
    handoff: {
      count: 8,
      dur_s: [2.5, 3.0, 4.0, 2.5, 3.5, 3.0, 4.0, 2.5],
      at_fraction: [0.08, 0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.90],
    },
  },

  // Packet-loss burst storm: frequent long mutes (un-recovered SRT). Distinct from
  // handoff — many short-to-mid bursts riddling every second of speech.
  packet_storm: {
    description: "RED-TEAM: heavy packet-loss burst storm (20/min, 80-320ms) riddling all speech with un-recovered dropouts.",
    packet_loss: { burst_min_ms: 80, burst_max_ms: 320, bursts_per_min: 20 },
  },

  // Very low level / far mic: speaker mostly off-mic. gain floored near 0.12 so most
  // speech sits near the STT noise floor. Tests whether quiet speech simply isn't
  // transcribed.
  faint: {
    description: "RED-TEAM: very low capture level (gain 0.10-0.30, far-mic drift). Speech near the STT floor — tests words simply not transcribed.",
    distance: { min_gain: 0.10, max_gain: 0.30, period_s: 19.0 },
  },

  // Breaking-point ladder for the dropout attack: 2 / 4 / 6 mid-claim total-silence
  // dropouts (dropout_siege is the 8-rung). Used to locate the knob setting where
  // coverage crosses below the 50% / 27% lines. All 3s mutes on the redteam script.
  dropout_2: {
    description: "RED-TEAM ladder: 2 mid-claim 3s dropouts.",
    handoff: { count: 2, dur_s: [3.0, 3.0], at_fraction: [0.30, 0.66] },
  },
  dropout_4: {
    description: "RED-TEAM ladder: 4 mid-claim 3s dropouts.",
    handoff: { count: 4, dur_s: [3.0, 3.0, 3.0, 3.0], at_fraction: [0.18, 0.40, 0.62, 0.84] },
  },
  dropout_6: {
    description: "RED-TEAM ladder: 6 mid-claim 3s dropouts.",
    handoff: { count: 6, dur_s: [3.0, 3.0, 3.0, 3.0, 3.0, 3.0], at_fraction: [0.12, 0.28, 0.44, 0.58, 0.72, 0.86] },
  },

  // THE KITCHEN SINK — everything cranked at once. If any single profile breaks the
  // window this stack should break it hardest. The worst-case adversarial ceiling.
  worst_case: {
    description: "RED-TEAM: all knobs cranked — sustained wind + micro-gap storm + dropout siege + packet storm + faint level. The maximum-adversity ceiling.",
    wind: { floor: 0.30, gust_amp: 28.0, gust_sharpness: 12, gust_periods_s: [7.0, 11.0, 17.0], limit: 0.995 },
    microgaps: { rate_per_10s: 10, min_ms: 150, max_ms: 380 },
    handoff: { count: 6, dur_s: [3.0, 3.5, 4.0, 3.0, 3.5, 4.0], at_fraction: [0.12, 0.26, 0.40, 0.55, 0.70, 0.85] },
    packet_loss: { burst_min_ms: 80, burst_max_ms: 300, bursts_per_min: 14 },
    distance: { min_gain: 0.28, max_gain: 0.7, period_s: 23.0 },
  },
};

export const KNOB_DEFAULTS = {
  wind: WIND_DEFAULT,
  microgaps: MICROGAPS_DEFAULT,
  packet_loss: PACKET_LOSS_DEFAULT,
  handoff: HANDOFF_DEFAULT,
  distance: DISTANCE_DEFAULT,
  crosstalk: CROSSTALK_DEFAULT,
  ambience: AMBIENCE_DEFAULT,
};
