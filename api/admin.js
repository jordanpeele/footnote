// Footnote operator admin: global kill switch for the hosted deployment.
//   GET /api/admin?token=<ADMIN_TOKEN>&op=kill     -> set kill:global (no TTL — explicit restore only)
//   GET /api/admin?token=<ADMIN_TOKEN>&op=restore  -> clear kill:global
//   GET /api/admin?token=<ADMIN_TOKEN>&op=status   -> { killed: boolean }
//   GET /api/admin?token=<ADMIN_TOKEN>&op=spend    -> est. spend tallies (this process + today's store rollup)
// Routes that spend money / write state (api/verify.js, api/onair.js POST) check the flag
// first and 503 while it's set. 501 when ADMIN_TOKEN is unset, 401 on bad token.
import { createHash, timingSafeEqual } from "node:crypto";
import { isConfigured, pipeline } from "../src/adapters/state/upstash/index.js";
import { localKill } from "../src/core/spendgate.js";
import { spendSnapshot } from "../src/core/spendmeter.js";

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
  const op = req.query.op;
  // op=spend is read-only OBSERVABILITY (packet 5c) — same body with or without a store
  // (spendSnapshot resolves `today` from the store when configured, null otherwise), so
  // it's handled once, ahead of the store/no-store kill-switch split.
  if (op === "spend") { res.status(200).json(await spendSnapshot()); return; }
  // Self-host (no store): operate the in-process flag — same semantics, same process
  // (D1 single-process makes a module flag globally correct; found at D18 pilot arming).
  if (!isConfigured()) {
    if (op === "kill") { localKill.engaged = true; localKill.at = Date.now(); res.status(200).json({ ok: true, killed: true, mode: "in-process" }); }
    else if (op === "restore") { localKill.engaged = false; localKill.at = null; res.status(200).json({ ok: true, killed: false, mode: "in-process" }); }
    else if (op === "status") { res.status(200).json({ killed: localKill.engaged, mode: "in-process" }); }
    else res.status(400).json({ error: "op must be kill|restore|status|spend" });
    return;
  }
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
    } else res.status(400).json({ error: "op must be kill|restore|status|spend" });
  } catch (e) { console.error("admin error", e && e.message); res.status(502).json({ error: "store error" }); }
}
