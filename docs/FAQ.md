# FAQ

Straight answers, sourced from the [receipts](./README.md). Where a number appears, the
document it was measured in is linked.

## Is this free?

The software is — MIT, no dependencies, no build step. The vendors it calls are not:
Footnote is BYOK, and your Deepgram, Anthropic, and Perplexity keys get billed directly.
Realistic numbers: verification dominates at **~1.5¢ per verified claim** (bench: ~$2–3
for ~180 sonar-pro verifies — [LATENCY_LEDGER.md](./LATENCY_LEDGER.md)); a real 35-minute
conversation ran 51 verifies ([field report](./FIELD_TEST_2026-08-08.md)); extraction and
STT are small next to that. The [root README](../README.md) estimates **$0.50–1.00 per
active streaming hour** depending on how talkative the stream is.

## Can I just use your instance?

No. `footnote-live.vercel.app` is the maintainer's own deployment — it runs on the
maintainer's keys, with per-room daily verdict caps and a global kill switch, because
that's what responsible spending of one person's API budget looks like. That model
doesn't scale: hosted-for-everyone means someone else's key spends on your stream and
someone else's editorial deployment airs to your audience — the wrong trust shape in both
directions. Running your own is genuinely fast: clone, paste three keys, `npm start` —
about five minutes if the key signups go smoothly. [SELF_HOSTING.md](./SELF_HOSTING.md)
is the walkthrough.

## Does it work on Twitch / TikTok / YouTube / Kick / …?

Yes, in the only sense that matters: Footnote never talks to a platform. The overlay is a
transparent web page — anything that can composite an OBS Browser Source (or a Moblin
Browser widget on a phone) over video can air it, and whatever you restream that program
feed to gets the cards. It's aspect-aware too: give it a portrait viewport and it renders
a vertical card sized for phone screens ([README](../README.md), [OBS_SETUP.md](../OBS_SETUP.md)).

## How accurate is it?

The public record, from the [ledger](./LATENCY_LEDGER.md): **4 sessions · 102 checks ·
1 wrong-verdict card aired (FS-8, closed by the negation tripwire) · 1 display-incoherent
pairing (FS-1, closed by D17).** Under measurement, the verifier is an **~85–94%
instrument at the auto-air confidence floor** against a 95% bar — measured on a
deliberately unfriendly 260-case golden set, not a friendly demo diet
([calibration run #2](./CALIBRATION_REPORT_2_2026-08-07.md)). That gap is why the veto
window matters. Full evidence: the [calibration reports](./README.md#calibration--why-auto-air-is-off)
and [field reports](./README.md#field-reports). No number in this paragraph is marketing.

## Can it run fully automatic?

Yes — in one of two modes, both honest about what they are (Decision D19,
[HOW_FOOTNOTE_DECIDES.md](../HOW_FOOTNOTE_DECIDES.md) §5). **VERIFIED** (the default)
is earned autonomy: the calibrated category only, two independent verifiers agreeing,
evidence rules, a session cap — what the calibration record
([#1](./CALIBRATION_REPORT_2026-08-07.md), [#2](./CALIBRATION_REPORT_2_2026-08-07.md),
[#3](./CALIBRATION_REPORT_3_TWOSTEP_2026-08-09.md)) actually supports. **OPEN** airs
every settled check after a 2-second abort window — and every card wears a visible
"AI · UNVERIFIED" marker on the broadcast and the receipts, because disclosure is that
mode's honesty model. In both modes, claims about named living individuals never
auto-air (D4 — absolute), and machine airs are permanently marked in the record. For a
few days in August the gates simply came down operator-present; the repo's CHANGELOG
tells that story plainly — D19 is its deliberate resolution.

## What's the latency?

**~3.5s p50 from spoken to on-screen** on the machine path, ~5.3s worst observed —
measured end-to-end in a test-air session, and unchanged on cell infrastructure in the
street session ([LATENCY_LEDGER.md](./LATENCY_LEDGER.md)). The waterfall: STT
finalization ≤~0.6s, extraction ~0.8–1.0s, verification ~2.6–3.0s (the block, ~75% of
machine time), publish + render ~0.3s. In veto mode add the human: operator decide ran
~3–7s typical on the street, more mid-conversation. The ledger also records that every
latency shortcut bench-tested so far either cost accuracy or bought nothing, so the 3.5s
floor is what honesty currently costs.

## Why did it air a wrong card once?

On the 2026-08-10 street session, a speaker asserted a false claim; the extractor
misclassified the utterance as a *denial*, the verifier correctly found the canonical
claim False, and the polarity flip — designed for real denials — inverted that into a
TRUE card, which the operator aired. The full chain is published in the
[street field report](./FIELD_TEST_2026-08-10_STREET.md) (finding FS-8), and the closure
is deterministic, not vibes: the R46 negation tripwire treats "extractor says *denies*
but the utterance contains no negation token" as a conflict that can never silently flip
— it catches exactly that card in replay with zero false positives across all four field
sessions, and it's regression-pinned in `test/field-replay.test.js`. The prior "0 wrong
verdicts" language was retracted and amended in the record the day the card was found.
Publishing that finding next to its fix is the operating theory of the whole project:
honesty is the product.
