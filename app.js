/* Footnote — live fact-check
   webcam "stream" on a mock Twitch/Kick/YouTube page. Live transcript →
   claim extraction (Haiku, /api/extract) → verification (Perplexity, /api/verify)
   → operator queue → on-air lower-third. Uses /api/transcribe as a fallback. */
(() => {
  const $ = (s) => document.querySelector(s);
  const byId = (id) => document.getElementById(id);
  /* SANITIZER CHOKE POINT (D8) — live speech is adversarial input. Every pipeline-derived
     string (claim, correction, source name, spoken text, error text, device labels) passes
     through esc() at EVERY innerHTML interpolation: queue cards, on-air lower-third, debug
     panel, transcript, obs bar. esc() also strips control characters and zero-width/bidi
     chars so nothing invisible or cursor-hostile reaches the DOM, and escapes quotes so
     attribute contexts (href="...") can't be broken out of. URLs additionally go through
     safeUrl() before landing in an href (no javascript:/data: schemes). /overlay uses
     textContent (inert) — its owner keeps it that way. */
  const esc = (s) => String(s)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "")
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u.trim())) ? u.trim() : null;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const fmtK = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(Math.round(n));

  /* ================= INSTRUMENTATION HARNESS =================
     Collection is ALWAYS on (near-zero overhead). The panel just visualizes it.
     Per utterance we capture the full latency chain so we can see exactly where
     time goes: spoken audio → transcription → claim extract → verify → on-screen.
       extract_ms   = Haiku claim-extraction round-trip     (gates the pricey verify)
       verify_ms    = Perplexity verification round-trip     (source + verdict)
       roundtrip_ms = browser fetch send → response          (upload + DG + return)
       dg_ms        = Deepgram round-trip measured server-side
       network_ms   = roundtrip − dg_ms                       (our transport overhead)
       render_ms    = overlay DOM update                                            */
  const DBG = {
    records: [], events: [], windows: 0, errors: 0, sessionStart: performance.now(),
    on: /[?&]debug=1/.test(location.search),
    push(r) { r.i = ++this.windows; this.records.push(r); if (this.records.length > 800) this.records.shift(); if (this.on) { try { console.debug("[footnote]", r); } catch {} renderDbg(); } },
    // always-on event tail (errors + lifecycle) — visible in the panel AND the console, so a live
    // failure is never silent. level: "err" | "warn" | "info". detail is any small context object.
    event(level, msg, detail) {
      const t = +((performance.now() - this.sessionStart) / 1000).toFixed(1);
      const e = { at: t, level, msg, detail: detail || null };
      this.events.push(e); if (this.events.length > 60) this.events.shift();
      if (level === "err") this.errors++;
      const tag = level === "err" ? "❌" : level === "warn" ? "⚠️" : "•";
      try { (level === "err" ? console.error : level === "warn" ? console.warn : console.info)(`[footnote] ${tag} ${msg}`, detail || ""); } catch {}
      if (this.on) renderDbg();
      return e;
    },
    err() { this.errors++; if (this.on) renderDbg(); },
    series(k) { return this.records.map((r) => r[k]).filter((v) => typeof v === "number"); },
    pct(a, p) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; },
    stats() {
      const f = (a) => a.length ? { p50: Math.round(this.pct(a, 50)), p95: Math.round(this.pct(a, 95)), n: a.length } : null;
      return { extract: f(this.series("extract_ms")), verify: f(this.series("verify_ms")), roundtrip: f(this.series("roundtrip_ms")), dg: f(this.series("dg_ms")) };
    },
    json() { return JSON.stringify({ generated: new Date().toISOString(), platform, session_s: +((performance.now() - this.sessionStart) / 1000).toFixed(1), windows: this.windows, errors: this.errors, stats: this.stats(), events: this.events, records: this.records }, null, 2); },
  };

  /* ================= FACT-CHECK (claim → extract → verify → operator queue → on-air) ================= */
  const ssTranscript = byId("ssTranscript"), ssLock = byId("ssLock"), ssMeter = byId("ssMeter"), player = byId("player");
  const opsQueue = byId("opsQueue"), opsStatus = byId("opsStatus"), onAir = byId("onAir");

  const VERDICT_META = {
    True:         { cls: "v-true", icon: "✓", label: "TRUE" },
    False:        { cls: "v-false", icon: "✗", label: "FALSE" },
    Misleading:   { cls: "v-warn", icon: "⚠", label: "MISLEADING" },
    NeedsContext: { cls: "v-warn", icon: "◐", label: "NEEDS CONTEXT" },
    Unverifiable: { cls: "v-gray", icon: "?", label: "UNVERIFIABLE" },
  };
  const vmeta = (v) => VERDICT_META[v] || VERDICT_META.Unverifiable;

  let fcCards = [], fcId = 0, fcInflight = 0, lastUtterance = "";
  let recentClaims = new Map();   // F2 dedupe: normalized claim → last card-creation epoch ms (cleared per stream)
  let fcPublish = null;   // set in control view → publishes an aired card to the OBS /overlay channel
  let opBridge = null;    // set in control view → second-phone operator bridge (P3-J): queue snapshot push + command poll
  let fcRoom = null;      // control view's room id — sent on verify calls for per-room caps/BYOK
  let byokActive = false; // room has its own vendor keys registered (caps lifted)
  let audioDeviceId = null;      // chosen input (mic or virtual audio cable) in the control picker
  let refreshAudioDevices = null;   // re-enumerate inputs after mic permission (labels appear)
  let callTabStream = null, callTabSource = null, mixBus = null;   // remote-call tab audio, mixed with the mic
  const CONTROL_VIEW = () => document.body.classList.contains("view-control");
  /* M6 — two-tabs-same-room clobber guard. Exactly one writer tab per room (localStorage
     heartbeat, wired in setupControlBridge). A read-only tab may LOOK at everything but must
     not mutate the shared record: no snapshot persistence, no fcPublish, no checks, no
     AIR/SKIP/HOLD/pull/corrections. This is a wrong-TAB guard, orthogonal to the gen guard
     (wrong-TIME) below — operator actions bypass the gen guard but never this one. */
  let tabReadOnly = false, roWarned = false;
  function warnReadOnly() { if (!roWarned) { roWarned = true; DBG.event("warn", "read-only tab — action suppressed (another control tab is live for this room)"); } }

  /* ============ FIELD-TEST HARNESS (local shakedown only — inert everywhere else) ============
     FT mirrors pipeline events (stt interim/final, extract/verify in-out, gate decisions,
     dispositions, air/publish) to the local server's /__fieldtest/log JSONL sink (npm start
     with FOOTNOTE_FIELDTEST_LOG set; the route doesn't exist otherwise). Hostname-gated:
     on any non-localhost origin FT.log is a no-op and TESTAIR can never enable.
     TESTAIR (?testair=1) is PASS-2 of the field test: auto-airs every settled verdict with a
     TEST watermark. It does NOT touch maybeAutoAir or any real gate — separate local-only
     path, and the `test` flag rides the card so the overlay shows the watermark. */
  const FT_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const TESTAIR = FT_LOCAL && new URLSearchParams(location.search).has("testair");
  let ftSeq = 0, ftUid = 0, ftLastInterim = 0;
  const FT = {
    log(ev, data) {
      if (!FT_LOCAL) return;
      try {
        const body = JSON.stringify(Object.assign({ ev, t: Date.now(), seq: ++ftSeq, page: "control" }, data || {}));
        if (!(navigator.sendBeacon && navigator.sendBeacon("/__fieldtest/log", new Blob([body], { type: "application/json" }))))
          fetch("/__fieldtest/log", { method: "POST", body, keepalive: true }).catch(() => {});
      } catch {}
    },
  };

  /* W1.3 hard lesson (run test: the assembler was in the served file and never executed,
     with NOTHING logged): any uncaught client error now lands in the harness, so silent
     code-path death becomes a logged fact instead of a post-session mystery. */
  window.addEventListener("error", (e) => FT.log("client_error", { msg: String(e.message || "").slice(0, 200), src: String(e.filename || "").split("/").pop(), line: e.lineno || null }));
  window.addEventListener("unhandledrejection", (e) => FT.log("client_error", { msg: ("unhandledrejection: " + String(e.reason && e.reason.message || e.reason)).slice(0, 200) }));

  /* ============ SESSION LOG — the broadcast record (checks + operator actions) ============
     One entry per checked claim, updated as the operator acts. Downloadable JSON from the queue
     header; aired checks are also mirrored server-side (durability backstop) via /api/onair.

     DISPOSITION COMPLETENESS (P1-F, re-verified after P3-F + M5; F2 added duplicate): every
     logged claim ends in exactly ONE terminal action —
     aired | skipped | held | error | expired | stale_generation | paused | duplicate.
     Lifecycle paths:
       · verify ok → "pending" → operator AIR / SKIP / HOLD → aired / skipped / held
                              → auto-air fires → aired (autoAired flag) · operator veto → skipped/held (vetoed flag)
                              → still pending when clearFactChecks runs (Start/End Stream) → expired
       · verify fails → error (retry is a NEW check + NEW entry; the error entry stands)
       · extract or verify answered by the 503 kill-switch → paused (no card enters the queue)
       · extract or verify straddles an End/Start Stream boundary → stale_generation (never enqueued)
       · extract returns a claim already carded < DUP_CLAIM_WINDOW_MS earlier (F2 dedupe)
         → duplicate (never enqueued; operator retry and typed input bypass via force)
       · "checking" card killed by a reload → restored as error w/ restored flag (M5 — logged at
         restore time, because checking cards are otherwise only logged when verify settles)
     Flags, never dispositions: corrected, vetoed, autoAired, restored (aired:boolean mirrors action).
     "pending" is the only non-terminal action and only exists while the card is actionable. */
  const SESSION = {
    startedAt: null, byId: new Map(), currentOnAir: null,
    log(card) {
      if (!this.startedAt) this.startedAt = new Date().toISOString();
      const e = {
        id: card.id, at: new Date().toISOString(), spoken: card.spoken, claim: card.claim,
        displayClaim: card.displayClaim || null,   // D17: what actually aired (speaker framing)
        verdict: card.verdict || null, confidence: card.confidence != null ? card.confidence : null,
        // R53 (additive, display/telemetry only): polarity rides the entry so the R20 export
        // supports the denial-watch count without the harness log
        polarity: card.polarity || null, polarity_conflict: !!card.polarity_conflict,
        correction: card.correction || null, source: card.source || null, citations: card.citations || null,
        action: card.state === "error" ? "error" : "pending", aired: false, autoAired: false, vetoed: false,
        airedAt: null, pulledAt: null,
        // latency chain (epoch ms + durations) — same numbers checkUtterance measured for DBG
        spokenAt: card.spokenAt || null, extractStartedAt: card.extractStartedAt || null,
        extractMs: card.extractMs != null ? card.extractMs : null,
        verifyMs: card.verifyMs != null ? card.verifyMs : null,
        pendingAt: card.pendingAt || null,
      };
      this.byId.set(card.id, e); updateSessionBtn();
    },
    mark(id, action, opts) {
      const e = this.byId.get(id); if (!e) return;
      FT.log("mark", { id, action, veto: !!(opts && opts.veto), auto: !!(opts && opts.auto), operator: !!(opts && opts.operator) });
      /* correction composer (P3-C): "corrected" is an append-only FLAG, not a disposition —
         it must not clobber action:"aired" (disposition model is the next wave's domain).
         References both stable aired ids: the original's and the correction event's. */
      if (action === "corrected") {
        e.corrected = true; e.correctedAt = new Date().toISOString();
        e.correctionRef = { originalId: (opts && opts.originalId) || null, correctionId: (opts && opts.correctionId) || null };
        updateSessionBtn();
        return;
      }
      e.action = action;
      if (opts && opts.veto) e.vetoed = true;   // auto-air countdown was running when the operator skipped/held
      if (opts && opts.operator) e.operator = true;   // P3-J: actioned from the second-phone /op page (server published)
      if (action === "aired") { e.aired = true; e.airedAt = new Date().toISOString(); e.autoAired = !!(opts && opts.auto); this.currentOnAir = id; }
      updateSessionBtn();
    },
    markPulled() {
      if (this.currentOnAir == null) return;
      const e = this.byId.get(this.currentOnAir); if (e) e.pulledAt = new Date().toISOString();
      this.currentOnAir = null; updateSessionBtn();
    },
    entries() { return [...this.byId.values()]; },
    counts() {
      const es = this.entries(), aired = es.filter((e) => e.aired);
      const byVerdict = {};
      aired.forEach((e) => { if (e.verdict) byVerdict[e.verdict] = (byVerdict[e.verdict] || 0) + 1; });
      return { checked: es.length, aired: aired.length, skipped: es.filter((e) => e.action === "skipped").length, airedByVerdict: byVerdict };
    },
    // end-of-night rollup: dispositions + p50/p95 for each pipeline stage
    summary() {
      const es = this.entries(), num = (v) => typeof v === "number";
      const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };
      /* L2 — p95 honesty: a "p95" over 1-3 samples is a lie (it's just the max). p50 (median of
         whatever exists) is always reported; p95 is null until n ≥ 4. n rides along so the
         reader can judge how much to trust either number. */
      const pp = (a) => ({ p50: pct(a, 50), p95: a.length >= 4 ? pct(a, 95) : null, n: a.length });
      const s2p = es.filter((e) => num(e.spokenAt) && num(e.pendingAt)).map((e) => e.pendingAt - e.spokenAt);
      const s2a = es.filter((e) => num(e.spokenAt) && e.airedAt).map((e) => Date.parse(e.airedAt) - e.spokenAt);
      return {
        totalChecked: es.length,
        aired: es.filter((e) => e.aired).length,
        autoAired: es.filter((e) => e.autoAired).length,
        vetoed: es.filter((e) => e.vetoed).length,
        skipped: es.filter((e) => e.action === "skipped").length,
        held: es.filter((e) => e.action === "held").length,
        pulled: es.filter((e) => e.pulledAt).length,
        expired: es.filter((e) => e.action === "expired").length,
        errors: es.filter((e) => e.action === "error").length,
        stale_generation: es.filter((e) => e.action === "stale_generation").length,   // P3-F: dropped across an End/Start Stream boundary
        paused: es.filter((e) => e.action === "paused").length,                       // kill-switch gap — the record shows it honestly
        duplicate: es.filter((e) => e.action === "duplicate").length,                 // F2: same claim carded again inside the dedupe window
        /* R54: per-card attention rollup over auto-aired cards. "uncaptured" is a first-class
           value — a missing tag is reported, never assumed into a state. */
        attention: (() => {
          const auto = es.filter((e) => e.autoAired); if (!auto.length) return null;
          const r = { watching: 0, talking: 0, away: 0, uncaptured: 0 };
          auto.forEach((e) => { r[e.attention || "uncaptured"] = (r[e.attention || "uncaptured"] || 0) + 1; });
          return r;
        })(),
        latency: {
          extract: pp(es.map((e) => e.extractMs).filter(num)),
          verify: pp(es.map((e) => e.verifyMs).filter(num)),
          spokenToPending: pp(s2p),
          spokenToAir: pp(s2a),
        },
      };
    },
    json() {
      return JSON.stringify({
        session: { startedAt: this.startedAt, generatedAt: new Date().toISOString(), platform, keyterms: this.keyterms || [], counts: this.counts(), summary: this.summary() },
        // R54: auto-aired entries always carry an attention value in the export — "uncaptured" when untagged
        entries: this.entries().map((e) => e.autoAired ? Object.assign({}, e, { attention: e.attention || "uncaptured" }) : e),
      }, null, 2);
    },
    _exported: true,   // R20: flips false on any record mutation, true on download
    download() {
      const b = new Blob([this.json()], { type: "application/json" });
      const u = URL.createObjectURL(b), a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = u; a.download = `footnote-session-${stamp}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(u), 2000);
      this._exported = true;
    },
  };
  /* R20 (P4-E): the session record is the eval pipeline's raw material — losing it loses
     golden-set growth. Two backstops: End Stream auto-downloads the record (unmissable),
     and closing a tab with an un-exported record asks first (covers crash-adjacent paths;
     the localStorage snapshot already covers actual crashes). */
  window.addEventListener("beforeunload", (e) => {
    if (SESSION.byId.size && !SESSION._exported && !tabReadOnly) { e.preventDefault(); e.returnValue = ""; }
  });
  function updateSessionBtn() {
    SESSION._exported = false;   // any record mutation makes the last export stale (R20)
    schedulePersist();
    const b = byId("sessionLog"); if (!b) return;
    const c = SESSION.counts();
    b.textContent = `⭳ Session · ${c.checked} checked · ${c.aired} aired`;
    b.disabled = c.checked === 0;
  }

  /* ---- /control resilience: snapshot queue + log to localStorage (namespaced per room) so a
     mid-session reload doesn't lose the operator's night. Slim cards only — no timers/DOM. ---- */
  let sessPersistKey = null, sessPersistT = 0, keepQueueOnce = false;   // keepQueueOnce: a restored queue survives the next Start Stream
  const SESS_MAX_AGE = 4 * 3600 * 1000;
  const slimCard = (c) => ({ id: c.id, spoken: c.spoken, claim: c.claim, displayClaim: c.displayClaim || null, state: c.state,
    verdict: c.verdict || null, correction: c.correction || null, source: c.source || null,
    confidence: c.confidence != null ? c.confidence : null, errMsg: c.errMsg || null,
    harm_class: c.harm_class || null, polarity: c.polarity || null, polarity_conflict: !!c.polarity_conflict, autoAirEligible: c.autoAirEligible === true,   // polarity: R53 additive — survives a reload into the restored entry
    spokenAt: c.spokenAt || null, pendingAt: c.pendingAt || null,
    extractMs: c.extractMs != null ? c.extractMs : null, verifyMs: c.verifyMs != null ? c.verifyMs : null,
    _airedId: c._airedId || null, corrected: !!c.corrected });   // P3-C: keep the aired id + corrected flag across a reload
  function persistSessionNow() {
    if (!sessPersistKey || tabReadOnly) return;   // M6: only the writer tab persists the snapshot
    try {
      localStorage.setItem(sessPersistKey, JSON.stringify({
        savedAt: Date.now(), startedAt: SESSION.startedAt,
        entries: SESSION.entries(), cards: fcCards.slice(0, 40).map(slimCard),
      }));
    } catch {}
  }
  function schedulePersist() {
    if (opBridge) opBridge.scheduleQueuePush();   // P3-J: queue mutations ride the same choke points as the localStorage persist
    if (!sessPersistKey) return; clearTimeout(sessPersistT); sessPersistT = setTimeout(persistSessionNow, 400);
  }
  function setOps() {
    const pend = fcCards.filter((c) => c.state === "pending").length;
    opsStatus.textContent = fcInflight ? `● analyzing… (${fcInflight})` : (pend ? `${pend} pending` : (streaming ? "listening" : "idle"));
    opsStatus.classList.toggle("busy", fcInflight > 0);
  }

  /* ---- kill-switch (paused) UX: /api/extract and /api/verify answer 503 {paused:true} while
     the operator's server-side kill switch (D14 spendgate) is engaged. One amber status line +
     ONE DBG warn (not per utterance); the affected claims are logged with terminal disposition
     "paused" so the session record shows the coverage gap honestly — but NO error cards are
     created (a pause is not a failure). The first non-paused HTTP response flips everything
     back to the normal status. ---- */
  let pipelinePaused = false;
  function notePaused() {
    if (!pipelinePaused) { pipelinePaused = true; DBG.event("warn", "pipeline paused by operator (server kill-switch) — checks logged as `paused` until it lifts"); }
    setStatus("⏸ paused by operator — pipeline disabled", "paused");
  }
  function noteUnpaused() {
    if (!pipelinePaused) return;
    pipelinePaused = false;
    DBG.event("info", "pipeline resumed (kill-switch lifted)");
    if (streaming) setStatus("● LIVE · listening — talk like an anchor", "live");
    else if (player.classList.contains("live")) setStatus("typed input · overlay live (no camera)", "live");
    else setStatus("ready", "");
  }

  // mirror of src/core/utterance.js — test/prompt-sync pattern (test/utterance-sync.test.js
  // asserts the block below is byte-identical, modulo indentation, with the module's copy).
  /* ===== MIRROR BLOCK (utterance guards) — keep byte-identical with the copy in app.js;
     test/utterance-sync.test.js compares them (indentation-insensitive). ===== */
  // TUNABLE — F2 dedupe: a claim that already produced a card this recently is dropped.
  const DUP_CLAIM_WINDOW_MS = 60000;
  // TUNABLE — F3 merge: max gap between two finals for them to be considered one thought.
  const MERGE_MAX_GAP_MS = 3500;
  // TUNABLE — F3 merge: a final this short (in words) is presumed a continuation fragment.
  const MERGE_SHORT_WORDS = 4;
  // TUNABLE — W1.2 assembler: silence that ends a spoken thought (flush the joined buffer).
  // 3600 = just past MERGE_MAX_GAP_MS: replay of BOTH sessions showed real intra-claim
  // splits arriving up to ~3.5s apart (session-1 vitamin-C denial 2.2s; session-2 bones
  // fragments 3.5s) — an 1800ms first guess flushed mid-thought and LOST claims the old
  // pair-join caught. Inter-claim pauses in both sessions were >5s, so 3.6s separates
  // thoughts safely. Endpointing bench refines; replay tool re-verifies any change.
  const ASSEMBLE_SILENCE_MS = 3600;
  // TUNABLE — W1.2 assembler: max finals joined into one utterance (runaway-buffer cap).
  const ASSEMBLE_MAX_FINALS = 6;
  // TUNABLE — W1.3 window: words of rolling transcript context handed to each extract.
  const WINDOW_WORDS = 30;
  // TUNABLE — W1.3 window: minimum NEW words since the last extract before another fires.
  const WINDOW_MIN_NEW_WORDS = 3;
  // TUNABLE — W1.3 window: cadence ceiling — extract at least this often during speech.
  const WINDOW_EXTRACT_MS = 3500;
  // TUNABLE — W1.3 window: trailing silence that flushes the last words of a thought.
  const WINDOW_TRAIL_SILENCE_MS = 1500;
  /**
   * Canonical claim key for dedupe: lowercase, punctuation stripped, whitespace collapsed.
   * @param {string|null|undefined} claim extracted claim text
   * @returns {string} normalized key ("" for empty/nullish input)
   */
  function normalizeClaim(claim) {
    return String(claim == null ? "" : claim)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  /**
   * F2 — is a claim first carded at `createdAt` still a duplicate at `nowAt`?
   * @param {number|null|undefined} createdAt epoch ms of the prior card's creation, if any
   * @param {number} nowAt epoch ms of the would-be new card
   * @returns {boolean} true → drop the new card as a duplicate
   */
  function withinDupWindow(createdAt, nowAt) {
    return createdAt != null && nowAt - createdAt >= 0 && nowAt - createdAt < DUP_CLAIM_WINDOW_MS;
  }
  /**
   * F3 — should two consecutive STT finals ALSO be checked as one joined utterance?
   * True when they arrived close together AND the boundary looks like a split thought:
   * the earlier final didn't end in sentence-terminal punctuation, or the later one is a
   * short fragment ("Was 4%.").
   * @param {string|null|undefined} prev earlier final transcript
   * @param {number} prevAt epoch ms the earlier final arrived
   * @param {string|null|undefined} next later final transcript
   * @param {number} nowAt epoch ms the later final arrived
   * @returns {boolean} true → also run the joined check
   */
  function shouldMergeFinals(prev, prevAt, next, nowAt) {
    const p = String(prev == null ? "" : prev).trim();
    const n = String(next == null ? "" : next).trim();
    if (!p || !n) return false;
    const gap = nowAt - prevAt;
    if (!(gap >= 0 && gap <= MERGE_MAX_GAP_MS)) return false;
    const unterminated = !/[.!?]$/.test(p);
    const shortNext = n.split(/\s+/).filter(Boolean).length <= MERGE_SHORT_WORDS;
    return unterminated || shortNext;
  }
  /**
   * W1.2 (walkable-rig sprint) — rolling final-assembler flush predicate. Session 2's
   * routed/bonded audio made Deepgram finalize at micro-gaps, shredding one spoken claim
   * across 2-5 finals; the pair-join (shouldMergeFinals, retained above for reference and
   * tests but no longer called by the client) couldn't reconstruct them — splits arrived
   * pre-punctuated, and pairs aren't enough. The assembler buffers consecutive finals and
   * flushes the JOINED utterance when the thought actually ends.
   * Flush when: the buffer hit the cap, OR real silence has passed since the last final.
   * @param {number} count finals currently buffered
   * @param {number} lastAt epoch ms of the newest buffered final
   * @param {number} nowAt epoch ms now
   * @returns {boolean} true → flush (join + check as merged when count >= 2)
   */
  function assemblyShouldFlush(count, lastAt, nowAt) {
    if (count <= 0) return false;
    if (count >= ASSEMBLE_MAX_FINALS) return true;
    return nowAt - lastAt >= ASSEMBLE_SILENCE_MS;
  }
  /**
   * W1.3 (run-test 2026-08-14) — rolling-WINDOW extraction predicate. The run proved the
   * final is not a unit of meaning: 244 finals, median ONE word, 73% of spoken words never
   * reached a check. The window frame: keep a running transcript of the last ~N words and
   * extract claims from the WINDOW on a cadence, letting F2 dedupe absorb the overlap and
   * the grounding gate reject anything not actually said. Supersedes the final-assembler
   * (whose wiring is retired; predicate retained above for reference/tests).
   * Extract when: enough NEW words arrived since the last extract AND (the newest final
   * ended a sentence, OR the cadence interval elapsed, OR real silence set in).
   * @param {number} newWords words arrived since the last window extract
   * @param {number} msSinceExtract ms since the last window extract
   * @param {number} msSinceLastWord ms since the newest word arrived
   * @param {boolean} endsTerminal newest final ended with . ! or ?
   * @returns {boolean} true → extract the window now
   */
  function windowShouldExtract(newWords, msSinceExtract, msSinceLastWord, endsTerminal) {
    if (newWords < WINDOW_MIN_NEW_WORDS) return false;
    if (endsTerminal) return true;
    if (msSinceExtract >= WINDOW_EXTRACT_MS) return true;
    return msSinceLastWord >= WINDOW_TRAIL_SILENCE_MS;
  }
  /**
   * D17 — pick the claim-bearing sentence from a (possibly filler-prefixed) utterance:
   * best content-word overlap with the canonical claim wins; whole utterance is the
   * fallback. Used to render the SPEAKER'S framing (denials keep their negation).
   * @param {string} spoken the utterance that produced the claim
   * @param {string} claim the canonical (positive-form) claim
   * @returns {string} the sentence to display
   */
  /**
   * R46 — does the text contain an explicit negation token? Deterministic consistency
   * check for the polarity tripwire (extractor says "denies" but the speaker's words
   * carry no negation → the flip is suspect) and the D17 split-negation fallback.
   * @param {string} text
   * @returns {boolean}
   */
  function hasNegation(text) {
    return /\b(no|not|never|isn't|wasn't|aren't|doesn't|don't|didn't|hasn't|haven't|won't|can't|cannot)\b|n't\b/i.test(String(text));
  }
  function pickSpokenSentence(spoken, claim, preferNegation) {
    const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9%]+/).filter((w) => w.length >= 3));
    const cw = words(claim);
    let best = null, bestScore = 0;
    for (const sent of String(spoken).split(/(?<=[.!?])\s+/)) {
      let n = 0; words(sent).forEach((w) => { if (cw.has(w)) n++; });
      if (n > bestScore) { bestScore = n; best = sent.trim(); }
    }
    // A denial whose picked sentence lost its negation (split across sentences — field case:
    // "it says X. No. That's not") falls back to the whole utterance, which carries it.
    if (preferNegation && best && !hasNegation(best) && hasNegation(spoken)) return String(spoken).trim();
    return best || String(spoken).trim();
  }
  /* ===== END MIRROR BLOCK ===== */

  // entry point: a spoken final (or a typed claim). Guard → Haiku extract → Perplexity verify.
  async function checkUtterance(text, opts) {
    opts = opts || {};
    const t = (text || "").trim();
    const words = t.split(/\s+/).filter(Boolean);
    /* F3 — opts.merged (joined split-finals) bypasses ONLY the word minimum: a joined pair of
       fragments can be a real claim under 6 words ("The GDP? Was 4%."). It still respects the
       consecutive-dupe guard here and the F2 claim dedupe below — force (typed/retry) is the
       only full bypass, because those are deliberate operator acts. */
    /* R56 (D18 pilot 1): the fragment drop was SILENT — no harness event — and five scripted
       5-word claims vanishing cost live minutes of confusion. Log-only fix; behavior identical.
       The consecutive-dupe drop STAYS silent (Deepgram re-finals repeat constantly). */
    if (!opts.force && words.length < 6 && !opts.merged) { FT.log("gate", { outcome: "fragment", words: words.length, spoken: t.slice(0, 80) }); return; }
    if (!opts.force && t === lastUtterance) return;   // consecutive-dupe guard (unchanged, unlogged)
    if (tabReadOnly) { warnReadOnly(); return; }                            // M6: a read-only tab runs no checks
    lastUtterance = t;
    /* GENERATION GUARD (P3-F, red-team H2 full closure): capture the stream generation at entry.
       `gen` bumps on both Start Stream and End Stream, so if it moved while extract/verify was
       in flight this check belongs to a dead broadcast — it must not enqueue, render, or feed
       auto-air in the new one. It IS logged (disposition: stale_generation) so the record stays
       complete. Operator retry re-enters here fresh and captures the CURRENT gen — by design. */
    const g = gen;
    const spokenAt = Date.now();   // ≈ utterance final; extract starts immediately (client stt lag ~0)
    const cid = "u" + (++ftUid);
    FT.log("check_start", { cid, spoken: t, typed: !!opts.force, merged: !!opts.merged });
    fcInflight++; setOps();
    const t0 = performance.now();
    let claim = null, extractFailed = false, extractPaused = false, ungrounded = false, polarity, harmClass, category;
    try {
      const r = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503 && j && j.paused === true) extractPaused = true;   // operator kill-switch — not a failure
      else if (!r.ok) { noteUnpaused(); extractFailed = true; DBG.event("err", `extract failed${j && j.upstream_status ? ` · Anthropic ${j.upstream_status}` : ` · HTTP ${r.status}`}`, { status: r.status, upstream_status: j && j.upstream_status, upstream: j && j.upstream, spoken: t.slice(0, 80) }); }
      else { noteUnpaused(); claim = j.claim; polarity = j.polarity; harmClass = j.harm_class; category = j.category; ungrounded = j.rejected === "ungrounded"; }   // null claim is a legit "no checkable claim", not a failure
    } catch (e) { extractFailed = true; DBG.event("err", "extract network error", { error: String(e && e.message || e), spoken: t.slice(0, 80) }); }
    const extractMs = performance.now() - t0;
    FT.log("extract_done", { cid, ms: +extractMs.toFixed(0), status: extractPaused ? "paused" : extractFailed ? "failed" : "ok", claim, polarity: polarity || null, harm_class: harmClass || null, category: category || null });
    if (g !== gen) {   // stale at extract stage — the stream this belongs to is gone: log, never enqueue
      fcInflight--; setOps();
      FT.log("gate", { cid, outcome: "stale_generation", stage: "extract" });
      DBG.event("info", "stale check dropped (stream ended during extract)", { spoken: t.slice(0, 60) });
      if (claim) { const dead = { id: ++fcId, spoken: t, claim, state: "checking", spokenAt, extractMs: +extractMs.toFixed(0) }; SESSION.log(dead); SESSION.mark(dead.id, "stale_generation"); }
      return;
    }
    if (extractPaused) {
      fcInflight--; setOps(); notePaused();
      FT.log("gate", { cid, outcome: "paused", stage: "extract" });
      const rec = { id: ++fcId, spoken: t, claim: null, state: "checking", spokenAt };
      SESSION.log(rec); SESSION.mark(rec.id, "paused");   // honest gap in the record; no card, no error dress
      return;
    }
    if (!claim) {
      fcInflight--; setOps();
      // "ungrounded" = the P4-F1 grounding gate rejected the extractor's output server-side —
      // distinguished from a plain no_claim so field monitoring can watch the gate fire
      FT.log("gate", { cid, outcome: extractFailed ? "extract_error" : ungrounded ? "ungrounded" : "no_claim", words: words.length });
      if (!extractFailed) DBG.event("info", ungrounded ? "extraction rejected (ungrounded)" : "no checkable claim", { spoken: t.slice(0, 80), extract_ms: +extractMs.toFixed(0) });
      DBG.push({ t: new Date().toISOString(), source: "fc", spoken: t, claim: null, extract_ms: +extractMs.toFixed(0), error: extractFailed || undefined });
      return;
    }
    /* F2 — claim-level dedupe at card-creation time. The consecutive-utterance guard above is
       defeated by interleaved finals (field test: same claim re-extracted 3× in 20s, two cards
       AIRED 2s apart). Key = normalized claim text; window keys on card CREATION time, survives
       across utterances, resets on clearFactChecks (stream boundaries). Operator retry and typed
       input enter with force:true and bypass — a deliberate re-check is never blocked. */
    const normClaim = normalizeClaim(claim);
    if (!opts.force && withinDupWindow(recentClaims.get(normClaim), Date.now())) {
      fcInflight--; setOps();
      FT.log("gate", { cid, outcome: "duplicate_claim" });
      DBG.event("info", "duplicate claim dropped (same claim carded moments ago)", { claim: claim.slice(0, 80), extract_ms: +extractMs.toFixed(0) });
      const dup = { id: ++fcId, spoken: t, claim, state: "checking", spokenAt, extractMs: +extractMs.toFixed(0) };
      SESSION.log(dup); SESSION.mark(dup.id, "duplicate");   // terminal disposition — same log-then-mark shape as stale_generation
      return;
    }
    /* D17 (round 7, from FS-1): cards ALWAYS display the speaker's framing — the canonical-
       positive form is verification substrate and never airs. For asserts, the canonical
       claim IS a faithful restatement; for denials (and, later, polarity conflicts) the
       spoken sentence carries the negation the canonical form strips. pickSpokenSentence
       trims multi-sentence utterances to the claim-bearing sentence by content-word overlap. */
    const displayClaim = (polarity === "denies" || polarity === "suspect_denies") ? pickSpokenSentence(t, claim, true) : claim;   // R46: suspect flips show speaker framing from the start
    const card = { id: ++fcId, _gen: g, _cid: cid, spoken: t, claim, displayClaim, polarity, harm_class: harmClass, category: category || "other", state: "checking", spokenAt, extractStartedAt: spokenAt, extractMs: +extractMs.toFixed(0) };   // real claim → checking card now
    recentClaims.set(normClaim, Date.now());   // F2: register at creation (force-created cards too — they still dedupe later voice repeats)
    if (recentClaims.size > 200) { const nowMs = Date.now(); recentClaims.forEach((at, k) => { if (!withinDupWindow(at, nowMs)) recentClaims.delete(k); }); }
    fcCards.unshift(card); renderQueue(); setOps();
    const t1 = performance.now();
    let v = null, verifyPaused = false;
    try {
      const r = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claim, polarity, utterance: t, room: fcRoom || undefined }) });   // R50: raw utterance feeds the independent polarity signal
      const body = await r.json().catch(() => ({}));
      if (r.status === 503 && body && body.paused === true) verifyPaused = true;   // operator kill-switch — not a failure
      else if (r.ok) { noteUnpaused(); v = body; }
      else { noteUnpaused(); DBG.event("err", `verify failed${body && body.upstream_status ? ` · Perplexity ${body.upstream_status}` : ` · HTTP ${r.status}`}`, { status: r.status, upstream_status: body && body.upstream_status, upstream: body && body.upstream, claim: claim.slice(0, 80) }); }
    } catch (e) { DBG.event("err", "verify network error", { error: String(e && e.message || e), claim: claim.slice(0, 80) }); }
    fcInflight--; setOps();
    card.verifyMs = +(performance.now() - t1).toFixed(0);   // same measurement DBG gets — one clock, no double-timing
    FT.log("verify_done", { cid, id: card.id, ms: card.verifyMs, ok: !!v, verdict: (v && v.verdict) || null, confidence: v && v.confidence != null ? v.confidence : null,
      tier: (v && v.source && v.source.tier != null) ? v.source.tier : null, autoAirEligible: !!(v && v.autoAirEligible === true), polarity_conflict: !!(v && v.polarity_conflict), harm_class: harmClass || null });
    if (g !== gen) {   // stale at verify stage — pull the card back out of the queue quietly, log the disposition
      fcCards = fcCards.filter((x) => x.id !== card.id);
      renderQueue(); setOps();
      SESSION.log(card); SESSION.mark(card.id, "stale_generation");   // checking cards aren't logged yet → log-then-mark
      DBG.event("info", "stale check dropped (stream ended during verify)", { claim: claim.slice(0, 60) });
      return;
    }
    if (verifyPaused) {
      fcCards = fcCards.filter((x) => x.id !== card.id);   // pause is not a failure — no error card
      renderQueue(); setOps(); notePaused();
      SESSION.log(card); SESSION.mark(card.id, "paused");
      return;
    }
    if (!v) { card.state = "error"; card.errMsg = (DBG.events[DBG.events.length - 1] || {}).msg || "verify failed"; renderQueue(); DBG.push({ t: new Date().toISOString(), source: "fc", claim, error: true, verify_ms: card.verifyMs }); SESSION.log(card); return; }
    Object.assign(card, { state: "pending", verdict: v.verdict, correction: v.correction, source: v.source, citations: v.citations, confidence: v.confidence,
      autoAirEligible: v.autoAirEligible === true, polarity_conflict: !!v.polarity_conflict, pendingAt: Date.now() });
    // D17: a polarity CONFLICT means the canonical form's relationship to the spoken claim is
    // in doubt — fall back to the speaker's own words for display regardless of polarity field
    if (card.polarity_conflict) card.displayClaim = pickSpokenSentence(card.spoken, card.claim, true);
    renderQueue(); setOps(); SESSION.log(card);
    DBG.push({ t: new Date().toISOString(), source: "fc", claim, verdict: v.verdict, confidence: v.confidence, extract_ms: card.extractMs, verify_ms: card.verifyMs, sourceUrl: v.source && v.source.url });
    maybeAutoAir(card);
    /* PASS-2 TESTAIR (local field test only — see FT block): air every settled verdict
       immediately with the TEST watermark. Supersedes a real auto-air timer if one armed;
       does not consult or alter any real gate. */
    if (TESTAIR && card.state === "pending") {
      if (card._auto) { clearTimeout(card._auto); card._auto = null; }
      card.test = true; card._autoAired = true;
      FT.log("testair_fire", { cid, id: card.id });
      airCard(card);
    }
  }

  /* R54: attention affordance on auto-aired cards — visible UNTAGGED state until the operator
     says what they were doing during the veto window (W/T/A keystroke targets the oldest
     untagged; these buttons target this card). Tagged state renders as a plain chip. */
  function attnHtml(c) {
    if (!c._autoAired || c.state !== "aired") return "";
    if (c.attention) return `<span class="fc-attn-tag">👁 ${esc(c.attention)}</span>`;
    return `<span class="fc-attn" title="R54: what were you doing during this card's veto window?">attention?
      <button class="fc-attn-b" data-id="${c.id}" data-attn="watching">W</button>
      <button class="fc-attn-b" data-id="${c.id}" data-attn="talking">T</button>
      <button class="fc-attn-b" data-id="${c.id}" data-attn="away">A</button></span>`;
  }
  function renderQueue() {
    schedulePersist();
    if (!fcCards.length) { opsQueue.innerHTML = `<div class="ops-empty"><span>go live and make a factual claim — checks land here to <b>AIR</b> or <b>SKIP</b>.</span></div>`; return; }
    opsQueue.innerHTML = "";
    fcCards.slice(0, 12).forEach((c) => opsQueue.appendChild(cardEl(c)));
  }
  function cardEl(c) {
    const el = document.createElement("div");
    el.className = "fc-card " + c.state + (c.state === "pending" ? " " + vmeta(c.verdict).cls : "");
    if (c.state === "checking") {
      el.innerHTML = `<div class="fc-claim">“${esc(c.displayClaim || c.claim)}”</div><div class="fc-checking"><span class="fc-spin"></span> checking against sources…</div>`;
    } else if (c.state === "error") {
      el.innerHTML = `<div class="fc-claim">“${esc(c.displayClaim || c.claim)}”</div><div class="fc-checking err">${esc(c.errMsg || "couldn't verify")} — <button class="fc-retry" data-id="${c.id}">retry</button></div>`;
    } else {
      const m = vmeta(c.verdict);
      const srcUrl = safeUrl(c.source && c.source.url);
      const src = srcUrl
        ? `<a class="fc-src" href="${esc(srcUrl)}" target="_blank" rel="noopener">${esc(c.source.name)} ↗</a>`
        : `<span class="fc-src">${esc((c.source && c.source.name) || "source")}</span>`;
      // manual-only tags: show the operator WHY auto-air didn't take this card (D4/D11)
      const tags = [];
      if (c.harm_class === "person_private" || c.harm_class === "person_public") tags.push("MANUAL — person");
      if (c.harm_class === "quote_attribution") tags.push("MANUAL — quote");
      if (c.polarity_conflict) tags.push("⚠ polarity");
      const tagHtml = tags.map((t) => `<span class="fc-manual">${esc(t)}</span>`).join("");
      /* correction composer (P3-C): aired cards get a "✎ correct" affordance (control view —
         publishing needs the overlay channel). Corrections are append-only events (D6): the
         original card just gets a "corrected" tag, its log entry is never mutated. */
      const canCorrect = c.state === "aired" && CONTROL_VIEW() && !c.corrected && !c._composing;
      const acts = c.state === "pending"
        ? `<span class="fc-acts"><button class="fc-air" data-id="${c.id}">AIR</button><button class="fc-hold" data-id="${c.id}">HOLD</button><button class="fc-skip" data-id="${c.id}">SKIP</button></span>`
        : `<span class="fc-acts"><span class="fc-state-tag">${c.state === "aired" ? "● AIRED" : c.state.toUpperCase()}</span>${c.corrected ? `<span class="fc-corrected-tag">↺ corrected</span>` : ""}${canCorrect ? `<button class="fc-correct" data-id="${c.id}" title="Air an on-record correction for this check">✎ correct</button>` : ""}${attnHtml(c)}</span>`;
      /* correction composer (P3-C): inline, not a modal — original claim + verdict read-only,
         one-line correction text, optional source URL. Drafts live on the card (c._corrDraft /
         c._corrUrl via the delegated input handler) so async queue re-renders don't eat typing. */
      const composer = c._composing ? `
        <div class="fc-compose">
          <div class="fc-cc-orig">correcting <span class="fc-badge ${m.cls}">${m.icon} ${m.label}</span> “${esc(c.claim)}”</div>
          <input class="fc-cc-text" data-id="${c.id}" placeholder="what actually happened — one line" value="${esc(c._corrDraft || "")}" maxlength="300">
          <input class="fc-cc-url" data-id="${c.id}" placeholder="source URL (optional)" value="${esc(c._corrUrl || "")}" spellcheck="false">
          <div class="fc-cc-acts"><button class="fc-cc-air" data-id="${c.id}">AIR CORRECTION</button><button class="fc-cc-cancel" data-id="${c.id}">cancel</button></div>
        </div>` : "";
      el.innerHTML = `<div class="fc-top"><span class="fc-badge ${m.cls}">${m.icon} ${m.label}</span>${tagHtml}<span class="fc-conf">${Math.round((c.confidence || 0) * 100)}%</span></div>
        <div class="fc-claim">“${esc(c.displayClaim || c.claim)}”</div>
        <div class="fc-correction">${esc(c.correction || "")}</div>
        <div class="fc-foot">${src}${acts}</div>${composer}`;
    }
    return el;
  }
  opsQueue.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const id = +b.dataset.id, c = fcCards.find((x) => x.id === id); if (!c) return;
    if (b.classList.contains("fc-attn-b")) applyAttention(c, b.dataset.attn, "control");
    else if (b.classList.contains("fc-air")) airCard(c);
    else if (b.classList.contains("fc-skip")) dismissCard(c, "skipped");
    else if (b.classList.contains("fc-hold")) dismissCard(c, "held");
    else if (b.classList.contains("fc-retry")) { fcCards = fcCards.filter((x) => x.id !== id); checkUtterance(c.claim, { force: true }); }
    /* correction composer (P3-C) */
    else if (b.classList.contains("fc-correct")) { c._composing = true; renderQueue(); const t = opsQueue.querySelector(`.fc-cc-text[data-id="${c.id}"]`); if (t) t.focus(); }
    else if (b.classList.contains("fc-cc-cancel")) { c._composing = false; renderQueue(); }
    else if (b.classList.contains("fc-cc-air")) airCorrection(c);
  });
  /* correction composer (P3-C): drafts live on the card, not the DOM — the queue re-renders
     with innerHTML whenever a new check lands, which would otherwise wipe in-progress typing. */
  opsQueue.addEventListener("input", (e) => {
    const t = e.target, id = +t.dataset.id, c = fcCards.find((x) => x.id === id); if (!c) return;
    if (t.classList.contains("fc-cc-text")) c._corrDraft = t.value;
    else if (t.classList.contains("fc-cc-url")) c._corrUrl = t.value;
  });

  /* correction composer (P3-C): air an append-only correction event (D6). Publishes through the
     standard fcPublish path with kind:"correction" — the overlay already renders correction dress —
     plus refId = the original card's server-assigned aired id (R9) so /receipts can join them.
     refClaim rides along one release as the legacy join fallback. Never mutates the original. */
  async function airCorrection(c) {
    if (tabReadOnly) return warnReadOnly();   // M6: read-only tab can't publish corrections
    const text = (c._corrDraft || "").trim();
    if (!text) { const t = opsQueue.querySelector(`.fc-cc-text[data-id="${c.id}"]`); if (t) t.focus(); return; }
    if (!fcPublish) return;   // control view only — no overlay channel, nowhere to air
    const url = safeUrl(c._corrUrl || "");
    let srcName = "Footnote desk";
    if (url) { try { srcName = new URL(url).hostname.replace(/^www\./, "") || srcName; } catch {} }
    const corr = { kind: "correction", claim: c.claim, correction: text,
      source: { name: srcName, url: url || null },
      refId: c._airedId || undefined,   // may be absent if the original's publish response was lost — receipts falls back to refClaim
      refClaim: c.claim };
    const durationMs = holdMode ? null : DEFAULT_HOLD_MS;
    c._composing = false; c.corrected = true; c._corrDraft = ""; c._corrUrl = "";
    renderQueue();
    const airedId = await fcPublish(corr, durationMs);
    if (airedId === null) { c.corrected = false; renderQueue(); DBG.event("err", "correction publish failed — card re-opened"); return; }
    SESSION.mark(c.id, "corrected", { originalId: c._airedId || null, correctionId: airedId });
    DBG.event("info", "correction aired", { of: c._airedId || null, id: airedId, text: text.slice(0, 60) });
  }

  // skip/hold share one path so the auto-air veto is always recorded (timer live = operator veto)
  function dismissCard(c, action) {
    if (tabReadOnly) return warnReadOnly();   // M6: read-only tab can't mutate the record
    const veto = !!c._auto && c.state === "pending";
    if (c._auto) { clearTimeout(c._auto); c._auto = null; }
    if (veto) FT.log("veto_window", { id: c.id, cid: c._cid || null, outcome: "vetoed", input_activity: lastInputT >= (c._armT || 0), ms: Date.now() - (c._armT || Date.now()) });   // R54
    c.state = action; renderQueue(); setOps(); SESSION.mark(c.id, action, { veto });
    /* N4 residual closure (P5-E): a dismissal must reach the server's queue snapshot NOW,
       not after the 400ms debounce — that window was the last way a second-phone AIR could
       land on a just-dismissed card. Best-effort immediate push; the debounced path still
       runs behind it as the retry. */
    if (opBridge && opBridge.pushNow) opBridge.pushNow();
  }

  let onAirRAF = 0, onAirHideT = 0;
  const DEFAULT_HOLD_MS = 10000;
  let holdMode = false;   // "Hold on screen": aired checks stay up until Pull, instead of auto-retiring
  /* STREET AUTO-AIR UX — on-air pacing (display layer ONLY; /pacer.js). Consecutive airs
     used to flash-replace the current lower-third mid-display; now every air — operator
     click, auto-air, TESTAIR, second-phone AIR (this layer can't tell them apart) —
     funnels through the pacer: the current card holds its minimum dwell (6s of the 10s
     hold), then the next queued card takes over with an exit→entrance beat. Decision
     logic (maybeAutoAir, gates, caps, veto) is untouched upstream of this line. Falls
     back to the legacy immediate swap if /pacer.js somehow didn't load — a missing
     script must never take the lower-third down. */
  const onAirPacer = globalThis.FootnotePacer ? globalThis.FootnotePacer.createPacer({
    render: (c, durationMs) => renderOnAirNow(c, durationMs),
    exitStart: () => { cancelAnimationFrame(onAirRAF); onAir.classList.remove("show"); },
    onEvent: (action, d) => FT.log("pace", { action, id: d.card && d.card.id != null ? d.card.id : null,
      queued: d.queued, waited_ms: d.waitedMs != null ? d.waitedMs : undefined }),
  }) : null;
  function showOnAir(c, durationMs) {
    if (onAirPacer) onAirPacer.air(c, durationMs);
    else renderOnAirNow(c, durationMs);
  }
  function airCard(c) {
    if (tabReadOnly) return warnReadOnly();   // M6: read-only tab can't air
    if (c._auto) clearTimeout(c._auto); c.state = "aired"; renderQueue(); setOps();
    // R53 (additive, telemetry-only): polarity rides the air event so the denial-watch line
    // is countable from the harness log alone (tools/fieldtest/session-summary.js)
    FT.log("air", { id: c.id, cid: c._cid || null, verdict: c.verdict || null, auto: !!c._autoAired, test: c.test === true, claim: c.claim,
      polarity: c.polarity || null, polarity_conflict: !!c.polarity_conflict });
    SESSION.mark(c.id, "aired", { auto: !!c._autoAired });
    const durationMs = holdMode ? null : DEFAULT_HOLD_MS;
    showOnAir(c, durationMs); chatReactToAir();
    // keep the server-assigned aired id on the card (R9) — the correction composer joins on it
    if (fcPublish) fcPublish(c, durationMs).then((id) => { if (id) { c._airedId = id; schedulePersist(); } });
  }
  function renderOnAirNow(c, durationMs) {   // the painter — reached ONLY through the pacer (or its fallback)
    if (durationMs === undefined) durationMs = DEFAULT_HOLD_MS;
    cancelAnimationFrame(onAirRAF); clearTimeout(onAirHideT);
    const m = vmeta(c.verdict);
    onAir.className = "onair " + m.cls;
    byId("oaVerdict").textContent = m.icon + " " + m.label;
    byId("oaClaim").textContent = "“" + (c.displayClaim || c.claim) + "”";   // D17: speaker framing
    byId("oaCorrection").textContent = c.correction || "";
    byId("oaSrc").innerHTML = (c.source && c.source.name) ? "Source: " + esc(c.source.name) : "";
    onAir.hidden = false; onAir.classList.remove("show"); void onAir.offsetWidth; onAir.classList.add("show");
    const timer = byId("oaTimer");
    if (durationMs === null) { timer.style.width = "100%"; return; }   // hold: full bar, no auto-retire
    const start = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - start) / durationMs); timer.style.width = (100 - p * 100) + "%";
      if (p < 1) onAirRAF = requestAnimationFrame(tick); else hideOnAir();
    })(start);
  }
  // natural end of a card's countdown: fade down, then let the pacer promote a queued card
  // (retire is a no-op unless a card was showing — clearOnAir paths reach here with phase idle)
  function hideOnAir() { cancelAnimationFrame(onAirRAF); onAir.classList.remove("show"); onAirHideT = setTimeout(() => { onAir.hidden = true; }, 400); if (onAirPacer) onAirPacer.retire(); }
  // pull / stream boundary: flush the pacing queue too — a PULL means EVERYTHING comes down
  function clearOnAir() { if (onAirPacer) onAirPacer.clear(); hideOnAir(); }
  function pullOnAir() { if (tabReadOnly) return warnReadOnly(); clearOnAir(); SESSION.markPulled(); if (fcPublish) fcPublish(null, 0); }   // take the current graphic off-air (locally + overlay)

  // optional auto-air: only definitive, high-confidence, sourced, tier-eligible checks — with a veto window
  function maybeAutoAir(c) {
    // D4 (PERMANENT — hardcoded, no setting may override): claims about private persons
    // and polarity-conflicted checks NEVER auto-air. A human airs those or nobody does.
    if (c.harm_class === "person_private" || c.polarity_conflict) return;
    if (c.harm_class && c.harm_class !== "none") return;              // person_public / quote_attribution → manual only
    /* R57 (D18) — pilot category scope is CODE, not protocol: only allowlisted categories
       may auto-air, same mechanism class as the person-holds above. Session 2's breach
       ("Silver is worth more than bronze", economics) replays as: never arms. Mirrors
       PILOT_CATEGORY_ALLOWLIST in src/core/tunables.js (classic script — can't import);
       change BOTH together. Unknown/missing category = "other" = never arms. */
    if (c.category !== "science_health") return;
    if (!byId("autoAir").checked) return;
    if (c.autoAirEligible !== true) return;                          // server-side evidence floor (tier gate, D5)
    // 0.85 mirrors AUTO_AIR_CONF_FLOOR in src/core/tunables.js (classic script — can't import); change both together
    if ((c.verdict === "True" || c.verdict === "False") && (c.confidence || 0) >= 0.85 && c.source && c.source.url) {
      /* H2 closure (P3-F): `streaming` alone is NOT enough — End Stream → Start Stream inside
         the 4s veto window makes `streaming` true again for the WRONG stream. The card must
         also belong to the CURRENT generation. Auto-air is autonomous work, so it is gen-guarded
         (operator AIR clicks are not). */
      if (autoAirCount >= AUTO_AIR_CAP) {
        if (!autoAirCapNoted) { autoAirCapNoted = true; DBG.event("warn", `auto-air session cap (${AUTO_AIR_CAP}) reached — remaining cards are manual (D18)`); FT.log("autoair_cap", { cap: AUTO_AIR_CAP }); }
        return;   // D18: cap reached — no more arming this session
      }
      FT.log("autoair_armed", { id: c.id, cid: c._cid || null });
      c._armT = Date.now();   // R54: veto-window open — input-activity sampling measures against this
      c._auto = setTimeout(() => { if (streaming && c._gen === gen && c.state === "pending" && autoAirCount < AUTO_AIR_CAP) {
        autoAirCount++; c._autoAired = true; c._airedAtMs = Date.now();
        /* R54 objective supplement: did the operator's hands move during THIS card's veto
           window? (input_activity=false + no tag is the "4s was a formality" signature.) */
        FT.log("veto_window", { id: c.id, cid: c._cid || null, outcome: "fired", input_activity: lastInputT >= c._armT, ms: Date.now() - c._armT });
        airCard(c);
      } }, 4000);
    }
  }
  function clearFactChecks() {
    fcCards.forEach((c) => c._auto && clearTimeout(c._auto));
    if (keepQueueOnce) keepQueueOnce = false;   // first Start Stream after a reload-restore keeps the queue actionable
    else fcCards = [];
    // gate-decision completeness: any logged claim whose card is gone can never be actioned → close it out
    const live = new Set(fcCards.map((c) => c.id));
    let n = 0;
    SESSION.byId.forEach((e) => { if (e.action === "pending" && !live.has(e.id)) { e.action = "expired"; e.expiredAt = new Date().toISOString(); n++; } });
    if (n) { DBG.event("info", `${n} unactioned check(s) → expired`); updateSessionBtn(); }
    lastUtterance = ""; recentClaims.clear();   // F2: dedupe window is per-stream — a new broadcast may legitimately re-air a claim
    renderQueue(); clearOnAir(); setOps();
  }

  /* ================= PLATFORM SKINS ================= */
  const site = byId("site");
  const AVC = ["#e84393", "#0984e3", "#6c5ce7", "#00b894", "#fdcb6e", "#e17055", "#00cec9", "#d63031", "#a29bfe", "#20bf6b"];
  const avc = (i) => AVC[i % AVC.length];
  // real YouTube (Material) icon paths so the buttons match the actual interface
  const svg = (d) => `<svg class="mi" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  const IC = {
    menu: "M3 6h18v2H3zM3 11h18v2H3zM3 16h18v2H3z",
    plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z",
    bell: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
    thumbUp: "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.96 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z",
    thumbDown: "M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z",
    share: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z",
    save: "M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z",
    ask: "M12 2l1.9 4.6L18.5 8.5 13.9 10.4 12 15l-1.9-4.6L5.5 8.5l4.6-1.9L12 2zm6.5 10l.95 2.55L22 15.5l-2.55.95L18.5 19l-.95-2.55L15 15.5l2.55-.95L18.5 12z",
  };
  const PLATFORMS = {
    twitch: {
      cls: "skin-twitch", ytMode: false,
      logo: `<span class="lg-twitch"><svg class="tw-mark" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="#9146FF" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg><span class="tw-word">Twitch</span></span>`,
      nav: `<a>Following</a><a>Browse</a>`,
      search: "Search",
      right: `<span class="pill ghost">Try 1-Month Ad-Free</span><span class="ic">👑</span><span class="ic">🔔</span><span class="ic">✉️</span><div class="av"></div>`,
      sideType: "channels", sideHead: "Followed Channels",
      side: [{ n: "factcheck_live", g: "News & Politics", v: "12.4K", on: true }, { n: "world_desk", g: "Just Chatting", v: "5.1K", on: true },
             { n: "politiconow", g: "News", v: "3.3K", on: true }, { n: "the_desk_verify", g: "News", v: "2.7K", on: true },
             { n: "beltway", g: "Talk Shows", v: "1.6K", on: true }, { n: "nightlyfeed", g: "IRL", v: null, on: false }, { n: "the_desk", g: "Just Chatting", v: null, on: false }],
      meta: { name: "Footnote News", verif: true, title: "🔴 LIVE: fact-checking the newscast in real time", cat: "Politics", tags: ["News", "English", "Fact-Check"], follow: "♥ Follow", gift: "Gift a Sub", sub: "Subscribe" },
      chatHead: "Stream Chat", chatPh: "Send a message", chatSend: "Chat",
      emotes: ["KEKW", "PogChamp", "LULW", "OMEGALUL", "Pog", "monkaS", "EZ", "Clap"], base: 62000,
    },
    kick: {
      cls: "skin-kick", ytMode: false,
      logo: `<span class="lg-kick">KICK<sup>™</sup></span>`,
      nav: ``,
      search: "Search",
      right: `<span class="pill">Get KICKs</span><span class="ic">📥</span><span class="ic">🔔</span><div class="av"></div>`,
      sideType: "kicknav",
      guide: [{ i: "🏠", n: "Home" }, { i: "🧭", n: "Browse" }, { i: "♥", n: "Following" }, { i: "🎁", n: "Drops" }],
      sideHead: "Following",
      side: [{ n: "newsdesk_live", g: "News & Politics", v: "8.9K", on: true }, { n: "the_factcheck", g: "News", v: "4.2K", on: true },
             { n: "nightdesk", g: "Just Chatting", v: "2.1K", on: true }, { n: "on_the_ground", g: "IRL", v: "1.3K", on: true },
             { n: "wallst_after", g: "Finance", v: "3.0K", on: true }, { n: "the_brief", g: "Talk Shows", v: null, on: false }],
      rec: [{ n: "DeenTheGreat", g: "Just Chatting", v: "8.6K", on: true }, { n: "politiwatch", g: "News & Politics", v: "4.2K", on: true },
            { n: "slotsking", g: "Slots & Casino", v: "12.9K", on: true }, { n: "the_debate_hub", g: "Talk Shows", v: "6.2K", on: true },
            { n: "marketmoves", g: "Finance", v: "3.5K", on: true }, { n: "lategamelive", g: "IRL", v: "1.9K", on: true }],
      meta: { name: "Footnote News", verif: true, title: "LIVE: real-time fact-checks as the story moves", cat: "News & Politics", tags: ["News", "English", "Fact-Check"], follow: "Follow", gift: "Gift Subs", sub: "Subscribe", followers: "3.2M" },
      chatHead: "Chat", chatPh: "Send a message", chatSend: "Chat",
      emotes: ["KEKW", "EZ", "YEP", "OMEGALUL", "catJAM", "W"], base: 24000,
    },
    youtube: {
      cls: "skin-youtube", ytMode: true,
      logo: `<span class="ic yt-burger">${svg(IC.menu)}</span><span class="lg-yt"><svg class="yt-mark" viewBox="0 0 29 20" aria-hidden="true"><rect width="29" height="20" rx="5.5" fill="#FF0000"/><path d="M11.6 5.8 L20.4 10 L11.6 14.2 Z" fill="#fff"/></svg><span class="yt-word">YouTube</span></span>`,
      nav: ``,
      search: "Search or ask a question",
      right: `<span class="pill yt-create">${svg(IC.plus)}Create</span><span class="ic yt-bell">${svg(IC.bell)}</span><div class="av" style="background:#065fd4"></div>`,
      sideType: "none",
      meta: { name: "Footnote News", subs: "2.31M subscribers", title: "Live Fact-Check: claims verified on air in real time", follow: "Subscribe", desc: "watching now · Started streaming 14 minutes ago · #LiveNews #FactCheck #Footnote" },
      chatHead: "Top chat ▾", chatPh: "Chat…", chatSend: "Send",
      emotes: ["🔥", "😂", "💯", "👀", "📈"], base: 84000,
    },
    clean: {   // program feed: just the video + on-screen graphics, no platform chrome
      cls: "skin-clean", ytMode: false, logo: ``, nav: ``, search: "", right: ``, sideType: "none",
      meta: { name: "", verif: false, title: "", cat: "", tags: [], follow: "", gift: "", sub: "" },
      chatHead: "", chatPh: "", chatSend: "", emotes: [], base: 84000,
    },
  };
  let platform = "youtube", cfg = PLATFORMS.youtube;

  const chanRow = (c, i) => `<div class="side-row"><span class="side-av ${c.on ? "on" : ""}" style="background:${avc(i)}"></span>
    <div class="side-meta"><div class="side-name">${esc(c.n)}</div><div class="side-game">${esc(c.g || "")}</div></div>
    ${c.on ? `<span class="side-view">${esc(c.v || "")}</span>` : `<span class="side-off">Offline</span>`}</div>`;

  function buildMeta(key, m) {
    if (key === "youtube") {
      return `<div class="yt-title">${esc(m.title)}</div>
        <div class="yt-row">
          <span class="meta-av fn-av" role="img" aria-label="Footnote News"></span>
          <div class="yt-channel"><div class="yt-name">${esc(m.name)}<span class="yt-verif" title="Verified">✔</span></div><div class="yt-subs">${esc(m.subs)}</div></div>
          <button class="btn-follow">${esc(m.follow)}</button>
          <div class="yt-actions"><span class="yt-pill yt-like">${svg(IC.thumbUp)}<span class="ytl-n">8.4K</span><span class="yt-div"></span>${svg(IC.thumbDown)}</span><span class="yt-pill">${svg(IC.share)}Share</span><span class="yt-pill">${svg(IC.ask)}Ask</span><span class="yt-pill">${svg(IC.save)}Save</span></div>
        </div>
        <div class="yt-desc"><b id="ytViewers">84K</b> ${esc(m.desc)}</div>`;
    }
    if (key === "kick") {
      return `<div class="kick-top">
          <span class="meta-av fn-av" role="img" aria-label="Footnote News"></span>
          <div class="meta-info">
            <div class="meta-name">${esc(m.name)}<span class="verif">✓</span></div>
            <div class="meta-title">${esc(m.title)}</div>
            <div class="meta-tags"><a class="meta-cat">${esc(m.cat)}</a><span class="tag-row">${m.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</span></div>
          </div>
          <div class="meta-actions">
            <button class="btn-follow">${esc(m.follow)}</button>
            <button class="btn-gift">${esc(m.gift)}</button>
            <button class="btn-sub">${esc(m.sub)}</button>
            <span class="kick-watch"><span class="kw-eye">👁</span><b id="kickViewers">24,000</b> watching</span>
          </div>
        </div>
        <div class="kick-about"><b>About ${esc(m.name)}</b><span class="kick-fol">${esc(m.followers || "")} Followers</span><span class="kick-socials">@footnote · github.com/jordanpeele/footnote</span></div>`;
    }
    return `<span class="meta-av fn-av" role="img" aria-label="Footnote News"></span>
      <div class="meta-info">
        <div class="meta-name">${esc(m.name)}${m.verif ? ` <span class="verif">✓</span>` : ""}</div>
        <div class="meta-title">${esc(m.title)}</div>
        <div class="meta-tags"><a class="meta-cat">${esc(m.cat)}</a><span class="tag-row">${m.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</span></div>
      </div>
      <div class="meta-actions">
        <button class="btn-follow">${esc(m.follow)}</button>
        <button class="btn-gift">${esc(m.gift)}</button>
        <button class="btn-sub">${esc(m.sub)}</button>
      </div>`;
  }

  function applyPlatform(key) {
    cfg = PLATFORMS[key]; platform = key;
    site.className = "site " + cfg.cls;
    byId("tbLogo").innerHTML = cfg.logo;
    byId("tbNav").innerHTML = cfg.nav;
    byId("tbRight").innerHTML = cfg.right;
    byId("tbSearch").placeholder = cfg.search;
    const sn = byId("sidenav");
    if (cfg.sideType === "channels") {
      sn.innerHTML = `<div class="side-head">${esc(cfg.sideHead)}</div>` + cfg.side.map(chanRow).join("");
    } else if (cfg.sideType === "kicknav") {
      sn.innerHTML = cfg.guide.map((r) => `<div class="side-guide-row"><span class="gi">${r.i}</span>${esc(r.n)}</div>`).join("")
        + `<div class="side-sep"></div><div class="side-head">${esc(cfg.sideHead)}</div>` + cfg.side.map(chanRow).join("")
        + (cfg.rec ? `<div class="side-head">Recommended</div>` + cfg.rec.map(chanRow).join("") : "");
    } else sn.innerHTML = "";
    byId("meta").innerHTML = buildMeta(key, cfg.meta);
    byId("chatHead").textContent = cfg.chatHead;
    byId("chatInput").placeholder = cfg.chatPh;
    byId("chatSend").textContent = cfg.chatSend;
    updateViewers(true);
  }

  /* ================= VIEWER COUNT ================= */
  let viewers = 0, viewerTimer = 0;
  function updateViewers(reset) {
    if (reset) viewers = cfg.base + Math.floor(Math.random() * cfg.base * 0.1);
    const label = cfg.ytMode ? " watching" : " viewers";
    byId("pView").textContent = fmtK(viewers) + label;
    const yv = byId("ytViewers"); if (yv) yv.textContent = viewers.toLocaleString("en-US");   // YT + Kick show the full count
    const kv = byId("kickViewers"); if (kv) kv.textContent = viewers.toLocaleString("en-US");
  }
  function startViewers() {
    stopViewers();
    viewerTimer = setInterval(() => { viewers += Math.floor((Math.random() - 0.42) * cfg.base * 0.02); viewers = Math.max(cfg.base * 0.6, viewers); updateViewers(false); }, 2600);
  }
  function stopViewers() { if (viewerTimer) { clearInterval(viewerTimer); viewerTimer = 0; } }

  /* ================= TOPIC-REACTIVE CHAT ================= */
  const chatBody = byId("chatBody");
  const CHAT_USERS = ["nate_dogg", "prof_gambles", "SwingStateSteve", "quietriot", "the_ackman", "vibes_only", "poll_watcher",
    "degenerate_dan", "MacroMandy", "night_owl", "coastal_elite", "flyover_fred", "hedge_hodl", "civicnerd", "bagholder99",
    "reply_guy", "first_take", "spicy_takes", "tinfoil_tim", "market_maven", "clip_that", "no_cap_news", "based_beth", "chart_wizard",
    "undecided_ken", "factcheck_chad", "the_intern", "breaking_now", "wonk_life", "sourced_pete", "lurker_lena"];
  const NAME_COLORS = ["#ff7f50", "#7bd88f", "#67b7ff", "#ffd166", "#c792ea", "#f78fb2", "#4fd6be", "#f5a97f", "#8ec07c", "#ff9e64"];
  const REACT = {
    generic: ["fact check incoming 👀", "source?? oh he HAS a source", "footnoted 💀",
      "did he just get fact checked live", "W transparency", "wait it checks him in real time??",
      "receipts", "this is actually clean", "chat is this real", "he said WHAT", "the little ¹ goes hard",
      "o7", "W stream", "citation needed... and provided", "actually sourced, respect", "first"],
  };
  function withEmotes(text) {
    if (Math.random() < 0.32 && cfg.emotes.length) return text + ` <span class="emote">${esc(pick(cfg.emotes))}</span>`;
    return text;
  }
  function pushMsg(text, hot) {
    const u = pick(CHAT_USERS);
    const yt = cfg.ytMode;
    const color = yt ? "var(--s-dim)" : pick(NAME_COLORS);
    // YouTube shows a per-user circular avatar next to each message (deterministic color)
    const avColor = AVC[[...u].reduce((a, c) => a + c.charCodeAt(0), 0) % AVC.length];
    const av = yt ? `<span class="cmsg-av" style="background:${avColor}"></span>` : "";
    const msg = document.createElement("div");
    if (yt && hot && Math.random() < 0.2) {                    // occasional YouTube super chat
      const amt = pick(["2.00", "5.00", "10.00", "20.00", "50.00"]);
      msg.className = "cmsg superchat";
      msg.innerHTML = `${av}<span class="cmsg-txt"><span class="cu" data-amt="${amt}">${esc(u)}</span> ${esc(text)}</span>`;
    } else {
      msg.className = "cmsg" + (hot ? " hot" : "");
      const body = `<span class="cu" style="color:${color}">${esc(u)}</span> ${withEmotes(esc(text))}`;
      msg.innerHTML = yt ? `${av}<span class="cmsg-txt">${body}</span>` : body;
    }
    chatBody.appendChild(msg);
    while (chatBody.children.length > 45) chatBody.removeChild(chatBody.firstChild);
  }
  let chatTimer = 0;
  function chatTick() { pushMsg(pick(REACT.generic)); chatTimer = setTimeout(chatTick, 1400 + Math.random() * 2200); }
  function chatReactToAir() { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) setTimeout(() => { if (chatTimer) pushMsg(pick(REACT.generic), true); }, 120 + i * 240); }
  function startChat() { stopChat(); chatBody.innerHTML = ""; for (let i = 0; i < 6; i++) pushMsg(pick(REACT.generic)); chatTick(); }
  function stopChat() { if (chatTimer) { clearTimeout(chatTimer); chatTimer = 0; } }

  /* ================= WEBCAM + AUDIO WINDOWS ================= */
  const cam = byId("cam"), streamBtn = byId("streamBtn"), ctrlStatus = byId("ctrlStatus");
  /* ================= GENERATION-GUARD AUDIT (P3-F, red-team H2 full closure) =================
     `gen` bumps on Start Stream AND End Stream. Every async surface that can outlive End Stream
     was audited; autonomous pipeline work captures its gen and is DROPPED (and session-logged
     as stale_generation) when the world moves on. R11: a partially-closed guard gets trusted,
     which is worse than no guard — hence this full inventory.
     BOUNDARY: manual operator actions (AIR/HOLD/SKIP clicks, keyboard A/S/P, pull, corrections,
     retry) are NEVER gen-guarded — the human is always allowed. Only autonomous work is.
       · checkUtterance (voice finals, typed input via submitTyped, chunked fallback) — GUARDED:
         captures g at entry; re-checked after the extract fetch AND after the verify fetch.
         Stale results never enqueue/render; they are logged with disposition stale_generation
         (verify-stage staleness also quietly removes the already-queued "checking" card).
       · maybeAutoAir 4s veto timer — GUARDED: fires only if `streaming && c._gen === gen`.
         The round-2 `streaming`-only check missed End→Start inside the veto window.
       · Deepgram WS callbacks (onopen/onmessage/onclose) + reconnect timer (dgRetryT) —
         already g-guarded at every entry point (pre-existing; endStream also clears the timer).
       · chunked path recordOne/startOverlap/sendWindow — already g-guarded before touching UI
         or calling checkUtterance (pre-existing); checkUtterance's own guard covers the tail.
       · dgAuth fetch inside startStreaming — g-checked on return (pre-existing).
       · retry button — EXEMPT by design: retry is an OPERATOR action; a retry of an old-gen
         card in the current stream is current-gen work. It re-enters checkUtterance fresh and
         captures the CURRENT gen. Correct, not a leak.
       · correction composer / fcPublish — EXEMPT: operator actions; corrections may
         deliberately air post-stream (the record must stay correctable after the show).
       · chat / viewer-count / meter timers — EXEMPT: cosmetic only, no session or overlay
         writes; all torn down by endStream anyway.
     ============================================================================================ */
  let streaming = false, gen = 0, stream = null, audioStream = null, ac = null, analyser = null, meterRAF = 0;
  let recMime = "", recBaseType = "audio/webm", micOn = false, strideTimer = 0;
  const WINDOW_MS = 2200, STRIDE_MS = 1100;
  const pickMime = () => ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
    .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";

  function buildMeter() { ssMeter.innerHTML = Array.from({ length: 14 }, () => "<i></i>").join(""); }
  function meterLoop() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const bars = ssMeter.children, n = bars.length;
    for (let i = 0; i < n; i++) bars[i].style.height = Math.max(6, (data[Math.floor(i / n * data.length)] / 255) * 100) + "%";
    meterRAF = requestAnimationFrame(meterLoop);
  }
  function setStatus(txt, mode) { ctrlStatus.textContent = txt; ctrlStatus.className = "ctrl-status" + (mode ? " " + mode : ""); }

  function recordOne(g) {
    if (g !== gen || !micOn || !audioStream) return;
    let chunks = [], rec;
    try { rec = new MediaRecorder(audioStream, recMime ? { mimeType: recMime } : undefined); } catch { return; }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => { if (g !== gen) return; const tStop = performance.now(); const blob = new Blob(chunks, { type: recMime || "audio/webm" }); if (blob.size > 1400) sendWindow(blob, g, tStop); };
    rec.start();
    setTimeout(() => { try { if (rec.state !== "inactive") rec.stop(); } catch {} }, WINDOW_MS);
  }
  function startOverlap(g) {
    if (g !== gen || !micOn || !audioStream) return;
    recordOne(g);
    strideTimer = setInterval(() => { if (g !== gen || !micOn) { clearInterval(strideTimer); strideTimer = 0; return; } recordOne(g); }, STRIDE_MS);
  }
  async function sendWindow(blob, g, tStop) {
    const tSend = performance.now();
    const rec = { t: new Date().toISOString(), platform, source: "mic", bytes: blob.size, ok: false };
    try {
      const r = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/octet-stream", "x-audio-type": recBaseType }, body: blob });
      rec.roundtrip_ms = +(performance.now() - tSend).toFixed(1);
      rec.status = r.status;
      if (g !== gen) return;
      if (!r.ok) {
        rec.error = "http " + r.status; DBG.err(); DBG.push(rec);
        setStatus([404, 501, 405].includes(r.status)
          ? "live transcription needs the hosted URL — or type a claim to check"
          : `transcription error (${r.status}) — type a claim to check`, "err");
        return;
      }
      const j = await r.json(); if (g !== gen) return;
      rec.dg_ms = j.dg_ms; rec.audio_s = j.audio_s; rec.confidence = j.confidence;
      if (typeof j.dg_ms === "number" && typeof rec.roundtrip_ms === "number") rec.network_ms = +(rec.roundtrip_ms - j.dg_ms).toFixed(1);
      const txt = (j.transcript || "").trim();
      rec.transcript = txt;
      if (txt.length > 2 && (j.confidence == null || j.confidence >= 0.3)) { ssTranscript.textContent = txt; checkUtterance(txt); }   // chunked fallback → fact-check
      rec.ok = true; DBG.push(rec);
      if (micOn) setStatus("● LIVE · listening — talk like an anchor", "live");
    } catch (e) { if (g === gen) { rec.error = String(e && e.message || e); DBG.err(); DBG.push(rec); setStatus("network error — you can still type to drive it", "err"); } }
  }

  /* ---- Deepgram streaming (browser-direct WebSocket) — PRIMARY path ----
     Continuous audio → interim+final results in ~300ms, no 2.2s window tax, no
     word-boundary mangling. Auth: short-lived server-minted token ONLY (/api/dg-token;
     the vendor key never ships in client source). Falls back to the chunked
     /api/transcribe path if the socket never delivers. */
  const DG_KEYTERMS = ["Bureau of Labor Statistics", "Federal Reserve", "Powell", "Trump", "Netanyahu",
    "Senate", "Congress", "Ukraine", "Putin", "Zelensky", "Taiwan", "Iran", "Gaza", "NATO", "WHO", "CDC",
    "Bitcoin", "Elon Musk", "GDP", "tariffs", "inflation", "recession", "unemployment", "emissions", "billion"];
  let dgWs = null, dgProc = null, dgCtx = null, dgSource = null, dgFinalWords = [], dgGotResult = false;
  let prevFinalText = "", prevFinalAt = 0;   // (legacy F3 pair buffer — still reset at boundaries; assembler below is the live path)
  /* W1.3 rolling-window state (supersedes the W1.2 final-assembler wiring): every final's
     words land in a rolling transcript window; the window is extracted on a cadence
     (windowShouldExtract) regardless of how Deepgram shredded the finals. winTimer runs
     per stream (killed at End Stream). Overlapping windows re-extracting the same claim
     are absorbed by F2 dedupe; hallucination is fenced by the P4-F1 grounding gate. */
  let winWords = [], winLastAt = 0, winNewWords = 0, winLastExtract = 0, winEndsTerminal = false, winTimer = 0, winLastSent = "";
  /* W1.3 window hardening — per-STREAM window lifecycle accounting for the morning field
     read: windows fired by trigger reason, words that entered the window vs words handed
     to extraction, and how often the winLastSent identical-window suppressor consumed a
     fire. Emitted as ONE `window_summary` harness event at End Stream. Counters survive
     Deepgram reconnects on purpose (the window STATE resets per connect; the summary is
     per stream) and reset at Start Stream too, in case a reload skipped endStream.
     Observability only — no window behavior changes. */
  let winStats;
  const winStatsReset = () => { winStats = { windows: 0, by_reason: { terminal: 0, cadence: 0, silence: 0 }, suppressed: 0, words_in: 0, words_sent: 0 }; };
  winStatsReset();
  function windowExtract(reason) {
    const text = winWords.slice(-WINDOW_WORDS).join(" ").trim();
    winNewWords = 0; winLastExtract = Date.now(); winEndsTerminal = false;
    if (!text || text === winLastSent) { if (text) winStats.suppressed++; return; }
    winLastSent = text;
    const wordCount = text.split(/\s+/).length;
    winStats.windows++; winStats.by_reason[reason] = (winStats.by_reason[reason] || 0) + 1; winStats.words_sent += wordCount;
    FT.log("window_extract", { reason, words: wordCount, text: text.slice(0, 200) });
    checkUtterance(text, { merged: true });   // merged: word-min bypass only — F2 + grounding still gate
  }
  let dgEverWorked = false, dgRetryN = 0, dgRetryT = 0;   // mid-session drop → auto-reconnect (unattended/auto-air safe)
  /* L2 (sprint-02): STT finalization wait measured ≤~0.55s p50 — endpointing is the lever,
     but faster finals ⇄ more split-finals is a live-audio tradeoff that can't be benched
     without a speaker (ledger rule: no unmeasured defaults). ?ep=<ms> exposes Deepgram's
     endpointing knob for the next live session: lower = faster finals + more splits (the
     P5-B merge absorbs those), higher = intact finals + more wait. Default: absent (vendor
     default). Measure final-latency vs split-rate on the dashboard, pick the knee, THEN default. */
  const DG_EP = (() => { const v = parseInt(new URLSearchParams(location.search).get("ep"), 10); return Number.isFinite(v) && v >= 10 && v <= 2000 ? v : null; })();
  /* R40 (street FS-3 — "Erewhon" transcribed 7 ways incl. "Taiwan"): per-session keyterms.
     The operator types tonight's proper nouns on /control pre-session; they ride every
     Deepgram (re)connect alongside the builtin news list, persist per room, and are
     logged into the session record. */
  let customKeyterms = [];
  const activeKeyterms = () => DG_KEYTERMS.concat(customKeyterms).slice(0, 100);
  const dgUrl = (sr) => `wss://api.deepgram.com/v1/listen?model=nova-3&language=en&encoding=linear16&sample_rate=${sr}`
    + `&channels=1&punctuate=true&smart_format=true&interim_results=true&`
    + (DG_EP ? `endpointing=${DG_EP}&` : "") + activeKeyterms().map((t) => "keyterm=" + encodeURIComponent(t)).join("&");
  function floatTo16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    return out;
  }
  // Socket auth: a short-lived server-minted token per (re)connect — /api/dg-token needs
  // DEEPGRAM_API_KEY (grant-capable) server-side; see .env.example. No client fallback:
  // a vendor key in client source is a leak, not a feature (learned the hard way).
  async function dgAuth() {
    try {
      const r = await fetch("/api/dg-token", { method: "POST" });
      if (r.ok) { const j = await r.json(); if (j && j.access_token) return ["bearer", j.access_token]; }
    } catch {}
    return null;
  }
  async function startStreaming(g) {
    if (!dgCtx || !dgSource) return false;
    const auth = await dgAuth();
    if (g !== gen) return false;                                       // stream ended while fetching auth
    if (!auth) { DBG.event("err", "no Deepgram auth available"); return false; }
    DBG.event("info", auth[0] === "bearer" ? "Deepgram auth · server token" : "Deepgram auth · inlined key (legacy)");
    dgFinalWords = []; dgGotResult = false; prevFinalText = ""; prevFinalAt = 0;
    winWords = []; winNewWords = 0; winLastAt = 0; winLastExtract = Date.now(); winLastSent = "";   // never window across a (re)connect boundary
    clearInterval(winTimer);
    winTimer = setInterval(() => {
      if (g !== gen || !winNewWords) return;
      const now = Date.now();
      if (windowShouldExtract(winNewWords, now - winLastExtract, now - winLastAt, false)) windowExtract(now - winLastAt >= WINDOW_TRAIL_SILENCE_MS ? "silence" : "cadence");
    }, 400);
    let ws; try { ws = new WebSocket(dgUrl(dgCtx.sampleRate), auth); } catch (e) { DBG.event("err", "Deepgram WS construct failed", { error: String(e && e.message || e) }); return false; }
    ws.binaryType = "arraybuffer"; dgWs = ws;
    ws.onerror = () => { if (g === gen) DBG.event("err", "Deepgram WS error", { readyState: ws.readyState, gotResult: dgGotResult }); };
    ws.onopen = () => {
      if (g !== gen) { try { ws.close(); } catch {} return; }
      DBG.event("info", "Deepgram WS open · streaming audio", { sampleRate: dgCtx.sampleRate });
      FT.log("dg_open", { sampleRate: dgCtx.sampleRate, auth: auth[0] });
      if (dgProc) { try { dgProc.disconnect(); } catch {} }   // reconnect: drop the old socket's processor
      dgProc = dgCtx.createScriptProcessor(4096, 1, 1);
      dgProc.onaudioprocess = (ev) => { if (g === gen && ws.readyState === 1) ws.send(floatTo16(ev.inputBuffer.getChannelData(0)).buffer); };
      const mute = dgCtx.createGain(); mute.gain.value = 0;              // keep the processor pulling audio, no feedback
      dgSource.connect(dgProc); dgProc.connect(mute); mute.connect(dgCtx.destination);
      setStatus("● LIVE · streaming — talk like an anchor", "live");
      ssTranscript.innerHTML = `<span class="dim">listening — start talking about the news…</span>`;
    };
    ws.onmessage = (e) => {
      if (g !== gen) return;
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.type !== "Results") return;
      const alt = d.channel && d.channel.alternatives && d.channel.alternatives[0];
      const tr = (alt && alt.transcript || "").trim();
      if (!tr) return;
      dgGotResult = true; dgEverWorked = true; dgRetryN = 0;
      if (d.is_final) FT.log("stt_final", { transcript: tr, words: tr.split(/\s+/).length });
      else if (Date.now() - ftLastInterim > 400) { ftLastInterim = Date.now(); FT.log("stt_interim", { transcript: tr.slice(-120) }); }
      // live transcript on every result; fact-check each COMPLETED (final) sentence
      let tail;
      if (d.is_final) { dgFinalWords.push(...tr.split(/\s+/)); if (dgFinalWords.length > 50) dgFinalWords = dgFinalWords.slice(-50); tail = dgFinalWords.slice(-18).join(" "); }
      else { tail = (dgFinalWords.slice(-10).join(" ") + " " + tr).trim().split(/\s+/).slice(-18).join(" "); }
      ssTranscript.textContent = tail;
      if (d.is_final) {
        checkUtterance(tr);
        /* W1.2 — rolling final-assembler (supersedes the F3 pair-join; session 2: bonded
           audio shredded claims across 2-5 pre-punctuated finals that pairs can't rebuild).
           Every final ALSO lands in a buffer; the buffer flushes as ONE joined utterance
           when the thought actually ends — real silence (asmTimer below), the buffer cap,
           or a gap wider than MERGE_MAX_GAP_MS (an old thought a coarse timer tick missed).
           Joined checks enter as merged (word-min bypass only) — the F2 claim dedupe
           absorbs the overlap with the per-final checks, so fragments + join extracting
           the same claim still yield exactly one card. */
        const nowAt = Date.now();
        const ws_ = tr.split(/\s+/).filter(Boolean);
        winWords.push(...ws_); if (winWords.length > 60) winWords = winWords.slice(-60);
        winNewWords += ws_.length; winLastAt = nowAt; winEndsTerminal = /[.!?]$/.test(tr);
        winStats.words_in += ws_.length;   // W1.3 summary: every word that entered the window
        if (winEndsTerminal && windowShouldExtract(winNewWords, nowAt - winLastExtract, 0, true)) windowExtract("terminal");
      }
    };
    ws.onclose = (ev) => {
      if (g !== gen) return;                                            // clean stop
      FT.log("dg_close", { code: ev && ev.code, gotResult: dgGotResult });
      if (dgGotResult || dgEverWorked) {
        // it was working, then dropped mid-session (network blip, Deepgram restart) → reconnect
        // with capped backoff so a long unattended/auto-air session self-heals instead of going deaf
        const delay = Math.min(5000, 500 * Math.pow(2, dgRetryN++));
        DBG.event("warn", `Deepgram WS dropped — reconnecting in ${delay}ms`, { code: ev && ev.code, attempt: dgRetryN });
        clearTimeout(dgRetryT);
        dgRetryT = setTimeout(() => { if (g === gen && streaming) startStreaming(g); }, delay);
        return;
      }
      // closed before ANY transcript arrived → this is a real failure (usually a rejected token / 4xx)
      DBG.event("err", "Deepgram closed with no transcript — check key/quota", { code: ev && ev.code, reason: (ev && ev.reason) || "" });
      if (window.MediaRecorder && recMime) { DBG.event("warn", "falling back to chunked /api/transcribe"); setStatus("● LIVE · listening — talk like an anchor", "live"); startOverlap(g); }  // fall back
    };
    return true;
  }

  async function startStream() {
    streaming = true; const myGen = ++gen; clearFactChecks();
    autoAirCount = 0; autoAirCapNoted = false;   // D18: cap is per-session
    winStatsReset();   // W1.3: window_summary is per-stream (belt-and-suspenders — a reload can skip endStream)
    if (applyKeyterms) applyKeyterms();   // R40: keyterms snapshot for this stream
    if (opBridge) opBridge.streamStarted();   // P3-J: start the operator command poll + baseline the queue snapshot
    dgEverWorked = false; dgRetryN = 0; clearTimeout(dgRetryT);
    streamBtn.textContent = "■ End Stream"; streamBtn.classList.add("live");
    player.classList.add("live");
    buildMeter(); startChat(); startViewers();
    // control view captures audio only (OBS owns the camera); can target a specific input
    // device — a mic, or a virtual audio cable (BlackHole / VB-Cable) carrying the show audio.
    const wantVideo = !CONTROL_VIEW();
    const audioC = { echoCancellation: true, noiseSuppression: true, channelCount: 1 };
    if (audioDeviceId) audioC.deviceId = { exact: audioDeviceId };
    ssTranscript.innerHTML = `<span class="dim">${wantVideo ? "connecting camera…" : "opening audio input…"}</span>`;
    setStatus(wantVideo ? "starting camera + mic…" : "opening audio input…", "live");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: wantVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false, audio: audioC });
    } catch {
      setStatus(wantVideo ? "camera/mic blocked — allow access, or type to drive the overlay" : "audio input blocked — allow access, or type to drive the overlay", "err");
      ssTranscript.innerHTML = `<span class="dim">no input — type a claim to drive the overlay</span>`;
      return;
    }
    if (refreshAudioDevices) refreshAudioDevices();   // labels are available now that permission was granted
    if (myGen !== gen) { stream.getTracks().forEach((t) => t.stop()); return; }
    cam.srcObject = stream; cam.classList.add("on"); player.classList.add("on"); cam.play().catch(() => {});
    const atrk = stream.getAudioTracks();
    if (!atrk.length) { setStatus("no mic detected — type to drive the overlay", "err"); return; }
    audioStream = new MediaStream(atrk);
    recMime = pickMime(); recBaseType = (recMime.split(";")[0]) || "audio/webm";   // for the chunked fallback
    micOn = true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const s = ac.createMediaStreamSource(audioStream);
      mixBus = ac.createGain(); s.connect(mixBus);                     // mic + (optionally) the remote-call tab
      analyser = ac.createAnalyser(); analyser.fftSize = 64; mixBus.connect(analyser); meterLoop();
      dgCtx = ac; dgSource = mixBus;                                   // one bus feeds meter + Deepgram
      if (callTabStream) wireCallTab();                                // captured earlier / across a restart
      if (muted) setMuted(true);                                       // mute survives a restart — re-apply to the fresh bus
    } catch {}
    setStatus("● LIVE · listening — talk like an anchor", "live");
    ssTranscript.innerHTML = `<span class="dim">listening — start talking about the news…</span>`;
    // Deepgram streaming first; chunked POST windows only if streaming can't start
    if (!(await startStreaming(myGen))) {
      if (window.MediaRecorder && recMime) startOverlap(myGen);
      else setStatus("audio capture unsupported here — type to drive the overlay", "err");
    }
  }
  /* ---- P4-F3 push-to-mute (field-test F7): a personal moment got transcribed while the
     stream stayed live. One tap (or "m") zeroes the mix bus feeding BOTH the meter and
     Deepgram — silence in, no finals, no checks — without tearing down the stream.
     Mute state survives Start/End Stream on purpose: a surprise-hot mic is worse than
     surprise silence. ---- */
  let muted = false, muteBtnEl = null;
  /* D18 pilot constraint: hard cap on auto-airs per session. Counted at FIRE time (not
     arm time — vetoed cards don't consume the cap), reset on Start Stream. At the cap,
     maybeAutoAir stops arming and the operator is told once. */
  const AUTO_AIR_CAP = 10;
  let autoAirCount = 0, autoAirCapNoted = false;
  let applyKeyterms = null;   // R40: set by the control bridge; called at Start Stream
  function setMuted(on) {
    muted = !!on;
    if (mixBus) { try { mixBus.gain.value = muted ? 0 : 1; } catch {} }
    if (muteBtnEl) {
      muteBtnEl.textContent = muted ? "🔇 MUTED — tap to unmute" : "🎙 Mute";
      muteBtnEl.classList.toggle("muted", muted);
    }
    if (muted) setStatus("🔇 MUTED — mic silenced, no checks until unmuted", "paused");
    else if (streaming) setStatus("● LIVE · listening — talk like an anchor", "live");
    FT.log("mute", { on: muted });
    DBG.event("info", muted ? "mic MUTED (push-to-mute)" : "mic unmuted");
    if (opBridge && opBridge.pushNow) opBridge.pushNow();   // R43: /op latch reconciles on the next poll
  }
  /* ===== R54: live attention capture (post-hoc recall is RETIRED as a method) =====
     After each auto-air fires the card carries a visible UNTAGGED state until the operator
     tags what they were doing during its veto window: one keystroke (W/T/A) here or one tap
     on /op. Missing tags export as "uncaptured" — never assumed. Objective supplements ride
     alongside: input-activity sampling per veto window (lastInputT vs arm time) and
     focus/blur events from both consoles. */
  let lastInputT = 0;
  ["pointerdown", "pointermove", "keydown", "wheel"].forEach((ev) =>
    document.addEventListener(ev, () => { lastInputT = Date.now(); }, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", () => FT.log("focus", { state: document.visibilityState }));
  window.addEventListener("blur", () => FT.log("focus", { state: "blur" }));
  window.addEventListener("focus", () => FT.log("focus", { state: "focus" }));
  const ATTN_STATES = { w: "watching", t: "talking", a: "away" };
  function applyAttention(c, state, source) {
    if (!c || !c._autoAired || c.attention) return;   // auto-aired cards only; first tag wins
    if (state !== "watching" && state !== "talking" && state !== "away") return;
    c.attention = state;
    const e = SESSION.byId.get(c.id); if (e) e.attention = state;
    FT.log("attention", { id: c.id, cid: c._cid || null, state, source, ms_after_air: c._airedAtMs ? Date.now() - c._airedAtMs : null });
    DBG.event("info", `attention tagged: ${state} (${source})`, { id: c.id });
    renderQueue(); updateSessionBtn();
    if (opBridge && opBridge.scheduleQueuePush) opBridge.scheduleQueuePush();   // clears the card from /op's attention strip
  }
  // oldest-untagged-first: tags apply in air order, matching how the operator recalls them
  function nextUntaggedAuto() { const u = fcCards.filter((c) => c._autoAired && !c.attention); return u[u.length - 1] || null; }
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === "m") { if (streaming) setMuted(!muted); return; }
    /* Hotkey precedence: "a" already means AIR-top-pending (street hotkey below). While any
       card is pending, "a" keeps that meaning and never tags — tag "away" with the card's
       button instead (or wait). W and T have no conflict. */
    if (k === "a" && fcCards.some((c) => c.state === "pending")) return;
    if (ATTN_STATES[k] && !tabReadOnly) applyAttention(nextUntaggedAuto(), ATTN_STATES[k], "control");
  });

  function endStream() {
    /* R56: End Stream prompts for undone debrief items — attention tags can only be applied
       while the cards still exist (clearFactChecks empties the queue below), so this is the
       last exit. Proceeding is allowed; the untagged cards export as "uncaptured" (R54). */
    if (!tabReadOnly) {
      const untagged = fcCards.filter((c) => c._autoAired && !c.attention);
      if (untagged.length && !confirm(`${untagged.length} auto-aired card(s) have no attention tag (W/T/A).\n\nEnd Stream anyway? They will export as "uncaptured".`)) return;
    }
    streaming = false; micOn = false; gen++;
    if (opBridge) opBridge.streamEnded();   // P3-J: stop the command poll; clear the operator queue snapshot
    clearTimeout(dgRetryT);
    if (strideTimer) { clearInterval(strideTimer); strideTimer = 0; }
    if (dgWs) { try { dgWs.send(JSON.stringify({ type: "CloseStream" })); } catch {} try { dgWs.close(); } catch {} dgWs = null; }
    if (dgProc) { try { dgProc.disconnect(); } catch {} dgProc = null; }
    dgSource = null; dgCtx = null; dgFinalWords = []; prevFinalText = ""; prevFinalAt = 0;
    clearInterval(winTimer); winTimer = 0; winWords = []; winNewWords = 0;   // window dies with the stream — never extract into a dead broadcast
    // W1.3 summary: one per-stream lifecycle event — windows by trigger reason, words in vs
    // sent, suppressor hits. Emitted before reset so the morning read gets the whole stream.
    if (winStats.windows || winStats.words_in || winStats.suppressed) FT.log("window_summary", winStats);
    winStatsReset();
    callTabSource = null; mixBus = null;   // nodes die with the context; the tab STREAM survives for the next start
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    audioStream = null;
    if (ac) { ac.close().catch(() => {}); ac = null; analyser = null; }
    cancelAnimationFrame(meterRAF);
    stopChat(); stopViewers();
    cam.classList.remove("on"); cam.srcObject = null;
    player.classList.remove("on", "live");
    streamBtn.textContent = "● Start Stream"; streamBtn.classList.remove("live");
    ssLock.textContent = "—"; clearFactChecks();
    if (SESSION.byId.size) {
      DBG.event("info", "session summary", SESSION.summary());   // after expiry, so dispositions are final
      // R20 (P4-E): End Stream IS the export moment — auto-download so the record can't be
      // forgotten on the street. (clearFactChecks ran first, so dispositions are final.)
      if (!tabReadOnly) { SESSION.download(); DBG.event("info", "session record auto-downloaded (R20)"); }
    }
    setStatus("stream ended", "");
  }
  const toggleStream = () => { if (streaming) endStream(); else startStream(); };

  /* typed fallback — drives the overlay even with no camera/mic */
  function submitTyped() {
    const el = byId("typedInput"), v = el.value.trim(); if (!v) return;
    if (!player.classList.contains("live")) {                 // reveal the overlay in typed-only mode
      player.classList.add("live"); buildMeter(); if (!chatTimer) startChat(); if (!viewerTimer) startViewers();
      setStatus("typed input · overlay live (no camera)", "live");
    }
    ssTranscript.textContent = v;
    checkUtterance(v, { force: true });   // typed claim → fact-check immediately
    el.value = "";
  }

  /* ================= DEBUG PANEL ================= */
  function toggleDbg() {
    const el = byId("dbg"); el.hidden = !el.hidden; DBG.on = !el.hidden;
    byId("dbgToggle").classList.toggle("on", !el.hidden);
    if (!el.hidden) renderDbg();
  }
  function renderDbg() {
    const el = byId("dbg"); if (el.hidden) return;
    const s = DBG.stats(), last = DBG.records[DBG.records.length - 1] || {};
    const cls = (v, g, w) => v == null ? "" : (v <= g ? "good" : v <= w ? "warn" : "bad");
    const line = (k, v, c) => `<div class="k">${k}</div><div class="v ${c || ""}">${v == null ? "—" : v}</div>`;
    const ms = (v) => v == null ? null : v + " ms";
    const st = (o) => o ? `${o.p50} / ${o.p95} ms` : "—";
    const rx = DBG.series("verify_ms").slice(-42), mx = Math.max(1, ...rx);
    const spark = rx.map((v) => `<i style="height:${Math.round(v / mx * 100)}%"></i>`).join("");
    el.innerHTML = `<h4>⚙ FACT-CHECK PIPELINE · LATENCY <span class="x" id="dbgX">✕</span></h4>
      <div class="grid">${line("utterances", DBG.windows)}${line("errors", DBG.errors, DBG.errors ? "bad" : "good")}${line("platform", platform)}</div>
      <div class="sec">LAST CHECK</div>
      <div class="last"><b>“${esc(last.claim || last.spoken || "—")}”</b><br>${last.claim ? (esc(last.verdict || "—") + (last.confidence != null ? " · conf " + Math.round(last.confidence * 100) + "%" : "") + (last.sourceUrl ? " · sourced" : "")) : "no checkable claim"}</div>
      <div class="grid">
        ${line("extract", ms(last.extract_ms), cls(last.extract_ms, 700, 1500))}
        ${line("verify", ms(last.verify_ms), cls(last.verify_ms, 2500, 5000))}
        ${line("deepgram", ms(last.dg_ms), cls(last.dg_ms, 500, 1000))}
      </div>
      <div class="sec">ROLLING p50 / p95</div>
      <div class="grid">${line("extract", st(s.extract))}${line("verify", st(s.verify))}${line("deepgram", st(s.dg))}</div>
      <div class="spark">${spark}</div>
      <div class="sec">EVENTS ${DBG.errors ? `· <span class="v bad">${DBG.errors} err</span>` : ""}</div>
      <div class="evlog">${DBG.events.length ? DBG.events.slice(-14).reverse().map((e) => `<div class="ev ev-${e.level}"><span class="evt">${e.at}s</span> ${esc(e.msg)}${e.detail && (e.detail.status || e.detail.code) ? ` <span class="evd">(${esc(String(e.detail.status || e.detail.code))})</span>` : ""}</div>`).join("") : `<div class="ev ev-info">no events yet — go live or type a claim</div>`}</div>
      <div class="row"><button id="dbgCopy">Copy JSON</button><button id="dbgDl">Download</button><button id="dbgClr">Clear</button></div>`;
    byId("dbgX").onclick = toggleDbg;
    byId("dbgCopy").onclick = () => { try { navigator.clipboard.writeText(DBG.json()); const b = byId("dbgCopy"); b.textContent = "copied ✓"; setTimeout(() => b.textContent = "Copy JSON", 1200); } catch {} };
    byId("dbgDl").onclick = () => { const b = new Blob([DBG.json()], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "footnote-pipeline-log.json"; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
    byId("dbgClr").onclick = () => { DBG.records = []; DBG.events = []; DBG.windows = 0; DBG.errors = 0; renderDbg(); };
  }

  // Build an OBS scene collection (OBS 28+) with the overlay pre-added as TWO scenes:
  // "Footnote 16:9" (1920×1080 Browser Source) and "Footnote 9:16" (1080×1920 — vertical
  // TikTok/Reels/Shorts canvas; the overlay auto-detects portrait from the source size, P5-F).
  // The OBS base canvas itself is a per-profile setting (Settings → Video), NOT part of a
  // scene collection — pick the scene that matches your canvas. Convenience for a fresh OBS;
  // the manual "add Browser Source with the URL" path is the guaranteed one. Importing a
  // collection creates a NEW collection (doesn't merge).
  function obsSceneCollection(url) {
    const uid = () => (crypto.randomUUID ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16); }));
    const base = { balance: 0.5, enabled: true, flags: 0, hotkeys: {}, mixers: 0, monitoring_type: 0, muted: false, prev_ver: 503644160, private_settings: {}, "push-to-mute": false, "push-to-mute-delay": 0, "push-to-talk": false, "push-to-talk-delay": 0, sync: 0, volume: 1.0 };
    const mkBrowser = (name, u, w, h) => Object.assign({}, base, { id: "browser_source", versioned_id: "browser_source", name, uuid: u,
      deinterlace_field_order: 0, deinterlace_mode: 0,
      settings: { height: h, width: w, url, reroute_audio: false } });
    const mkScene = (name, u, srcName, srcUuid) => Object.assign({}, base, { id: "scene", versioned_id: "scene", name, uuid: u,
      settings: { custom_size: false, id_counter: 1, items: [{
        align: 5, blend_method: "default", blend_type: "normal", bounds: { x: 0, y: 0 }, bounds_align: 0, bounds_type: 0,
        crop_bottom: 0, crop_left: 0, crop_right: 0, crop_top: 0, group_item_backup: false, id: 1, locked: false,
        name: srcName, pos: { x: 0, y: 0 }, private_settings: {}, rot: 0, scale: { x: 1, y: 1 }, scale_filter: "disable",
        source_uuid: srcUuid, visible: true }] } });
    const bL = uid(), sL = uid(), bP = uid(), sP = uid();
    const SRC_L = "Footnote Overlay 1920x1080", SRC_P = "Footnote Overlay 1080x1920";
    const col = {
      current_program_scene: "Footnote 16:9", current_scene: "Footnote 16:9", current_transition: "Fade",
      groups: [], name: "Footnote Overlay", preview_locked: false, scaling_enabled: false,
      scene_order: [{ name: "Footnote 16:9" }, { name: "Footnote 9:16" }],
      sources: [
        mkBrowser(SRC_L, bL, 1920, 1080),
        mkBrowser(SRC_P, bP, 1080, 1920),
        mkScene("Footnote 16:9", sL, SRC_L, bL),
        mkScene("Footnote 9:16", sP, SRC_P, bP),
      ],
      transition_duration: 300, transitions: [],
    };
    return JSON.stringify(col, null, 2);
  }

  /* ---- remote-call audio (control view): capture a browser call tab (Meet / Zoom web) and mix
     it with the mic, so BOTH sides of a conversation get fact-checked. Tab audio flows even with
     the Mac muted — wear headphones (or mute the Mac) so the mic doesn't re-hear the guest. ---- */
  function wireCallTab() {
    if (!ac || !mixBus || !callTabStream || !callTabStream.getAudioTracks().length) return;
    try { if (callTabSource) callTabSource.disconnect(); } catch {}
    try {
      callTabSource = ac.createMediaStreamSource(callTabStream);
      callTabSource.connect(mixBus);
      DBG.event("info", "call tab audio mixed into pipeline");
    } catch (e) { DBG.event("err", "call tab wiring failed", { error: String(e && e.message || e) }); }
  }
  function dropCallTab(btn) {
    if (callTabStream) callTabStream.getTracks().forEach((t) => t.stop());
    callTabStream = null;
    try { if (callTabSource) callTabSource.disconnect(); } catch {}
    callTabSource = null;
    if (btn) { btn.textContent = "+ Call audio"; btn.classList.remove("on"); }
    DBG.event("info", "call tab audio removed");
  }
  async function captureCallTab(btn) {
    if (callTabStream) return dropCallTab(btn);                        // toggle off
    let s;
    try { s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, selfBrowserSurface: "exclude" }); }
    catch { return; }                                                  // picker cancelled / denied
    if (!s.getAudioTracks().length) {
      s.getTracks().forEach((t) => t.stop());
      DBG.event("err", "shared tab has no audio — pick a Chrome TAB and tick “Also share tab audio”");
      return;
    }
    s.getVideoTracks().forEach((t) => t.stop());                       // we only want the sound
    callTabStream = new MediaStream(s.getAudioTracks());
    callTabStream.getAudioTracks()[0].addEventListener("ended", () => dropCallTab(btn));   // "Stop sharing" bar
    if (btn) { btn.textContent = "✓ Call audio"; btn.classList.add("on"); }
    DBG.event("info", "call tab audio captured", { label: s.getAudioTracks()[0].label });
    if (ac && mixBus) wireCallTab();                                   // live already → mix in now
  }

  /* ============ CONTROL BRIDGE (publish aired cards to the OBS /overlay channel) ============ */
  function setupControlBridge() {
    // stable per-console room + write key (persisted, so a reload keeps the same overlay URL)
    const LS = "footnote.obs.room";
    let s = null; try { s = JSON.parse(localStorage.getItem(LS) || "null"); } catch {}
    if (!s || !s.room || !s.writeKey) {
      const rnd = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
      s = { room: rnd(10), writeKey: rnd(24) };
      try { localStorage.setItem(LS, JSON.stringify(s)); } catch {}
    }
    const overlayUrl = location.origin + "/overlay?room=" + s.room;

    /* ---- M6: two-tabs-same-room clobber guard. The room's queue snapshot, session log and
       overlay channel assume ONE writer — a second /control tab on the same room silently
       clobbers all three. One writer tab per room, enforced by a localStorage heartbeat:
       the active tab writes {nonce, t} to footnote.tab.<room> every 2s (and on load). A booting
       tab that finds a fresh (<6s) foreign heartbeat asks the operator: take over, or open
       read-only. A tab that later sees a foreign heartbeat NEWER than its own last write has
       been taken over and drops to read-only automatically (polled in the same interval —
       simple and robust; no storage-event subtleties). Read-only suppresses persistence,
       fcPublish and all session-mutating actions; the operator can still watch. ---- */
    const HB_KEY = "footnote.tab." + s.room, HB_FRESH_MS = 6000, HB_TICK_MS = 2000;
    const hbNonce = crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2));
    let hbLastWrite = 0;
    const readHB = () => { try { const h = JSON.parse(localStorage.getItem(HB_KEY) || "null"); return h && h.nonce && typeof h.t === "number" ? h : null; } catch { return null; } };
    const writeHB = () => { hbLastWrite = Date.now(); try { localStorage.setItem(HB_KEY, JSON.stringify({ nonce: hbNonce, t: hbLastWrite })); } catch {} };
    const enterReadOnly = (why) => {
      if (tabReadOnly) return;
      tabReadOnly = true;
      DBG.event("warn", "this tab is read-only — " + why);
      const oh = $(".ops-head");
      if (oh && !oh.querySelector(".ops-readonly")) {
        const b = document.createElement("span");
        b.className = "ops-readonly"; b.textContent = "👁 read-only — another tab is live";
        oh.insertBefore(b, byId("opsStatus"));
      }
    };
    const bootHB = readHB();
    if (bootHB && bootHB.nonce !== hbNonce && (Date.now() - bootHB.t) < HB_FRESH_MS) {
      const take = window.confirm("Another control tab is live for this room.\n\nOK = take over (that tab goes read-only)\nCancel = open read-only");
      if (take) writeHB(); else enterReadOnly("another control tab owns this room");
    } else writeHB();
    setInterval(() => {
      const hb = readHB();
      if (hb && hb.nonce !== hbNonce && hb.t > hbLastWrite) { enterReadOnly("a newer control tab took over"); return; }
      if (!tabReadOnly) writeHB();
    }, HB_TICK_MS);
    window.addEventListener("beforeunload", () => { const hb = readHB(); if (hb && hb.nonce === hbNonce) { try { localStorage.removeItem(HB_KEY); } catch {} } });

    // ---- session restore: a /control reload mid-show keeps the operator queue + session log ----
    sessPersistKey = "footnote.session." + s.room;
    try {
      const snap = JSON.parse(localStorage.getItem(sessPersistKey) || "null");
      const fresh = snap && snap.savedAt && (Date.now() - snap.savedAt) < SESS_MAX_AGE;
      if (fresh && ((snap.entries || []).length || (snap.cards || []).length)) {
        SESSION.startedAt = snap.startedAt || SESSION.startedAt;
        (snap.entries || []).forEach((en) => SESSION.byId.set(en.id, en));
        fcCards = (snap.cards || []).map((c) => {
          if (c.state === "checking") {
            c.state = "error"; c.errMsg = "interrupted by reload";   // its fetch died with the old page → retry button
            /* M5 — checking cards are only SESSION-logged when verify settles, so a card that was
               mid-check at reload has NO entry. Create one now (action "error", restored flag) so
               no card can end the night outside the disposition log. */
            if (!SESSION.byId.has(c.id)) { SESSION.log(c); const en = SESSION.byId.get(c.id); if (en) en.restored = true; }
          }
          return c;
        });
        fcId = Math.max(0, fcId, ...fcCards.map((c) => c.id || 0), ...[...SESSION.byId.keys()]);   // no id collisions with restored entries
        keepQueueOnce = true;
        renderQueue(); setOps(); updateSessionBtn();
        const note = document.createElement("span");
        note.className = "ops-restored";
        note.innerHTML = `↻ restored session · ${SESSION.byId.size} logged <button type="button" title="Dismiss">✕</button>`;
        note.querySelector("button").addEventListener("click", () => note.remove());
        const oh = $(".ops-head"); if (oh) oh.insertBefore(note, byId("opsStatus"));
        DBG.event("info", "restored session", { cards: fcCards.length, entries: SESSION.byId.size, age_min: Math.round((Date.now() - snap.savedAt) / 60000) });
      } else if (snap) { try { localStorage.removeItem(sessPersistKey); } catch {} }   // stale snapshot (>4h) — start clean
    } catch {}

    // banner in the control bar with the copyable Browser Source URL
    const bar = document.createElement("div");
    bar.className = "obs-bar";
    bar.innerHTML = `<span class="obs-label"><span class="obs-sup">¹</span> OBS OVERLAY</span>
      <input class="obs-url" readonly value="${esc(overlayUrl)}" aria-label="Overlay URL">
      <button class="obs-copy" type="button">Copy URL</button>
      <button class="obs-scene" type="button" title="Download an OBS scene collection with this overlay pre-added">Download OBS scene</button>
      <label class="obs-audio"><span>Audio in</span><select aria-label="Audio input"><option value="">Default input</option></select></label>
      <button class="obs-call" type="button" title="Capture a browser call tab (Meet / Zoom web) so the remote voice gets fact-checked too">+ Call audio</button>
      <button class="obs-mute" type="button" title="Silence the mic feed instantly (keyboard: M) — no transcription, no checks, stream stays up">🎙 Mute</button>
      <button class="obs-keys-toggle" type="button" title="Bring your own vendor keys — room-scoped, TTL-wiped, lifts the hosted daily cap">Room keys ▾</button>
      <span class="obs-byok" hidden>using your keys · caps lifted</span>
      <span class="obs-hint">OBS Browser Source or Moblin Browser widget</span>`;
    const ctrl = $(".control"); if (ctrl) ctrl.insertAdjacentElement("afterend", bar);
    fcRoom = s.room;   // verify calls carry the room for per-room caps / BYOK routing

    // ---- BYOK pane (D10): keys go straight to the server, are never echoed back (status is
    // booleans only), and expire with the room TTL. Inputs are cleared after every save. ----
    const keysPane = document.createElement("div");
    keysPane.className = "obs-keys"; keysPane.hidden = true;
    keysPane.innerHTML = `<span class="rk-note">your keys · stored for this room only, auto-wiped after 48h, never displayed again</span>
      <input type="password" class="rk-pplx" placeholder="Perplexity API key" autocomplete="off" spellcheck="false">
      <input type="password" class="rk-anth" placeholder="Anthropic API key (optional)" autocomplete="off" spellcheck="false">
      <input type="password" class="rk-dg" placeholder="Deepgram key (optional)" autocomplete="off" spellcheck="false">
      <button class="rk-save" type="button">Save keys</button>
      <button class="rk-clear" type="button" title="Remove this room's keys now">Clear</button>
      <span class="rk-status"></span>`;
    bar.insertAdjacentElement("afterend", keysPane);
    const rkStatus = keysPane.querySelector(".rk-status"), byokBadge = bar.querySelector(".obs-byok");
    const setByok = (pplx, anth, dg) => {
      byokActive = !!pplx;   // caps only lift when the room brings a Perplexity key (the metered call)
      byokBadge.hidden = !byokActive;
      rkStatus.textContent = pplx || anth || dg ? `✓ ${[pplx && "Perplexity", anth && "Anthropic", dg && "Deepgram"].filter(Boolean).join(" + ")} key on file` : "";
    };
    bar.querySelector(".obs-keys-toggle").addEventListener("click", () => { keysPane.hidden = !keysPane.hidden; });
    const postKeys = async (keys) => {
      try {
        const r = await fetch("/api/onair", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: s.room, writeKey: s.writeKey, op: "keys", keys }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { setByok(j.perplexity, j.anthropic, j.deepgram); return true; }
        rkStatus.textContent = `save failed (${r.status})`;
      } catch { rkStatus.textContent = "save failed (network)"; }
      return false;
    };
    keysPane.querySelector(".rk-save").addEventListener("click", async () => {
      const pi = keysPane.querySelector(".rk-pplx"), ai = keysPane.querySelector(".rk-anth"), di = keysPane.querySelector(".rk-dg");
      const keys = { perplexity: pi.value.trim(), anthropic: ai.value.trim(), deepgram: di.value.trim() };
      if (!keys.perplexity && !keys.anthropic && !keys.deepgram) { rkStatus.textContent = "paste a key first"; return; }
      if (await postKeys(keys)) { pi.value = ""; ai.value = ""; di.value = ""; }   // never keep key material in the DOM
    });
    keysPane.querySelector(".rk-clear").addEventListener("click", async () => {
      if (await postKeys({})) rkStatus.textContent = "keys cleared";
    });
    // resume state on load — booleans only, no key material ever crosses back
    fetch(`/api/onair?room=${encodeURIComponent(s.room)}&byok=1`)
      .then((r) => r.ok ? r.json() : null).then((j) => { if (j) setByok(j.perplexity, j.anthropic, j.deepgram); }).catch(() => {});
    bar.querySelector(".obs-copy").addEventListener("click", () => {
      try { navigator.clipboard.writeText(overlayUrl); const b = bar.querySelector(".obs-copy"); b.textContent = "Copied ✓"; setTimeout(() => b.textContent = "Copy URL", 1200); } catch {}
    });

    // ---- audio input picker (mic or virtual audio cable) ----
    const audioSel = bar.querySelector(".obs-audio select");
    audioSel.addEventListener("change", () => { audioDeviceId = audioSel.value || null; });
    refreshAudioDevices = async () => {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const ins = devs.filter((d) => d.kind === "audioinput");
        const cur = audioSel.value;
        audioSel.innerHTML = `<option value="">Default input</option>` +
          ins.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || ("Input " + (i + 1)))}</option>`).join("");
        if (cur && ins.some((d) => d.deviceId === cur)) audioSel.value = cur;
      } catch {}
    };
    refreshAudioDevices();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", refreshAudioDevices);

    // ---- remote-call tab audio (fact-check both sides of a call) ----
    const callBtn = bar.querySelector(".obs-call");
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) callBtn.addEventListener("click", () => captureCallTab(callBtn));
    else callBtn.disabled = true;

    // ---- P4-F3 push-to-mute button (state + "m" shortcut live at module level) ----
    muteBtnEl = bar.querySelector(".obs-mute");
    muteBtnEl.addEventListener("click", () => setMuted(!muted));

    // ---- download an OBS scene collection with this overlay pre-configured ----
    bar.querySelector(".obs-scene").addEventListener("click", () => {
      const blob = new Blob([obsSceneCollection(overlayUrl)], { type: "application/json" });
      const u = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = u; a.download = "Footnote-Overlay.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(u), 2000);
    });
    // publisher: called from airCard (air), airCorrection, and pullOnAir (card=null → take off-air).
    // Resolves to the server-assigned aired id (R9) — null on failure/pull — so callers can
    // reference the aired event later (corrections join on it).
    fcPublish = async (card, durationMs) => {
      if (tabReadOnly) { warnReadOnly(); return null; }   // M6: read-only tab never touches the overlay channel
      const body = { room: s.room, writeKey: s.writeKey, durationMs: durationMs === undefined ? DEFAULT_HOLD_MS : durationMs,
        card: card ? { verdict: card.verdict, claim: card.displayClaim || card.claim, canonical: card.claim, correction: card.correction, source: card.source || null,
          kind: card.kind || undefined,                                       // passthrough (e.g. "correction" — overlay/receipts render it)
          test: card.test === true || undefined,                              // field-test watermark (local TESTAIR only — overlay renders it)
          autoAired: card._autoAired === true || undefined,                   // D18: receipts distinctly mark machine airs
          // C2 sourcing display: tier drives the PRIMARY-SOURCE treatment on the card;
          // citations (already editorial-ranked) let /receipts show every qualifying source
          tier: (card.source && typeof card.source.tier === "number") ? card.source.tier : undefined,
          citations: Array.isArray(card.citations) ? card.citations.slice(0, 5) : undefined,
          refId: card.refId || undefined, refClaim: card.refClaim || undefined } : null };   // correction → original join (refClaim = legacy fallback)
      try {
        const pubT0 = performance.now();
        const r = await fetch("/api/onair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) { DBG.event("err", `overlay publish failed · HTTP ${r.status}`, { status: r.status }); return null; }
        const j = await r.json().catch(() => ({}));
        FT.log("publish", { id: (j && j.id) || null, cid: card ? card._cid || null : null, pull: !card, ms: +(performance.now() - pubT0).toFixed(0) });
        DBG.event("info", card ? "aired → overlay" : "pulled ← overlay", { claim: card ? (card.claim || "").slice(0, 60) : null, id: (j && j.id) || null });
        return (j && j.id) || null;
      } catch (e) { DBG.event("err", "overlay publish network error", { error: String(e && e.message || e) }); return null; }
    };

    /* ---- P3-J: street-operator bridge — a second phone drives AIR/HOLD/SKIP from /op ----
       Control is the queue's owner. It PUBLISHES a slim snapshot of actionable
       (checking/pending) cards on the same debounced choke points the localStorage persist
       uses, and POLLS the room's command list (~1.5s while streaming), applying operator
       actions to the local cards. Sync semantics:
         · operator "air": the SERVER already published to the overlay + aired log (so a
           control hiccup can't eat the air) — control only marks the card aired
           (SESSION.mark {auto:false, operator:true}), NO second fcPublish.
         · "skip"/"hold": marks only — control runs the normal local dismiss path
           (dismissCard, which also records an auto-air veto if the countdown was live).
         · "pull": server already published card:null — control runs pullOnAir's local
           half (hideOnAir + SESSION.markPulled) without re-publishing.
       Idempotency: dedupe by server-stamped command id, then per-card state checks (a
       command for a card that's no longer pending is a no-op). Staleness: commands
       stamped before this stream's start are consumed but never applied (card ids reset
       per session — gen-adjacent guard). M6: read-only tabs neither push the queue nor
       poll commands. */
    const operatorUrl = location.origin + "/op?room=" + s.room + "&key=" + s.writeKey;
    let opQueueT = 0, opCmdTimer = 0, opLastCmdId = "", opSessionT0 = 0;
    const opApplied = new Set();
    const opQCard = (c) => ({ id: c.id, state: c.state, verdict: c.verdict || null, claim: c.displayClaim || c.claim,   // D17: /op previews the display framing
      correction: c.correction || null, confidence: c.confidence != null ? c.confidence : null,
      source: c.source || null, harm_class: c.harm_class || null, autoAirEligible: c.autoAirEligible === true,
      polarity_conflict: !!c.polarity_conflict, spokenAt: c.spokenAt || null });
    async function opPushQueue(clear) {
      if (tabReadOnly) return;                    // M6: read-only tab never writes the shared queue
      if (!streaming && !clear) return;
      const cards = clear ? [] : fcCards.filter((c) => c.state === "checking" || c.state === "pending").slice(0, 20).map(opQCard);
      // R54: auto-aired cards awaiting an attention tag ride the snapshot so /op can offer one-tap W/T/A
      const attn = clear ? [] : fcCards.filter((c) => c._autoAired && c.state === "aired" && !c.attention).slice(0, 6)
        .map((c) => ({ id: c.id, claim: (c.displayClaim || c.claim || "").slice(0, 80) }));
      try {
        await fetch("/api/onair", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: s.room, writeKey: s.writeKey, op: "queue", cards, onAirId: SESSION.currentOnAir, muted, attn,
            autoair: { on: !!byId("autoAir").checked, count: autoAirCount, cap: AUTO_AIR_CAP } }) });   // R43 latch + W4: cap state visible from the street
      } catch {}   // best-effort — next mutation re-pushes; /op's 180s TTL bounds staleness
    }
    function opApplyCmd(cmd) {
      if (!cmd || !cmd.id || opApplied.has(cmd.id)) return;
      opApplied.add(cmd.id); opLastCmdId = cmd.id;
      if (opApplied.size > 400) { const it = opApplied.values(); for (let i = 0; i < 200; i++) opApplied.delete(it.next().value); }
      if (typeof cmd.t !== "number" || cmd.t < opSessionT0) return;   // stale: issued before this stream started
      const c = cmd.cardId != null ? fcCards.find((x) => x.id === cmd.cardId) : null;
      if (cmd.action === "air") {
        if (!c || c.state !== "pending") return;   // already actioned locally / card gone — idempotent no-op
        if (c._auto) { clearTimeout(c._auto); c._auto = null; }
        c.state = "aired";
        if (cmd.airedId) c._airedId = cmd.airedId;   // server minted the aired id — corrections join on it
        renderQueue(); setOps();
        SESSION.mark(c.id, "aired", { auto: false, operator: true });
        showOnAir(c, cmd.durationMs === null ? null : (typeof cmd.durationMs === "number" ? cmd.durationMs : DEFAULT_HOLD_MS));
        FT.log("air", { id: c.id, cid: c._cid || null, verdict: c.verdict || null, auto: false, operator: true, claim: c.claim,
          polarity: c.polarity || null, polarity_conflict: !!c.polarity_conflict });   // R53 additive, telemetry-only
        DBG.event("info", "operator AIR (second phone)", { claim: (c.claim || "").slice(0, 60), id: cmd.airedId || null });
      } else if (cmd.action === "skip" || cmd.action === "hold") {
        if (!c || c.state !== "pending") return;
        dismissCard(c, cmd.action === "skip" ? "skipped" : "held");
        DBG.event("info", `operator ${cmd.action.toUpperCase()} (second phone)`, { claim: (c.claim || "").slice(0, 60) });
      } else if (cmd.action === "mute" || cmd.action === "unmute") {
        // R43: latched mute from the street phone — same semantics as the Mac M-key
        setMuted(cmd.action === "mute");
        DBG.event("info", `operator ${cmd.action.toUpperCase()} (second phone)`);
      } else if (cmd.action === "pull") {
        clearOnAir(); SESSION.markPulled();   // server already published card:null — local half only (pacing queue flushed too)
        DBG.event("info", "operator PULL (second phone)");
      } else if (cmd.action === "attention") {
        // R54: one-tap tag from /op — same applyAttention path as the Mac keystroke (first tag wins)
        const ac = cmd.cardId != null ? fcCards.find((x) => x.id === cmd.cardId) : null;
        if (ac) applyAttention(ac, cmd.attn, "op");
      }
    }
    async function opPollCmds() {
      if (tabReadOnly || !streaming) return;
      try {
        // N1: writeKey in the POST body — never a query string (query strings reach access logs)
        const r = await fetch("/api/onair", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: s.room, writeKey: s.writeKey, op: "cmds-read", after: opLastCmdId }), cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json().catch(() => null);
        if (j && Array.isArray(j.cmds)) j.cmds.forEach(opApplyCmd);   // oldest→newest — issue order
      } catch {}
    }
    opBridge = {
      scheduleQueuePush() { if (tabReadOnly || !streaming) return; clearTimeout(opQueueT); opQueueT = setTimeout(opPushQueue, 400); },
      pushNow() { if (tabReadOnly || !streaming) return; clearTimeout(opQueueT); opPushQueue(); },   // synchronous-intent push (dismissals — N4)
      streamStarted() {
        opSessionT0 = Date.now(); opLastCmdId = "";
        clearTimeout(opQueueT); opPushQueue();               // baseline (empty) snapshot so /op sees the session
        clearInterval(opCmdTimer); opCmdTimer = setInterval(opPollCmds, 1500);
      },
      streamEnded() { clearInterval(opCmdTimer); opCmdTimer = 0; clearTimeout(opQueueT); opPushQueue(true); },
    };

    // R40: street keyterms row — proper nouns for tonight, fed to Deepgram on every connect
    const ktRow = document.createElement("div");
    ktRow.className = "obs-bar kt-row";
    const ktSaved = (() => { try { return localStorage.getItem("footnote.keyterms." + s.room) || ""; } catch { return ""; } })();
    ktRow.innerHTML = `<span class="obs-label">🗣 KEYTERMS</span>
      <input class="obs-url kt-input" placeholder="tonight's proper nouns, comma-separated — e.g. Erewhon, Silver Lake, Karen Bass" value="${esc(ktSaved)}" aria-label="Session keyterms">
      <span class="obs-hint">street names the transcriber should expect — applied at Start Stream</span>`;
    const ktInput = ktRow.querySelector(".kt-input");
    ktInput.addEventListener("change", () => { try { localStorage.setItem("footnote.keyterms." + s.room, ktInput.value); } catch {} });
    applyKeyterms = () => {
      customKeyterms = ktInput.value.split(",").map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 50).slice(0, 30);
      SESSION.keyterms = customKeyterms.slice();
      if (customKeyterms.length) { DBG.event("info", "session keyterms active", { terms: customKeyterms }); FT.log("keyterms", { terms: customKeyterms }); }
    };

    // OPERATOR row: the capability URL for the second-phone /op page (solo street mode)
    const opRow = document.createElement("div");
    opRow.className = "obs-bar op-row";
    opRow.innerHTML = `<span class="obs-label">📱 OPERATOR</span>
      <input class="obs-url op-url" readonly value="${esc(operatorUrl)}" aria-label="Operator URL">
      <button class="obs-copy op-copy" type="button">Copy URL</button>
      <span class="obs-hint">second-phone queue — URL contains the write key, treat like a password</span>`;
    keysPane.insertAdjacentElement("afterend", opRow);
    opRow.insertAdjacentElement("afterend", ktRow);
    opRow.querySelector(".op-copy").addEventListener("click", () => {
      try { navigator.clipboard.writeText(operatorUrl); const b = opRow.querySelector(".op-copy"); b.textContent = "Copied ✓"; setTimeout(() => b.textContent = "Copy URL", 1200); } catch {}
    });
    /* R42 (street FS-5): capability URLs must never be hand-typed — a two-character
       transcription slip cost a 403 mid-setup. The self-host server exposes its
       non-loopback addresses (/__addrs, absent on Vercel → this whole block no-ops);
       when a tailnet (100.64/10) address exists, offer a ready-made second copy button
       with that origin for the street phone. */
    fetch("/__addrs").then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d || !Array.isArray(d.addrs)) return;
      const pick = d.addrs.find((a) => a.tailnet) || null;
      if (!pick) return;
      const tnUrl = `http://${pick.address}:${d.port}/op?room=${s.room}&key=${s.writeKey}`;
      const b = document.createElement("button");
      b.className = "obs-copy op-copy-tailnet"; b.type = "button"; b.textContent = "Copy tailnet URL";
      b.title = "Operator URL on the tailnet origin — for the street phone (Tailscale on)";
      b.addEventListener("click", () => {
        try { navigator.clipboard.writeText(tnUrl); b.textContent = "Copied ✓"; setTimeout(() => b.textContent = "Copy tailnet URL", 1200); } catch {}
      });
      opRow.querySelector(".op-copy").insertAdjacentElement("afterend", b);
    }).catch(() => {});

    DBG.event("info", "OBS control bridge ready", { room: s.room, overlayUrl });
  }

  /* ================= BOOT ================= */
  // OBS "control" view (served at /control): same pipeline + queue, mock-stream chrome hidden.
  // The on-air graphic itself moves to the separate /overlay Browser Source (wired in P1).
  const VIEW = (location.pathname.replace(/\/+$/, "") || "/") === "/control" ? "control" : "demo";
  document.body.classList.toggle("view-control", VIEW === "control");
  if (VIEW === "control") setupControlBridge();
  byId("platformSel").value = "youtube";
  applyPlatform("youtube");
  byId("platformSel").addEventListener("change", (e) => {
    const wasLive = player.classList.contains("live");
    applyPlatform(e.target.value);
    if (wasLive) { player.classList.add("live"); startChat(); }   // keep on-air + restart chat in new skin
  });
  streamBtn.onclick = toggleStream;
  byId("typedSend").onclick = submitTyped;
  byId("typedInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitTyped(); });
  renderQueue(); setOps();
  // on-air controls: Hold (stay until pulled) + Pull (take off-air now)
  if (byId("holdAir")) byId("holdAir").addEventListener("change", (e) => { holdMode = e.target.checked; });
  if (byId("pullAir")) byId("pullAir").addEventListener("click", pullOnAir);
  if (byId("sessionLog")) byId("sessionLog").addEventListener("click", () => SESSION.download());
  updateSessionBtn();
  // keyboard: A = air top pending card, S = skip it, P = pull on-air
  document.addEventListener("keydown", (e) => {
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === "`") return toggleDbg();
    if (e.key === "p" || e.key === "P") return pullOnAir();
    const top = fcCards.find((c) => c.state === "pending");
    if (top && (e.key === "a" || e.key === "A")) airCard(top);
    else if (top && (e.key === "s" || e.key === "S")) dismissCard(top, "skipped");
  });
  byId("dbgToggle").onclick = toggleDbg;
  if (DBG.on) { byId("dbg").hidden = false; byId("dbgToggle").classList.add("on"); renderDbg(); }
  window.footnoteDebug = DBG;   // console hook: footnoteDebug.json(), .records
  window.footnoteSession = SESSION;   // console hook: footnoteSession.download(), .entries(), .counts()
})();
