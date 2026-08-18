# How Footnote Decides

Footnote puts fact-checks on live television. A machine hears a speaker, extracts claims, verifies them against sources, and proposes a verdict card. A human operator airs it, holds it, or kills it — or, when the operator enables Auto-air, the machine airs it itself after a veto window (Ruling R72, §5).

This document is Footnote's editorial policy. It is written to be audited: every rule below is either **enforced by the running code today** or marked **[PLANNED — packet]**, meaning it is committed policy the code does not yet enforce. If you find the running system behaving differently from an unmarked rule, that is a bug — report it (see §9).

The pipeline this policy governs: Deepgram speech-to-text → Claude Haiku claim extraction (`api/extract.js`) → Perplexity sonar-pro verification with trust-tiered source ranking (`api/verify.js`) → verdict card → operator decision or toggle-gated auto-air (`app.js`).

---

## 1. What counts as a checkable claim

Footnote checks **atomic, factual, falsifiable, third-party-verifiable** assertions. One claim per card. A claim is checkable if a competent researcher with access to authoritative sources could confirm or refute it — statistics, dates, historical events, attributions and quotes, quantities, and qualitative/comparative factual assertions ("crime is up this year," "the Nile is the longest river").

Footnote does **not** check:

- **Opinion and preference** — "this policy is a disgrace."
- **Predictions** — claims about the future are not falsifiable yet.
- **Hyperbole and rhetoric** — "a million times better." Obvious figurative speech is not a claim.
- **Personal experience** — "I grew up poor." First-person testimony is not third-party-verifiable in real time.
- **Too-vague** — assertions with no determinable referent ("people are saying," "things are worse").

The extraction prompt in `api/extract.js` enforces the opinion/question/filler rejections today. The prompt is deliberately recall-biased — "when in doubt, EXTRACT" — because a missed lie is worse than a discarded card downstream. Prediction, hyperbole, and vagueness are currently filtered by a mix of the extraction prompt's "checkable" framing and the verifier returning Unverifiable; they are not named reject classes in the prompt. [PLANNED — P1-B: explicit reject-class taxonomy in the extraction stage.]

### Harm classes

Some claims are checkable but carry elevated harm if the machine gets them wrong. These are flagged at extraction and change how the rest of the pipeline may treat the card:

- **`person_private`** — a claim about a named private individual (not a public figure acting in public capacity). Accusations of crime, claims about health status, and claims about minors default to `person_private` treatment.

[SHIPPED — the extractor classifies every claim (none | person_public | person_private | quote_attribution) and the queue surfaces the class as a warning chip. **Superseded by R72 (2026-08-18, operator ruling):** the D4 rule that person-classed and polarity-conflicted cards NEVER auto-air is removed — with Auto-air enabled, these cards air after the veto window like any other; the chip exists so the operator can veto them in that window. Historical field record under D4: 36/36 person-claims correctly held to manual in the 2026-08-08 session.]

## 2. Source hierarchy

Policy recognizes four tiers:

- **T1 — Primary records.** Government data and documents (.gov/.mil), court records, official transcripts, primary statistical agencies (BLS, Census, BEA, Federal Reserve), intergovernmental bodies (WHO, UN, World Bank, IMF, OECD).
- **T2 — Wire services.** AP, Reuters. Institutions whose business is being right first, with public corrections practices.
- **T3 — Established outlets and fact-checkers with public corrections policies.** National newspapers and broadcasters (NYT, WSJ, Washington Post, BBC, NPR, PBS, network news), established fact-checkers (PolitiFact, FactCheck.org, Snopes), peer-reviewed science, major reference works.
- **T4 — Everything else.** Unknown domains, regional outlets not on the list, advocacy sites, encyclopedic aggregators. T4 sourcing is **insufficient for a definitive verdict** on its own.

Never citable as a surfaced source: social platforms, forums, personal blogs, SEO/commerce pages (Reddit, Quora, X/Twitter, Facebook, Instagram, TikTok, YouTube, Pinterest, Medium, wikiHow, Blogspot, WordPress, Substack, Tumblr).

**What the code enforces today** (`api/verify.js`) is a coarser three-tier ranking:

