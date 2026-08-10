# Architecture — for the contributor who wants to swap a part

Footnote is a pipeline with four vendor-shaped holes in it, an editorial layer that sits
above all of them, and a family of deterministic gates that don't trust any of them. This
document maps the seams. The contribution walkthroughs (contracts, eval expectations,
review bar) are in [CONTRIBUTING.md](../CONTRIBUTING.md); the policy the code answers to
is [HOW_FOOTNOTE_DECIDES.md](../HOW_FOOTNOTE_DECIDES.md).

```
mic/OBS audio ─► STT ─► final sentence ─► ClaimExtractor ─► claim (or null)
                                                │
                              deterministic gates (grounding, tripwire)
                                                │
                                   Verifier ─► raw verdict + citations
                                                │
                              editorial layer (finalizeVerification)
                                                │
                        operator queue ─► AIR ─► StateChannel ─► overlay
```

## The four interfaces

Every vendor-touching stage is an ES-module adapter behind a small JSDoc-typed interface.
Interfaces live in [`src/core/interfaces/`](../src/core/interfaces/); adapters in
`src/adapters/<domain>/<vendor>/`; each domain ships a `_stub` adapter showing the minimal
shape.

| domain | interface | reference adapter | selection env var (default) |
|---|---|---|---|
| Claim extraction | [`claim-extractor.js`](../src/core/interfaces/claim-extractor.js) | `src/adapters/extractor/anthropic-haiku/` | `FOOTNOTE_EXTRACTOR` (`anthropic-haiku`) |
| Verification | [`verifier.js`](../src/core/interfaces/verifier.js) | `src/adapters/verifier/perplexity/` | `FOOTNOTE_VERIFIER` (`perplexity`) |
| Speech-to-text | [`stt-provider.js`](../src/core/interfaces/stt-provider.js) | `src/adapters/stt/deepgram/` | `FOOTNOTE_STT` (`deepgram`) |
| State channel | [`state-channel.js`](../src/core/interfaces/state-channel.js) | `src/adapters/state/upstash/` | `FOOTNOTE_STATE` (`upstash`; the self-host server defaults it to `memory`) |

Selection happens in [`src/core/registry.js`](../src/core/registry.js), read at call time.
Two guardrails worth knowing: adapters are statically imported (so serverless bundlers
trace them), and stub adapters are **refused when `NODE_ENV=production`** unless
`ALLOW_STUBS=1` — a prod stub state channel silently swallows on-air publishes while
reporting success (red-team M2), so the registry throws instead.

There is also a second verifier in the registry, `perplexity-twostep`, **built dark**: it
runs only under an explicit `FOOTNOTE_VERIFIER=perplexity-twostep` and stays that way
until it clears the calibration bar it has so far failed —
[VERIFY_TWOSTEP.md](./VERIFY_TWOSTEP.md).

Interface notes that bite adapter authors:

- **Credentials are per-call arguments** (`verify(claim, ctx, credentials)`), never
  `process.env` writes — env is instance-global on a warm lambda and concurrent
  invocations would race keys across users. `test/credentials.test.js` statically
  enforces the ban.
- **Verifiers return everything; core decides.** Return ALL citations unranked — filtering
  and ranking is the editorial layer's call, not the adapter's.
- **Errors are typed**: `UpstreamError` for vendor non-2xx, plain `Error` for the rest;
  routes map them to distinct response shapes.

## The editorial layer sits ABOVE the verifier seam (Decision D5)

[`src/core/editorial.js`](../src/core/editorial.js) is the reason swapping the verifier
can't change what Footnote is willing to put on television. A verifier returns a *raw*
verdict and raw citations; `finalizeVerification()` then:

