/* Preflight aggregator + individual check evaluators — the pure, side-effect-free core
   of `tools/street/preflight.js`. Split out so the aggregation contract (GO only when
   zero FAIL; WARN never blocks) is unit-testable against injected check results without
   touching the network, the filesystem, or arm.sh. The runner (preflight.js) does the
   probing and hands the raw facts to the `eval*` functions here.

   A "check result" is: { id, name, status: "PASS"|"WARN"|"FAIL", reason } */

export const PASS = "PASS";
export const WARN = "WARN";
export const FAIL = "FAIL";

const RELAY_HEALTH_URL = "http://54.203.255.224:8080/";
const RELAY_BONDED_URL = "srtla://54.203.255.224:5000";
const SHORTCUT_URL_TEMPLATE =
  "http://<mac-tailnet-host>/api/admin?token=<ADMIN_TOKEN>&op=kill";
const INGEST_AUTH_BRANCH = "daysprint/2a-sec-ingest-auth-PARKED";

/* 1. Relay health — curl :8080, BOTH services active. FAIL if down. */
export function evalRelayHealth({ body, ok }) {
  if (!ok || !body) {
    return {
      id: "relay-health",
      name: "Relay health (:8080)",
      status: FAIL,
      reason: `no answer from ${RELAY_HEALTH_URL} — bonded media front door is down; only indoor srt:// fallback works`,
    };
  }
  let json = null;
  try { json = JSON.parse(body); } catch { /* handled below */ }
  const srtlaActive = json && json.srtla_rec === "active";
  const srtOutActive = json && json.srt_out === "active";
  if (srtlaActive && srtOutActive) {
    const up = json.uptime_s != null ? `, uptime ${json.uptime_s}s` : "";
    return {
      id: "relay-health",
      name: "Relay health (:8080)",
      status: PASS,
      reason: `both services active (srtla_rec + srt_out${up})`,
    };
  }
  const which = [
    srtlaActive ? null : "srtla_rec",
    srtOutActive ? null : "srt_out",
  ].filter(Boolean).join(" + ");
  return {
    id: "relay-health",
    name: "Relay health (:8080)",
    status: FAIL,
    reason: `relay answered but ${which || "services"} not active — ${body.slice(0, 120)}`,
  };
}

/* 1b. Client version gate (P-A, run2 lesson): the browser can run a STALE app.js while the
   server serves current code — run2 executed pre-window cached client for 111 min. This gate
   asserts the newest client_version in the harness log equals the served APP_VERSION. NO-GO
   (FAIL) on mismatch; WARN if no client has streamed yet (reload /control to stamp one). */
export function evalClientVersion({ served, client, logPresent }) {
  if (!served) {
    return { id: "client-version", name: "Client version gate",
      status: WARN, reason: "could not read served APP_VERSION from app.js — check manually" };
  }
  if (!logPresent || !client) {
    return { id: "client-version", name: "Client version gate",
      status: WARN, reason: `no client_version stamped yet — RELOAD /control (dashboard must echo ${served}) before streaming` };
  }
  if (client !== served) {
    return { id: "client-version", name: "Client version gate",
      status: FAIL, reason: `STALE CLIENT — browser ran ${client}, server serves ${served}. Hard-reload /control (Cmd-Shift-R); confirm the dashboard echoes ${served}. (run2 was invalidated by exactly this.)` };
  }
  return { id: "client-version", name: "Client version gate",
    status: PASS, reason: `client_version ${client} == served (fresh code confirmed)` };
}

/* 2. Relay ingest auth — is the parked passphrase fix applied? Read-only assessment.
   `applied` is true only if we have positive evidence the live relay enforces a
   passphrase. Absent that, WARN (never FAIL — the rig still functions, just open). */
export function evalIngestAuth({ applied, evidence }) {
  if (applied) {
    return {
      id: "ingest-auth",
      name: "Relay ingest auth",
      status: PASS,
      reason: evidence || "passphrase enforced at the :4000 SRT termination",
    };
  }
  return {
    id: "ingest-auth",
    name: "Relay ingest auth",
    status: WARN,
    reason:
      `front door unauthenticated — decision #1, fix parked on ${INGEST_AUTH_BRANCH}` +
      (evidence ? ` (${evidence})` : ""),
  };
}

