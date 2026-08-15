#!/bin/bash
# Mac-side front-door tripwire check (packet P-D). Curls the relay health endpoint and
# prints any UNKNOWN-source SRTLA registrations the relay has recorded — sources that hit
# the unauthenticated ingest but are NOT on the operator's allowlist.
#
#   tools/relay/check-tripwire.sh              # human-readable summary + exit code
#   tools/relay/check-tripwire.sh --json       # raw recent_unknown_sources array
#
# Exit codes (so preflight.js can consume it):
#   0  clean       — endpoint reachable, zero unknown sources
#   2  unknown-hit — one or more unknown-source registrations recorded (WARN in preflight)
#   3  unreachable — could not read the endpoint / field (informational; not blocking)
#
# Read-only: a single GET to :8080. Touches nothing on the media path.
set -uo pipefail

HEALTH_URL="${FOOTNOTE_RELAY_HEALTH_URL:-http://54.203.255.224:8080/}"
JSON_MODE=0
[ "${1:-}" = "--json" ] && JSON_MODE=1

# The relay's :8080 is a single-shot `nc` server (one connection at a time), so a request
# that races another poll can be dropped. Retry a couple times before declaring UNREACHABLE.
body=""
for attempt in 1 2 3; do
  body="$(curl -s -m 8 "$HEALTH_URL" 2>/dev/null)"
  [ -n "$body" ] && break
  sleep 1
done
if [ -z "$body" ]; then
  echo "tripwire: UNREACHABLE — no answer from $HEALTH_URL (3 tries)"
  exit 3
fi

# Pull the array; tolerate an older health endpoint that predates the field.
arr="$(printf '%s' "$body" | jq -c '.recent_unknown_sources // empty' 2>/dev/null)"
total="$(printf '%s' "$body" | jq -r '.unknown_sources_total // 0' 2>/dev/null)"

if [ "$JSON_MODE" -eq 1 ]; then
  printf '%s\n' "${arr:-[]}"
  [ -z "$arr" ] || [ "$arr" = "[]" ] && exit 0 || exit 2
fi

if [ -z "$arr" ]; then
  echo "tripwire: field absent — relay-health has no recent_unknown_sources (old endpoint?). Endpoint IS up."
  exit 3
fi

count="$(printf '%s' "$arr" | jq 'length' 2>/dev/null || echo 0)"
if [ "$count" -eq 0 ]; then
  echo "tripwire: CLEAN — 0 unknown-source registrations recorded (all ingest on allowlist)."
  exit 0
fi

echo "tripwire: UNKNOWN SOURCES — $count recent (of $total total) off-allowlist registration(s):"
printf '%s' "$arr" | jq -r '.[] | "  \(.ts)  \(.source_ip):\(.source_port)  \(.line)"' 2>/dev/null
echo ""
echo "  -> An UNKNOWN source hit the unauthenticated ingest. If it's you on a new carrier,"
echo "     add it to /etc/footnote/relay-allowlist.conf on the relay. Otherwise: investigate"
echo "     before arming (someone found the open :5000 front door)."
exit 2
