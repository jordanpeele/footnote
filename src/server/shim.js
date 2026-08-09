// Vercel-handler shim for the plain node:http server. The api/ routes are written
// against Vercel's Node runtime request/response extensions; this adapts a raw
// (IncomingMessage, ServerResponse) pair to exactly what those routes touch:
//
//   req.query    — parsed query params (plain object)            [onair]
//   req.body     — parsed JSON when the route's config.api.bodyParser !== false and the
//                  request declares a JSON content-type           [onair, extract, verify]
//   req.headers  — native (routes read origin, x-audio-type, x-forwarded-for)
//   req.socket   — native (rate limiter reads remoteAddress)
//   req[Symbol.asyncIterator] — native stream; NOT consumed when bodyParser is false,
//                  so transcribe.js can read the raw audio body itself
//   res.status(c)      — sets statusCode, chainable              [all routes]
//   res.json(obj)      — JSON content-type + serialize + end     [all routes]
//   res.setHeader/.end — native                                   [all routes]
//   res.send(body)     — string/Buffer + end (defensive; no current route uses it)
//
// Mirrors Vercel's body limits: JSON bodies over 1 MB → 413, unparseable JSON → 400.

const JSON_BODY_LIMIT = 1_000_000;

function enhanceResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.headersSent) res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    if (typeof body === "object" && body !== null && !Buffer.isBuffer(body)) return res.json(body);
    res.end(body);
    return res;
  };
  return res;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > JSON_BODY_LIMIT) { const e = new Error("body too large"); e.code = "E_TOO_LARGE"; throw e; }
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try { return JSON.parse(text); }
  catch { const e = new Error("invalid json"); e.code = "E_BAD_JSON"; throw e; }
}

/**
 * Wrap a Vercel-style route module (default handler + optional `config`) into a plain
 * (req, res, url) node handler.
 * @param {{ default: Function, config?: { api?: { bodyParser?: boolean } } }} mod
 */
export function wrapRoute(mod) {
  const handler = mod.default;
  const bodyParser = mod.config?.api?.bodyParser !== false;   // Vercel default: on
  return async (req, res, url) => {
    enhanceResponse(res);
    req.query = Object.fromEntries(url.searchParams);
    if (bodyParser && req.method !== "GET" && req.method !== "HEAD"
        && /\bjson\b/.test(String(req.headers["content-type"] || ""))) {
      try {
        req.body = await readJsonBody(req);
      } catch (e) {
        if (e.code === "E_TOO_LARGE") { res.status(413).json({ error: "body too large" }); return; }
        res.status(400).json({ error: "invalid json" });
        return;
      }
    }
    await handler(req, res);
  };
}