/* 2b. Front-door tripwire (packet P-D) — while the ingest is unauthenticated, the relay
   listens for SRTLA registrations from sources NOT on the operator's allowlist and records
   them. This surfaces the relay's `recent_unknown_sources` on /op's GO/NO-GO: any unknown
   source seen since setup = WARN (never FAIL — it's a heads-up, not a blocker; the rig still
   works). `unknownCount` = number of unknown-source hits the relay reported (0 = clean).
   `reachable` = did we read the field at all (false when the endpoint is down OR predates
   the field — either way, informational WARN, not a block). */
export function evalTripwire({ reachable, unknownCount, latest }) {
  if (!reachable) {
    return {
      id: "tripwire",
      name: "Front-door tripwire (unknown ingest sources)",
      status: WARN,
      reason:
        "could not read recent_unknown_sources from the relay health endpoint — tripwire status unknown; confirm tools/relay/check-tripwire.sh manually before arming",
    };
  }
  if (unknownCount > 0) {
    const where = latest ? ` (latest: ${latest})` : "";
    return {
      id: "tripwire",
      name: "Front-door tripwire (unknown ingest sources)",
      status: WARN,
      reason:
        `${unknownCount} UNKNOWN-source SRTLA registration(s) recorded${where} — someone off-allowlist hit the open :5000 ingest. ` +
        "If it's you on a new carrier, add it to /etc/footnote/relay-allowlist.conf; otherwise INVESTIGATE before arming (run tools/relay/check-tripwire.sh)",
    };
  }
  return {
    id: "tripwire",
    name: "Front-door tripwire (unknown ingest sources)",
    status: PASS,
    reason: "0 unknown-source registrations — all recent ingest matched the operator allowlist",
  };
}

/* 3. tailscale serve on + /op reachable over the tailnet URL.
   serveOn: is `tailscale serve` proxying :3000?  code: HTTP status hitting the tailnet
   /op URL (0 = no answer). A 502/000 means serve is configured but the loopback server
   behind it isn't up yet — that's an arm-time condition, not a serve failure → WARN. */
export function evalTailscaleServe({ serveOn, host, code }) {
  if (!serveOn) {
    return {
      id: "tailscale-serve",
      name: "tailscale serve + /op",
      status: FAIL,
      reason: "tailscale serve OFF — phone /op path down; run: tailscale serve --bg 3000",
    };
  }
  const url = host ? `https://${host}/op` : "the tailnet /op URL";
  // 401/403 = reachable-but-needs-key (expected: /op wants ?room=&key=); 2xx/3xx = up.
  if (code >= 200 && code < 400) {
    return {
      id: "tailscale-serve",
      name: "tailscale serve + /op",
      status: PASS,
      reason: `serve ON, ${url} -> ${code}`,
    };
  }
  if (code === 401 || code === 403) {
    return {
      id: "tailscale-serve",
      name: "tailscale serve + /op",
      status: PASS,
      reason: `serve ON, ${url} -> ${code} (reachable; wants ?room=&key=)`,
    };
  }
  if (code === 502 || code === 503 || code === 0) {
    return {
      id: "tailscale-serve",
      name: "tailscale serve + /op",
      status: WARN,
      reason: `serve ON but backend not answering (${url} -> ${code || "no answer"}) — arm.sh starts the server; re-check after arming`,
    };
  }
  return {
    id: "tailscale-serve",
    name: "tailscale serve + /op",
    status: WARN,
    reason: `serve ON, ${url} -> ${code} (unexpected — confirm before walking)`,
  };
}

/* 4. Local server armable — arm.sh --check exists and runs cleanly.
   armable: did `arm.sh --check` exit 0 with parseable output?  `output` = its stdout. */
export function evalArmable({ armShExists, checkRan, exitCode, output }) {
  if (!armShExists) {
    return {
      id: "armable",
      name: "Local server armable (arm.sh --check)",
      status: FAIL,
      reason: "tools/street/arm.sh not found — cannot arm the rig",
    };
  }
  if (!checkRan || exitCode !== 0) {
    return {
      id: "armable",
      name: "Local server armable (arm.sh --check)",
      status: FAIL,
      reason: `arm.sh --check failed (exit ${exitCode}) — arming path broken`,
    };
  }
  // Surface a one-liner distilled from arm.sh's own dry-run probe block.
  const line = summarizeArmCheck(output);
  return {
    id: "armable",
    name: "Local server armable (arm.sh --check)",
    status: PASS,
    reason: `arm.sh --check clean${line ? ` — ${line}` : ""}`,
  };
}

