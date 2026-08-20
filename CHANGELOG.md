# Changelog

Notable changes, security-relevant ones first-class. Starts 2026-08-12; earlier
history is in the commit log and the decision records (`docs/DECISIONS.md`).

## 2026-08-20 (evening) — D19: the two-mode architecture

- **What happened, plainly.** On 8/18, with the operator present and instructing, the
  auto-air gates came down (R72): category allowlist, evidence floor, verdict rules,
  session cap, and the D4 person-hold all removed; the veto window was cut to 2s. Over
  two desk sessions 38 cards machine-aired under that regime — including two
  non-definitive verdicts, one tier-1-sourced card, and six polarity-conflict cards —
  with zero operator interventions. On 8/20 a full reconciliation ledger diffed every
  shipped constant against its last ruling, including which changes were explicitly
  approved and which rode along. **D19 is the deliberate resolution**: two first-class
  modes instead of one demolished gate.
- **VERIFIED (default)**: the earned stack restored — science_health allowlist,
  concurrence verifier REQUIRED (fails closed on single-arm servers; posture is
  config-owned and logged at boot, closing a drift where the launch script silently
  selected the verifier), definitive+sourced+evidence-floor rules, session cap 10.
- **OPEN**: every settled check airs after the abort window, wearing a production
  "AI · UNVERIFIED" marker on the broadcast card, receipts, and export. Disclosure is
  the model; the marker is not the TEST watermark.
- **D4 restored ABSOLUTE, both modes** (operator-ratified): person-classed,
  quote-attribution, and polarity-conflicted cards never auto-air anywhere; the hold
  sits above the mode switch, test-pinned.
- **Renames + record fixes**: "veto window" → "abort window" (2s, both modes — the
  attention data showed it is not review); session exports now persist category,
  harm_class, mode, and active verifier per entry (the reconciliation needed inference;
  the next one won't); R53 denial-watch line reinstated (count 3/20); /op shows mode +
  cap. Replay tests pin both modes against the 8/18+8/20 field sessions.

## 2026-08-20

- **Speaker attribution (W2).** Deepgram diarization (available, previously unused)
  now rides the streaming connection; every card records WHOSE claim it's checking.
  The editorial rule is conservative on purpose: a claim is attributed only when one
  speaker owns ≥80% of the run's diarized words (≥3 words) — mixed or thin runs
  attribute to nobody, because a wrong name on a broadcast graphic is worse than no
  name. Labels (S1/S2…) render on the queue, /op, the chyron kicker, and the session
  record — and only once a second speaker has actually been seen, so solo streams are
  visually unchanged. Typed claims and the chunked STT fallback stay unattributed.
- **Confidence display: bucketed by default (A-2 graduated).** Calibration measured
  the raw confidence as saturated (0.97–0.99 on nearly everything, including the one
  wrong card ever aired) — so the queue and /op now show LIKELY/UNCERTAIN instead of
  implying precision that isn't there. Raw % is one hover away and fully back via
  `?conf=raw`.
- **Skip reasons on /control (A-4 completed).** SKIP now opens the same optional
  one-tap reason row /op has (wrong-entity / dull / risky / other); the reason lands
  in the session record as `skipReason`. Also fixed: /op's phone-side reasons were
  being dropped on the control side — they now reach the record too. Every veto is
  labeled eval data.
- **Latency ledger:** honest entries for the v4 multi-claim extract cost and the
  hosted-serverless path (cold-start + vendor-caching caveats included).
- **Verify concurrency gate 2 → 4.** After the operator raised the Perplexity API
  tier, the post-tier flood test showed zero vendor 429s — the 2-slot gate itself
  had become the tail latency (13 simultaneous claims queued ~10s at p50). Four
  slots matches the most claims one window can settle at once; the 429 retry
  ladder stays as the burst guard (it absorbed exactly one transient in testing).

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
