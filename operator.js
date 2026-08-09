/* Footnote /op — second-phone operator queue (P3-J, solo street mode).
   Reads the room's UNAIRED queue snapshot (writeKey-gated POST op:"queue-read" — N1: the
   key travels in the body, never a query string that would land in access logs) and the
   public on-air state; sends air/skip/hold/pull commands (POST op:"cmd"). The server publishes
   operator airs to the overlay directly, so this page works even when /control at home
   base hiccups — /control catches up from the command list on its next poll.

   Security posture: every pipeline-derived string (claims, corrections, source names)
   lands in the DOM via textContent ONLY — live speech is adversarial input. The write
   key arrives in the URL (capability URL, same scheme as the overlay room URL); no new
   auth surface. No frameworks, no deps. */
(() => {
  const byId = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const room = qs.get("room") || "", key = qs.get("key") || "";

  const VERDICT_META = {
    True:         { cls: "v-true",  label: "✓ TRUE" },
    False:        { cls: "v-false", label: "✗ FALSE" },
    Misleading:   { cls: "v-warn",  label: "⚠ MISLEADING" },
    NeedsContext: { cls: "v-warn",  label: "◐ NEEDS CONTEXT" },
    Unverifiable: { cls: "v-gray",  label: "? UNVERIFIABLE" },
  };
  const vmeta = (v) => VERDICT_META[v] || VERDICT_META.Unverifiable;

  const queueEl = byId("queue"), emptyEl = byId("empty"), bannerEl = byId("banner");
  const stripEl = byId("onairStrip"), connDot = byId("connDot");
  byId("roomChip").textContent = room || "no room";

  // tiny DOM helper — className is ours, text goes through textContent (never markup)
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  function setBanner(text, cls) {
    if (!text) { bannerEl.hidden = true; return; }
    bannerEl.hidden = false; bannerEl.className = "banner" + (cls ? " " + cls : ""); bannerEl.textContent = text;
  }

  if (!room || !key) { setBanner("missing ?room= / ?key= — copy the OPERATOR URL from /control"); return; }

  /* ---- state ---- */
  let cards = [], lastQseq = null, lastChange = 0, fails = 0, stopped = false;
  let onAirLive = false;

  /* ---- P4-F3: new-card cue. Street operator's eyes are on the conversation, not the
     phone — decide time (p50 2.8s, p95 9.5s in the 08-08 field test) is mostly reaction
     lag. Vibrate + short beep + screen flash when a NEW pending card lands. The beep
     needs an unlocked AudioContext (mobile autoplay policy): created lazily on the first
     touch anywhere on the page. Everything here is best-effort — a cue can never break
     the queue. */
  let cueCtx = null;
  const unlockAudio = () => {
    if (cueCtx) return;
    try { cueCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    if (cueCtx && cueCtx.state === "suspended") cueCtx.resume().catch(() => {});
  };
  document.addEventListener("touchstart", unlockAudio, { once: true, passive: true });
  document.addEventListener("click", unlockAudio, { once: true });
  const seenPending = new Set();   // card ids we've already cued for (per page life)
  function cueNewCards(list) {
    const fresh = list.filter((c) => c.state === "pending" && !seenPending.has(c.id) && !sent.has(c.id));
    list.forEach((c) => { if (c.state === "pending") seenPending.add(c.id); });
    if (!fresh.length) return;
    try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch {}
    if (cueCtx && cueCtx.state === "running") {
      try {
        const o = cueCtx.createOscillator(), g = cueCtx.createGain();
        o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.12, cueCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, cueCtx.currentTime + 0.25);
        o.connect(g); g.connect(cueCtx.destination);
        o.start(); o.stop(cueCtx.currentTime + 0.26);
      } catch {}
    }
    document.body.classList.add("cue");
    setTimeout(() => document.body.classList.remove("cue"), 600);
  }
  // optimistic marks: cardId -> action. A tapped card greys instantly and stays greyed
  // until a queue snapshot no longer lists it as pending (control reconciled) — if home
  // base is down, the mark persists so the operator can't double-fire.
  const sent = new Map();

  /* ---- commands ---- */
  async function postCmd(action, cardId) {
    try {
      const r = await fetch("/api/onair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, writeKey: key, op: "cmd", cmd: { action, cardId } }),
      });
      if (r.status === 403) { forbid(); return false; }
      return r.ok || r.status === 409;   // 409 = already handled server-side — treat as done
    } catch { return false; }
  }
  function act(action, cardId) {
    if (sent.has(cardId)) return;   // double-tap guard (server is idempotent too)
    sent.set(cardId, action);
    renderQueue();
    postCmd(action, cardId).then((ok) => {
      if (!ok && !stopped) { sent.delete(cardId); renderQueue(); setBanner("send failed — tap again", "info"); setTimeout(() => { if (fails === 0) setBanner(null); }, 2500); }
    });
  }
  byId("pullBtn").addEventListener("click", () => {
    stripEl.hidden = true; onAirLive = false;   // optimistic — poll reconciles
    postCmd("pull", null);
  });

  function forbid() {
    stopped = true;
    setBanner("403 — wrong key for this room. Re-copy the OPERATOR URL from /control.");
    connDot.className = "conn-dot down";
    queueEl.hidden = true; stripEl.hidden = true;
  }

  /* ---- render ---- */
  function renderQueue() {
    queueEl.querySelectorAll(".card").forEach((n) => n.remove());
    const list = cards;   // snapshot arrives newest-first (control unshifts new checks)
    emptyEl.hidden = list.length > 0;
    for (const c of list) {
      const mark = sent.get(c.id);
      const card = el("div", "card " + (c.state === "checking" ? "checking" : vmeta(c.verdict).cls) + (mark ? " sent" : ""));
      const top = el("div", "c-top");
      if (c.state === "checking") {
        top.appendChild(el("span", "badge v-gray", "CHECKING"));
      } else {
        const m = vmeta(c.verdict);
        top.appendChild(el("span", "badge " + m.cls, m.label));
        // manual-hold tags — why auto-air won't touch this card (D4/D11); the human decides
        if (c.harm_class === "person_private" || c.harm_class === "person_public") top.appendChild(el("span", "tag", "MANUAL — person"));
        if (c.harm_class === "quote_attribution") top.appendChild(el("span", "tag", "MANUAL — quote"));
        if (c.polarity_conflict) top.appendChild(el("span", "tag", "⚠ polarity"));
        if (mark) top.appendChild(el("span", "sent-tag", mark === "air" ? "AIRING…" : mark === "hold" ? "HELD" : "SKIPPED"));
        else if (c.confidence != null) top.appendChild(el("span", "conf", Math.round(c.confidence * 100) + "%"));
      }
      card.appendChild(top);
      card.appendChild(el("div", "claim", "“" + (c.claim || "") + "”"));
      if (c.state === "checking") {
        card.appendChild(el("div", "spin", "checking against sources…"));
      } else {
        if (c.correction) card.appendChild(el("div", "correction", c.correction));
        if (c.source && c.source.name) card.appendChild(el("div", "src", "Source: " + c.source.name));
        const acts = el("div", "acts");
        const bAir = el("button", "b-air", "AIR"), bHold = el("button", "b-hold", "HOLD"), bSkip = el("button", "b-skip", "SKIP");
        bAir.type = bHold.type = bSkip.type = "button";
        bAir.addEventListener("click", () => act("air", c.id));
        bHold.addEventListener("click", () => act("hold", c.id));
        bSkip.addEventListener("click", () => act("skip", c.id));
        acts.appendChild(bAir); acts.appendChild(bHold); acts.appendChild(bSkip);
        card.appendChild(acts);
      }
      queueEl.appendChild(card);
    }
  }

  function renderOnAir(d) {
    const live = d && d.card && (d.durationMs == null || (d.serverNow - d.airedAt) < d.durationMs);
    onAirLive = !!live;
    if (!live) { stripEl.hidden = true; return; }
    const corr = d.card.kind === "correction";
    const m = corr ? { cls: "v-corr", label: "↺ CORRECTION" } : vmeta(d.card.verdict);
    const v = byId("oaVerdict");
    v.className = "oa-verdict " + m.cls; v.textContent = m.label;
    byId("oaClaim").textContent = corr ? (d.card.correction || "") : "“" + (d.card.claim || "") + "”";
    stripEl.hidden = false;
  }

  /* ---- reconcile: drop optimistic marks once the snapshot no longer offers the card ---- */
  function reconcile() {
    const pending = new Set(cards.filter((c) => c.state === "pending").map((c) => c.id));
    for (const id of [...sent.keys()]) if (!pending.has(id)) sent.delete(id);
  }

  /* ---- poll loop: queue (gated) + on-air (public) each tick; adaptive cadence + jittered
     backoff on failure (the overlay's degraded-cell pattern) ---- */
  const ACTIVE_MS = 1000, IDLE_MS = 3000, ACTIVE_WINDOW = 30000, FAILS_BEFORE_BANNER = 4;
  (async function poll() {
    if (stopped) return;
    let ok = false;
    try {
      const [qr, or] = await Promise.all([
        // N1: writeKey in the POST body — never a query string (query strings reach access logs)
        fetch("/api/onair", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, writeKey: key, op: "queue-read" }), cache: "no-store" }),
        fetch(`/api/onair?room=${encodeURIComponent(room)}`, { cache: "no-store" }),
      ]);
      if (qr.status === 403) { forbid(); return; }
      if (qr.ok) {
        const q = await qr.json();
        ok = true;   // only a parsed response is healthy
        if (q.qseq !== lastQseq) {
          lastQseq = q.qseq; cards = Array.isArray(q.cards) ? q.cards : [];
          lastChange = performance.now();
          reconcile(); renderQueue(); cueNewCards(cards);   // P4-F3: buzz/beep/flash for new work
        }
      }
      if (or.ok) renderOnAir(await or.json().catch(() => null));
    } catch {}
    if (ok) {
      fails = 0; connDot.className = "conn-dot ok";
      if (!bannerEl.hidden && bannerEl.textContent.startsWith("offline")) setBanner(null);
    } else {
      fails++;
      connDot.className = "conn-dot " + (fails >= FAILS_BEFORE_BANNER ? "down" : "degraded");
      if (fails >= FAILS_BEFORE_BANNER) setBanner("offline — retrying… taps won't send until this clears");
    }
    const active = onAirLive || sent.size > 0 || cards.some((c) => c.state === "pending" || c.state === "checking")
      || (performance.now() - lastChange) < ACTIVE_WINDOW;
    let delay = active ? ACTIVE_MS : IDLE_MS;
    if (fails) delay = Math.min(5000, 500 * Math.pow(2, Math.min(fails - 1, 4))) + Math.random() * 300;
    setTimeout(poll, delay);
  })();
})();
