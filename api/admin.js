// Footnote operator admin: global kill switch for the hosted deployment.
//   GET /api/admin?token=<ADMIN_TOKEN>&op=kill     -> set kill:global (no TTL — explicit restore only)
//   GET /api/admin?token=<ADMIN_TOKEN>&op=restore  -> clear kill:global
//   GET /api/admin?token=<ADMIN_TOKEN>&op=status   -> { killed: boolean }
// Routes that spend money / write state (api/verify.js, api/onair.js POST) check the flag
// first and 503 while it's set. 501 when ADMIN_TOKEN is unset, 401 on bad token.
import { createHash, timingSafeEqual } from "node:crypto";
import { isConfigured, pipeline } from "../src/adapters/state/upstash/index.js";

// constant-time-ish compare: hash both sides so length never leaks, then timingSafeEqual
function tokenOk(given, expected) {
  const h = (s) => createHash("sha256").update(String(s)).digest();
  try { return timingSafeEqual(h(given || ""), h(expected)); } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "GET only" }); return; }
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.ADMIN_TOKEN;
  if (!secret) { res.status(501).json({ error: "ADMIN_TOKEN not configured" }); return; }
  if (!tokenOk(req.query.token, secret)) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "store not configured" }); return; }
  const op = req.query.op;
  try {
    if (op === "kill") {
      await pipeline([["SET", "kill:global", String(Date.now())]]);   // no TTL — restore is explicit
      res.status(200).json({ ok: true, killed: true });
    } else if (op === "restore") {
      await pipeline([["DEL", "kill:global"]]);
      res.status(200).json({ ok: true, killed: false });
    } else if (op === "status") {
      const out = await pipeline([["GET", "kill:global"]]);
      res.status(200).json({ killed: Boolean(out?.[0]?.result) });
    } else res.status(400).json({ error: "op must be kill|restore|status" });
  } catch (e) { console.error("admin error", e && e.message); res.status(502).json({ error: "store error" }); }
}
