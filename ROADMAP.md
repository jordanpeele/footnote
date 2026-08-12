# Roadmap

Footnote is a live, human-in-the-loop fact-checker built in public. This is where
it's going. It's honest about what's weak today — the same way [the record](./README.md#the-record-so-far)
is honest about the one wrong card we've aired. Nothing here is a promise with a
date; it's the order we think the problems should fall.

Want to pick something up? Many of these have a [good first issue](https://github.com/jordanpeele/footnote/labels/good%20first%20issue)
attached, and [CONTRIBUTING](./CONTRIBUTING.md) has the review bar. The fastest way
to understand any of it is `npm run demo`.

## How this is sequenced

Two rules order the work:

1. **Fix what misleads the human before adding features.** Anything that gives the
   operator a false signal, or hands a self-hoster a sharp edge, comes first.
2. **The eval set is the critical path.** We don't ship accuracy claims we can't
   measure. Growing and adjudicating the golden set gates most of the accuracy
   work — so it runs continuously underneath everything else.

Independent tracks run in parallel; the accuracy work waits on the eval spine.

---

## Now — honesty & instrumentation

Small, safe, and overdue. These make the tool tell the operator the truth about
its own state and start capturing the data everything downstream needs.

- **Trust the number, or don't show it.** Verifier confidence currently reads
  0.97–0.99 on almost everything — [our calibration work](./docs/CALIBRATION_REPORT_2_2026-08-07.md)
  showed the number is saturated and doesn't discriminate. Until it's calibrated
  (see *Next*), the operator surface should bucket or hide it rather than imply a
  precision it doesn't have.
- **Label the skips.** Every time an operator vetoes a card, that's a labeled
  judgment we currently throw away. A one-tap reason turns it into training data
  for the eval set and future autonomy work.
- **Honest self-hosting numbers.** Publish real latency for the hosted (serverless)
  path — it differs from the single-process numbers in the [latency ledger](./docs/LATENCY_LEDGER.md)
  and self-hosters deserve to know what they'll actually see.
- **Self-hosting safety.** Harden the default posture and documentation so a
  bring-your-own-keys self-hoster can't accidentally expose their own spend. See
  [SECURITY.md](./SECURITY.md) for the current model.

## Now — speaker attribution

The highest-value editorial improvement for the street/interview format. Today a
card doesn't record **who** made a claim — fine for a solo monologue, not fine when
two people are in frame and a verdict could implicitly attach to the wrong person.
Speaker diarization (already available from the STT provider, currently unused)
lets a card know whose claim it's checking, and lets [the display rules](./HOW_FOOTNOTE_DECIDES.md)
show the right person's framing. This is the difference between a tool you can
point at a conversation and one you can only point at yourself.

## Next — the accuracy engine

This is where verdict quality actually improves. It waits on a larger, adjudicated
[golden set](./eval/README.md) so every change is measured, not vibed.

- **A second opinion.** Today every verdict is one search provider's answer. Two
  independent verifiers that must *agree* to air (and fall back to "Needs Context"
  when they don't) is the credible path past the accuracy ceiling a single
  verifier hits — see [the two-step experiment](./docs/VERIFY_TWOSTEP.md) for why
  parameter-tuning alone didn't move it. A second verifier adapter
  ([good first issue](https://github.com/jordanpeele/footnote/labels/verifier))
  is the first half of this.
- **Calibrated confidence.** Make the confidence number *mean* something by scaling
  it against real golden outcomes — then it can drive the operator surface and,
  eventually, autonomy.
- **The correction line, tested.** The correction ("here's the accurate figure") is
  the most-read text on the card and currently isn't scored separately from the
  verdict. It gets its own eval slice.
- **Polarity, measured.** The one wrong card we've aired came from a polarity
  misclassification (a claim's affirmation/denial read backwards). We closed that
  specific class with a [deterministic tripwire](./docs/security/) family
  ([R48, issue #10](https://github.com/jordanpeele/footnote/issues/10)); the
  general fix is measuring polarity as its own eval dimension.

## Next — robustness

Live speech is adversarial input by design. So far the pipeline has been tested on
cooperative speakers; it needs a structured pass with an uncooperative one, and the
deterministic-consistency checks ([the tripwire family](https://github.com/jordanpeele/footnote/issues/10))
extended from what that surfaces. Related: characterizing behavior under bursts
(several claims in a few seconds), which the current latency numbers don't cover.

## Later — latency & operator experience

The machine pipeline is ~3.5s and largely vendor-bound (see the ledger). The bigger
real-world latency is the operator's decision time, so the leverage is in the
operator UX: reading the card while it's still verifying, ordering the queue for the
thumb, one-tap airing for the clearest cases. The overlay's transport and the
merge-recovery path also have measured headroom.

## Later — trust infrastructure

- **Durable receipts.** [The public record](./docs/) of what aired currently expires
  on a rolling window. For an accountability tool, the receipts should outlive the
  stream — a permanent per-session record.
- **Hosted observability.** A status surface for a hosted instance's spend and
  kill-switch state.
- **Gate integrity in CI.** Make it structurally hard for a change to weaken an
  editorial gate without it being obvious in review.

## The endgame — earned autonomy

Auto-air (the tool airing high-confidence checks without a human thumb) stayed
**off** through three calibration runs because it hadn't earned it on the evidence —
[that story is a feature, not a bug](./HOW_FOOTNOTE_DECIDES.md). Then it started
earning it, the way this section said it would have to: calibration #4 produced the
first eligible categories, [two-verifier concurrence](./docs/R49_CONCURRENCE_REPORT_2026-08-12.md)
held at 100% on science/health, an independent polarity guard closed the last known
wrong-card class, and on 2026-08-12 the [first supervised pilot session](./docs/D18_PILOT_FIELD_REPORT_2026-08-12.md)
machine-aired 10 cards with zero wrong and every refusal gate firing on cue.

The current state is deliberately narrow: **one category, operator present, live
4-second veto, 10 per session, machine-aired cards permanently marked** — a
[written protocol](./docs/D18_PILOT_PROTOCOL.md) with abort criteria, not a switch
someone flipped. Autonomy stays a documented decision per category, expanded only by
the same evidence path and revocable the same way (one wrong machine-aired card ends
the pilot). Everything outside the pilot's scope: a human airs every card.

---

*This roadmap is directional and community-shaped — open an [issue](https://github.com/jordanpeele/footnote/issues)
or a [discussion](https://github.com/jordanpeele/footnote/discussions) to argue with
the ordering or claim a piece.*
