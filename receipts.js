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

  // same accent language as the overlay (SPRINT-02 C1): NeedsContext gets its own violet
  // v-ctx — distinct from the amber warning AND the correction blue. Display only.
  const VERDICT_META = {
    True:         { cls: "v-true", icon: "✓", label: "TRUE" },
    False:        { cls: "v-false", icon: "✗", label: "FALSE" },
    Misleading:   { cls: "v-warn", icon: "⚠", label: "MISLEADING" },
    NeedsContext: { cls: "v-ctx", icon: "◐", label: "NEEDS CONTEXT" },
    Unverifiable: { cls: "v-gray", icon: "?", label: "UNVERIFIABLE" },
  };
  const vmeta = (v) => VERDICT_META[v] || VERDICT_META.Unverifiable;
  // code tier → chip; conservative titles per HOW_FOOTNOTE_DECIDES.md (no fake precision)
  const TIER_CHIP = { 3: "T1 · wire/official", 2: "T2 · established", 1: "T3 · other" };

  /* Host → display name for the multi-source citation list (SPRINT-02 C2). HAND-MIRROR of
     PRETTY + prettyName in src/core/editorial.js — receipts is a classic script (no
     imports); if you touch the canonical map, touch this one. Fallback rule: curated map
     (exact host, then parent suffixes) → short 2-label .gov/.mil acronym → title-cased
     registrable label → cleaned host (last ≤3 labels, leading capital, NEVER all-caps). */
  const HOST_NAMES = {
    "reuters.com": "Reuters", "apnews.com": "Associated Press", "ap.org": "Associated Press",
    "bbc.com": "BBC", "bbc.co.uk": "BBC", "npr.org": "NPR", "pbs.org": "PBS",
    "nytimes.com": "The New York Times", "washingtonpost.com": "The Washington Post", "wsj.com": "The Wall Street Journal",
    "bloomberg.com": "Bloomberg", "economist.com": "The Economist", "theguardian.com": "The Guardian",
    "cnn.com": "CNN", "nbcnews.com": "NBC News", "abcnews.go.com": "ABC News", "cbsnews.com": "CBS News",
    "usatoday.com": "USA Today", "politico.com": "Politico", "axios.com": "Axios", "forbes.com": "Forbes",
    "time.com": "TIME", "theatlantic.com": "The Atlantic", "latimes.com": "Los Angeles Times",
    "britannica.com": "Encyclopædia Britannica", "nature.com": "Nature", "science.org": "Science",
    "scientificamerican.com": "Scientific American", "nationalgeographic.com": "National Geographic",
    "pewresearch.org": "Pew Research Center", "snopes.com": "Snopes", "factcheck.org": "FactCheck.org",
    "politifact.com": "PolitiFact", "who.int": "World Health Organization", "un.org": "United Nations",
    "worldbank.org": "World Bank", "imf.org": "IMF", "oecd.org": "OECD",
    "investopedia.com": "Investopedia", "history.com": "History.com", "cnbc.com": "CNBC",
    "wikipedia.org": "Wikipedia", "census.gov": "U.S. Census Bureau", "bls.gov": "Bureau of Labor Statistics",
    "cdc.gov": "CDC", "nasa.gov": "NASA", "noaa.gov": "NOAA", "federalreserve.gov": "Federal Reserve",
    "congress.gov": "U.S. Congress", "usa.gov": "USA.gov", "cftc.gov": "CFTC", "sec.gov": "SEC",
    "bea.gov": "Bureau of Economic Analysis", "bjs.ojp.gov": "Bureau of Justice Statistics", "fbi.gov": "FBI",
    "archives.gov": "National Archives", "loc.gov": "Library of Congress",
    "ssa.gov": "Social Security Administration", "cbo.gov": "Congressional Budget Office",
    "state.gov": "U.S. State Department", "treasury.gov": "U.S. Treasury",
    "justice.gov": "U.S. Justice Department", "whitehouse.gov": "The White House",
    "nih.gov": "National Institutes of Health", "weather.gov": "National Weather Service",
    "eia.gov": "U.S. Energy Information Administration", "supremecourt.gov": "U.S. Supreme Court",
    "stlouisfed.org": "Federal Reserve Bank of St. Louis", "europa.eu": "European Union",
    "mayoclinic.org": "Mayo Clinic", "webmd.com": "WebMD", "healthline.com": "Healthline",
    "businessinsider.com": "Business Insider", "vox.com": "Vox", "thehill.com": "The Hill",
    "newsweek.com": "Newsweek", "usnews.com": "U.S. News & World Report",
  };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
  function displayName(host) {
    if (!host) return "source";
    const labels = host.split(".");
    for (let i = 0; i < labels.length - 1; i++) {
      const hit = HOST_NAMES[labels.slice(i).join(".")];
      if (hit) return hit;
    }
    const label = labels.length >= 2 ? labels[labels.length - 2] : host;
    if (labels.length === 2 && /\.(gov|mil)$/.test(host) && label.length <= 4) return label.toUpperCase();
    if (labels.length <= 2) {
      const name = label.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      return name.length < 3 ? host : name;
    }
    const cleaned = labels.slice(-3).join(".");
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

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

  /* Sourcing line (SPRINT-02 C2): the surfaced source leads (name from the log, tier chip
     from the entry's top-level tier passthrough), then EVERY other qualifying citation the
     aired card carried renders as a small named link — already editorial-ranked server-side
     (≤5, surfaced first), deduped by resolved URL. Links only if they parse as http(s). */
  function srcLine(e) {
    const line = el("div", "rc-srcline");
    const source = e.source;
    const seen = new Set();
    if (source && source.name) {
      const url = safeHttpUrl(source.url);
      let src;
      if (url) { seen.add(url); src = el("a", "rc-src", source.name); src.href = url; src.target = "_blank"; src.rel = "noopener noreferrer"; }
      else src = el("span", "rc-src", source.name);
      line.appendChild(src);
      // tier rides the aired entry now (slimCard passthrough); source.tier covers old logs
      const chip = TIER_CHIP[Number.isInteger(e.tier) ? e.tier : source.tier];
      if (chip) line.appendChild(el("span", "rc-tier", chip));
    }
    for (const u of Array.isArray(e.citations) ? e.citations : []) {
      const url = safeHttpUrl(u);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const a = el("a", "rc-cite", displayName(hostOf(url)));
      a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
      line.appendChild(a);
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
    if ((e.source && e.source.name) || (Array.isArray(e.citations) && e.citations.length)) card.appendChild(srcLine(e));
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
