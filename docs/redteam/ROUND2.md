# Red-team ROUND 2 — P0-B contracts refactor + P1-F instrumentation/resilience

**Baseline:** commit `00cef1c` (analysis snapshots via `git show 00cef1c:<path>`); pre-refactor
comparisons against `5de46c7`. Working tree was under active edit during this pass
(app.js/overlay.js mtimes 23:52, api/* 23:54, editorial.js 00:24; `api/factcheck.js` staged-deleted,
editorial.js has an uncommitted `autoAirEligible` addition). All line anchors below are **00cef1c**
unless marked *(5de46c7)* or *(working tree)*. Pure-function claims were executed in node against the
00cef1c snapshot of `src/core/editorial.js`.

## Executive summary

The P0-B refactor itself is remarkably drift-free — extract/verify/transcribe route+adapter behavior
is byte-identical to the pre-refactor routes for every edge probed (429/timeout shapes, malformed
upstream JSON, confidence clamping, keyterms, NONE handling). The real exposure is around the edges:
the **legacy `/api/factcheck` route was still deployed at baseline with no rate limit and a full
editorial bypass** (H1), an **in-flight check can auto-air to the OBS overlay after the operator ends
the stream** (H2), and the **`.gov` tier regex grants top trust to privately registrable
`gov.<cc>` domains** (H3). On the P1-F side the session log has two disposition holes
(reload-interrupted checks vanish; post-endStream completions log as eternally-pending), and the
overlay treats 200-with-garbage as healthy and can wedge a held card on glass forever after state
TTL expiry.

---

## HIGH

### H1 — Legacy `/api/factcheck` deployed at baseline: unmetered spend + full editorial bypass
**Target:** P0-B (editorial bypass + registry perimeter) · **Anchor:** `git show 00cef1c:api/factcheck.js` (whole file; handler ~L50–74)

`api/factcheck.js` still exists at `00cef1c` (i.e., in the deployed baseline). It predates every
protection the refactor centralized:
- **No `rateLimit` call at all** — the only unmetered route in the API. One `curl` loop = unbounded
  Haiku + Perplexity sonar-pro spend (every other route caps at 20–600/min/IP).
- **Bypasses `finalizeVerification` entirely**: no `search_domain_filter`, no trust ranking
  (`source.url = citations[0]` — can be reddit/twitter/anything), **model-claimed
  `source_name` displayed without matching the linked URL** (violates the "name must match the cited
  page" invariant stated in editorial.js's own header), no `cleanText` (markdown reaches the card),
  old weaker extraction prompt.

The working tree has it staged-deleted (good), but: (a) that deletion is uncommitted/undeployed;
(b) **immutable preview deployments keep serving it forever** even after the deletion ships — worth a
check that old preview URLs are access-protected or the exposed keys are rotated.
**Fix owner:** P1-B follow-up — land the deletion, audit Vercel preview-deployment protection, and
consider rotating `PERPLEXITY_API_KEY`/`ANTHROPIC_API_KEY` if old previews stay public.

### H2 — Ghost auto-air: an in-flight check can air to the OBS overlay AFTER End Stream
**Target:** P1-F (disposition completeness) · **Anchors:** app.js L181–221 (`checkUtterance` — no `gen` guard), L216–220 (post-await logging), L299–304 (`maybeAutoAir`), L270–276 (`airCard` → `fcPublish`), L696–715 (`endStream`)

`checkUtterance`'s fetches are not generation-guarded (unlike every audio path, which checks
`g !== gen`). Sequence:
1. Speaker makes a claim; verify is in flight (`● analyzing…`).
2. Operator hits **End Stream** → `clearFactChecks()` empties `fcCards`, expiries are finalized, the
   "session summary" event is emitted (L713).
3. The in-flight verify resolves. The card object (no longer in `fcCards`, invisible in the queue)
   is set to `pending`, `SESSION.log(card)` creates a **new entry after the summary**, and
   `maybeAutoAir(card)` runs.
4. With Auto-air checked and a definitive ≥0.85 sourced verdict, the 4s timer fires, `c.state` is
   still `"pending"` (nothing ever touches the orphaned card again), so `airCard(c)` executes →
   `fcPublish` **publishes the card to `/api/onair` and the OBS overlay shows it on the program
   feed** — with no queue card to skip/hold and the control UI showing "stream ended".

Also the disposition hole even without auto-air: the entry logs as `action:"pending"` forever (it is
persisted to localStorage and survives restore for 4h; the next `clearFactChecks` will expire it only
because it's not in `fcCards` — but the *session that produced it* already emitted its summary
without it, and `verify`-error variants log `error` entries post-summary too).
**Repro (no mic needed):** type a claim, click End Stream within ~2s, watch the overlay 4–6s later.
**Fix owner:** P1-F follow-up — capture `myGen` in `checkUtterance` and drop results when
`gen` changed (or at minimum gate `maybeAutoAir`/`SESSION.log` on `streaming`).

### H3 — `trustTier` grants tier-3 to privately registrable `*.gov.<cc>` hosts (feeds auto-air gate)
**Target:** P0-B (editorial) · **Anchor:** src/core/editorial.js L78; amplified by *(working tree)* `autoAirEligible` (`best.tier === 3` ⇒ eligible)

`/\.gov(\.[a-z]{2})?$/` matches any host ending `.gov.<two letters>` — verified in node:
`trustTier("cdc.gov.io") === 3`. Only a handful of ccTLDs reserve `gov.<cc>` for government
(`gov.uk`, `gov.co`…); on open registries (`.io`, `.me`, `.tv`, `.cc`, `.ws`…) anyone can own
`gov.io` and mint `anything.gov.io`. Trust ranking will promote such a citation **above Reuters/AP**
(sort is by tier, tier-3 stable-ordered), it becomes the surfaced on-air source, and under the
working-tree `autoAirEligible` a single such citation satisfies the evidence floor by itself.
Inbound path is real if unlikely: Perplexity citing an SEO'd spoof page. Related inconsistencies
(same regex family): bare `gov.uk` → tier 1 while `service.gov.uk` → tier 3; `ec.europa.eu` → tier 1
while `europa.eu` → tier 3 (Set has no subdomain logic).
**Fix owner:** P1-B follow-up — allowlist the ccTLDs where `gov.<cc>` is actually sovereign, or
require `\.gov$`/`\.mil$` plus an explicit foreign-gov list; add subdomain-suffix matching for the
trust Sets.

---

## MEDIUM

### M1 — `getAdapter()` called outside try in onair/transcribe: bad `FOOTNOTE_*` env hard-crashes the two live-path routes (behavior drift)
**Target:** P0-B (registry attack) · **Anchors:** api/onair.js L27, api/transcribe.js L32 (outside try); src/core/registry.js L31–38 (throws on unknown name)

`FOOTNOTE_STATE=garbage` (typo'd env) makes `getAdapter("state")` throw **before** onair's
try/catch → unhandled → `FUNCTION_INVOCATION_FAILED` (opaque 500) on **every** overlay poll and
every publish. Same for `FOOTNOTE_STT` in transcribe. This failure mode did not exist pre-refactor
(routes had no registry), and it differs from verify/extract/dg-token, which call `getAdapter`
inside try and degrade to a clean 502 JSON. The overlay's backoff treats it as generic failure
(dot after 8 fails), but the operator gets zero diagnostic.
**Fix owner:** P1-B follow-up — validate registry selection at module load with a clear thrown
message, or move the calls inside the existing try blocks.

### M2 — `FOOTNOTE_STATE=stub` in a deployed instance: control reports "aired → overlay" while the overlay shows nothing
**Target:** P0-B (registry attack) · **Anchors:** src/core/registry.js L31–38 (env is the only gate); src/adapters/state/_stub/index.js (per-process Maps, `isConfigured()` always true); app.js L916–918 (success logged on 200)

Env selection reaches `_stub` adapters in prod — there is no `NODE_ENV`/deployment guard, and the
state stub's `isConfigured()` returns `true`, so onair's "store not configured" 500 never fires.
On serverless, control's POST lands on instance A (in-memory publish, returns `{ok:true, seq}`),
the overlay's GET lands on instance B (`{card:null, seq:0}`): **silent on-air blackout with
affirmative success feedback**, plus the durable aired-log is lost per-instance. Severity is
operational (requires env access to trigger) but the failure is invisible by design.
Related, lower impact: `FOOTNOTE_VERIFIER=stub` produces "Stub verifier: no verification performed"
cards that a hurried operator can manually AIR (auto-air is blocked — verdict `Unverifiable` +
`source.url:null`); `FOOTNOTE_EXTRACTOR=stub` turns every ≥8-char utterance into a claim →
verify-spend amplification bounded only by the 20/min rate limit.
**Fix owner:** P1-B follow-up — log a loud cold-start warning (and/or add a response marker) when
any non-default adapter is active outside local dev; make the state stub's `isConfigured()` return
false when `process.env.VERCEL` is set.

### M3 — Overlay counts 200-with-garbage as healthy: `ok = true` set before `r.json()`
**Target:** P1-F (overlay resilience, half-open) · **Anchor:** overlay.js L73–75, L85–86

```js
if (r.ok) {
  ok = true;
  const d = await r.json();   // throws → caught → but ok is already true
```
A captive portal / hotel proxy / misrouted CDN returning `200 text/html` forever: every poll throws
at `r.json()`, yet `ok` is already true → `fails` resets to 0 each time → the degraded-network dot
**never appears** and the overlay is silently dead — the exact scenario the dot exists for (street
rig on cell internet). Fix is a one-liner ordering change (`ok = true` after successful parse).
Noted, not edited (read-only pass; file under active edit).
**Fix owner:** P1-F follow-up.

### M4 — Overlay wedges a held card on glass after state TTL expiry (`seq:0` treated as "no data", not "pull")
**Target:** P1-F (overlay resilience, seq regression) · **Anchors:** overlay.js L79 (`d.seq && d.seq !== lastSeq`); api/onair.js L54–55 (hold TTL 3600s)

A HOLD card publishes with `durationMs:null` and TTL 3600s. If it stays up past an hour (long
segment, operator distracted) the Redis key expires; GET now returns `{card:null, seq:0}`.
`d.seq` is `0` → falsy → the change branch never runs → **the card stays on the program feed
indefinitely** until a *new* publish arrives. Same wedge after any store wipe. True seq *regression*
(lower non-zero seq, e.g. clock skew across control machines) is handled — the guard is `!==`, not
`>` — so the only wedge is the `seq:0`/empty-state case. Note the client can't rely on the operator
noticing: /control's local on-air panel keeps showing the card too.
**Fix owner:** P1-F follow-up — treat `lastSeq !== null && (!d.seq || !d.card)` while `showing` as a
pull (hide), or have onair GET synthesize `seq: serverNow` for empty state.

### M5 — Reload-restore: interrupted ("checking") cards never enter the session log — invisible in every disposition path
**Target:** P1-F (disposition completeness) · **Anchors:** app.js L852–855 (checking→error on restore, no `SESSION.log`), L204 (checking card created without log entry), L310–313 (expiry walks `SESSION.byId` only)

`SESSION.log` fires only when a check reaches `pending`/`error` (L216–218), so a card persisted
mid-verify has **no session entry**. On restore it's converted to an `error` card with a retry
button — but still never logged. If the operator doesn't press retry, the check appears in *no*
disposition: `clearFactChecks`'s completeness sweep iterates `SESSION.byId`, and the card isn't
there. The broadcast record silently under-reports interrupted checks — precisely the reload
scenario the persistence layer was built for. (If retried, a fresh id/entry is created and the
count is correct.)
**Fix owner:** P1-F follow-up — `SESSION.log(c)` for restored `checking→error` cards in the restore
loop (entry lands with `action:"error"`).

### M6 — Two /control tabs, same room: last-writer-wins snapshot + cross-tab id collisions silently drop log entries
**Target:** P1-F (double-restore race) · **Anchors:** app.js L835–841 (shared `footnote.obs.room`), L845–866 (both tabs restore the same snapshot), L164–172 (whole-snapshot overwrite, 400ms debounce), L856 (`fcId` seeded identically in both tabs)

Both tabs read the same `footnote.obs.room` and `footnote.session.<room>` keys. Each restores the
identical snapshot (entries do **not** duplicate within a tab — `byId` is a Map), then both seed
`fcId` to the same max, so tab A's next card and tab B's next card get the **same id** for different
claims. Persistence writes the *entire* snapshot per tab (debounced 400ms after any mutation), so
the file ping-pongs between two divergent sessions; whichever tab wrote last wins, and on the next
reload the loser's entries are gone — colliding ids mean one entry silently *replaces* the other in
the Map. Both tabs also publish to the same overlay room (dueling on-air state, both accepted by the
shared writeKey). Answering the packet's questions: "who wins" = last 400ms-debounced writer;
"do entries duplicate" = no — worse, they collide and overwrite.
**Fix owner:** P1-F follow-up — per-tab session suffix, or a `BroadcastChannel`/`storage`-event
single-writer lock with a visible "another control tab owns this room" banner.

### M7 — Nothing enforces prompt-file ↔ fallback sync going forward
**Target:** P0-B (prompt-file failure) · **Anchors:** src/adapters/extractor/anthropic-haiku/index.js L14–33 (`FALLBACK_PROMPT`, `loadPrompt`); vercel.json (`includeFiles: prompts/**`)

Verified byte-identical at baseline (1061 = 1061 chars). Failure handling is correct: missing or
whitespace-only `prompts/extractor.md` at cold start → fallback fires (read once at module scope).
But the only sync mechanism is the "Keep in sync" comment. The versioned `.md` is the *intended*
editing surface, so the first prompt iteration strands the fallback; a later bundling miss (the
exact scenario the fallback exists for — e.g. someone simplifies vercel.json) then silently reverts
prod extraction to an old prompt with zero signal beyond a server-side `console.error`. There is no
test/eval asserting equality.
**Fix owner:** P1-B follow-up — trivial eval-suite check (`readFileSync(prompts/extractor.md).trim()
=== FALLBACK_PROMPT`), or generate the fallback constant from the file at build time.

---

## LOW

### L1 — `rankCitations` throws on non-array `citations` → contract fragility for third-party verifier adapters
**Anchor:** src/core/editorial.js L86–92. Executed: `finalizeVerification({citations:"https://…"})` →
`TypeError: (urls || []).map is not a function` (a truthy non-array skips the `|| []`). The
perplexity adapter guards with `Array.isArray`, so no drift today; but core is the layer that's
supposed to be adapter-proof, and a sloppy community adapter turns a recoverable card into a blanket
502. `Array.isArray(urls) ? urls : []` in core. **Owner:** P1-B.

### L2 — `SESSION.summary()` reports p50/p95 without `n` — p95 at n=1 is just the sample
**Anchor:** app.js L111–112 (`pp` returns `{p50,p95}` only; contrast DBG.stats L41–44 which includes
`n`). With 1–2 checks the "p95" is the max (index `floor(0.95*n)`), presented unqualified in the
end-of-night rollup that goes in the broadcast record. Math is a defensible nearest-rank variant at
real n; the omission of `n` is the dishonest part. **Owner:** P1-F.
Verified OK on the same packet question: extract/verify latencies **cannot** attach to the wrong
entry under concurrent `checkUtterance` calls — `card`, `t0`, `t1` are closure-local (L189–215).

### L3 — Blocklist evasion: `t.co`, `youtu.be`, custom-domain blogs pass as tier-1 surfaced sources
**Anchor:** src/core/editorial.js L28 (`LOW_TRUST_RE` is `.com$`-anchored). Executed:
`t.co` → tier 1, surfaced as source **"T"**; `youtu.be` → source **"Youtu"**; substack/medium custom
domains unblocked. Only surfaced when nothing better exists, but "Source: T" on a broadcast chyron is
both a trust and a credibility bug. Same in pre-refactor code (not drift). **Owner:** P1-B.

### L4 — `correction.slice(0, 240)` can split a surrogate pair → lone surrogate (�) on air
**Anchor:** src/core/editorial.js L106. Executed: 239 chars + emoji → trailing `\ud83d`. Also
`slimCard`'s `.slice(0, 300)`s in api/onair.js L18–24. Pre-existing (not drift). One-character-class
fix would be `[...s].slice(0, 240).join("")` — noted, not edited. **Owner:** P1-B.

### L5 — Nested markdown survives `cleanText`: literal `**` can reach the chyron
**Anchor:** src/core/editorial.js L60–70. Executed: `"**bold *ital* [link](u)**"` →
`"**bold ital link**"` (bold regex `[^*]+` can't span the stripped-inner asterisks; single pass, no
loop). Also `__init__`-style identifiers get unbolded (`"the init method"`). Pre-existing.
**Owner:** P1-B.

### L6 — TOFU writeKey: 24h idle expiry allows room seizure; register race lacks SETNX
**Anchors:** src/adapters/state/upstash/index.js L55–63 (GET-then-SET, `EX 86400`). A room idle >24h
can be re-registered by anyone holding the overlay URL (room id is in the Browser-Source URL, which
gets pasted into OBS configs/screenshots) → hijack the overlay next show. The GET/SET race also
lets two "first writers" both succeed, with the loser 403ing later. Behavior identical to
pre-refactor (not drift). **Owner:** P1-B (use `SET NX`; consider longer TTL or re-registration
refresh from control on boot).

### L7 — Verdict casing drift from vendor is silently softened, not normalized
**Anchor:** src/core/editorial.js L104 (`VERDICTS.includes`). Executed: `"false"` and `" True"` →
`"Unverifiable"`. A correct-but-miscased definitive verdict airs as UNVERIFIABLE (and is thereby
excluded from auto-air). Same pre-refactor (not drift). Trivial: case-insensitive match onto the
canonical form. **Owner:** P1-B.

---

## INFO

- **I1 — Route/adapter drift hunt came back clean.** Mechanical + node-probed comparison of
  `5de46c7` routes vs `00cef1c` route+adapter for extract/verify/transcribe: byte-identical response
  bodies for upstream 429/5xx (`{error, upstream_status, upstream}`), network failure, malformed
  vendor JSON (verify/extract → clean 502; transcribe → deliberate crash parity, commented as such),
  confidence clamp (1.5→1, −2→0, `"0.9"`→0.5 default, `NaN`→`null` after JSON serialization — the
  NaN case is shared pre/post, so not drift), NONE detection, wrapping-quote strip (handles curly
  quotes), Deepgram KEYTERMS preserved in the adapter, `dg_ms` meta preserved. Only cosmetic drift:
  `Server-Timing` label is now `${stt.name}` (differs only under the stub adapter).
- **I2 — Verified OK (packet questions with negative results):** HOLD during the 4s auto-air window
  **does** record `vetoed` — skip and hold share `dismissCard`, veto computed before the timer is
  cleared (app.js L261–264). `keepQueueOnce` is consumed exactly once at the first Start Stream;
  the second start clears the queue as designed (L305–308). Exactly-4h snapshot is dropped (strict
  `<`, L848). Single-tab `fcId` reseeding takes `max(cards, session keys)` — no collision across
  repeated restore cycles (L856). Overlay flap (fail/ok alternation) does not flicker the dot
  (8 *consecutive* fails required, reset on success) and backoff is jittered and capped (L85–90).
- **I3 — Upstream error `detail` (300 chars of raw vendor body) is echoed to any client** in
  verify/extract 502s (api/verify.js L21, api/extract.js L20) — mild internals disclosure (vendor
  request ids, quota messages), same as pre-refactor.
- **I4 — Duplicate-domain citations aren't deduped** — 5×reuters.com can fill all `citations` slots,
  crowding out independent corroboration (matters more once working-tree `autoAirEligible` counts
  distinct hosts — that function itself does dedupe via `Set(host)`, verified). editorial.js L110.
- **I5 — Retry double-counts a claim** in the session record (old `error` entry + new entry with a
  new id; `totalChecked`/`errors` inflate). Arguably correct as an audit trail; flagging for the
  record. app.js L257.
- **I6 — Working-tree note (not chased):** concurrent round-2 edits add `autoAirEligible` to
  editorial.js (analyzed above re H3), a `kind:"correction"` card type to overlay.js, and large
  diffs to api/verify.js, api/onair.js, extractor adapter, and app.js (~95 lines). Findings here
  should be re-checked against those diffs when they land — especially H2/H3, which interact
  directly with the auto-air work.
- **I7 — Known/out-of-scope:** inlined `DG_KEY` in app.js L575 (already tracked for rotation
  post-pitch; dg-token path is the replacement).