- Code tier 3 (`HIGH_TRUST` + any .gov/.mil domain) merges policy T1, T2, and most of T3 into one bucket — Reuters, AP, the BBC, the NYT, PolitiFact, Britannica, Nature, WHO, and all government domains rank equally.
- Code tier 2 (`MID_TRUST`) is a small named set (Wikipedia, Investopedia, CNBC, Business Insider, Vox, The Hill, Newsweek, Mayo Clinic, WebMD, and others) — roughly policy T3-adjacent and upper T4.
- Code tier 1 is any unknown, non-blocklisted domain — policy T4.
- Code tier 0 is the blocklist (`LOW_TRUST_RE`), dropped entirely; the ten most common low-trust domains are additionally excluded from the web search itself via `search_domain_filter` (Perplexity caps the filter at ten entries).

Enforcement is threefold and real: the search filter, a system prompt demanding wire/gov/major-outlet sourcing, and server-side ranking so the surfaced source is always the highest-tier citation returned — and its displayed name is always derived from the linked domain, so the card never shows an outlet it isn't actually citing.

**The delta:** the shipped code cannot distinguish a primary document from a newspaper story about it, so the policy distinction between T1/T2 and T3 exists in this document and in the verifier's prompt, not in the ranking. [PLANNED — P1-B: split code tier 3 into the four policy tiers and expose the tier on every citation.]

## 3. Verdict–evidence rules

- **True / False** (the definitive verdicts) require **T1–T2 sourcing, or two independent T3 sources**. Independent means separately reported, not two outlets rewriting the same wire story.
- **Misleading / NeedsContext** may rest on T3 sourcing.
- **Unverifiable is the honest default.** If sourcing is thin, contested, or the claim outruns the evidence, the verdict is Unverifiable — not a low-confidence guess.

