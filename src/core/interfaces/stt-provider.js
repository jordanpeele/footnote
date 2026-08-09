// STTProvider — server-side speech-to-text services. Two jobs today:
//   1) transcribe: batch-transcribe one short browser-captured audio window (the chunked
//      /api/transcribe path; the browser sends ~2s Opus blobs, gets text back).
//   2) mintToken: mint a short-lived vendor access token so the browser can ALSO stream
//      straight to the vendor's realtime WebSocket without a server key in client source
//      (the /api/dg-token path). Optional — a provider with no browser-streaming story
//      may omit it, and the token route 501s.
//
// This repo is no-build plain JS: interfaces are JSDoc @typedefs (see claim-extractor.js
// for the full convention notes).
//
// An STTProvider adapter is an ES module (see src/adapters/stt/_stub/) exporting:
//   name, isConfigured, transcribe, and optionally mintToken.
//
// Error contract: throw `UpstreamError` (src/core/errors.js) with a client-safe message.
// For transcribe specifically: a network-level failure (vendor unreachable) is an
// UpstreamError with status=null; a non-2xx vendor response is an UpstreamError with the
// status set and any client-safe extras (e.g. { dg_ms }) in `meta` — routes spread `meta`
// into the error body. Plain Errors (e.g. response-JSON parse) propagate as a 500.

/**
 * @typedef {Object} TranscribeResult
 * @property {string} transcript     Plain transcript text ("" when nothing was heard).
 * @property {number} confidence     Vendor confidence 0..1 (0 when absent).
 * @property {number} ms             Vendor round-trip time in ms (server→vendor→server).
 * @property {number} bytes          Size of the audio payload that was sent.
 * @property {number} audioSeconds   Seconds of audio the vendor actually decoded.
 */

/**
 * @typedef {Object} STTProvider
 * @property {string} name
 *   Stable adapter id (matches its registry key); also used in the Server-Timing header.
 * @property {() => boolean} isConfigured
 *   True when the vendor credentials are present in the environment.
 * @property {(audio: Buffer, audioType: string) => Promise<TranscribeResult>} transcribe
 *   `audio` is the raw request body (size-gated by the route); `audioType` is its MIME
 *   type (e.g. "audio/webm"). The adapter owns model choice, query params, and any
 *   keyterm/vocabulary boosting.
 * @property {(credentials?: STTCredentials | null) => Promise<{accessToken: string, expiresIn: number}>} [mintToken]
 *   Mint a short-lived browser-usable token for the vendor's realtime streaming API.
 *   Optional (poll-only providers won't have one). `credentials` is the per-call BYOK
 *   key bundle below — null/undefined means "use the adapter's env-configured key".
 */

/**
 * Per-call credentials for a single mintToken() invocation (BYOK, Decision D13).
 * CONTRACT (R8): credentials are PER-CALL function arguments. Adapters resolve
 * `credentials?.deepgramKey || env default` at request-construction time and must NEVER
 * write to process.env to install a caller's key — env is instance-global on a warm
 * lambda and concurrent invocations would race, letting one user's key sign another
 * user's traffic. Env mutation as a credential mechanism is permanently banned
 * (test/credentials.test.js statically enforces this).
 * @typedef {Object} STTCredentials
 * @property {string} [deepgramKey]
 *   Room-scoped Deepgram key. Absent/null → the adapter uses its env default.
 */

export {};
