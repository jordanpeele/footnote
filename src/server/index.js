// Footnote self-host server (Decision D1): the whole app in ONE dependency-free Node
// process — static pages + the same api/ routes Vercel runs + in-memory room state.
//   npm start   →  http://localhost:3000/control  +  /overlay?room=…
//
// Order matters here: (1) load .env / .env.local into process.env (tiny parser, no
// dotenv dep), (2) default FOOTNOTE_STATE to the in-process "memory" adapter, (3) only
// THEN import the api/ routes — the registry reads env at call time, but the state
// default must be set before any route can run. Routes are discovered from api/*.js
// (underscore-prefixed files are helpers, same convention Vercel uses) and adapted via
// src/server/shim.js. Rewrites mirror vercel.json: /overlay → overlay.html,
// /control → index.html. Rate limiting (api/_ratelimit.js) fails open without Upstash
// env — correct for localhost.
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---- env: real environment > .env.local > .env (set-if-unset, so earlier wins) -------
// P4-F4 (field-test F6): that precedence means a stale key exported from the user's shell
// (~/.zshenv etc.) silently outranks a fresh key in .env.local — the vendor 403s while the
// file's key is perfectly valid. So for the known vendor keys we warn when the real
// environment shadows a DIFFERENT file value. Warning only — precedence is unchanged, and
// we NEVER print any part of either value (no prefixes, no lengths).
const VENDOR_KEYS = new Set(["DEEPGRAM_API_KEY", "ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY",
  "ADMIN_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]);
// Snapshot BEFORE any file load: once .env.local runs, its values sit in process.env and
// would be indistinguishable from real-environment values when .env loads after it.
const SHELL_KEYS = new Set([...VENDOR_KEYS].filter((k) => k in process.env));
const shadowWarned = new Set();                  // one warning per variable, max
function loadEnvFile(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return; }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1].startsWith("#")) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");           // strip trailing comments on bare values
    if (!(m[1] in process.env)) process.env[m[1]] = v;
    // Shadow check: the loader discards v when the var already exists, so compare here,
    // while we still have it. Empty file values (`KEY=` placeholders) don't count as a
    // conflicting intent, so they don't warn.
    else if (SHELL_KEYS.has(m[1]) && v !== "" && v !== process.env[m[1]] && !shadowWarned.has(m[1])) {
      shadowWarned.add(m[1]);
      console.warn(`note: ${m[1]} comes from your shell environment and DIFFERS from ${path.basename(file)} — the shell value wins. Unset it (check ~/.zshenv, ~/.zshrc) if you meant the file's value.`);
    }
  }
}
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

// Self-host default: single process → in-memory state channel. Anything explicitly set
// (env or .env files, e.g. FOOTNOTE_STATE=upstash) wins.
process.env.FOOTNOTE_STATE ||= "memory";

// ---- routes: api/<name>.js → /api/<name>, via the Vercel-handler shim ----------------
const { wrapRoute } = await import("./shim.js");
const routes = new Map();
for (const f of (await fsp.readdir(path.join(ROOT, "api"))).sort()) {
  if (!f.endsWith(".js") || f.startsWith("_")) continue;
  const mod = await import(pathToFileURL(path.join(ROOT, "api", f)).href);
  if (typeof mod.default !== "function") continue;
  routes.set("/api/" + f.slice(0, -3), wrapRoute(mod));
}

// ---- static files from repo root, mirroring vercel.json ------------------------------
const REWRITES = { "/": "/index.html", "/control": "/index.html", "/overlay": "/overlay.html",
  "/receipts": "/receipts.html", "/op": "/operator.html",
  // Adjudication cockpit (self-host only): a fully client-side page under tools/. It
  // fetches its own /tools/adjudicate/{lib.js,adjudicate.js,adjudicate.css,queue.json}
  // by absolute path (served straight from the repo tree) and downloads graduations.json
  // — no dedicated endpoint, no state channel. Mirrors how /control maps to a static page.
  "/adjudicate": "/tools/adjudicate/adjudicate.html" };