What's enforced today: the verifier's system prompt instructs the model to verify only against high-trust sources, and the server defaults any malformed or out-of-enum verdict to **Unverifiable** (`api/verify.js`). The evidence-floor rules above are **prompt-enforced only** — nothing in the code today checks that a True verdict actually carries T1–T2 citations before it reaches the queue. [PLANNED — P1-B: structural enforcement — downgrade True/False to Unverifiable server-side when the citation set doesn't meet the floor.]

## 4. The five verdicts

- **True** — the claim, as stated, is supported by qualifying sources. Asserts the specific factual assertion is accurate. Does not endorse the speaker's argument, framing, or conclusion.
- **False** — the claim, as stated, is contradicted by qualifying sources. The card carries a one-line correction with the accurate figure or fact. Does not assert the speaker lied — only that the statement is wrong.
- **Misleading** — the claim contains true elements deployed to create a false impression (cherry-picked baseline, misattributed cause, technically-true framing). Asserts the impression is wrong even where the numbers aren't.
- **NeedsContext** — the claim is true or partially true but materially incomplete without additional facts the card supplies. Weaker than Misleading: it does not assert intent to deceive or a false impression, only that the statement alone would misinform.
- **Unverifiable** — Footnote could not confirm or refute the claim against qualifying sources in real time. Asserts nothing about the claim's truth. An Unverifiable verdict is not a soft "False" and must never be presented as one.

These five are the entire enum; the server rejects anything else (`VERDICTS` in `api/verify.js`).

## 5. Auto-air

**[Ruling R72 — 2026-08-18, operator ruling]** Auto-air is off by default and operator-enabled per session. When enabled, **the toggle is the whole gate**: every settled check auto-airs after a **2-second veto window** — the card sits in the queue with a visible countdown; the operator's Skip or Hold cancels the timer. Only a card still untouched after 2 seconds airs itself.

There is no verdict restriction, no confidence floor, no source requirement, no category allowlist, no harm-class hold, and no per-session cap. R72 supersedes the pilot-era gate chain (the definitive-verdict/confidence/source conditions below the fold in git history, the D4 person-hold, the D5 evidence-tier floor, the R57 category allowlist, and the D18 10-per-session cap). The operator's veto window — and the decision to enable the toggle at all — are the only checks between the machine and the air.

Every auto-aired card is flagged `autoAired: true` in the session log — the record always distinguishes machine airing from human airing. Harm-class and polarity-conflict chips still render on every card so the operator can spot sensitive checks inside the veto window.

Honesty note: this makes the operator's attention load-bearing in a way the pilot-era gates deliberately avoided. The measurement machinery below still runs and is still logged; under R72 it informs the operator rather than gating the machine:

- [Decision D3 — measurement only under R72] **Calibration-scored eligibility.** Per-category precision is measured against the adjudicated golden set (`eval/`) and `autoAirEligible` is still computed server-side and logged per card. Under R72 it no longer gates airing.
- [Decision D4 — **SUPERSEDED by R72**] The permanent `person_private` carve-out is removed. The harm class is still extracted, logged, and surfaced as a chip; it no longer holds a card from auto-air.
- **[Ruling R51 — SUPERSEDED by R72]** `adversarial` claims are no longer manual-only. The gaming-incentive concern R51 documented (a bad actor performing outrageous claims *because* the machine responds autonomously) stands as analysis; under R72 the countermeasure is the operator's veto window, not a structural hold.
- **[Decision D16/D18 — historical] Second-verifier concurrence and the supervised pilot.** The concurrence bar, the science_health-only pilot, the kill-switch arming checklist, and the 10-per-session cap were the conditions under which auto-air first went live (D18 pilot, 2026-08-12). R72 retires them as gates; the pilot write-ups remain the evidence record of how the machine performed under supervision.
- **[Ruling R70/R71 — measurement retained] Correlated-prior errors are structurally invisible to concurrence.** Measured (calibration #5, R-concurrence red-team): the two current arms' errors are ~12× more correlated than independence would predict, because both draw verdicts from the same prior-laden public web. The seven measured would-air-wrong cards cluster in `current_events / statistics / historical_events / geography`. Under R72 there is no graduation ladder left for R71 to freeze — this finding now quantifies the *error exposure the operator accepts* when enabling Auto-air, and it is the standing argument for the independent skeptic third arm (R67).

## 6. Corrections (Decision D6)

When Footnote airs a wrong verdict, the correction goes **on air** the same way the error did:

- A correction is a **first-class card type**, visually distinct from a verdict card, stating what was aired, what was wrong, and what is right.
- Corrections are **appended** to the session log. An aired verdict is never silently edited, mutated, or deleted — the original entry stands, the correction stands next to it.
- The public receipts page (§7) shows both.

[PLANNED — P1-G: the correction card type and receipts page do not exist in the shipped code. Today a correction means the operator pulls the card and the pull is timestamped in the log (`markPulled`); the append-only commitment is policy binding on all future implementation.]

## 7. Session log and receipts

Every checked claim produces a log entry — not just aired ones. Shipped today (`SESSION` in `app.js`): each entry records the raw spoken text, the extracted claim, verdict, confidence, correction, source and full citation list, the disposition (**aired / held / skipped / error / pending**), whether airing was **auto or human**, and timestamps for check, air, and pull. The operator can download the full session as JSON at any time. Aired cards are additionally mirrored server-side per stream room (`api/onair.js`) as a durability backstop that survives a control-surface crash — currently capped at 500 entries with a 7-day retention.

The commitment: **every stream gets a public receipts URL** — the complete session log, published, so anyone can audit what Footnote checked, what it aired, what it refused to air, and on what sourcing. [PLANNED — P1-G: public receipts page, plus server-side retention extended to match the permanence the corrections policy requires; 7-day/500-entry retention is a backstop, not an archive, and does not yet satisfy §6.]

## 8. What Footnote does not do

- **No verdict without a source.** A card with no citable source is Unverifiable by definition. (The pre-R72 rule that auto-air additionally required a source URL is gone — an Unverifiable, sourceless card auto-airs as Unverifiable when the toggle is on.)
- **No medical or legal advice.** Footnote may check a factual claim in those domains against qualifying sources (mortality statistics, what a statute says). It never frames a verdict as guidance about what a viewer should do.
- **No silent memory-holing.** Aired means logged; wrong means corrected on air (§6), not deleted.
- **The human veto is load-bearing, not decorative.** The operator is part of the trust architecture: with Auto-air off, a human disposes of every card; with it on (R72), the human's veto window is the only check on the machine. Removing or shrinking the veto window itself is a policy change under §9, not a product optimization.

## 9. Challenging a verdict or changing this policy

- **Wrong verdict on a live stream:** the operator pulls the card and airs a correction per §6.
- **Wrong verdict after the fact:** open an issue citing the session-log entry (or receipts URL, once shipped) and the sourcing that contradicts it.
- **Changing this policy:** this file is the standard the code is audited against, so it changes by pull request against this file, and those PRs get standards-editor scrutiny — the burden is on the change to show it makes Footnote more accurate or more accountable, not merely faster or more exciting. Process details are in [CONTRIBUTING.md](CONTRIBUTING.md).

Code that diverges from an unmarked rule in this document is wrong, even if it works.
