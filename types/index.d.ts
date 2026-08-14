// Hand-written barrel over the generated declarations (see tsconfig.types.json).
// One namespace per src/core public module. Regenerating the .d.ts files does
// not touch this file; update it only if a module is added/removed in src/core.
export * as editorial from "./core/editorial.js";
export * as errors from "./core/errors.js";
export * as grounding from "./core/grounding.js";
export * as polarity from "./core/polarity.js";
export * as polaritySignal from "./core/polarity-signal.js";
export * as registry from "./core/registry.js";
export * as spendgate from "./core/spendgate.js";
export * as tunables from "./core/tunables.js";
export * as utterance from "./core/utterance.js";
