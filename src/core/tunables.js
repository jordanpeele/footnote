// Operational safety knobs for the HOSTED deployment. Self-hosters without Redis run
// uncapped (limits fail open, same stance as api/_ratelimit.js). All values TUNABLE —
// Coby sets them; nothing else in the code hardcodes these numbers.

// TUNABLE — max hosted verify calls per room per UTC day (BYOK rooms are exempt).
export const HOSTED_VERDICTS_PER_ROOM_PER_DAY = 50;

// TUNABLE — room lifetime: write-key registration and BYOK keys expire this many hours
// after last use. Keys are wiped by TTL, never by hand.
export const ROOM_TTL_HOURS = 48;

// TUNABLE — monthly spend ceiling (USD) for the hosted deployment; informational budget
// line for the operator/kill-switch decision, not enforced per-request.
export const MONTHLY_SPEND_CEILING_USD = 200;

// TUNABLE — minimum model-reported confidence for the auto-air gate. app.js mirrors this
// value (classic script, can't import); change BOTH together.
export const AUTO_AIR_CONF_FLOOR = 0.85;
