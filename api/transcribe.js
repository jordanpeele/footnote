// Vercel serverless function: browser audio window -> active STT adapter (default:
// Deepgram nova-3) -> transcript. Vendor keys stay server-side; the browser only ever
// sends audio and gets text back. Thin route: validate origin/size → rate limit →
// adapter transcribe → shape response.
export const config = { api: { bodyParser: false } };
import { spendGate } from "../src/core/spendgate.js";
import { rateLimit } from "./_ratelimit.js";
import { getAdapter } from "../src/core/registry.js";
import { UpstreamError } from "../src/core/errors.js";

const ALLOW_HOSTS = ["footnote-live.vercel.app", "footnote-phi.vercel.app", "localhost", "127.0.0.1"];

function originOK(origin) {
  if (!origin) return true;                        // same-origin fetch may omit Origin
  try {
    const h = new URL(origin).hostname;
    // exact hosts, or this project's own Vercel preview deploys
    return ALLOW_HOSTS.includes(h) || (h.startsWith("footnote-") && h.endsWith(".vercel.app"));
  } catch { return false; }
}

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!(await spendGate(req, res))) return;   // D14: kill switch first — before rate limit or any adapter
  if (!(await rateLimit(req, res, "transcribe", 40))) return;
  if (!originOK(req.headers.origin)) { res.status(403).json({ error: "forbidden origin" }); return; }

  let stt;   // bad FOOTNOTE_STT env must 500 cleanly, not kill the invocation (red-team M1)
  try { stt = getAdapter("stt"); } catch (e) { console.error("stt adapter:", e && e.message); res.status(500).json({ error: "server missing DEEPGRAM_API_KEY" }); return; }
  if (!stt.isConfigured()) { res.status(500).json({ error: "server missing DEEPGRAM_API_KEY" }); return; }

  let audio;
  try { audio = await readRaw(req); } catch { res.status(400).json({ error: "bad body" }); return; }
  if (!audio || audio.length < 900) { res.status(200).json({ transcript: "", confidence: 0 }); return; }
  if (audio.length > 1_200_000) { res.status(413).json({ error: "audio too large" }); return; }  // ~2.2s Opus is tiny

  const audioType = req.headers["x-audio-type"] || "audio/webm";
  let out;
  try {
    out = await stt.transcribe(audio, audioType);
  } catch (e) {
    if (e instanceof UpstreamError) {
      // unreachable → { error } only; vendor non-2xx → meta carries dg_ms (adapter logged it)
      res.status(502).json({ error: e.message, ...e.meta });
      return;
    }
    throw e;   // anything else (e.g. vendor JSON parse) crashes the handler, as before
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Server-Timing", `${stt.name};dur=${out.ms}`);
  // dg_ms = vendor round-trip (server→vendor→server); bytes/audio_s let the client
  // separate network from processing and compute a realtime factor.
  res.status(200).json({ transcript: out.transcript, confidence: out.confidence, dg_ms: out.ms, bytes: out.bytes, audio_s: out.audioSeconds });
}
