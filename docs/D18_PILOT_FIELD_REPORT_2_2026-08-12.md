# D18 pilot field report — session 2 · 2026-08-12 evening

An infrastructure session that earned its keep and a pilot session that only
partly happened — reported in that order, honestly. Raw:
`eval/results/fieldtest-2026-08-12-d18pilot2.jsonl` + the R20 export
(`session-2026-08-12-d18pilot2.json`). Scope per R55; protocol amendments
R53–R56 were live for the first time.

## Session totals

| checked | aired | auto-aired | vetoes | wrong cards | attention captured |
|---|---|---|---|---|---|
| 8 | 6 | **2** | 0 | **0** | **2/2 — zero uncaptured** |

Cumulative machine-aired record: **12 auto-airs · 0 wrong** (10 in session 1,
2 here). Denial-watch line (R53): **0 polarity-applied auto-airs this session;
cumulative 3 of the required 20 clean.**

## What this session proved

1. **The street-endgame transport, end to end.** Moblin bonded **two
   carriers** — Verizon (via the operator phone's hotspot) and AT&T — over
   SRTLA to a publicly-reachable `srtla_rec` behind a router port-forward,
   reassembled to SRT into OBS, out to an unlisted YouTube ingest. The
   relay's registration log shows both carrier IPs joining one bond group.
   This is the real topology (no VPN in the media path), stood up live
   mid-session after the tailnet approach failed (below).
2. **R54 live attention capture works — 100% capture on its first outing.**
   Both auto-aired cards tagged in the moment, both honestly **"talking"**
   (the operator was mid-speech during both veto windows — exactly the
   uncomfortable truth the mechanism exists to record). One tag came from
   `/op` on the phone **while the Mac was locked** (`source: "op"`) — the
   redundant tagging path proved itself in its designed scenario. The
   objective sampler agreed: both `veto_window` events logged
   `input_activity: false` (hands off during the full 4s).
3. **The R56 fragment-gate observability paid for itself immediately.** The
   session's defining problem (below) was diagnosable in real time ONLY
   because sub-6-word drops now log — in pilot 1 the same symptom was five
   minutes of "why isn't it processing." This time the answer was on the
   dashboard while it happened.
4. **FS-2 (partial): the pipeline survives a locked screen.** 77 seconds
   locked-hidden (target 90); STT, extraction, and gating ran continuously
   throughout — the throttling that caused the original FS-2 failure did not
   recur under caffeinate. NOT proven: the on-air graphic's behavior under
   lock (the aired card had auto-retired ~6s into the lock; "Hold on screen"
   state unconfirmed). FS-2's render half carries to session 3 with the
   explicit fixture: Hold ON, card up, then lock.

## THE finding — bonded audio breaks STT endpointing (top of the fix list)

Claims-through-rate collapsed: session 1 processed 20 checks in ~17 minutes
on the local mic; session 2 managed 8 in ~40 minutes of trying, with the
operator's claims repeatedly shredded into 1–5-word finals ("The adult" /
"Human body has 26" / "26 bone."). Root cause is the audio path, not the
guards: SRT jitter + Moblin's 2s latency buffer + OBS→BlackHole pacing hands
Deepgram audio with micro-gaps, and its endpointing finalizes at each gap.
The guards then behaved correctly on shredded input — fragment gate caught
the shards, the F3/P5-B merge rescued the pairs it's built for ("Silver is
worth more" + "Then bronze" → the session's cleanest auto-air), F2 dedupe
suppressed the re-final, and the P4-F1 grounding gate correctly rejected the
"two zero six bones" mishear twice.

Queued fixes, in leverage order:
1. **Deepgram endpointing tuning for the routed-audio path** (`endpointing` /
   `utterance_end_ms`) — a parameter, not a rebuild; likely recovers most of
   the loss.
2. **Grow the F3 merge into a rolling assembler** — today it joins pairs and
   requires the first half unterminated; tonight's splits often arrived
   pre-punctuated and slipped through. Join consecutive finals until real
   silence.
3. Consider a per-input STT profile (local mic vs routed audio) once 1–2 are
   measured.

## Scope deviations (honest section)

- **One auto-air occurred OUT of category**: "Silver is worth more than
  bronze" (economics, True @0.95) — a correct verdict, but science_health
  scope is protocol-enforced and the operator was improvising off-sheet.
  D18's category constraint was breached by drift, not by the machine.
- Off-sheet person/politics claims (Trump ×2, Vance, Shah of Iran) were
  spoken; every one was correctly refused by the gates (person_public →
  manual-only; the Vance claim additionally drew an R50 polarity-conflict
  hold). Good gate evidence, wrong session for it.
- Lesson recorded: fatigue + live troubleshooting erode sheet discipline.
  Session 3 should be short, scripted, and fresh — the controls evidence
  (vetoes, D4 hold, cap wall) does not need the bonded transport and should
  be collected on the local mic where STT is reliable.

## Not banked (carried forward)

Vetoes (0 of 2) · the scripted D4 hold · the cap run-out · the P7-D leg-kill
drill (scrubbed: the tailnet SRTLA path delivered zero packets — bonding's
per-interface sockets bypass the VPN tunnel — and the mid-session rebuild to
the public relay consumed the segment) · FS-2's render half · the 90s lock
(77s achieved).

## Transport log (for the runbook)

- Moblin's **implementation setting must be "Moblin"** for `srtla://`;
  "Official" (libsrt) silently speaks plain SRT only.
- **`srtla_rec` wedges if started before OBS's SRT listener exists** — start
  order: OBS listener → `srtla_rec` → Moblin. (One restart fixed it.)
- **SRTLA + Tailscale don't compose** (bonding binds physical interfaces →
  bypasses the tunnel). Bond over public ingest; keep the tailnet for `/op`.
- **Spectrum rotated the WAN IP** when the port-forward/reservation applied —
  the phone was aiming at a stale IP for one round. A dynamic residential IP
  is one more argument for the endgame **cloud relay** (public VM runs
  `srtla_rec`; OBS dials out; zero inbound home ports, stable address).
- The router port-forward (UDP 5000) was agreed as **session-scoped**;
  close-out step is deleting it.

## Ops nits

- Dashboard renders the new fragment-gate events as `[undefined] ""` — it
  predates the event's fields. Fix queued (cosmetic).
- The 90s-lock timer ran on the operator phone and hid `/op` for half the
  drill window (`op_focus: hidden` at 40s) — timer goes elsewhere next time.
- `ADMIN_TOKEN` panic curls must be exported in the terminal that runs them.

## Recommendations

1. **Session 3 (short, fresh, local mic, indoor):** collect the missing
   controls evidence — 2 vetoes, scripted D4 hold, cap run-out, FS-2 render
   half with Hold ON, denial segment for the R53 watch line. No transport
   novelty. This completes the session-2 sheet's unfinished half.
2. **Bench day (transport):** endpointing tuning + rolling assembler, then
   the cloud relay build; re-schedule the leg-kill drill against it.
3. Keep the attention mechanism exactly as built — first outing produced
   100% capture and honest tags.
