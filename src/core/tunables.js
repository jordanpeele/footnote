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

/* R72 (2026-08-18 operator ruling) — the auto-air gates are GONE. AUTO_AIR_CONF_FLOOR
   and PILOT_CATEGORY_ALLOWLIST (R57/D18 pilot era) are removed: when the operator enables
   the Auto-air toggle, every settled check auto-airs after the veto window. The toggle and
   the veto window are the only control points. Pilot-era history: D18_PILOT_PROTOCOL.md,
   the calibration reports, and git. */