// vercel.json marks the app shell no-cache so OBS/browsers pick up deploys immediately.
const NO_CACHE = new Set(["/app.js", "/app.css", "/pacer.js", "/index.html", "/overlay.html", "/overlay.js", "/overlay.css",
  "/receipts.html", "/receipts.js", "/receipts.css", "/operator.html", "/operator.js", "/operator.css"]);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

async function serveStatic(pathname, res) {
  const rel = REWRITES[pathname] || pathname;
  // Never serve dotfiles (.env!, .git) or anything that escapes the repo root.
  const segments = rel.split("/").filter(Boolean);
  if (segments.some((s) => s.startsWith(".") || s === "node_modules")) return notFound(res);
  const file = path.resolve(ROOT, ...segments);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return notFound(res);
  let data;
  try {
    if (!(await fsp.stat(file)).isFile()) return notFound(res);
    data = await fsp.readFile(file);
  } catch { return notFound(res); }
  res.setHeader("content-type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  if (NO_CACHE.has(rel)) res.setHeader("cache-control", "no-cache, must-revalidate");
  res.statusCode = 200;
  res.end(data);
}

function notFound(res) { res.statusCode = 404; res.setHeader("content-type", "text/plain"); res.end("not found"); }

/* ---- field-test log sink (LOCAL ONLY — this server never runs on Vercel, and the route
   only exists when FOOTNOTE_FIELDTEST_LOG is set). The control page and overlay mirror
   their pipeline events here (localhost-gated client-side too); each POST body is one
   JSON event, appended as JSONL with a server receive-timestamp. ---- */
const FT_LOG = process.env.FOOTNOTE_FIELDTEST_LOG || null;

/* ---- R42: non-loopback addresses (self-host only — Vercel never runs this server).
   /control uses this to offer a ready-made tailnet-origin OPERATOR URL: hand-assembled
   capability URLs caused a 403 in the field (two mistranscribed key chars) — capability
   URLs should never be hand-typed. Tailscale CGNAT range (100.64/10) is tagged so the
   client can prefer it over plain LAN addresses. */
function nonLoopbackAddrs() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family !== "IPv4" || i.internal) continue;
      const first = Number(i.address.split(".")[0]), second = Number(i.address.split(".")[1]);
      const tailnet = first === 100 && second >= 64 && second <= 127;
      out.push({ address: i.address, tailnet });
    }
  }
  return out;
}
async function ftSink(req, res) {
  const chunks = [];
  for await (const c of req) { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 65536) break; }
  let ev = null;
  try { ev = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
  if (ev && typeof ev === "object") {
    ev.srv_t = Date.now();
    try { fs.appendFileSync(FT_LOG, JSON.stringify(ev) + "\n"); } catch {}
  }
  res.statusCode = 204; res.end();
}

// ---- server --------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";   // docker-compose sets HOST=0.0.0.0

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://" + (req.headers.host || "localhost")); } catch { return notFound(res); }
  const route = routes.get(url.pathname);
  try {
    if (url.pathname === "/__addrs" && req.method === "GET") {   // R42 — self-host only
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ addrs: nonLoopbackAddrs(), port: PORT }));
    }
    else if (FT_LOG && url.pathname === "/__fieldtest/log" && req.method === "POST") await ftSink(req, res);
    else if (route) await route(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") await serveStatic(url.pathname, res);
    else notFound(res);
  } catch (e) {
    console.error("server error", url.pathname, e && (e.stack || e.message));
    if (!res.headersSent) { res.statusCode = 500; res.setHeader("content-type", "application/json"); }
    if (!res.writableEnded) res.end(JSON.stringify({ error: "internal error" }));
  }
});

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`Footnote up — control: http://${shown}:${PORT}/control   overlay: http://${shown}:${PORT}/overlay?room=<room>`);
  console.log(`state channel: ${process.env.FOOTNOTE_STATE}   routes: ${[...routes.keys()].join(" ")}`);
  const missing = ["ANTHROPIC_API_KEY", "PERPLEXITY_API_KEY", "DEEPGRAM_API_KEY"].filter((k) => !process.env[k]);
  if (missing.length) console.log(`note: missing keys (${missing.join(", ")}) — those pipeline stages will fail until set in .env`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); });
}
