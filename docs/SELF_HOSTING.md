# Self-hosting Footnote

Zero to a running fact-checker, alone, in one sitting. The software is MIT and dependency-free;
the three vendors it calls are not free — you bring your own keys and they bill you directly
(realistic numbers below).

## Prerequisites

- **Node ≥ 22** (`node --version`; the `engines` field enforces it)
- **git**
- A microphone, or the patience to type claims (typing works — no mic is required to test)

That's the whole list. `npm start` runs one Node process with **zero npm dependencies** —
there is no `npm install` step, no build, no external database. The control→overlay state
channel runs in-memory inside the server.

```sh
git clone https://github.com/jordanpeele/footnote && cd footnote
```

## The three keys

| key | pays for | get it |
|---|---|---|
| `DEEPGRAM_API_KEY` | streaming speech-to-text (nova-3) | [console.deepgram.com](https://console.deepgram.com) — **must be a grant-capable, Member-scope key** (below) |
| `ANTHROPIC_API_KEY` | claim extraction (Claude Haiku) | [console.anthropic.com](https://console.anthropic.com) |
| `PERPLEXITY_API_KEY` | claim verification (sonar-pro web search) | [perplexity.ai](https://www.perplexity.ai) → API settings |

**The Deepgram key scope matters.** The browser streams audio straight to Deepgram's
realtime WebSocket, authenticated with a short-lived token the server mints via
`/api/dg-token` — so your real key never ships to any client. Minting those tokens requires
a key created with the **Member** role in the Deepgram console (Settings → API Keys → create
key → choose the Member role). A default limited-scope key can transcribe but **cannot mint
grants** — the symptom is a 403 on the token grant while the key itself tests fine (see
Troubleshooting). A transcription-only key does still work for the chunked `/api/transcribe`
fallback path, just not for low-latency streaming.

### What a session actually costs

Verification dominates. Bench runs measured **~$2–3 for ~180 sonar-pro verifies** (~1.5¢
per verify, request fees dominant — [LATENCY_LEDGER.md](./LATENCY_LEDGER.md)); a real
35-minute conversation ran 51 verifies ([field report](./FIELD_TEST_2026-08-08.md)).
Haiku extraction is a rounding error next to that (hundreds of extractions plus judge calls
measured ≈ $0.25 combined in the calibration runs), and Deepgram streaming bills per audio
minute at their published rates. The [root README](../README.md) works this out to roughly
**$0.50–1.00 per active streaming hour**, depending on how talkative the stream is. The
Haiku gate exists precisely to keep the expensive verify calls down.

## Configure: `.env.local`

```sh
cp .env.example .env.local
```

Then fill it in. The server loads `.env.local`, then `.env` (`.env.local` wins), and **real
environment variables win over both** — see Troubleshooting for the trap that ordering
creates. The variables, honestly:

| var | required? | what |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | stage-1 extraction |
| `PERPLEXITY_API_KEY` | yes | stage-2 verification |
| `DEEPGRAM_API_KEY` | yes (for speech) | STT; Member scope for streaming. Typed-claim testing works without it |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | no (locally) | Upstash Redis REST creds. Not needed for self-host: state defaults to the in-process memory adapter and rate limiting **fails open** without them. Required on serverless deploys |
| `PORT` | no | listen port, default `3000` |
| `HOST` | no | bind address, default `127.0.0.1` (loopback only — docker-compose sets `0.0.0.0`) |
| `FOOTNOTE_STATE` | no | state-channel adapter; `npm start` defaults it to `memory`. Set `upstash` to use Redis locally |
| `FOOTNOTE_EXTRACTOR` / `FOOTNOTE_VERIFIER` / `FOOTNOTE_STT` | no | adapter selection (see [ARCHITECTURE.md](./ARCHITECTURE.md)); defaults are the shipping vendors |
| `ADMIN_TOKEN` | no | enables the `/api/admin` global kill switch (kill / restore / status). Without it the route answers 501. Works without Redis since `d3b2a19` via an in-process flag (responses say `mode: "in-process"`); before that, a Redis-less kill switch was silently fail-open — upgrade if you're on an older checkout |
| `BYOK_ENABLED` | no | `1` lets rooms spend against their own stored vendor keys (Decision D13). Off by default; leave it off unless you're running a shared instance |
| `FOOTNOTE_FIELDTEST_LOG` | no | path for the local field-test event sink (`/__fieldtest/log`); only exists on the self-host server |
| `ALLOW_STUBS` | no | CI-only escape hatch that permits stub adapters when `NODE_ENV=production`. Never set it on anything real |

## Run

```sh
npm start
# Footnote up — control: http://127.0.0.1:3000/control   overlay: http://127.0.0.1:3000/overlay?room=<room>
```

The banner lists the active state channel and routes, and warns about any missing vendor
keys (those stages fail until set — nothing else breaks). `docker compose up` is the same
thing containerized. `npm test` runs the unit suite if you want a green light first.

## ⚠ Spending safety — read this before you expose the server

Footnote is **bring-your-own-keys**: every `/api/extract` and `/api/verify` call spends
*your* money at Deepgram / Anthropic / Perplexity. Two defaults matter:

- **Rate limiting fails *open* without Redis.** The per-IP limiter (`api/_ratelimit.js`)
  needs Upstash (`KV_REST_API_URL` / `KV_REST_API_TOKEN`). Locally you don't have it, so
  **there is no rate limit** — fine on loopback where only you can reach it.
- **The default bind is loopback (`127.0.0.1`) — keep it that way unless you mean it.**
  `docker-compose` sets `HOST=0.0.0.0` so the port map works, and a VPS or a
  port-forwarded box is reachable by the whole internet.

**The footgun:** bind wide (`0.0.0.0`, a VPS, a forwarded port) *and* run without Redis,
and you are serving **unauthenticated, unlimited** extract/verify to anyone who finds the
port — a stranger can drain your API budget. This is not hypothetical for anyone who puts
the container on a public host.

**Safe postures, pick one:**
1. **Loopback only (default).** Reach it from the same machine / an SSH tunnel / a private
   overlay network like Tailscale ([STREET_RIG.md](./STREET_RIG.md) does exactly this). No
   public exposure, nothing to rate-limit.
2. **Wide bind *with* Redis.** Set the Upstash env vars so the limiter actually limits, and
   set `ADMIN_TOKEN` so the [kill switch](../SECURITY.md) works if you need to stop spend
   fast (`GET /api/admin?token=…&op=kill`).
3. **Put it behind your own auth.** A reverse proxy with a password / your platform's access
   control in front of the whole app.

If you only ever open `/control` and the overlay on your own machine, you're already in
posture 1 and there's nothing to do.

## Your first fact-check

1. Open `http://localhost:3000/control`. The OBS OVERLAY bar shows your room's overlay URL —
   the room pairs control and overlay, and it persists across reloads.
2. Hit **● Start Stream** (allow the mic), and say something checkable — or skip the mic
   entirely and **type a claim** into the input; typed claims drive the same
   extract → verify pipeline.
3. A card lands in the FACT-CHECK QUEUE with a verdict, one-line correction, confidence,
   and a trust-ranked source. **AIR** it.
4. Open the overlay URL in another tab: the lower-third is on screen, and auto-retires
   after ~10s (or **Hold** it).

No-key/no-pipeline test hooks: `/overlay?demo=1` cycles sample cards;
`?debug=1` on `/control` opens the instrumentation panel (upstream statuses, event log —
your first stop when something looks dead).

## Into OBS

Add the overlay URL as a **Browser Source, 1920×1080** (or 1080×1920 for vertical — the
overlay is aspect-aware). The control page's **Download OBS scene** button ships pre-sized
16:9 and 9:16 scenes. Full walkthrough, including routing mixed show audio into the
pipeline via a virtual cable: [OBS_SETUP.md](../OBS_SETUP.md).

## Troubleshooting

Every entry here is a failure class from a real session, not a hypothetical.

- **Server prints `note: <KEY> comes from your shell environment and DIFFERS from
  .env.local — the shell value wins.`** Believe it. Real environment variables outrank the
  env files, so a stale key exported in `~/.zshenv` / `~/.zshrc` silently shadows the fresh
  one you just pasted into `.env.local` — the vendor 403s while the file's key is perfectly
  valid. This cost 10 minutes of a field session (finding F6) before the warning existed.
  Unset the shell export and restart.

- **Deepgram 403 on the token grant.** Wrong key scope. `/api/dg-token` needs a
  grant-capable **Member** key; a default limited key transcribes fine but can't mint
  browser tokens, so the key "tests fine" everywhere except the one call that matters.
  Create a Member-scope key in the Deepgram console.

- **You want to fact-check the stream's mixed audio, not just your mic.** The pipeline
  transcribes whatever the control page's **Audio in** picker is set to. Route OBS's
  monitoring output into a virtual audio device — [BlackHole](https://existential.audio/blackhole/)
  on macOS (OBS Settings → Audio → Monitoring Device = BlackHole; set sources to *Monitor
  and Output*), VB-Cable on Windows — and pick that device in Audio in. Details in
  [OBS_SETUP.md](../OBS_SETUP.md). This is how the street rig feeds SRT audio into the
  pipeline, with a bonus: if the transport drops, BlackHole emits silence and the STT
  socket just rides through it.

- **Overlay renders as a tiny mid-frame card after you resized the Browser Source**
  (e.g. 16:9 → vertical). OBS kept the old scene-item transform and is scaling the old
  bounding box into the new canvas — the page itself is rendering correctly for the
  viewport it was given. Right-click the source → Transform → **Reset Transform**, or
  delete and re-add, or import the shipped `Footnote 9:16` scene. This ate ~7 minutes of a
  field session (finding P5F-1).

- **Port 3000 is taken** — set `PORT=3001` (env or `.env.local`). Subtler variant: another
  dev server holding `*:3000` on IPv6 can capture `localhost` while Footnote sits on IPv4 —
  if `/control` looks like the wrong app, try `http://127.0.0.1:3000/control` explicitly.

- **Something is silently wrong and you don't know which stage.** `/control?debug=1`.
  The debug panel shows per-upstream status and a timestamped event log — extraction gates,
  verify round-trips, publish results. Most "it's dead" reports are one visible 4xx in
  that panel.
