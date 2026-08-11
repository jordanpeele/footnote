// Adapter registry: maps each pipeline domain to its active adapter module, selected by
// env var, with today's vendors as defaults. Static imports (no dynamic import) so
// Vercel's bundler traces every adapter; modules are side-effect-light so importing the
// inactive ones costs nothing.
//   FOOTNOTE_EXTRACTOR = anthropic-haiku (default) | stub
//   FOOTNOTE_VERIFIER  = perplexity (default)      | perplexity-twostep | brave-claude | concurrence | stub
//   FOOTNOTE_STT       = deepgram (default)        | stub
//   FOOTNOTE_STATE     = upstash (default)         | memory | stub
// perplexity-twostep is P4-C, built DARK: opt-in only, never the default, stays that way
// until it clears the D15 calibration bar (docs/VERIFY_TWOSTEP.md).
// brave-claude (issue #5) and concurrence (gap F-3) are also built DARK — the second
// independent verifier + the two-verifier concurrence gate. Opt-in only, never default,
// pending a spend-authorized calibration eval (docs/VERIFY_CONCURRENCE.md). concurrence's
// two engines are the FOOTNOTE_CONCURRENCE_A / _B env pair (default perplexity + brave-claude).
import * as anthropicHaiku from "../adapters/extractor/anthropic-haiku/index.js";
import * as extractorStub from "../adapters/extractor/_stub/index.js";
import * as perplexity from "../adapters/verifier/perplexity/index.js";
import * as perplexityTwostep from "../adapters/verifier/perplexity-twostep/index.js";
import * as braveClaude from "../adapters/verifier/brave-claude/index.js";
import * as concurrence from "../adapters/verifier/concurrence/index.js";
import * as verifierStub from "../adapters/verifier/_stub/index.js";
import * as deepgram from "../adapters/stt/deepgram/index.js";
import * as sttStub from "../adapters/stt/_stub/index.js";
import * as upstash from "../adapters/state/upstash/index.js";
import * as memoryState from "../adapters/state/memory-ws/index.js";
import * as stateStub from "../adapters/state/_stub/index.js";

const REGISTRY = {
  extractor: { "anthropic-haiku": anthropicHaiku, stub: extractorStub },
  verifier: { perplexity, "perplexity-twostep": perplexityTwostep, "brave-claude": braveClaude, concurrence, stub: verifierStub },
  stt: { deepgram, stub: sttStub },
  state: { upstash, memory: memoryState, stub: stateStub },
};
const ENV = { extractor: "FOOTNOTE_EXTRACTOR", verifier: "FOOTNOTE_VERIFIER", stt: "FOOTNOTE_STT", state: "FOOTNOTE_STATE" };
const DEFAULTS = { extractor: "anthropic-haiku", verifier: "perplexity", stt: "deepgram", state: "upstash" };

/**
 * @param {"extractor"|"verifier"|"stt"|"state"} domain
 * @returns {*} the active adapter module for that domain
 */
export function getAdapter(domain) {
  const table = REGISTRY[domain];
  if (!table) throw new Error("unknown adapter domain: " + domain);
  const envVar = ENV[domain];
  const chosen = process.env[envVar] || DEFAULTS[domain];
  // Stub adapters are dev/CI-only: in production a stub silently swallows real work
  // (e.g. the state stub's per-instance Maps make on-air publishes vanish while control
  // reports success — red-team M2). Routes already 500 cleanly on a registry throw.
  // ALLOW_STUBS=1 is the explicit CI escape hatch.
  if (/^_?stub$/i.test(chosen) && process.env.NODE_ENV === "production" && process.env.ALLOW_STUBS !== "1") {
    throw new Error(`${envVar}="${chosen}": stub adapters are disabled when NODE_ENV=production (set ALLOW_STUBS=1 to override, CI only)`);
  }
  const adapter = table[chosen];
  if (!adapter) throw new Error(`unknown ${domain} adapter "${chosen}" (from env ${envVar}; have: ${Object.keys(table).join(", ")})`);
  return adapter;
}

/**
 * Resolve a verifier adapter by its registry key, WITHOUT consulting FOOTNOTE_VERIFIER.
 * Used by the concurrence meta-verifier (src/adapters/verifier/concurrence/) to compose its
 * two configured sub-verifiers (FOOTNOTE_CONCURRENCE_A / _B) by name. Bypasses the stub
 * production guard on purpose — concurrence never defaults, and a caller opting into a stub
 * sub-verifier is an explicit dev/CI choice. Returns undefined for an unknown key so the
 * caller can throw a domain-specific error.
 * @param {string} nameKey
 * @returns {*} the verifier adapter module, or undefined
 */
export function getVerifierByName(nameKey) {
  return REGISTRY.verifier[nameKey];
}
