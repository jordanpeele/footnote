# Contributing to Footnote

Thanks for being here. Footnote is small on purpose — plain ESM JavaScript, no build step, a handful of serverless functions, and a set of interfaces where the interesting contributions go. This doc covers running it, building adapters, contributing overlay skins, and the (deliberately higher) bar for editorial-policy changes.

**Where to start:**

- `npm run demo` — replays a themed session through the real surfaces, no API keys. Fastest way to understand what the product is before reading any of it.
- The [`good first issue` list](https://github.com/jordanpeele/footnote/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — each one has current file pointers and a definition of done. Claim one by commenting.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how the pipeline fits together and why the editorial layer sits above the adapters.

## Run it locally

```sh
git clone https://github.com/jordanpeele/footnote && cd footnote
cp .env.example .env      # your Deepgram (grant-capable) + Anthropic + Perplexity keys
npm start                 # http://localhost:3000/control and /overlay?room=…
```
<!-- landing in sprint-01: single-process `npm start` (packet P1-A). `npx vercel dev` also works if you prefer the serverless-emulation path. -->

Redis (Upstash REST creds) is optional locally — without it, rate limiting is off and the control→overlay bridge is limited to same-browser testing. Test hooks that don't need any keys:

- `/overlay?demo=1` — cycles sample cards so you can style without the pipeline.
- `/overlay?card=<base64 json>` — renders one specific card.
- On `/control`, type a claim instead of speaking to drive extract→verify directly.
- `?debug=1` on control opens the instrumentation panel (upstream statuses, event log).

## Tests

```sh
npm test
```

That runs `node --test "test/**/*.test.js"` — the glob form is canonical. Don't switch it to the bare-directory form (`node --test test/`); that stopped resolving nested test files on modern Node, and the glob works everywhere the `engines` field allows.

## Code style

- **Plain ESM JS. No build step.** If your change needs webpack, it needs rethinking.
- **No new runtime dependencies without discussion.** Open an issue first. The `fetch`-only pattern in `api/*.js` is deliberate — every vendor is one readable HTTP call.
- **Match the terse commented style.** Comments explain *why* (the trap, the constraint, the editorial reason), not what the line does. Read `api/verify.js` for the house voice.
- Keep payloads and prompts visible in the diff — no config indirection for one-off strings.

## Build a verifier adapter

The verifier is the most valuable thing to swap, so here's the walkthrough end-to-end. The interface lives at `src/core/interfaces/verifier.js`; the reference adapter is `src/adapters/verifier/perplexity/`. <!-- landing in sprint-01: interfaces + adapter layout (packet P0-B); until it lands, `api/verify.js` is the reference implementation and defines the contract below -->

**The contract.** A verifier takes an atomic claim string and returns the card fields:

```js
// verify(claim: string, opts) -> {
//   verdict:    "True" | "False" | "Misleading" | "Unverifiable" | "NeedsContext",
//   correction: string,          // ONE plain-text sentence, no markdown, ≤240 chars
//   confidence: number,          // 0..1
//   source:     { name, url, tier } | null,   // the single most authoritative citation
//   citations:  string[],        // all surviving citations, best first
// }
```

**The editorial obligations** (these are what reviews actually check — see `HOW_FOOTNOTE_DECIDES.md`):

1. **Trust-tier your citations.** Never surface a blocklisted domain (social, forums, personal blogs) as the source. Rank what your search returns; the aired source must be the most credible one. Reuse the tiering in the reference adapter rather than inventing your own.
2. **Source name must match the linked URL.** Derive the display name from the chosen citation's domain — never let the model name one outlet while you link another.
3. **Plain text out.** Strip markdown, `[1]` markers, code fences. The correction renders on a chyron.
4. **Fail closed.** If your backend errors or returns junk, return `Unverifiable` with low confidence — never a made-up verdict.

**Steps:**

1. Copy `src/adapters/verifier/perplexity/` to `src/adapters/verifier/<yourvendor>/` and gut the vendor call. Keep the citation-ranking and text-cleaning shape.
2. Implement the contract with your stack (e.g. Brave or Exa search + a Claude synthesis call — there's a [drafted issue](./launch/good-first-issues/05-verifier-adapter-brave-claude.md) for exactly this).
3. Wire selection: adapters are chosen by env var (e.g. `VERIFIER=perplexity`). <!-- landing in sprint-01: exact selection mechanism ships with P0-B — check src/core/interfaces/ when it lands -->
4. **Run the golden set** and put the result in your PR (see next section).

## Eval expectations

`eval/` contains a golden claim set with expected verdicts and a calibration harness. <!-- landing in sprint-01: packet P1-D; see eval/README.md when it lands -->

**Adapters ship with a golden-set run result.** A verifier PR without eval numbers won't be reviewed — not as gatekeeping, but because "seems right on the three claims I tried" is exactly the failure mode this project exists to prevent. Paste the harness output (accuracy by verdict class, calibration) into the PR description. Regressions against the reference adapter need a written argument, not just vibes.

## Other adapter domains

Same pattern, smaller contracts — copy the reference adapter, implement the interface, note in the PR how you tested:

- **STT** — `src/core/interfaces/stt.js`, reference `src/adapters/stt/deepgram/`. Contract: audio in, interim + *final* sentence events out (finals drive claim extraction). A local Whisper adapter makes fully-keyless dev possible ([drafted issue](./launch/good-first-issues/06-stt-adapter-local-whisper.md)).
- **State channel** — `src/core/interfaces/state-channel.js`, reference `src/adapters/state-channel/upstash-redis/`. Contract: per-room `publish(card, durationMs)` / `read() → {card, seq, airedAt, durationMs, serverNow}`, TOFU write key, durable aired-log append. The `seq` edge-trigger and resume-on-connect semantics are load-bearing — read `api/onair.js` + `overlay.js` before you start.

## Contribute an overlay skin

A skin is one small HTML/CSS/JS bundle that renders a card object into pixels on a transparent canvas — the pipeline doesn't care what it looks like. Interface at `src/core/interfaces/overlay-skin.js`; the broadcast lower-third at `src/adapters/overlay/broadcast/` is the reference. <!-- landing in sprint-01: P0-B layout; today the equivalent code is overlay.html/overlay.js/overlay.css -->

Ground rules for any skin:

- Render all five verdicts distinctly (True / False / Misleading / Needs Context / Unverifiable) — and **never by color alone**.
- Always show the claim, the correction, and the source name. The source is not optional decoration; it's the product.
- Transparent background, safe at 1920×1080 and 1080×1920 (portrait phones via Moblin), readable at TikTok-feed size.
- Honor the timing contract: animate in, show remaining-time (when `durationMs` is set), hold when `durationMs` is null, animate out on pull.
- Include a screenshot of each verdict rendered via `/overlay?demo=1` in your PR.

Four skin directions are pre-drafted as [good first issues](./launch/good-first-issues/).

## Editorial policy changes

`HOW_FOOTNOTE_DECIDES.md` is the spec for what's allowed to reach a screen. Changing it is changing the product's promise, so it works differently from code:

- Changes go as **PRs against `HOW_FOOTNOTE_DECIDES.md` itself**, with the reasoning in the PR body — what claim class or failure mode motivated it, and what could now air that couldn't before (or vice versa).
- These PRs get **standards-editor scrutiny and a higher review bar**: expect slower review, requests for concrete examples, and pushback. A one-line prompt tweak that widens what auto-airs is a bigger deal than a 500-line adapter.
- Code that quietly diverges from the written policy is a bug in the code, not a de facto policy change.

## Good first issues

Start with the [`good first issue` label](https://github.com/jordanpeele/footnote/issues?q=label%3A%22good+first+issue%22) — nine are pre-drafted in [`launch/good-first-issues/`](./launch/good-first-issues/), each with exact file pointers and a definition of done: four overlay skins, a verifier adapter, an STT adapter, a state-channel adapter, Spanish i18n, and an eval-set contribution. Claim one by commenting on the issue.

## What happens to your PR

So you know what you're signing up for:

- **The bar is correctness over cleverness.** Anything on the on-air path — extract, verify, editorial, state channel, overlay — is held to broadcast standard, because a bug there doesn't crash a page, it puts a wrong thing on someone's live video. Boring code that obviously does the right thing beats elegant code that probably does.
- **CI must be green.** Same `npm test` you run locally. A red check won't get reviewed, mostly because the fix is usually faster than the conversation.
- **Small PRs merge faster.** One adapter, one skin, one fix. A 200-line PR often lands the same week; a 2000-line PR sits until there's a clear afternoon, and there aren't many of those.
- **Adapters are the easiest on-ramp.** The contracts in [`src/core/interfaces/`](./src/core/interfaces/) are small, the reference adapters show the shape, and an adapter can't weaken the editorial layer — which makes them low-risk to review and quick to say yes to.
- Honest note on latency: the maintainer is a video journalist who reviews between shoots. Sometimes that's same-day, sometimes it's a week — it's not a signal about your PR. If something's sat quiet for two weeks, a bump comment is welcome and not rude.
