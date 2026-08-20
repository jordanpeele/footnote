# How Footnote Decides

Footnote puts fact-checks on live television. A machine hears a speaker, extracts claims, verifies them against sources, and proposes a verdict card. A human operator airs it, holds it, or kills it — or, when the operator enables Auto-air, the machine airs it itself after an abort window, under one of two per-room modes (Decision D19, §5).

This document is Footnote's editorial policy. It is written to be audited: every rule below is either **enforced by the running code today** or marked **[PLANNED — packet]**, meaning it is committed policy the code does not yet enforce. If you find the running system behaving differently from an unmarked rule, that is a bug — report it (see §9).

The pipeline this policy governs: Deepgram speech-to-text → Claude Haiku claim extraction (`api/extract.js`) → Perplexity sonar-pro verification with trust-tiered source ranking (`api/verify.js`) → verdict card → operator decision or mode-gated auto-air (`app.js`, D19).

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

[SHIPPED — the extractor classifies every claim (none | person_public | person_private | quote_attribution) and the queue surfaces the class as a warning chip. **D4 is ABSOLUTE (D19, 2026-08-20):** claims about named living individuals — `person_private` AND `person_public` — plus `quote_attribution` and polarity-conflicted cards **never auto-air, in any mode**. They queue for manual AIR with the ⚠ chip; no setting, mode, or flag can override, and the hold sits above the mode switch in code, test-pinned. Honest history: D4 was removed 2026-08-18 by an explicit operator instruction and restored 2026-08-20 by an explicit operator ratification with the risk named (defamation exposure on unreviewed person-verdicts) — both moves are on the public record (CHANGELOG). Field record under D4: 36/36 person-claims correctly held in the 2026-08-08 session.]

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

## 5. Auto-air — the two-mode architecture (Decision D19)

Auto-air posture is a **per-room mode**, set at /control, carried in room state, and stamped on every card, session-export entry, and receipts record. Fresh rooms — and self-hosters — **default to VERIFIED**. In both modes the toggle is off by default, every machine air runs a **2-second abort window** (renamed from "veto window": the attention data showed it is an abort affordance, not review), and every auto-aired card is flagged `autoAired: true` in the record.

**D4 is ABSOLUTE and sits above both modes** (§1): person-classed, quote-attribution, and polarity-conflicted cards never auto-air anywhere.

### VERIFIED mode (default — the earned stack)

Exactly what this document has always meant by earned autonomy, restored in full after the 8/18–8/20 excursion (see CHANGELOG):

1. Category must be **calibration-eligible** (currently `science_health` only — R57, earned in calibration run #4).
2. The **concurrence verifier must be active** — two independent arms agreeing (D16). This fails CLOSED: if the server runs a single-arm verifier, VERIFIED auto-air refuses to arm and says so. Posture is config-owned, not launch-path-owned: `npm start` and the street arming script produce identical posture, the server logs the active verifier at boot, and /control displays it (D19, closing the pilot-ledger §8 drift finding).
3. Verdict must be **definitive (True/False) with a qualifying source URL** and the `autoAirEligible` evidence floor (D5: tier-3 surfaced source or two distinct tier-≥2 citations).
4. **Session cap, default 10** (D18 semantics restored) — room-configurable downward always; raising it beyond 10 is what OPEN mode is for.

### OPEN mode (the disclosed show)

Every settled check that clears D4 airs after the abort window — no category gate, no evidence floor, no verdict restriction, no cap (the count is telemetry). In exchange, **every OPEN-mode card wears a production-grade "AI · UNVERIFIED" marker** on the broadcast graphic, mirrored on the receipts page and in the export — visually distinct from the amber TEST watermark, because OPEN is a real mode dressed honestly, not a test. OPEN exists so a desk stream or demo can run "everything airs" as a legitimate, disclosed format instead of requiring the gates to be demolished (which is what happened on 8/18 — the CHANGELOG tells that story plainly).

Known scope limit, stated rather than hidden: R51's `adversarial` hold is structural in VERIFIED (the allowlist excludes everything uncalibrated) but has **no runtime detector in OPEN** — the extractor's category set carries no adversarial class. In OPEN, the UNVERIFIED dress and the operator's abort window are the compensating controls. Ruled and accepted as-is (8/20): no classifier is being built speculatively; the trigger to revisit is the first field evidence of abuse.

### Measurement that rides along in both modes

- [Decision D3] **Calibration-scored eligibility** is computed and logged per card always; it gates only VERIFIED.
- **[Ruling R70/R71]** Correlated-prior errors are structurally invisible to concurrence (~12× correlation measured, calibration #5). For VERIFIED this is why graduations beyond `science_health` stay frozen pending the independent skeptic third arm (R67); for OPEN it quantifies the error exposure the operator accepts by choosing the mode.
- **[R53] Denial-watch**: a standing line in every session report until n≥20 clean denial auto-airs (count: 3/20). Reinstated by D19 after lapsing between 8/12 and 8/20.

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

- **No auto-aired claims about named living individuals. Ever. In any mode.** (D4-absolute, §1 and §5 — restored 2026-08-20.)
- **No verdict without a source.** A card with no citable source is Unverifiable by definition. VERIFIED auto-air additionally requires a qualifying source URL; in OPEN an Unverifiable card may air *as Unverifiable*, wearing the AI·UNVERIFIED marker.
- **No medical or legal advice.** Footnote may check a factual claim in those domains against qualifying sources (mortality statistics, what a statute says). It never frames a verdict as guidance about what a viewer should do.
- **No silent memory-holing.** Aired means logged; wrong means corrected on air (§6), not deleted.
- **The human abort is load-bearing, not decorative.** The operator is part of the trust architecture: with Auto-air off, a human disposes of every card; in OPEN mode the abort window plus the UNVERIFIED disclosure are the checks; in VERIFIED the full earned chain gates the machine. Removing or shrinking the abort window, or quietly weakening a mode's gates, is a policy change under §9, not a product optimization.

## 9. Challenging a verdict or changing this policy

- **Wrong verdict on a live stream:** the operator pulls the card and airs a correction per §6.
- **Wrong verdict after the fact:** open an issue citing the session-log entry (or receipts URL, once shipped) and the sourcing that contradicts it.
- **Changing this policy:** this file is the standard the code is audited against, so it changes by pull request against this file, and those PRs get standards-editor scrutiny — the burden is on the change to show it makes Footnote more accurate or more accountable, not merely faster or more exciting. Process details are in [CONTRIBUTING.md](CONTRIBUTING.md).

Code that diverges from an unmarked rule in this document is wrong, even if it works.
