# Security

Footnote puts words on people's live video. That makes some bugs here worse than the usual web-app bug: an attacker who can air a card to someone else's stream has effectively hijacked their broadcast. Please treat anything in that neighborhood as security-sensitive, even if it looks like a small logic issue.

## Reporting

Use GitHub's private vulnerability reporting on this repo: **Security tab → Report a vulnerability**. That keeps the details between us until there's a fix.

Please don't open a public issue for anything exploitable. If you're not sure whether something counts, report it privately anyway — worst case it gets moved to a regular issue.

## What counts as security-sensitive here

Roughly in order of how bad it would be:

1. **Airing to a stream you don't control.** Rooms are capability URLs gated by a per-room write key (TOFU — first writer registers it; see `api/onair.js`). Anything that lets a third party publish a card, run operator commands, or read the unaired queue without the room's write key is the worst-case bug for this project. This is the crown jewel: the whole point of the operator gate is that a human chose what airs, and a bypass puts someone else's words on someone's face, live.
2. **The spend gates and kill switch.** Every costed route checks the global kill flag first (`src/core/spendgate.js`, set/cleared via `api/admin.js`). A way to spend through the gate while it's engaged, flip it without `ADMIN_TOKEN`, or otherwise burn a host's API budget is a real vulnerability — this is BYOK and every check is real money.
3. **BYOK key storage and handling.** Users can store their own vendor keys per room (`op:"keys"` on `api/onair.js`), and adapters take credentials as per-call arguments by contract. Anything that leaks a stored key to a reader, ships a server key to the client, or lets one room read another room's keys.
4. **The overlay as an injection target.** Live speech is adversarial input and the card crosses a state channel into a browser source composited onto a broadcast. The pipeline strips control/zero-width/bidi characters and the overlay renders via `textContent` — a way around that (script execution in the overlay, invisible characters surviving to the chyron) is in scope.

Out of scope: rate-limit tuning on a self-hosted instance, the documented fail-open behavior when Redis is absent (a keyless local setup runs ungated on purpose), and vulnerabilities in the upstream vendors themselves.

## What to expect

Solo maintainer, and a journalist before a security team — I'll acknowledge within a few days, not hours, and fixes land on the same schedule as everything else here: between shoots. Anything in category 1 or 2 jumps the queue. If it's actively being exploited against the hosted instance, say so in the report; the kill switch exists for exactly that.

## Past disclosures

- **2026-08-12 — self-host kill switch was fail-open without a configured store.** Before `d3b2a19`, `/api/admin` on a Redis-less self-host reported kills as successful while the spend gate ignored the flag — a silent no-op (category 2 above; found by our own pre-pilot arming checklist, no report of exploitation). Fixed via an in-process fallback; admin responses now carry `mode` so you can see which regime you're in. If you self-host with `ADMIN_TOKEN` set and no Redis, upgrade. Details in [CHANGELOG.md](./CHANGELOG.md).
