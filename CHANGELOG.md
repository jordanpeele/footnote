# Changelog

Notable changes, security-relevant ones first-class. Starts 2026-08-12; earlier
history is in the commit log and the decision records (`docs/DECISIONS.md`).

## 2026-08-12

- **Security — self-host kill switch was fail-open (fixed in `d3b2a19`).**
  Before this commit, the global kill switch (`/api/admin`) only worked when an
  Upstash store was configured: without Redis, `op=kill` reported success but
  the flag reader in `src/core/spendgate.js` returned `false` unconditionally,
  so costed routes kept spending — a silent no-op. Hosted deployments (which
  have Redis) were never affected; keyless self-hosts were. Fixed with an
  in-process fallback: when no store is configured, kill/restore/status operate
  a process-local flag that the spend gate actually reads. Admin responses now
  carry `mode` (`"in-process"` vs the store) so you can see which regime you're
  in. **If you self-host with `ADMIN_TOKEN` set and no Redis, upgrade — your
  kill switch did nothing before this.** Found by the D18 pilot arming
  checklist, which requires a live kill/restore cycle before any auto-air
  session.
- D18 supervised auto-air pilot mechanics: 10-per-session cap, auto-aired
  cards permanently marked `AUTO · machine-aired` on receipts, pilot protocol
  in `docs/D18_PILOT_PROTOCOL.md`.
