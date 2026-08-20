/* Footnote receipts — public per-session record of AIRED checks.
   /receipts?room=<room> reads GET /api/onair?room=…&log=1 (newest first, aired only, 7-day cap)
   and renders it read-only. Corrections (kind==="correction") are appended events that reference
   the original check — they never mutate it (D6), and render visually offset. The join is on the
   original's stable aired id (entry.id ⇐ correction.refId, R9); legacy logs without ids fall back
   to the refClaim string, and entries with neither degrade to a plain correction card.
   SECURITY: claims are adversarial speech — every log string lands via textContent, never
   innerHTML; source URLs only become links if they parse as http(s).
   Deep links (4a): every entry with a server-minted aired id is addressable as #<id> —
   location.hash scrolls + highlights it on load, and each card carries a copy-link button.
   Attention events (4a, DARK): log entries with kind==="attention" are R54 operator-
   attention tags joined to their auto-aired original by refId. They are metadata, never
   cards — always filtered from the card list — and render as a small neutral chip on the
   original ONLY under ?attn=1 (default OFF pending the operator's disclosure ruling).
   ?base=<origin> overrides the API origin (default same-origin) so a local copy of this page
   can be tested against prod. */
(() => {
  const byId = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const room = qs.get("room");
  const base = (qs.get("base") || "").replace(/\/+$/, "");
  const SHOW_ATTN = qs.has("attn");   // 4a: dark flag — attention chips render only when explicitly asked
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
  /* 4a anchors: an entry id becomes a DOM id / URL hash ONLY if it matches the server's
     mintId shape (ms timestamp + 4 base36 chars). The log is adversarial-adjacent data —
     never let an arbitrary string become an element id (DOM-clobbering hygiene). */
  const okAnchor = (s) => typeof s === "string" && /^\d{1,17}-[a-z0-9]{4}$/.test(s);

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

  // 4a: per-card copy-link — copies this page's URL (room + flags preserved) with the
  // entry's stable aired id as the hash. Clipboard write is user-gesture-scoped.
  function copyBtn(id) {
    const b = el("button", "rc-link", "#");
    b.type = "button";
    b.title = "copy a direct link to this check";
    b.setAttribute("aria-label", "copy link to this check");
    b.addEventListener("click", () => {
      const u = new URL(location.href);
      u.hash = id;
      const done = () => { b.textContent = "✓"; b.classList.add("ok"); setTimeout(() => { b.textContent = "#"; b.classList.remove("ok"); }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u.href).then(done).catch(() => {});
      else { location.hash = id; done(); }   // clipboard unavailable → at least land the hash in the URL bar
    });
    return b;
  }

  // byIdMap: log entries keyed by stable aired id (R9); correctedIds: originals referenced by
  // some correction (so the original card can wear a "corrected" chip without being mutated);
  // attnByRef (4a): aired id → operator attention state, rendered only under ?attn=1.
  function renderEntry(e, byIdMap, correctedIds, attnByRef) {
    const isCorr = e.kind === "correction";          // missing kind ⇒ plain check
    const card = el("article", isCorr ? "rc rc-correction" : "rc");
    const anchored = okAnchor(e.id);
    if (anchored) card.id = e.id;                    // 4a: stable per-card anchor (#<aired id>)
    const top = el("div", "rc-top");
    const m = isCorr ? { cls: "", icon: "↺", label: "CORRECTION" } : vmeta(e.verdict);
    top.appendChild(el("span", ("rc-badge " + m.cls).trim(), m.icon + " " + m.label));
    /* R63 framing: TEST airs are field-test artifacts — visibly watermarked and excluded
       from the ledger's accounting. The card renders (the record hides nothing) but wears
       the exclusion on its sleeve. */
    if (e.test === true) {
      card.classList.add("rc-test");
      const t = el("span", "rc-testchip", "TEST · not in ledger");
      t.title = "field-test air — watermarked on screen and excluded from the session ledger (R63)";
      top.appendChild(t);
    }
    // D18: machine-aired cards are distinctly marked — the record always tells you whether
    // a human thumb or the auto-air gate put this on screen
    // D19: OPEN-mode cards carry the AI-unverified marker into the public record — the
    // receipts page is where the disclosure model has to hold up, not just the chyron
    if (e.mode === "open") {
      const u = el("span", "rc-unv", "AI · UNVERIFIED");
      u.title = "aired in OPEN mode (D19): no editorial verification gates — the verdict is a single AI check, disclosed as such on the broadcast card";
      row.appendChild(u);
    }
    if (e.autoAired === true) {
      const a = el("span", "rc-auto", "AUTO · machine-aired");
      a.title = "aired by the auto-air gate under live operator supervision — every machine air runs a 2-second operator abort window (D19)";
      top.appendChild(a);
      // 4a (DARK, ?attn=1): the operator's self-reported attention during this card's veto
      // window (R54) — neutral metadata chip, never a judgment dressed as one
      const attn = SHOW_ATTN && anchored ? attnByRef.get(e.id) : null;
      if (attn) {
        const s = el("span", "rc-attn", "operator: " + attn);
        s.title = "R54 — the operator's self-reported attention state during this card's 4-second veto window";
        top.appendChild(s);
      }
    }
    if (!isCorr && e.id && correctedIds.has(e.id)) top.appendChild(el("span", "rc-corrected", "↺ corrected"));
    if (e.airedAt) top.appendChild(el("time", "rc-time", fmtTime(e.airedAt)));
    if (anchored) top.appendChild(copyBtn(e.id));
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
    /* 4a: attention events are per-card METADATA, not checks — always split out of the
       card list (regardless of the flag, so they can never render as empty cards) and
       joined onto their originals by refId. First entry wins per refId (server enforces
       one, this is belt-and-braces). */
    const attnByRef = new Map();
    const entries = [];
    for (const e of log) {
      if (e && e.kind === "attention") {
        if (e.refId && typeof e.attn === "string" && ["watching", "talking", "away"].includes(e.attn) && !attnByRef.has(e.refId)) attnByRef.set(e.refId, e.attn);
      } else if (e) entries.push(e);
    }
    if (!entries.length) { empty.hidden = false; empty.textContent = "no aired checks in this room yet"; byId("dateRange").textContent = ""; return; }
    empty.hidden = true;
    const times = entries.map((e) => e.airedAt).filter(Boolean);
    if (times.length) {
      const lo = fmtDay(Math.min(...times)), hi = fmtDay(Math.max(...times));
      byId("dateRange").textContent = lo === hi ? lo : lo + " — " + hi;
    }
    // one pass to index ids + collect correction references (old logs have no id → maps stay empty)
    const byIdMap = new Map(), correctedIds = new Set();
    for (const e of entries) {
      if (e.id) byIdMap.set(e.id, e);
      if (e.kind === "correction" && e.refId) correctedIds.add(e.refId);
    }
    const frag = document.createDocumentFragment();
    // server is newest-first; re-sort defensively so corrections interleave chronologically
    for (const e of [...entries].sort((a, b) => (b.airedAt || 0) - (a.airedAt || 0))) frag.appendChild(renderEntry(e, byIdMap, correctedIds, attnByRef));
    feed.appendChild(frag);
    focusHash();   // 4a: deep link — scroll + highlight once the target exists in the DOM
  }

  /* 4a deep links: #<aired id> scrolls to and highlights that card. One-shot per hash —
     the 30s auto-refresh re-renders the feed but must not re-scroll under the reader;
     navigating to a new hash (hashchange) re-arms it. Unknown/absent ids no-op silently
     (the entry may have aged past the 7-day window). */
  let hashDone = "";
  function focusHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id || !okAnchor(id) || hashDone === id) return;
    const n = document.getElementById(id);
    if (!n || !n.classList.contains("rc")) return;
    hashDone = id;
    feed.querySelectorAll(".rc-hit").forEach((x) => x.classList.remove("rc-hit"));
    n.classList.add("rc-hit");
    n.scrollIntoView({ block: "center" });
  }
  window.addEventListener("hashchange", () => { hashDone = ""; focusHash(); });

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
