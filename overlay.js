/* Footnote OBS overlay — renders ONLY the on-air fact-check lower-third on a transparent
   canvas for an OBS Browser Source.
   P0: driven by test hooks (?demo, ?card=, window.footnoteOverlay).
   P1 will replace the test driver with the /api/onair state channel (polling ?room=…). */
(() => {
  const byId = (id) => document.getElementById(id);
  const onAir = byId("onAir");
  // SPRINT-02 C1: per-verdict accents (display only — vocabulary + labels unchanged).
  // NeedsContext gets its own violet family (v-ctx): reads "informational, not alarm" at a
  // half-second glance, and can't be confused with either the amber warning (Misleading)
  // or the correction card's sky-blue v-corr.
  const VERDICT_META = {
    True:         { cls: "v-true", icon: "✓", label: "TRUE" },
    False:        { cls: "v-false", icon: "✗", label: "FALSE" },
    Misleading:   { cls: "v-warn", icon: "⚠", label: "MISLEADING" },
    NeedsContext: { cls: "v-ctx", icon: "◐", label: "NEEDS CONTEXT" },
    Unverifiable: { cls: "v-gray", icon: "?", label: "UNVERIFIABLE" },
  };
  const vmeta = (v) => VERDICT_META[v] || VERDICT_META.Unverifiable;
  const DUR = 11000;
  let raf = 0, hideT = 0, showing = false;   // showing → poll fast (catch a pull/next air quickly)

  // field-test mirror (local shakedown only): render events → the local server's JSONL sink.
  // Hostname-gated no-op everywhere else; the /__fieldtest/log route only exists on npm start.
  const FT_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const ftLog = (ev, data) => {
    if (!FT_LOCAL) return;
    try {
      const body = JSON.stringify(Object.assign({ ev, t: Date.now(), page: "overlay" }, data || {}));
      if (!(navigator.sendBeacon && navigator.sendBeacon("/__fieldtest/log", new Blob([body], { type: "application/json" }))))
        fetch("/__fieldtest/log", { method: "POST", body, keepalive: true }).catch(() => {});
    } catch {}
  };
  let refToken = 0;                          // invalidates an in-flight correction join when a newer card renders

  // R12.2: correction cards carry refId — the stable aired-log id of the original claim.
  // Resolve the original by joining the public aired log (GET ?log=1 is CORS-open and
  // cheap), cached per refId so repeat renders don't refetch. Returns the original claim
  // string, or null on fetch failure / join miss (caller falls back to legacy refClaim).
  const refCache = new Map();   // refId -> original claim string | null (definitive log miss)
  async function resolveRef(refId) {
    if (refCache.has(refId)) return refCache.get(refId);
    try {
      const r = await fetch("/api/onair?room=" + encodeURIComponent(room) + "&log=1", { cache: "no-store" });
      if (!r.ok) return null;                        // transient failure — don't cache, retry on next air
      const d = await r.json();
      const hit = (d.log || []).find((e) => e && e.id === refId);
      const claim = (hit && hit.claim) || null;      // log is durable: a parsed miss is definitive — cache it
      refCache.set(refId, claim);
      return claim;
    } catch { return null; }
  }

  // remainingMs: undefined → default window; null → hold (stay until pulled); number → count down that long
  function showOnAir(card, remainingMs) {
    if (!card) return;
    if (remainingMs === undefined) remainingMs = DUR;
    cancelAnimationFrame(raf); clearTimeout(hideT);
    const corr = card.kind === "correction";       // appended correction event — not a verdict
    const m = corr ? { cls: "v-corr", icon: "↺", label: "CORRECTION" } : vmeta(card.verdict);
    onAir.className = "onair " + m.cls + (card.test === true ? " test" : "");   // TEST watermark (local field-test airs)
    ftLog("render", { claim: (card.claim || "").slice(0, 120), verdict: card.verdict || null, test: card.test === true });
    byId("oaVerdict").textContent = m.icon + " " + m.label;
    byId("oaClaim").textContent = corr ? (card.correction || "") : "“" + (card.claim || "") + "”";
    const sub = byId("oaCorrection");
    const tok = ++refToken;
    if (corr && card.refId && room) {
      // render the correction NOW, fill the "corrects: …" sub-line async once the join lands
      sub.textContent = "";
      resolveRef(card.refId).then((claim) => {
        if (tok !== refToken) return;   // a newer card took the chyron while we fetched
        if (claim) sub.textContent = "corrects: “" + claim + "”";
        // LEGACY — remove next release: refClaim fallback when the refId join fails
        else if (card.refClaim) sub.textContent = "corrects: “" + card.refClaim + "”";
      });
    } else if (corr) {
      // LEGACY — remove next release: refClaim-only join for pre-refId correction cards
      sub.textContent = card.refClaim ? "corrects: “" + card.refClaim + "”" : "";
    } else sub.textContent = card.correction || "";
    // source line + tier visibility (SPRINT-02 C2): code tier 3 = the wire/official bucket
    // (HOW_FOOTNOTE_DECIDES.md §2) → subtle PRIMARY SOURCE micro-tag; tier ≤2 or absent
    // tier = plain publisher name. textContent assignment clears any previous tag node.
    const srcEl = byId("oaSrc");
    const srcName = card.source && card.source.name;
    srcEl.textContent = srcName ? "Source: " + srcName : "";
    if (srcName && !corr && card.tier === 3) {
      const tag = document.createElement("span");
      tag.className = "oa-primary";
      tag.textContent = "PRIMARY SOURCE";
      srcEl.appendChild(tag);
    }
    onAir.hidden = false; onAir.classList.remove("show"); void onAir.offsetWidth; onAir.classList.add("show");
    showing = true;
    const timer = byId("oaTimer");
    if (remainingMs === null) { timer.style.width = "100%"; return; }   // hold: full bar, no auto-retire
    const start = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - start) / remainingMs); timer.style.width = (100 - p * 100) + "%";
      if (p < 1) raf = requestAnimationFrame(tick); else hideOnAir();
    })(start);
  }
  // exit is a ~200ms fade-down (overlay.css .onair base transition) — the hidden flip waits just past it
  function hideOnAir() { cancelAnimationFrame(raf); showing = false; onAir.classList.remove("show"); hideT = setTimeout(() => { onAir.hidden = true; }, 220); }

  // programmatic API — P1 bridge (and manual testing) call these
  window.footnoteOverlay = { air: showOnAir, clear: hideOnAir };

  const qs = new URLSearchParams(location.search);

  /* P5-F: portrait/landscape layout. AUTO from viewport aspect (a 1080×1920 OBS source or
     Moblin widget just works — no special URL), with ?layout=portrait|landscape as the
     escape hatch for aspect-ambiguous embeds. body.portrait drives the CSS; re-evaluated
     live so an OBS source resize mid-show lands on the right layout. */
  const layoutOverride = (qs.get("layout") || "").toLowerCase();
  const aspectMq = matchMedia("(max-aspect-ratio: 1/1)");
  function applyLayout() {
    const portrait = layoutOverride === "portrait" || (layoutOverride !== "landscape" && aspectMq.matches);
    document.body.classList.toggle("portrait", portrait);
    // field diagnostic: what viewport does the embedder (OBS CEF / Moblin) actually give us?
    ftLog("layout", { w: innerWidth, h: innerHeight, portrait, override: layoutOverride || null });
  }
  applyLayout();
  if (aspectMq.addEventListener) aspectMq.addEventListener("change", applyLayout);
  window.addEventListener("resize", applyLayout);

  // ?y=<px> — override the card's bottom offset (dodge platform UI chrome; wins over both layouts)
  const yOff = parseInt(qs.get("y"), 10);
  if (yOff > 0) onAir.style.bottom = yOff + "px";

  // ---- P1 live bridge: poll the state channel for this room ----
  // Edge-triggered on server-stamped seq; baselines on connect so it never replays a stale card.
  const room = qs.get("room");
  if (room) {
    let lastSeq = null, lastChange = 0, fails = 0;
    // degraded-network hint: after 8 straight failed polls show a near-invisible dot (operator
    // eyeballing the program feed can spot it; viewers won't); first success clears it.
    const FAILS_BEFORE_DOT = 8;
    const netDot = document.createElement("div");
    netDot.className = "net-dot"; document.body.appendChild(netDot);
    // Adaptive cadence: poll FAST (~400ms) when a change is likely — a check is on screen, one
    // was aired/pulled in the last FAST_WINDOW, or the server says the operator queue is warm
    // (activeAt, P4-F2) — and back off to SLOW (~2.5s) when idle. Gets
    // near-instant feel where it matters without a persistent connection or a 5th realtime vendor.
    const FAST = Math.max(200, parseInt(qs.get("poll") || "400", 10) || 400);
    const SLOW = Math.max(FAST, parseInt(qs.get("pollIdle") || "2500", 10) || 2500);
    const FAST_WINDOW = 30000;
    // P4-F2 (field F5): the server stamps activeAt on the room record while the operator
    // queue holds cards — work is coming, so stay FAST even past FAST_WINDOW. Freshness is
    // judged on the server's own clock pair (d.serverNow - d.activeAt), NEVER the client
    // clock: OBS boxes drift. On failed polls the last value persists, which is moot —
    // the jittered backoff below owns the delay whenever fails > 0.
    const ACTIVE_WINDOW = 90000;
    let serverActive = false;   // last PARSED response said the queue is warm
    const isLive = (d) => d.card && (d.durationMs == null || (d.serverNow - d.airedAt) < d.durationMs);
    const remaining = (d) => d.durationMs == null ? null : Math.max(0, d.durationMs - (d.serverNow - d.airedAt));
    (async function poll() {
      let ok = false;
      try {
        const r = await fetch("/api/onair?room=" + encodeURIComponent(room), { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          ok = true;                                     // only a PARSED response is healthy (red-team M3)
          serverActive = typeof d.activeAt === "number" && typeof d.serverNow === "number"
            && (d.serverNow - d.activeAt) < ACTIVE_WINDOW;
          if (lastSeq === null) {                        // on connect: RESUME an in-flight check (survives OBS restart/refresh)
            lastSeq = d.seq || 0;
            if (isLive(d)) { lastChange = performance.now(); showOnAir(d.card, remaining(d)); }
          } else if ((d.seq || 0) !== lastSeq) {         // a new air, a pull, or state expiry (seq resets → treat as pull; red-team M4)
            lastSeq = d.seq || 0; lastChange = performance.now();
            isLive(d) ? showOnAir(d.card, remaining(d)) : hideOnAir();
          }
        }
      } catch {}
      if (ok) { fails = 0; netDot.classList.remove("on"); }
      else if (++fails >= FAILS_BEFORE_DOT) netDot.classList.add("on");
      const active = showing || (performance.now() - lastChange) < FAST_WINDOW || serverActive;
      let delay = active ? FAST : SLOW;
      if (fails) delay = Math.min(5000, 500 * Math.pow(2, Math.min(fails - 1, 4))) + Math.random() * 300;   // jittered backoff — don't hammer a dead cell link
      setTimeout(poll, delay);
    })();
  }

  // ---- test drivers (standalone, no server) ----
  const c = qs.get("card");                     // ?card=<base64 json> → render one card
  if (c) { try { showOnAir(JSON.parse(atob(c))); } catch (e) { console.error("bad ?card", e); } }
  if (qs.get("demo")) {                          // ?demo=1 → cycle samples so you can eyeball it in OBS
    const SAMPLES = [
      { verdict: "False", claim: "The Great Wall of China is visible from space with the naked eye.", correction: "NASA and astronauts confirm it is not visible to the naked eye from low Earth orbit.", source: { name: "Scientific American" }, tier: 3 },
      { verdict: "True", claim: "Gold is worth more than silver.", correction: "Gold trades far higher than silver per ounce in modern markets.", source: { name: "CFTC" } },
      { verdict: "NeedsContext", claim: "The unemployment rate was 4.1 percent in June.", correction: "BLS reported 4.2 percent for June 2026; figures are revised over time.", source: { name: "Bureau of Labor Statistics" }, tier: 3 },
    ];
    let i = 0;
    const cycle = () => { showOnAir(SAMPLES[i % SAMPLES.length]); i++; };
    cycle(); setInterval(cycle, DUR + 3000);
  }
})();
