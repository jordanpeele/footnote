// STTProvider adapter: Deepgram (implements src/core/interfaces/stt-provider.js).
//   transcribe — nova-3 batch transcription of one short browser audio window
//   mintToken  — short-lived access token grant so the browser can stream to Deepgram's
//                realtime WS without a Deepgram key in client source (needs a
//                grant-capable Member-scope key in DEEPGRAM_API_KEY; the client
//                authenticates its WebSocket with ["bearer", access_token])
import { UpstreamError } from "../../../core/errors.js";

export const name = "deepgram";
export function isConfigured() { return Boolean(process.env.DEEPGRAM_API_KEY); }

// keyterm prompting (nova-3): boost the exact proper nouns / domain terms that drive
// the market lookups, so they're transcribed correctly (e.g. Khamenei, not Khomeini).
const KEYTERMS = [
  "Iran", "Tehran", "Khamenei", "Pahlavi", "Reza Pahlavi", "ayatollah",
  "Strait of Hormuz", "IAEA", "nuclear deal", "sanctions", "embassy", "Knesset",
  "Netanyahu", "Trump", "Shane Smith", "Supreme Leader", "Senate", "midterms",
  "Federal Reserve", "Powell", "inflation", "recession", "Congress", "Speaker",
];

/** @type {import("../../../core/interfaces/stt-provider.js").STTProvider["transcribe"]} */
export async function transcribe(audio, audioType) {
  const key = process.env.DEEPGRAM_API_KEY;
  const kt = KEYTERMS.map((t) => "keyterm=" + encodeURIComponent(t)).join("&");
  const qs = "model=nova-3&smart_format=true&punctuate=true&language=en&" + kt;
  let dg;
  const dgStart = Date.now();                        // instrumentation: time the Deepgram round-trip
  try {
    dg = await fetch("https://api.deepgram.com/v1/listen?" + qs, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": audioType },
      body: audio,
    });
  } catch (e) { throw new UpstreamError("deepgram unreachable"); }
  if (!dg.ok) {
    const t = await dg.text().catch(() => "");
    console.error("deepgram error", dg.status, t.slice(0, 300));   // log server-side only
    throw new UpstreamError("transcription failed", { status: dg.status, detail: t.slice(0, 300), meta: { dg_ms: Date.now() - dgStart } });
  }
  const j = await dg.json();
  const ms = Date.now() - dgStart;
  const alt = j?.results?.channels?.[0]?.alternatives?.[0] || {};
  const dur = j?.metadata?.duration || 0;            // audio seconds Deepgram decoded
  return { transcript: alt.transcript || "", confidence: alt.confidence || 0, ms, bytes: audio.length, audioSeconds: dur };
}

/** @type {NonNullable<import("../../../core/interfaces/stt-provider.js").STTProvider["mintToken"]>} */
export async function mintToken(credentials = null) {
  // BYOK (D13/R8): per-call credential, resolved at header-construction time. NEVER via
  // env mutation — that races across concurrent invocations in a warm lambda.
  const key = credentials?.deepgramKey || process.env.DEEPGRAM_API_KEY;
  const r = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: "Token " + key, "content-type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 300 }),
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 200);
    console.error("dg-token upstream error", r.status, detail);
    throw new UpstreamError("grant failed", { status: r.status, detail });
  }
  const j = await r.json();
  return { accessToken: j.access_token, expiresIn: j.expires_in };
}
