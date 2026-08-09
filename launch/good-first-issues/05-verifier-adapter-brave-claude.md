# Verifier adapter: Brave Search + Claude synthesis

**Labels:** good first issue, adapter, verifier

## Context

The shipping verifier is Perplexity sonar-pro (search + synthesis in one call). Prove out the pluggable-verifier story with a two-piece stack: **Brave Search API** (or Exa, if you prefer) for retrieval, **Claude** (Haiku or Sonnet) for synthesis into the card contract. Users already have an Anthropic key for claim extraction, so this drops the third vendor for anyone who'd rather run search themselves.

This is deliberately left unbuilt as the reference exercise for the adapter system — the first merged one becomes the example everyone else copies.

## Pointers

- Interface contract: `src/core/interfaces/verifier.js` <!-- landing in sprint-01: until the layout lands, `api/verify.js` is the reference implementation and defines the contract -->
- Reference adapter (copy its citation-ranking + text-cleaning shape): `src/adapters/verifier/perplexity/`
- End-to-end walkthrough: CONTRIBUTING.md → "Build a verifier adapter" — the four editorial obligations there (trust-tier the citations, source name matches the linked URL, plain text out, fail closed) are the review checklist
- Trust tiers to reuse, not reinvent: `HIGH_TRUST` / `MID_TRUST` / `LOW_TRUST_RE` / `trustTier()` in `api/verify.js`
- Brave Search API: https://brave.com/search/api/ (free tier exists) · Exa: https://exa.ai
- Eval harness: `eval/README.md` <!-- landing in sprint-01 -->

## Definition of done

- [ ] `src/adapters/verifier/brave-claude/` implementing the full contract: `{verdict, correction, confidence, source, citations}` with the five canonical verdicts
- [ ] Search results are trust-tier ranked; blocklisted domains never surfaced as the source; displayed source name derived from the linked citation's domain
- [ ] Correction is one plain-text sentence ≤240 chars (markdown/citation markers stripped)
- [ ] Backend errors return `Unverifiable` + low confidence (fail closed), never a fabricated verdict
- [ ] New env vars documented in `.env.example`; adapter selectable via the standard mechanism; zero new runtime deps (plain `fetch`)
- [ ] Golden-set harness run result pasted in the PR, compared side-by-side with the Perplexity reference adapter
