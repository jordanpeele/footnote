/* Footnote receipts — public per-session record of AIRED checks.
   /receipts?room=<room> reads GET /api/onair?room=…&log=1 (newest first, aired only, 7-day cap)
   and renders it read-only. Corrections (kind==="correction") are appended events that reference
   the original check — they never mutate it (D6), and render visually offset. The join is on the
   original's stable aired id (entry.id ⇐ correction.refId, R9); legacy logs without ids fall back
   to the refClaim string, and entries with neither degrade to a plain correction card.
   SECURITY: claims are adversarial speech — every log string lands via textContent, never
   innerHTML; source URLs only become links if they parse as http(s).
   ?base=<origin> overrides the API origin (default same-origin) so a local copy of this page
   can be tested against prod. */
(() => {
  const byId = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const room = qs.get("room");
  const base = (qs.get("base") || "").replace(/\/+$/, "");
  const feed = byId("feed"), empty = byId("empty");

  const VERDICT_META = {
    True:         { cls: "v-true", icon: "✓", label: "TRUE" },
    False:        { cls: "v-false", icon: "✗", label: "FALSE" },
    Misleading:   { cls: "v-warn", icon: "⚠", label: "MISLEADING" },
    NeedsContext: { cls: "v-warn", icon: "◐", label: "NEEDS CONTEXT" },
    Unverifiable: { cls: "v-gray", icon: "?", label: "UNVERIFIABLE" },
  };
  const vmeta = (v) => VERDICT_META[v] || VERDICT_META.Unverifiable;
  // code tier → chip; conservative titles per HOW_FOOTNOTE_DECIDES.md (no fake precision)
  const TIER_CHIP = { 3: "T1 · wire/official", 2: "T2 · established", 1: "T3 · other" };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent only — strict escape
    return n;
  };
  const safeHttpUrl = (u) => {
    try { const p = new URL(u); return (p.protocol === "http:" || p.protocol === "https:") ? p.href : null; }
    catch { return null; }
  };
  const fmtTime = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " +
           d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  };
  const fmtDay = (ms) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

  function srcLine(source) {
    const line = el("div", "rc-srcline");
    if (source && source.name) {
      const url = safeHttpUrl(source.url);
      let src;
      if (url) { src = el("a", "rc-src", source.name); src.href = url; src.target = "_blank"; src.rel = "noopener noreferrer"; }
      else src = el("span", "rc-src", source.name);
      line.appendChild(src);
      const chip = TIER_CHIP[source.tier];
      if (chip) line.appendChild(el("span", "rc-tier", chip));
    }
    return line;
  }

  // byIdMap: log entries keyed by stable aired id (R9); correctedIds: originals referenced by
  // some correction (so the original card can wear a "corrected" chip without being mutated).
  function renderEntry(e, byIdMap, correctedIds) {
    const isCorr = e.kind === "correction";          // missing kind ⇒ plain check
    const card = el("article", isCorr ? "rc rc-correction" : "rc");
    const top = el("div", "rc-top");
    const m = isCorr ? { cls: "", icon: "↺", label: "CORRECTION" } : vmeta(e.verdict);
    top.appendChild(el("span", ("rc-badge " + m.cls).trim(), m.icon + " " + m.label));
    if (!isCorr && e.id && correctedIds.has(e.id)) top.appendChild(el("span", "rc-corrected", "↺ corrected"));
    if (e.airedAt) top.appendChild(el("time", "rc-time", fmtTime(e.airedAt)));
    card.appendChild(top);
    if (isCorr) {
      card.appendChild(el("div", "rc-claim", e.correction || ""));
      // join on the original's stable id; legacy fallback = the refClaim string; neither → no ref line
      const orig = e.refId ? byIdMap.get(e.refId) : null;
      const refText = (orig && orig.claim) || e.refClaim || null;
      if (refText) card.appendChild(el("div", "rc-refs", "corrects: “" + refText + "”"));
    } else {
      card.appendChild(el("div", "rc-claim", "“" + (e.claim || "") + "”"));
      if (e.correction) card.appendChild(el("div", "rc-corr", e.correction));
    }
    if (e.source && e.source.name) card.appendChild(srcLine(e.source));
    return card;
  }

  function render(log) {
    feed.querySelectorAll(".rc").forEach((n) => n.remove());
    if (!log.length) { empty.hidden = false; empty.textContent = "no aired checks in this room yet"; byId("dateRange").textContent = ""; return; }
    empty.hidden = true;
    const times = log.map((e) => e.airedAt).filter(Boolean);
    if (times.length) {
      const lo = fmtDay(Math.min(...times)), hi = fmtDay(Math.max(...times));
      byId("dateRange").textContent = lo === hi ? lo : lo + " — " + hi;
    }
    // one pass to index ids + collect correction references (old logs have no id → maps stay empty)
    const byIdMap = new Map(), correctedIds = new Set();
    for (const e of log) {
      if (e.id) byIdMap.set(e.id, e);
      if (e.kind === "correction" && e.refId) correctedIds.add(e.refId);
    }
    const frag = document.createDocumentFragment();
    // server is newest-first; re-sort defensively so corrections interleave chronologically
    for (const e of [...log].sort((a, b) => (b.airedAt || 0) - (a.airedAt || 0))) frag.appendChild(renderEntry(e, byIdMap, correctedIds));
    feed.appendChild(frag);
  }

  byId("roomChip").textContent = room ? "room: " + room : "no room";
  if (!room) { empty.hidden = false; empty.textContent = "add ?room=<room> to the URL to view a session's receipts"; return; }

  async function load() {
    try {
      const r = await fetch(base + "/api/onair?room=" + encodeURIComponent(room) + "&log=1", { cache: "no-store" });
      if (!r.ok) return;                             // keep last good render on transient errors
      const d = await r.json();
      render(Array.isArray(d.log) ? d.log : []);
    } catch {}
  }
  load();
  setInterval(load, 30000);                          // auto-refresh while open
})();
