export type TranscribeResult = {
    /**
     * Plain transcript text ("" when nothing was heard).
     */
    transcript: string;
    /**
     * Vendor confidence 0..1 (0 when absent).
     */
    confidence: number;
    /**
     * Vendor round-trip time in ms (server→vendor→server).
     */
    ms: number;
    /**
     * Size of the audio payload that was sent.
     */
    bytes: number;
    /**
     * Seconds of audio the vendor actually decoded.
     */
    audioSeconds: number;
};
export type STTProvider = {
    /**
     *   Stable adapter id (matches its registry key); also used in the Server-Timing header.
     */
    name: string;
    /**
     *   True when the vendor credentials are present in the environment.
     */
    isConfigured: () => boolean;
    /**
     *   `audio` is the raw request body (size-gated by the route); `audioType` is its MIME
     *   type (e.g. "audio/webm"). The adapter owns model choice, query params, and any
     *   keyterm/vocabulary boosting.
     */
    transcribe: (audio: Buffer, audioType: string) => Promise<TranscribeResult>;
    /**
     * Mint a short-lived browser-usable token for the vendor's realtime streaming API.
     * Optional (poll-only providers won't have one). `credentials` is the per-call BYOK
     * key bundle below — null/undefined means "use the adapter's env-configured key".
     */
    mintToken?: (credentials?: STTCredentials | null) => Promise<{
        accessToken: string;
        expiresIn: number;
    }>;
};
export type STTCredentials = {
    /**
     * Room-scoped Deepgram key. Absent/null → the adapter uses its env default.
     */
    deepgramKey?: string;
};
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
