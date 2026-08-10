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

  /* ---- P7-B render-ack state machine (R39): AIR success alone only proves the SERVER
     accepted the card — 8 cards once silently missed broadcast while /op said success.
     The overlay now acks the actual paint (POST op:"rendered"), the server stamps
     renderedId onto the room record, and queue-read carries it back here. Per aired card:
       AIRING…  — cmd in flight (optimistic mark, no server answer yet)
       AIRED ✓  — server accepted + minted airedId; waiting for the overlay's paint ack
       ON AIR ✓✓ — queue-read renderedId === this card's airedId (pixels confirmed, green)
       STALL    — >5s since air with no matching ack → amber pulsing
                  "NOT ON SCREEN — check home base"; clears if the ack arrives late. */
  const airs = new Map();   // cardId -> { airedId, at, rendered, lastLbl }
  const STALL_MS = 5000;
  function airLabel(a) {
    if (!a) return null;                               // cmd still in flight
    if (a.rendered) return "onair";
    if (performance.now() - a.at > STALL_MS) return "stall";
    return "aired";
  }

  /* ---- commands ---- */
  // resolves to the parsed response body ({} if unparseable) on success/409, null on failure
  async function postCmd(action, cardId) {
    try {
      const r = await fetch("/api/onair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, writeKey: key, op: "cmd", cmd: { action, cardId } }),
      });
      if (r.status === 403) { forbid(); return null; }
      if (r.ok || r.status === 409) return (await r.json().catch(() => null)) || {};   // 409 = already handled server-side — treat as done
      return null;
    } catch { return null; }
  }
  function act(action, cardId) {
    if (sent.has(cardId)) return;   // double-tap guard (server is idempotent too)
    sent.set(cardId, action);
    renderQueue();
    postCmd(action, cardId).then((b) => {
      if (!b && !stopped) { sent.delete(cardId); renderQueue(); setBanner("send failed — tap again", "info"); setTimeout(() => { if (fails === 0) setBanner(null); }, 2500); return; }
      // arm the render-ack machine only when the server minted an airedId (a plain 409
      // "not airable" never aired — a STALL warning for it would be a false alarm)
      if (b && action === "air" && b.airedId) { airs.set(cardId, { airedId: b.airedId, at: performance.now(), rendered: false, lastLbl: null }); renderQueue(); }
    });
  }
  byId("pullBtn").addEventListener("click", () => {
    stripEl.hidden = true; onAirLive = false;   // optimistic — poll reconciles
    postCmd("pull", null);
  });

  /* ---- P7-C mic mute (R43): latched toggle in the header. The command is LOG-ONLY
     server-side — /control consumes mute/unmute from the cmd list and flips the actual
     mic; the LATCHED state comes back via the queue snapshot's `muted` boolean, which is
     the source of truth here. Optimistic flip on tap, reconciled against the snapshot
     (adopt on agreement, revert if control hasn't confirmed within the window). DOM is
     built here: operator.html is owned by the parent shard this round. */
  const muteBtn = el("button", "btn-mute", "MUTE");
  muteBtn.type = "button";
  connDot.parentNode.insertBefore(muteBtn, connDot);
  const muteBanner = el("div", "mute-banner", "MIC MUTED");
  muteBanner.hidden = true;
  bannerEl.parentNode.insertBefore(muteBanner, bannerEl.nextSibling);
  let muted = false;        // last snapshot value (control's latch)
  let muteWish = null;      // optimistic flip awaiting confirmation: { val, at }
  const MUTE_RECONCILE_MS = 8000;
  function renderMute() {
    const on = muteWish ? muteWish.val : muted;
    muteBtn.textContent = on ? "MUTED" : "MUTE";
    muteBtn.classList.toggle("on", on);
    muteBanner.hidden = !on;
  }
  muteBtn.addEventListener("click", () => {
    if (stopped) return;
    const target = !(muteWish ? muteWish.val : muted);
    muteWish = { val: target, at: performance.now() };
    renderMute();
    postCmd(target ? "mute" : "unmute", null).then((b) => {
      if (!b && !stopped && muteWish && muteWish.val === target) {
        muteWish = null; renderMute();
        setBanner("send failed — tap again", "info"); setTimeout(() => { if (fails === 0) setBanner(null); }, 2500);
      }
    });
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
      // R41: Unverifiable pending cards render recessed — the street norm is "don't air
      // what we couldn't verify", but operator discretion is retained (button stays live)
      const unv = c.state !== "checking" && vmeta(c.verdict) === VERDICT_META.Unverifiable;
      const card = el("div", "card " + (c.state === "checking" ? "checking" : vmeta(c.verdict).cls) + (mark ? " sent" : "") + (unv ? " unv" : ""));
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
        if (mark === "air") {
          // P7-B state machine: AIRING… → AIRED ✓ → ON AIR ✓✓ | STALL (see airs map above)
          const lbl = airLabel(airs.get(c.id));
          if (lbl === "onair") top.appendChild(el("span", "sent-tag ok", "ON AIR ✓✓"));
          else if (lbl === "stall") { card.classList.add("stalled"); top.appendChild(el("span", "sent-tag stall", "NOT ON SCREEN — check home base")); }
          else top.appendChild(el("span", "sent-tag", lbl === "aired" ? "AIRED ✓" : "AIRING…"));
        } else if (mark) top.appendChild(el("span", "sent-tag", mark === "hold" ? "HELD" : "SKIPPED"));
        else if (c.confidence != null) top.appendChild(el("span", "conf", Math.round(c.confidence * 100) + "%"));
      }
      card.appendChild(top);
      card.appendChild(el("div", "claim", "“" + (c.claim || "") + "”"));
      if (c.state === "checking") {
        card.appendChild(el("div", "spin", "checking against sources…"));
      } else {
        if (c.correction) card.appendChild(el("div", "correction", c.correction));
        if (c.source && c.source.name) card.appendChild(el("div", "src", "Source: " + c.source.name));
        if (unv) card.appendChild(el("div", "unv-hint", "street norm: don't air"));
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
    // a card the snapshot no longer offers is off /op entirely — its ack machine goes too
    for (const id of [...airs.keys()]) if (!pending.has(id)) airs.delete(id);
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
        // P7-C: adopt control's mute latch; drop the optimistic wish once control agrees
        // (or the reconcile window lapses — a lost cmd must not pin a phantom MUTED state)
        if (typeof q.muted === "boolean") {
          muted = q.muted;
          if (muteWish && (q.muted === muteWish.val || performance.now() - muteWish.at > MUTE_RECONCILE_MS)) muteWish = null;
          renderMute();
        }
        // P7-B: drive the ack machines every tick (not just on qseq change — AIRED→STALL
        // and a late STALL→ON AIR flip both happen with a frozen snapshot); re-render only
        // when some card's derived label actually changed.
        let dirty = false;
        const rid = q.renderedId || null;
        for (const a of airs.values()) {
          if (!a.rendered && rid && a.airedId === rid) a.rendered = true;
          const lbl = airLabel(a);
          if (lbl !== a.lastLbl) { a.lastLbl = lbl; dirty = true; }
        }
        if (dirty) renderQueue();
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