// Pull the salient dry-run facts out of arm.sh --check's output for a one-line reason.
export function summarizeArmCheck(output) {
  if (!output) return "";
  const bits = [];
  const dg = /deepgram key:\s*(present|.*MISSING.*)/i.exec(output);
  if (dg) bits.push(/present/i.test(dg[1]) ? "DG key present" : "DG key MISSING");
  const srtla = /srtla_rec:\s*(built|not built.*)/i.exec(output);
  if (srtla) bits.push(/built/i.test(srtla[1]) && !/not built/i.test(srtla[1]) ? "srtla_rec built" : "srtla_rec not built");
  const srv = /server:\s*(already running.*|not running.*)/i.exec(output);
  if (srv) bits.push(/already running/i.test(srv[1]) ? "server already up" : "server not yet up");
  return bits.join(", ");
}

/* 5. Kill-switch — ADMIN_TOKEN present in the MAIN-TREE .env.local so the kill Shortcut
   works. tokenPresent: nonempty ADMIN_TOKEN found.  We print the Shortcut URL to confirm. */
export function evalKillSwitch({ tokenPresent, envPath, shortcutUrl }) {
  const url = shortcutUrl || SHORTCUT_URL_TEMPLATE;
  if (tokenPresent) {
    return {
      id: "kill-switch",
      name: "Kill-switch (ADMIN_TOKEN)",
      status: PASS,
      reason: `ADMIN_TOKEN set in ${envPath || ".env.local"} — Shortcut works; confirm URL: ${url}`,
    };
  }
  return {
    id: "kill-switch",
    name: "Kill-switch (ADMIN_TOKEN)",
    status: FAIL,
    reason: `ADMIN_TOKEN missing/empty in ${envPath || ".env.local"} — FOOTNOTE KILL shortcut returns 501; no remote stop`,
  };
}

/* 6. OBS high-pass (120 Hz) preset file present. OBS's own state isn't machine-readable,
   so even when the file exists this is a WARN-to-confirm-it's-loaded-on-the-source. */
export function evalObsPreset({ presetExists, presetPath }) {
  if (!presetExists) {
    return {
      id: "obs-preset",
      name: "OBS wind-cut preset (120 Hz high-pass)",
      status: FAIL,
      reason: "obs-audio-preset.md not found — the wind-cut/gust-ceiling prescription is missing",
    };
  }
  return {
    id: "obs-preset",
    name: "OBS wind-cut preset (120 Hz high-pass)",
    status: WARN,
    reason: `preset present (${presetPath || "tools/street/obs-audio-preset.md"}) — CONFIRM it's loaded on the moblin-feed source (EQ Low -20 dB above Limiter -6 dB); OBS state isn't machine-readable`,
  };
}

/* 7. Keyterms — a WARN-to-fill: per-route proper nouns must be typed into the Deepgram
   keyterm list before leaving. Not machine-verifiable, so it's a standing reminder. */
export function evalKeyterms() {
  return {
    id: "keyterms",
    name: "R40 keyterms for the route",
    status: WARN,
    reason: "TYPE tonight's proper nouns (street/store/park/people names) into the Deepgram keyterm list before leaving, then restart the server (STREET_CHECKLIST R40)",
  };
}

/* 8. Kit — Moblin URL correct + earbud/wired-mic reminder. Config is fixed (the relay
   Elastic IP), the mic is the operator's #1 quality tax → WARN reminder. */
export function evalKit() {
  return {
    id: "kit",
    name: "Kit (Moblin URL + mic)",
    status: WARN,
    reason: `Moblin bonded URL = ${RELAY_BONDED_URL} (Implementation MUST be "Moblin", passphrase on). WEAR the wired/earbud mic with windscreen — an unshielded iPhone mic in wind is the #1 quality tax (RUN_TEST 2026-08-14)`,
  };
}

/* Aggregate: GO only if zero FAIL. WARN items are printed but never block.
   Returns { decision: "GO"|"NO-GO", checks, fails, warns, passes }. */
export function aggregate(checks) {
  const fails = checks.filter((c) => c.status === FAIL);
  const warns = checks.filter((c) => c.status === WARN);
  const passes = checks.filter((c) => c.status === PASS);
  return {
    decision: fails.length === 0 ? "GO" : "NO-GO",
    checks,
    fails,
    warns,
    passes,
  };
}

export const CONSTANTS = {
  RELAY_HEALTH_URL,
  RELAY_BONDED_URL,
  SHORTCUT_URL_TEMPLATE,
  INGEST_AUTH_BRANCH,
};
