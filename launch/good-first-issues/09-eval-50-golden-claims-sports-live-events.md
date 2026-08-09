# Eval: 50 golden claims — sports & live events

**Labels:** good first issue, eval

## Context

The golden set skews toward news/politics/econ — the claims Footnote grew up on. Its weakest documented category is **sports and live events**: records that change week to week, stats that differ by source and cutoff date, "greatest of all time" claims that are really Needs Context, and just-happened results that verification backends may not have indexed yet. Sports streams are also exactly where live fact-checking gets used casually.

This issue: 50 new golden claims in that category, with expected verdicts, so every verifier adapter gets scored on it.

## Pointers

- Golden set format + how claims are reviewed: `eval/README.md` <!-- landing in sprint-01: packet P1-D defines the exact schema; match it when it lands -->
- Verdict definitions (what makes something Misleading vs Needs Context vs Unverifiable): `HOW_FOOTNOTE_DECIDES.md` <!-- landing in sprint-01 -->
- Claim shape: atomic, self-contained declarative sentences — the same shape `api/extract.js` produces (read its system prompt)
- Run the harness against the reference verifier and include the scores

## Definition of done

- [ ] 50 claims in the golden-set schema, tagged `sports-live-events`
- [ ] Verdict mix: all five verdict classes represented; at least 10 non-True/False (the hard ones are the point)
- [ ] Difficulty mix: include stale-record traps ("the transfer fee record is X"), source-disagreement cases, and at least 5 claims whose truth changed in the last 12 months
- [ ] Each claim has expected verdict + a one-line rationale + at least one authoritative source URL a human can check
- [ ] No claims about in-progress events (goldens must have a stable ground truth at review time)
- [ ] Harness run against the reference verifier included in the PR, with a sentence or two on where it stumbled
