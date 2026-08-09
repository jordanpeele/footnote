// Adapter registry: maps each pipeline domain to its active adapter module, selected by
// env var, with today's vendors as defaults. Static imports (no dynamic import) so
// Vercel's bundler traces every adapter; modules are side-effect-light so importing the
// inactive ones costs nothing.
//   FOOTNOTE_EXTRACTOR = anthropic-haiku (default) | stub
//   FOOTNOTE_VERIFIER  = perplexity (default)      | perplexity-twostep | stub
//   FOOTNOTE_STT       = deepgram (default)        | stub
//   FOOTNOTE_STATE     = upstash (default)         | memory | stub
// perplexity-twostep is P4-C, built DARK: opt-in only, never the default, stays that way
// until it clears the D15 calibration bar (docs/VERIFY_TWOSTEP.md).
import * as anthropicHaiku from "../adapters/extractor/anthropic-haiku/index.js";
import * as extractorStub from "../adapters/extractor/_stub/index.js";
import * as perplexity from "../adapters/verifier/perplexity/index.js";
import * as perplexityTwostep from "../adapters/verifier/perplexity-twostep/index.js";
import * as verifierStub from "../adapters/verifier/_stub/index.js";
import * as deepgram from "../adapters/stt/deepgram/index.js";
import * as sttStub from "../adapters/stt/_stub/index.js";
import * as upstash from "../adapters/state/upstash/index.js";
import * as memoryState from "../adapters/state/memory-ws/index.js";
import * as stateStub from "../adapters/state/_stub/index.js";

const REGISTRY = {
  extractor: { "anthropic-haiku": anthropicHaiku, stub: extractorStub },
  verifier: { perplexity, "perplexity-twostep": perplexityTwostep, stub: verifierStub },
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
