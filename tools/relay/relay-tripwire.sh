#!/bin/bash
# FRONT-DOOR TRIPWIRE (packet P-D) — hears an unauthenticated ingest without locking it.
#
# While the SRTLA ingest stays unauthenticated (auth rolled back at run2; the Moblin
# passphrase bench P-C hasn't passed yet), we can't shut the door — but we CAN hear it.
# This service follows srtla_rec's journal, extracts the SOURCE IP of every SRTLA
# connection/group registration line, and records any source that is NOT on the
# operator's allowlist (their carriers + home). Unknown-source hits are appended to a
# JSONL log that relay-health.sh surfaces on :8080 (recent_unknown_sources) and that the
# Mac polls via tools/relay/check-tripwire.sh.
#
# ADDITIVE + PASSIVE: it only reads the journal and writes its own log. It NEVER touches
# srtla_rec:5000 or srt-out — the live media path is untouched. If this service is dead,
# the media path is unaffected.
#
#   Allowlist:  /etc/footnote/relay-allowlist.conf  (operator-edited; one CIDR/IP per line)
#   Hit log:    /var/log/footnote-tripwire.jsonl    (one JSON object per unknown hit)
#
# srtla_rec registration log shapes (from run2 forensics), all prefixed "IP:port":
#   IP:port (group 0x..): connection registration
#   IP:port: group 0x.. registered
#   IP:port: connection registration for group (nil) failed
#   IP:port: group registration failed
# We fire on ANY of these from an off-allowlist source (success OR failure — an unknown
# source *attempting* to register is exactly the signal we want to catch).
set -uo pipefail

ALLOWLIST="${FOOTNOTE_TRIPWIRE_ALLOWLIST:-/etc/footnote/relay-allowlist.conf}"
HITLOG="${FOOTNOTE_TRIPWIRE_LOG:-/var/log/footnote-tripwire.jsonl}"
KEEP_LINES="${FOOTNOTE_TRIPWIRE_KEEP:-500}"   # cap the hit log so it can't grow unbounded

touch "$HITLOG" 2>/dev/null || { echo "cannot write $HITLOG" >&2; exit 1; }

# ipv4_in_cidr IP CIDR  -> 0 if IP is inside CIDR (or exact match), 1 otherwise.
# Pure bash/awk; no ipcalc dependency. Bare IPs in the allowlist are treated as /32.
ipv4_in_cidr() {
  local ip="$1" cidr="$2" base bits
  case "$cidr" in
    */*) base="${cidr%/*}"; bits="${cidr#*/}" ;;
    *)   base="$cidr";      bits=32 ;;
  esac
  awk -v ip="$ip" -v base="$base" -v bits="$bits" '
    function toint(a,   n,p) { n=split(a,p,"."); if(n!=4) return -1
      return (p[1]%256)*16777216 + (p[2]%256)*65536 + (p[3]%256)*256 + (p[4]%256) }
    function and32(x,m,   r,bit,i2) {         # unsigned 32-bit AND without bitwise ops
      r=0; bit=1
      for (i2=0;i2<32;i2++) {
        if ( (int(x/bit)%2)==1 && (int(m/bit)%2)==1 ) r+=bit
        bit*=2
      }
      return r }
    BEGIN {
      i=toint(ip); b=toint(base)
      if (i<0 || b<0) { exit 1 }              # unparseable -> not a match
      if (bits<=0) { exit 0 }                 # /0 matches everything
      if (bits>32) bits=32
      mask = (bits==32) ? 4294967295 : (4294967295 - (2^(32-bits) - 1))
      exit (and32(i,mask)==and32(b,mask)) ? 0 : 1
    }'
}

is_allowlisted() {
  local ip="$1" line
  [ -f "$ALLOWLIST" ] || return 1
  while IFS= read -r line; do
    line="${line%%#*}"                        # strip inline comments
    line="${line//[[:space:]]/}"              # strip whitespace
    [ -z "$line" ] && continue
    if ipv4_in_cidr "$ip" "$line"; then return 0; fi
  done < "$ALLOWLIST"
  return 1
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

record_hit() {
  local ip="$1" port="$2" raw="$3" ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"ts":"%s","source_ip":"%s","source_port":"%s","line":"%s"}\n' \
    "$ts" "$(json_escape "$ip")" "$(json_escape "$port")" "$(json_escape "$raw")" >> "$HITLOG"
  # trim to the most recent $KEEP_LINES so the log is bounded
  if [ "$(wc -l < "$HITLOG" 2>/dev/null || echo 0)" -gt "$KEEP_LINES" ]; then
    tail -n "$KEEP_LINES" "$HITLOG" > "$HITLOG.tmp" 2>/dev/null && mv "$HITLOG.tmp" "$HITLOG"
  fi
}

# Follow srtla_rec's journal from now on (-n0), line-buffered so hits surface immediately.
# Only registration/registered lines carry a source IP:port we care about.
stdbuf -oL -eL journalctl -u srtla-rec -f -o cat -n 0 2>/dev/null | \
while IFS= read -r line; do
  case "$line" in
    *registration*|*registered*) : ;;
    *) continue ;;
  esac
  # Extract leading "IP:port" token (strip any "srtla_rec[123]: " prefix if -o cat leaves one)
  tok="${line##*srtla_rec*]: }"               # no-op if prefix absent (-o cat strips it)
  tok="${tok%% *}"                            # first whitespace-delimited token: "IP:port" or "IP:port:"
  tok="${tok%:}"                              # drop trailing ':' (the "IP:port:" form)
  ip="${tok%:*}"
  port="${tok##*:}"
  # sanity: must look like an IPv4:port
  case "$ip" in
    [0-9]*.[0-9]*.[0-9]*.[0-9]*) : ;;
    *) continue ;;
  esac
  if ! is_allowlisted "$ip"; then
    record_hit "$ip" "$port" "$line"
  fi
done
