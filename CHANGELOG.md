# Changelog

Notable changes, security-relevant ones first-class. Starts 2026-08-12; earlier
history is in the commit log and the decision records (`docs/DECISIONS.md`).

## 2026-08-18

- **Extraction — prompt v4: multi-claim windows (rapid-fire speech).** The v3
  single-claim contract silently dropped all but one claim when a transcript
  window carried several ("a million Haitian immigrants move to the UK every
  year" was lost to a neighboring claim sharing its window, desk session
  2026-08-18). The extractor now returns `{"claims":[...]}` — up to 4 per
  window, parser-enforced — and every layer (route, control client, stream
  simulator) runs its per-claim gates on each: grounding, R46 negation
  tripwire, F2 dedupe, and one card/verify per claim. Response and adapter
  shapes stay back-compatible: legacy top-level fields mirror the first
  surviving claim, and a model regression to the single-claim envelope wraps
  instead of dropping. Per-claim polarity/harm_class/category rules unchanged.
- **Auto-air veto window: 4s → 2s.** The pipeline floor is ~3.8s spoken→pending,
  so the veto was half the perceived talk→air latency.
- **Editorial — Ruling R72: the Auto-air toggle is now the whole gate.** Operator
  ruling, explicit and on the record. With Auto-air enabled, every settled check
  auto-airs after the veto window (2s, shortened from 4s the same day — the pipeline floor is ~3.8s, so the veto was half the talk-to-air latency) — the pilot-era gate chain is removed:
  no definitive-verdict/confidence/source conditions, no D5 evidence-tier floor,
  no R57 category allowlist, no D18 10-per-session cap, and the D4 person-hold and
  R51 adversarial hold are superseded. Harm-class and polarity-conflict chips still
  render (operator information for the veto window), `autoAirEligible` and category
  are still computed and logged (measurement, not gating), and every machine-aired
  card remains permanently flagged `autoAired: true`. The tripwire tests that
  pinned the old gates now pin the new rule — reintroducing a gate is itself an
  edit the suite catches. Policy text updated in `HOW_FOOTNOTE_DECIDES.md` §1/§5/§8;
  pilot-era protocol and calibration docs stand as the historical evidence record.

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
