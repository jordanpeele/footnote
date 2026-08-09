# Red-team ROUND 3 — RE-PROBE (sprint round 3 wave 2, packet P3-H adversarial half)

**Baseline:** commit `db7a559` (SETTLED tree), deployed to https://footnote-live.vercel.app.
Method: line-by-line reads of the current tree, `node` executions of the pure functions against
the live `src/core/*` modules, `npm test` (42/42), and a handful of cheap live calls against prod
(one kill→status→restore cycle, restored immediately, per the D14 confirmation allowance).
Prior art: `docs/redteam/ROUND2.md` (findings) + `docs/redteam/ROUND2-TRIAGE.md` (status table).

## Executive summary

**Every previously-closed finding stays closed in the current tree, and every previously-open item
that this wave owned (H2, M5, M6, L2) has landed a correct fix.** The round-2 highs are done:
H2's ghost auto-air is closed by a full generation guard (`_gen` captured *before* the first await,
re-checked after both the extract and verify fetches, and the 4s auto-air timer now gated on
`streaming && c._gen === gen`); H3's `*.gov.<cc>` spoof is closed by the curated `GOV_CC` allowlist
with correct `host === s || host.endsWith("." + s)` semantics (subdomains of real `gov.uk` pass,
`notgov.uk`/`xgov.uk`/`gov.uk.evil.com`/`cdc.gov.io` all fall to tier 1). The M1–M4 adapter/overlay
guards hold and now cover the new `queue`/`cmd` branches (all inside onair's outer try). L1/L3/L4/L5/L7
remain closed with the exact regressions pinned. The R15 verdict-normalization ordering is **correct**:
case-normalization happens inside `finalizeVerification` before both the polarity flip and the
auto-air gate, and the evidence-floor gate (`autoAirEligible`) is verdict-independent, so a vendor
`"false"` traverses the identical path as `"False"` (proven in node).

The **new P3-J operator bridge** (second-phone `/op`) is the round's real new attack surface and it is
well-built: `?queue=1`/`?cmds=1` are writeKey-gated on every path, dot-prefixed internal rooms
(`q.<room>`, `cmd.<room>`) are unreachable through `okRoom`, `/op` and `operator.html` render every
pipeline string via `textContent` (no XSS), the cross-session air replay is correctly dropped
(`opSessionT0` stale-command gate + per-`(cardId,spokenAt)` server dedup), and the new POST ops sit
behind `spendGate` + `rateLimit` (live-confirmed: `op:"cmd"` 503s under kill). Four **new findings**,
all LOW/MED and mostly inherent to the capability-URL design: the writeKey now rides GET query strings
(→ Vercel logs), a TOCTOU race can defeat single-session air idempotency under true concurrency, the
queue GET path is a new reach for the known L6 room-seizure, and a stale `/op` snapshot can air a
just-HELD card during the ~400ms queue re-push window.

---

## Re-probe verdict table

| # | Finding | Verdict | Anchor / evidence |
|---|---------|---------|-------------------|
| H1 | Legacy `/api/factcheck` unmetered + bypass | **CLOSED-CONFIRMED** | File absent from tree (`api/` has no `factcheck.js`); route-inventory test asserts `ROUTE_CLASSES` ≡ `api/` both directions (green). Residual preview-deploy/key-rotation note still BACKLOG. |
| H2 | Ghost auto-air after End Stream (no gen guard) | **CLOSED-CONFIRMED** | `app.js` L268 `const g = gen` captured **before** the first await (L274); re-checked L281 (post-extract) and L312 (post-verify); auto-air timer L482 gated `streaming && c._gen === gen && c.state === "pending"`. Stale results logged `stale_generation` (L284/L315). Audit table L693–718 matches the code. |
| H3 | `*.gov.<cc>` privately-registrable → tier 3 | **CLOSED-CONFIRMED** | `editorial.js` L98–107 curated `GOV_CC` + `host === s \|\| host.endsWith("."+s)`. node: `cdc.gov.io/gov.io/gov.uk.gov.io/notgov.uk/xgov.uk/gov.uk.evil.com → 1`; `evil.gov.uk/service.gov.uk/gov.uk → 3` (real subdomains correctly pass); lone `cdc.gov.io` fails `autoAirEligible`. |
| M1 | `getAdapter` outside try crashes onair/transcribe | **CLOSED-CONFIRMED** | `onair.js` L86 `getAdapter("state")` inside try → clean 500; the whole handler body incl. the new `queue`/`cmd` branches is inside the L97 outer try. |
| M2 | Stub adapters reachable in prod | **CLOSED-CONFIRMED** | `registry.test.js`: prod+stub rejects unless `ALLOW_STUBS=1`; prod+default resolves without touching vendors (green, subprocess-isolated). |
| M3 | Overlay counts 200-with-garbage as healthy | **CLOSED-CONFIRMED** | `overlay.js` L109 `ok = true` set **after** `await r.json()` (commented red-team M3). |
| M4 | Held card wedges on glass after TTL (`seq:0`) | **CLOSED-CONFIRMED** | `overlay.js` L113 `(d.seq \|\| 0) !== lastSeq` → `isLive` false → `hideOnAir()` (commented red-team M4). Survives the R12.2 refId edits (all textContent). |
| M5 | Restored `checking` cards never logged | **CLOSED-CONFIRMED** | `app.js` L1103 `SESSION.log(c)` + `restored=true` for `checking→error` cards on restore. |
| M6 | Two /control tabs clobber snapshot/ids | **CLOSED-CONFIRMED** | `app.js` L1052–1087 localStorage heartbeat single-writer lock; loser → read-only (`tabReadOnly`); every mutating path (checkUtterance L261, dismiss/air/correction/pushQueue/pollCmds) guards on `tabReadOnly`. |
| M7 | No prompt-file ↔ fallback sync enforcement | **CLOSED-CONFIRMED** | `prompt-sync.test.js` now **imports** `FALLBACK_PROMPT` (R14 named export) and byte-compares to `prompts/extractor.md` body — no source-scraping left (L14 import; L25 `assert.equal`). |
| L1 | `rankCitations` throws on non-array | **CLOSED-CONFIRMED** | `editorial.js` L116 `Array.isArray(urls) ? urls : []`. |
| L2 | `SESSION.summary()` p50/p95 without n | **CLOSED-CONFIRMED (wave-2)** | (app.js summary now carries `n` alongside p50/p95; wave-2 owned.) |
| L3 | Shortener/blocklist evasion + 1-char names | **CLOSED-CONFIRMED** | `editorial.js` L32 `SHORTENER_RE` → tier 0; L96 `prettyName` <3 chars → full host (gov acronym path exempt). node: `t.co → 0`. |
| L4 | `.slice(240)` splits surrogate pair | **CLOSED-CONFIRMED** | `editorial.js` L81 `truncateOnAir`; `onair.js` L31 `cut()` strips lone high surrogate on **every** slimCard/slimQCard field (residual L4 backlog now also covered in onair). |
| L5 | Nested markdown survives cleanText | **CLOSED-CONFIRMED** | `editorial.js` L63 fixpoint loop (bound 6). |
| L6 | TOFU writeKey room seizure / no SETNX | **CLOSED-CONFIRMED (register race)** / **still BACKLOG-LOW (seizure)** | `onair.js` L150 comment: `SET NX EX` atomic register in adapter (R12.1) — the two-first-writers race is closed. The 24h idle-seizure policy is still open, and now **also reachable via the queue GET** — see N3. |
| L7 | Verdict casing softened to Unverifiable | **CLOSED-CONFIRMED** | `editorial.js` L149–151 `.trim().toLowerCase()` then `VERDICTS.find(v => v.toLowerCase() === rawVerdict)`. node: `"false"→False`, `" True"→True`, `"FALSE"→False`, `"bogus"/null/42→Unverifiable`. |

**R15 RULING — verdict normalization ordering: CORRECT (no gate sees a raw miscased verdict).**
Trace in `api/verify.js`: (1) `finalizeVerification(raw)` L69 normalizes the verdict to canonical
form (`editorial.js` L149–151) **and** computes `source.tier` + `autoAirEligible` — both of which are
**verdict-independent** (they read only `rv.citations` → `rankCitations` → `autoAirEligible`, never
the verdict); (2) `applyPolarity(v.verdict, polarity)` L73 receives the **already-canonical** verdict
and flips only exact `"True"`/`"False"` (`polarity.js` L37–38), so `"false"→"False"→(denies)→"True"`
is byte-identical to `"False"→(denies)→"True"` (proven: `false+denies → {verdict:"True"}`). The
client-side auto-air verdict gate (`app.js` L477 `c.verdict === "True" || "False"`) sees the same
post-polarity canonical value. **No editorial gate — tier ranking, `autoAirEligible`, polarity flip,
or the auto-air verdict/confidence floor — ever reads the un-normalized verdict.** The flip handles
only canonical forms, exactly as the re-probe required.

**Live spot-checks (prod, `footnote-live.vercel.app`):**
- Wrong-key queue GET → **403** (after proper TOFU claim: keyA registers → 200, keyB → 403, keyA again → 200; `cmds` same). Short key (<8) → 403. Dot-room via public GET → 400 "bad room".
- `?queue=1&byok=1` on a foreign room → `{perplexity:false,...}` booleans only — **no queue leak** (byok branch precedes queue).
- `/op?room=&key=` → **200 text/html**; one extract → clean `{claim,polarity:"asserts",harm_class:"none"}` (pipeline healthy).
- **Kill cycle (restored):** status `killed:false` → kill → `killed:true` → `/api/verify` POST **503**, `/api/onair` POST `op:"cmd"` **503** (proves spendGate covers the new P3-J op branch on the live deployment) → restore → `killed:false`. Left as found.

---

## New findings (severity-ranked)

### N1 — MEDIUM: writeKey travels in GET query strings on queue/cmds polls → server logs + browser history
`operator.js` L149 (`/api/onair?queue=1&room=…&key=<writeKey>`) and `app.js` L1285
(`/api/onair?cmds=1&…&key=<s.writeKey>`) send the room's **write capability** (air/publish/correction)
as a URL query parameter, polled ~1/s while live. Vercel function/access logs record full request URLs
including query strings, so the writeKey is written to platform logs; it also lands in the `/op` phone's
URL bar, browser history, and any bookmark. The POST `op:"cmd"` path keeps the key in the request body
(not logged), but the polling reads are GETs and can't. This is partly inherent to the capability-URL
design (already documented "treat like a password" for the `/op` link), and the demo operator is a
trusted party — but "in the URL" is a materially weaker posture than "in a POST body," and the key here
is the high-privilege *write* key, not the read-only overlay room. **Owner:** P3-J follow-up — consider
moving the polling auth to a POST (or a short-lived derived read token), and/or documenting that the
room writeKey is exposed in hosting logs. Honest severity MED for a broadcast tool; LOW in the current
demo/solo-operator threat model.

### N2 — LOW: TOCTOU race defeats single-session air idempotency under true concurrency
`onair.js` L195–206 (`op:"cmd"` air) is read-then-write with no lock: it `state.get`s the queue, finds
the pending card, scans the cmd log for a `prior` air with the same `(cardId, spokenAt)`, then
publishes + appends. Two concurrent AIR requests for the same card can both pass the `prior` check
before either appends → **duplicate aired-log entry + a redundant (benign) re-publish of the same
card**. The code comment claims "a double-tap can't double-air or double-log"; that holds only for
serialized requests. In practice the `/op` client guards with the `sent` Map (`operator.js` L63) and
the cross-session case is separately safe (N/A: new session → new `spokenAt`, old card absent from the
queue → 409), so this needs a client bypass or two racing phones on one key. Effect is a cosmetic
double log row and an identical overlay re-render, not a wrong card on air. **Owner:** P3-J follow-up —
make the air dedup atomic (adapter-level `SET NX` on an `aired:<cardId>:<spokenAt>` marker) if the
"can't double-log" guarantee is load-bearing for the receipts record.

### N3 — LOW: queue/cmds GET is a new reach for the known L6 room-seizure (read-shaped TOFU claim)
The writeKey-gate on `?queue=1`/`?cmds=1` reuses `state.registerRoom` (`onair.js` L117), which is TOFU:
a GET against an **unregistered** room **claims** it for the presented key. Confirmed live — a fresh room
returns 200 for the first arbitrary key, then 403 for any other. Previously only a POST could trigger the
TOFU registration; now a GET-shaped request can seize an as-yet-unregistered room. Real-world reach is the
same as round-2 L6 (attacker must know the 10-char room id — leaked only via OBS-config screenshots of the
overlay URL — and act before /control's first publish at stream start), so this is a widening of L6's
attack surface, not a new class. **Owner:** folds into the open L6 policy decision (re-registration refresh
from control on boot would also shut this path).

### N4 — LOW: stale `/op` snapshot can AIR a just-HELD card during the queue re-push window
When /control HOLDs a pending card, the card leaves the actionable set and control re-pushes the queue
snapshot — but the push is debounced 400ms and best-effort (`opPushQueue` swallows failures, `app.js`
L1256). Within that window (or if the push drops), the `/op` phone still lists the card as pending; an
operator AIR passes the server's `state === "pending"` check against the **stale** `q.<room>` snapshot and
**publishes the held card to the overlay**. Control then polls the returning `air` command and ignores it
(`opApplyCmd` L1265 `c.state !== "pending"` → no-op), so control shows HELD while the overlay shows the
card AIRED — a control/overlay divergence with no local signal. Narrow (~400ms + the operator tapping in
that window) and self-limited by the 180s queue TTL, but it violates the "held card never airs" operator
expectation. **Owner:** P3-J follow-up — have `op:"cmd"` air also confirm against the current on-air/held
marks, or push the queue snapshot synchronously on HOLD/SKIP before returning.

---

## INFO (no action)
- **I-R3a — `gov.co` (and other real `gov.<cc>` not in `GOV_CC`) under-trusted to tier 1.** The curated
  allowlist trades the H3 spoof risk for occasionally under-ranking a legitimate foreign-gov citation
  (node: `gov.co → 1`). Accuracy nit, not a vuln — the conservative direction. Extend `GOV_CC` as real
  sovereign second-levels come up.
- **I-R3b — public aired-log GET (`?log=1`) remains CORS-open and unauthenticated by design** (R9 receipts
  embedding). Confirmed 200. Correct: the aired log is the accountability surface; the *unaired* queue is
  the thing that's writeKey-gated.
- **I-R3c — clock-skew in the P3-J stale-command gate.** `opApplyCmd` compares server `cmd.t` against the
  client's `opSessionT0 = Date.now()` (`app.js` L1262/L1294). Skew fails safe (a legit command at the very
  start of a stream is dropped, never a stale one aired). No action.
- **Carried from round 2:** I3 (upstream `detail` echo), I4 (duplicate-domain citations), I7 (inlined
  `DG_KEY`, tracked for post-pitch rotation), and the H1 residual (Vercel preview-deploy protection / key
  rotation) remain open BACKLOG items — none regressed, none in scope for this tree.
