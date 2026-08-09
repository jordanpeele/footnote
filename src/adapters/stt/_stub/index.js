// STTProvider stub — the minimal shape a contributor implements (see
// src/core/interfaces/stt-provider.js). No network, no keys; FOOTNOTE_STT=stub always
// hears silence. mintToken is optional in the contract; the stub includes one to show the
// shape (a poll-only provider would simply not export it, and /api/dg-token would 501).
export const name = "stub";
export function isConfigured() { return true; }

/** @type {import("../../../core/interfaces/stt-provider.js").STTProvider["transcribe"]} */
export async function transcribe(audio, _audioType) {
  return { transcript: "", confidence: 0, ms: 0, bytes: audio.length, audioSeconds: 0 };
}

/** @type {NonNullable<import("../../../core/interfaces/stt-provider.js").STTProvider["mintToken"]>} */
export async function mintToken(_credentials = null) {
  // CREDENTIALS ARE PER-CALL (D13/R8). A real adapter resolves
  // `credentials?.deepgramKey || process.env.<ITS_ENV_KEY>` at request-header
  // construction time. NEVER resolve credentials through env mutation — process.env is
  // instance-global, so a swap-and-restore races across concurrent invocations. Env
  // mutation as a credential mechanism is permanently banned (R8);
  // test/credentials.test.js enforces it statically.
  return { accessToken: "stub-token", expiresIn: 300 };
}
