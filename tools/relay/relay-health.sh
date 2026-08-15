#!/bin/bash
# Footnote relay health endpoint (:8080) — the tiny JSON the Mac/preflight polls before a
# session. Reflects the two media services + uptime, PLUS the front-door tripwire's most
# recent UNKNOWN-source registrations (packet P-D). Read-only: it never touches the media
# path; it just reports systemctl state and tails the tripwire's hit log.
#
# JSON shape:
#   { "srtla_rec":"active", "srt_out":"active", "uptime_s":12345,
#     "recent_unknown_sources":[ {"ts":..,"source_ip":..,"source_port":..,"line":..}, ... ],
#     "unknown_sources_total": 3 }
#
# recent_unknown_sources = last N (default 10) entries from /var/log/footnote-tripwire.jsonl,
# newest last. Empty array = nothing off-allowlist has tried to register. If the tripwire
# service is down or the log is absent, the field is [] and unknown_sources_total is 0
# (fail-open on the OBSERVABILITY layer — never blocks the media path).
TRIPWIRE_LOG="${FOOTNOTE_TRIPWIRE_LOG:-/var/log/footnote-tripwire.jsonl}"
TRIPWIRE_N="${FOOTNOTE_TRIPWIRE_N:-10}"

while true; do
  {
    read -r _
    s1=$(systemctl is-active srtla-rec)
    s2=$(systemctl is-active srt-out)
    up=$(cut -d. -f1 /proc/uptime)
    # Build the recent_unknown_sources JSON array from the tripwire log (bounded, newest last).
    if [ -s "$TRIPWIRE_LOG" ]; then
      total=$(wc -l < "$TRIPWIRE_LOG" 2>/dev/null | tr -d ' ')
      recent=$(tail -n "$TRIPWIRE_N" "$TRIPWIRE_LOG" 2>/dev/null | jq -c -s '.' 2>/dev/null)
    fi
    [ -z "${recent:-}" ] && recent='[]'
    [ -z "${total:-}" ] && total=0
    body=$(printf '{"srtla_rec":"%s","srt_out":"%s","uptime_s":%s,"recent_unknown_sources":%s,"unknown_sources_total":%s}\n' \
      "$s1" "$s2" "$up" "$recent" "$total")
    printf "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n%s" "$body"
  } | nc -l -q1 -p 8080
  # reset per-connection locals so a stale value can't leak into the next response
  unset recent total
done
