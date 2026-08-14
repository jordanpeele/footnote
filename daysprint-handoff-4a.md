# DAYSPRINT handoff — packet 4a: receipts (auto chips + attention + per-card links)

Branch: `worktree-agent-a57af5b7173dd9886` · committed, NOT pushed · `npm test` green (252 tests: 250 pass, 2 pre-existing skips) · no gate semantics touched, no ledger-sentence changes, footer untouched.

## Shipped

### 1. Per-card deep links (LIVE)
- Every receipt entry with a server-minted aired id is addressable as `/receipts?room=<room>#<id>`. The element id is set ONLY when the id matches the mintId shape (`/^\d{1,17}-[a-z0-9]{4}$/` — `okAnchor` in receipts.js); arbitrary log strings can never become DOM ids (clobbering hygiene, log is adversarial-adjacent).
- `location.hash` on load scrolls the card to center and rings it green (`.rc-hit`, one-shot fade). One-shot per hash: the 30s auto-refresh never re-scrolls under the reader; `hashchange` re-arms.
- Per-card `#` copy button (top-right, after the time): copies the current page URL (room + flags preserved) with the card's id as the hash; falls back to setting `location.hash` where the clipboard API is unavailable. Legacy entries without ids get no anchor and no button, gracefully.

### 2. AUTO chip polish + TEST framing (LIVE)
- `AUTO · machine-aired` restyled from amber (read as a warning) to cool slate-blue — distinct from every verdict color and from the tier/cite chips, but a disclosure, not an alarm. Tooltip: aired by the auto-air gate under live operator supervision, 4-second veto window (D18).
- TEST-watermarked cards (`test:true`, local TESTAIR) now visibly TEST on receipts: dashed dimmed card + dashed `TEST · not in ledger` chip, tooltip carrying the excluded-from-ledger framing (R63). The card stays in the record — nothing is hidden, the exclusion is worn on the sleeve.

### 3. Attention states on receipts (BUILT DARK — operator decision required)
Write path (clean, additive, correction-pattern):
- New writeKey-gated op `POST /api/onair {op:"attn", refId, state}` appends a `kind:"attention"` event to the AIRED log, joined to the original by `refId` (the original's aired id) — D6 append-only, the aired entry is never mutated. Guards: R54 closed state set (watching/talking/away, else 400 — never defaulted); refId must reference an existing `autoAired:true` entry (else 409 — no junk in the record, no tags on human airs); first tag wins (dup → 200 `{dup}`, one event max). Behind spendGate like every write (kill switch halts record writes).
- app.js: `applyAttention` (both the Mac W/T/A keystroke and the /op one-tap via cmd) mirrors the tag to the public log via `fcAttnPublish` — **ONLY when /control is opened with `?attn=1`** (`ATTN_PUBLIC`, default OFF). A tag applied before the air's publish response resolves is covered by the `airCard` `.then` (server dedupes, double-send safe). Read-only tabs never send.
- receipts.js: attention events are ALWAYS filtered out of the card list (they can never render as broken cards, flag or no flag); the neutral gray `operator: <state>` chip renders on the auto-aired original **only under `/receipts?...&attn=1`**.
- Net: with both flags default-OFF, nothing new reaches the public log and nothing new renders. The public record is byte-identical to before this packet unless the operator opts in on /control.

**Disclosure case (the one paragraph):** Surfacing attention makes the supervision claim auditable instead of asserted — today receipts says "machine-aired" and D18 says "operator present, 4s veto window," but the public can't distinguish a veto window somebody watched from one that ran as a formality; publishing the R54 tag ("operator: watching / talking / away") closes that gap and is the strongest honest version of the accountability page, ESPECIALLY when the answer is "away," which is precisely why it costs something: it publishes self-reported, unverifiable operator behavior into a permanent public record, an "away" chip beside a wrong card becomes an accountability weapon aimed at the operator personally rather than the system, and once disclosed for some cards its ABSENCE on others becomes legible too (untagged reads as evasive, retroactively converting an optional research instrument into a public obligation). Recommendation embedded in the build: ship it only if you're prepared to tag every auto-air every session, forever — otherwise the flag stays dark and R54 remains a session-record/field-report instrument. The operator decides; flipping it live = open /control with `?attn=1` (writes) and publish receipts links with `&attn=1` (rendering). No deploy needed beyond this branch.

## Verification done
- `npm test` green; new `test/onair-attn-log.test.js` (6 tests: append+no-mutation, closed set, refId existence + auto-only, dup/first-tag-wins, writeKey gate) + `test/onair-slimcard.test.js` extended with boolean-true-only passthrough pins for `test`/`autoAired` (receipts now renders both).
- Live smoke against `npm start` (memory adapter): human air + auto/TEST air + attn op → log shape correct; browser check of /receipts confirmed default view (attention event filtered, no chips, anchors + copy buttons present) and flagged view (`?attn=1#<id>`: neutral chip, scroll + highlight ring).

## Notes for the next packet
- The attn op accepts writes regardless of flags (the flag is a disclosure choice on /control, not a security boundary — the writer already holds the writeKey). If the operator rules the data must never exist server-side even opt-in, delete the `op === "attn"` branch; everything else stands alone.
- `attention` is not persisted across /control reloads (`schedulePersist` snapshot doesn't carry it) — pre-existing R54 behavior, unchanged here; a reload before tagging loses the local tag (public-log mirror already sent survives).
- Copy-link URL preserves whatever query the viewer is on (including `&attn=1`) — sharing a flagged view shares the flag; deliberate, revisit if the operator wants canonical links stripped.