- **ranks citations by trust tier** — the curated `HIGH_TRUST` / `MID_TRUST` sets, a
  blocklist (`LOW_TRUST_RE`: social/forums/blogs, dropped entirely), a shortener blocklist
  (`t.co` can't be a source), and a curated `GOV_CC` allowlist instead of a naive
  `.gov.<cc>` regex — because `gov.io` is privately registrable (red-team H3);
- **selects the surfaced source** as the highest-tier survivor, and derives its display
  name from the linked domain (`prettyName`) so the card can never show an outlet it isn't
  actually citing;
- **normalizes the verdict** case-insensitively onto the five-value enum, defaulting
  anything off-list to `Unverifiable`;
- **cleans and truncates the correction** for the chyron (markdown stripped to a fixpoint,
  surrogate-safe truncation);
- **computes `autoAirEligible`** — the evidence floor: a tier-3 surfaced source, or ≥2
  tier-≥2 citations from distinct hostnames. A lone unknown-domain source can't satisfy
  auto-air at any confidence.

`api/verify.js` is deliberately a thin route: spend gate → rate limit → adapter →
`finalizeVerification` → polarity → response.

## The deterministic gate family

The extractor and verifier are stochastic; the gates are not. The working principle
(R48, arrived at after the FS-8 wrong-verdict card): pair each stochastic stage with a
cheap deterministic consistency check that can't hallucinate.

- **Grounding gate** — [`src/core/grounding.js`](../src/core/grounding.js), applied in
  `api/extract.js`. Rejects any "claim" not grounded in what the speaker actually said:
  assistant-voice patterns (the extractor echoed its own prompt into the queue 4× in the
  08-08 field test), numbers the speaker never uttered, and a low lexical-overlap
  backstop. Tuned against 51 real field pairs; a false rejection silently drops a real
  claim, so when uncertain it allows.
- **Polarity module** — [`src/core/polarity.js`](../src/core/polarity.js). The extractor
  always emits the claim in canonical *assertive* form plus a `polarity` field; the
  verifier checks the assertive form; `applyPolarity()` maps the verdict back onto what
  the speaker said (denies flips True↔False, only True/False ever flip). Any malformed
  polarity value → `conflict: true`, and conflicted cards are held for a human.
- **Negation tripwire** — in `api/extract.js` (R46, the FS-8 closure): when the extractor
  says `denies` but the utterance contains no negation token, the flip is suspect — the
  polarity is rewritten to a value `applyPolarity` treats as conflict, so the verdict
  never silently inverts. Replay evidence: it catches exactly the FS-8 card with zero
  false positives across four field sessions (`test/field-replay.test.js`).
- **Harm classes** — the extractor also emits `harm_class`; person-class cards render
  manual-only and never arm auto-air (36/36 correct in the 08-08 field test), and
  `person_claims` is a structural NEVER in the calibration gate regardless of score
  (Decision D4, hardcoded in `eval/report.js`).

## The state channel and the capability model

`/control` (producer) and `/overlay` (OBS Browser Source) run in separate browser
processes, bridged per-room through [`api/onair.js`](../api/onair.js) and the active
StateChannel adapter. The trust model is capability URLs, not accounts:

- **Rooms are TOFU**: the first writer registers the room's `writeKey` (atomic `SET NX EX`
  in the adapter — two racing first-writers can't both win). Matching key → write;
  mismatch → 403. Room ids and keys are the credentials; treat the URLs as passwords.
- **Reads are deliberately asymmetric.** The overlay GET (current card) is open; the aired
  log (`?log=1`) is public with CORS — it's the receipts surface, accountability by
  design. The *unaired* queue and command list are writeKey-gated, and those reads travel
  as POST body ops (`queue-read` / `cmds-read`) specifically so capability keys never land
  in access logs or browser history (red-team N1 — the old query-string GETs return 410).
- **Dot-prefixed internal rooms.** The operator bridge stores its queue snapshot and
  command log under `q.<room>` / `cmd.<room>`. `.` is outside the public room-id charset,
  so internal rooms can never be claimed, written, or read through the public surface.
- **Render-ack** (`op:"rendered"`) — the overlay reports "I actually painted this card,"
  so `/op` can distinguish *server accepted* from *pixels on the program feed* (8 cards
  once silently missed broadcast while the phone said success — FS-2). It's
  unauthenticated by design: the overlay holds no writeKey, and the gate is the
  server-minted aired id itself, with cosmetic-only stakes on a spoof.

The interface's `seq` edge-trigger and resume-on-connect semantics are load-bearing —
read `api/onair.js` and `overlay.js` before building a state adapter.

## Two deployment shapes, one `api/`

- **Self-host** ([`src/server/index.js`](../src/server/index.js)): one dependency-free
  Node process. It parses `.env.local`/`.env` itself, defaults `FOOTNOTE_STATE=memory`,
  discovers `api/*.js` routes through a small Vercel-handler shim, and mirrors
  `vercel.json`'s rewrites (`/control`, `/overlay`, `/op`, `/receipts`). Loopback bind by
  default.
- **Vercel serverless**: the same `api/*.js` files run as functions. Functions are
  request-scoped, so the state channel must be external (Upstash Redis REST) and the
  overlay polls rather than subscribes — which is why the StateChannel interface marks
  `subscribe()` optional and poll adapters throw on it.

Rate limiting (`api/_ratelimit.js`) and the room/day caps fail **open** without Redis —
correct for a keyless localhost, worth knowing before you expose a storeless server.

## Where tests live, and the mirror-block pattern

- `npm test` runs `node --test "test/**/*.test.js"` — registry guards, editorial
  regressions (every red-team closure is pinned), credentials ban, spendgate, op-command
  races, field replays.
- What unit tests can't reach: `app.js` (the control page) is a classic browser IIFE wired
  to live DOM and timers. Its acceptance harness is
  [e2e-scenarios.md](./e2e-scenarios.md) — exact, dated, re-runnable browser recipes.
- **The mirror-block pattern:** because `app.js` is a classic script, it cannot import ESM
  core modules, so logic both sides need exists twice — once in core (the editing
  surface), once mirrored in `app.js` — with a test that byte-compares the marked blocks
  and fails on drift. Examples: `src/core/utterance.js` (dedupe/merge guards) ↔ app.js,
  pinned by `test/utterance-sync.test.js`; the extractor prompt file ↔ its adapter
  fallback, pinned by `test/prompt-sync.test.js`; `AUTO_AIR_CONF_FLOOR` in
  `src/core/tunables.js` is mirrored as a bare `0.85` in app.js with a change-both-together
  comment. If you touch one side of a mirror, the suite tells you about the other.
