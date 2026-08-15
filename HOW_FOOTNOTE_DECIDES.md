# How Footnote Decides

Footnote puts fact-checks on live television. A machine hears a speaker, extracts claims, verifies them against sources, and proposes a verdict card. A human operator airs it, holds it, or kills it — or, under narrow conditions, the machine airs it itself after a veto window.

This document is Footnote's editorial policy. It is written to be audited: every rule below is either **enforced by the running code today** or marked **[PLANNED — packet]**, meaning it is committed policy the code does not yet enforce. If you find the running system behaving differently from an unmarked rule, that is a bug — report it (see §9).

The pipeline this policy governs: Deepgram speech-to-text → Claude Haiku claim extraction (`api/extract.js`) → Perplexity sonar-pro verification with trust-tiered source ranking (`api/verify.js`) → verdict card → operator decision or gated auto-air (`app.js`).

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

- **`person_private`** — a claim about a named private individual (not a public figure acting in public capacity). These cards **never auto-air**, at any confidence, under any future calibration regime. A human airs them or nobody does. This is a permanent carve-out (Decision D4), not a threshold to be tuned.
- Accusations of crime, claims about health status, and claims about minors default to `person_private` treatment.

[SHIPPED — the extractor classifies every claim (none | person_public | person_private | quote_attribution); person_private and polarity-conflicted checks are hardcoded NEVER-auto-air (D4 — no setting can override), person_public and quote_attribution are manual-only, and /op surfaces the class as a MANUAL tag. Field record: 36/36 person-claims correctly held to manual in the 2026-08-08 session.]

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

Auto-air is off by default and operator-enabled per session. When enabled, the shipped gate (`maybeAutoAir` in `app.js`) is:

1. Verdict is **True or False** — definitive verdicts only. Misleading, NeedsContext, and Unverifiable never auto-air.
2. **Confidence ≥ 0.85.**
3. A **source URL is present** on the card.
4. A **4-second veto window**: the card sits in the queue with a visible countdown; the operator's Skip or Hold cancels the timer. Only a card still untouched after 4 seconds airs itself.

Every auto-aired card is flagged `autoAired: true` in the session log — the record always distinguishes machine airing from human airing.

Known honesty note on the shipped gate: the confidence number is the verification model's self-report, not a calibrated probability, and the gate checks that a source URL exists but not its tier — a code-tier-1 (unknown-domain) source currently satisfies condition 3. Both gaps are why the gate is conservative and the veto window exists, and both are what the following work closes:

- [SHIPPED — Decision D3] **Calibration-gated eligibility.** Auto-air eligibility is per-claim-category, earned by measured precision against the adjudicated golden set (`eval/`). Four calibration runs have been published; the first two categories met the numeric bar in run #4 (2026-08-11). Meeting the bar is a *fact*, not a switch — enabling remains a separate, explicit decision.
- [SHIPPED — Decision D4] **`person_private` carve-out.** Claims about named private individuals are structurally excluded from auto-air, permanently. No calibration result unlocks them.
- **[Ruling R51] `adversarial` claims are permanently manual-only** — regardless of calibration numbers. Auto-airing verdicts on adversarial input invites gaming the fact-checker as content: a bad actor's incentive to perform outrageous claims *grows* if the machine responds autonomously. The category's calibration eligibility stands as a measurement; the policy overrides it. A human airs those cards or nobody does.
- **[Decision D16/D18 — conditions-precedent, not active] Second-verifier concurrence before any auto-air pilot.** Any enabling requires: two *independent* verification engines agreeing at ≥95% on the category (D16/R49), an independent polarity check shipped and replay-verified (R50 — the polarity field comes from the shared extractor, so verifier agreement alone cannot catch a mislabeled denial), and a completed skepticism re-read. The pilot itself (D18, `science_health` only) would be operator-present, veto-window live, kill-switch verified at session start, auto-aired cards distinctly marked on receipts, capped at 10 auto-airs per session. None of this is enabled today.
- **[Ruling R70/R71 — the honest limit of same-family concurrence] Correlated-prior errors are structurally invisible to concurrence.** Measured (calibration #5, R-concurrence red-team): the two current arms' errors are ~12× more correlated than independence would predict, because both draw verdicts from the same prior-laden public web. Concurrence catches *independent* errors (a disagreement to downgrade) but is blind to a *shared* wrong prior — both arms confidently agree on the same wrong definitive verdict, and the confidence floor cannot separate it (the mode's signature IS high, agreeing confidence). The seven measured would-air-wrong cards cluster in `current_events / statistics / historical_events / geography` — so **R71: R64-A-0d graduations beyond `science_health` are FROZEN until a genuinely independent (non-Claude-family) skeptic third arm (R67) is live and its correlation-break is measured.** `science_health` continues on its own record. A claim-shape detector (R66/R70) is scoped to the private-source *shape* only (commercial self-study, uncited authority); the shared-prior *myth* class has no linguistic tell and is explicitly OUT of detector scope — it belongs to the skeptic arm.

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

- **No auto-aired claims about private individuals.** Ever. See §1 and §5.
- **No verdict without a source.** A card with no citable source is Unverifiable by definition. Auto-air additionally requires a source URL (enforced today).
- **No medical or legal advice.** Footnote may check a factual claim in those domains against qualifying sources (mortality statistics, what a statute says). It never frames a verdict as guidance about what a viewer should do.
- **No silent memory-holing.** Aired means logged; wrong means corrected on air (§6), not deleted.
- **The human veto is load-bearing, not decorative.** The operator is part of the trust architecture: the machine proposes, and except inside the narrow §5 gate, a human disposes. Removing or shrinking the human's role is a policy change under §9, not a product optimization.

## 9. Challenging a verdict or changing this policy

- **Wrong verdict on a live stream:** the operator pulls the card and airs a correction per §6.
- **Wrong verdict after the fact:** open an issue citing the session-log entry (or receipts URL, once shipped) and the sourcing that contradicts it.
- **Changing this policy:** this file is the standard the code is audited against, so it changes by pull request against this file, and those PRs get standards-editor scrutiny — the burden is on the change to show it makes Footnote more accurate or more accountable, not merely faster or more exciting. Process details are in [CONTRIBUTING.md](CONTRIBUTING.md).

Code that diverges from an unmarked rule in this document is wrong, even if it works.
