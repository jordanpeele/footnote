#!/bin/bash
# archive-session.sh (packet 5de) — close out a field-test session's raw material in one
# command. Timestamps + moves:
#   1. the active field-test log (FOOTNOTE_FIELDTEST_LOG target; default = newest
#      eval/results/fieldtest-*.jsonl) -> eval/results/fieldtest-YYYY-MM-DD-<slug>.jsonl
#      (plus its .1 rotation sibling, if the server's size guard rotated mid-session)
#   2. the matching R20 session export (newest ~/Downloads/footnote-session-*.json,
#      auto-downloaded by End Stream)      -> eval/results/session-YYYY-MM-DD-<slug>.json
# Naming matches the convention already in eval/results/ (e.g. fieldtest-2026-08-12-d18pilot.jsonl
# + session-2026-08-12-d18pilot.json). The date comes from the log's mtime, not "now",
# so an after-midnight close-out doesn't split a session across two dates.
#
# Usage: bash tools/fieldtest/archive-session.sh <slug> [path-to-active-log]
set -euo pipefail
cd "$(dirname "$0")/../.."

SLUG="${1:-}"
if [ -z "$SLUG" ]; then
  echo "usage: bash tools/fieldtest/archive-session.sh <slug> [path-to-active-log]"
  echo "  e.g. bash tools/fieldtest/archive-session.sh street2"
  exit 1
fi
case "$SLUG" in (*[!a-zA-Z0-9_-]*) echo "error: slug must be [a-zA-Z0-9_-] (it becomes a filename)"; exit 1;; esac

# --- 1. the active log -----------------------------------------------------------------
LOG="${2:-${FOOTNOTE_FIELDTEST_LOG:-}}"
if [ -z "$LOG" ]; then
  LOG=$(ls -t eval/results/fieldtest-*.jsonl 2>/dev/null | grep -v '\.jsonl\.1$' | head -1 || true)
fi
if [ -z "$LOG" ] || [ ! -f "$LOG" ]; then
  echo "error: no active field-test log found (looked at \$2, \$FOOTNOTE_FIELDTEST_LOG, then newest eval/results/fieldtest-*.jsonl)"
  exit 1
fi

DATE=$(stat -f %Sm -t %Y-%m-%d "$LOG")
DEST_LOG="eval/results/fieldtest-$DATE-$SLUG.jsonl"
DEST_SESSION="eval/results/session-$DATE-$SLUG.json"

if [ "$LOG" -ef "$DEST_LOG" ] 2>/dev/null; then
  echo "log:      $LOG already has the session name — leaving in place"
else
  if [ -e "$DEST_LOG" ]; then echo "error: $DEST_LOG already exists — pick another slug"; exit 1; fi
  mv "$LOG" "$DEST_LOG"
  echo "log:      $LOG -> $DEST_LOG"
fi
if [ -f "$LOG.1" ]; then   # size-guard rotation sibling from src/server ftSink
  mv "$LOG.1" "$DEST_LOG.1"
  echo "log:      $LOG.1 -> $DEST_LOG.1 (mid-session rotation)"
fi

# --- 2. the matching R20 export --------------------------------------------------------
R20=$(ls -t "$HOME"/Downloads/footnote-session-*.json 2>/dev/null | head -1 || true)
if [ -z "$R20" ]; then
  echo "R20:      ⚠ no footnote-session-*.json in ~/Downloads — export it from /control (End Stream"
  echo "          auto-downloads it), then rerun, or move it to $DEST_SESSION by hand"
else
  if [ -e "$DEST_SESSION" ]; then echo "error: $DEST_SESSION already exists — pick another slug"; exit 1; fi
  # sanity: the export should be from this session, i.e. not older than the log's last write
  if [ "$R20" -ot "$DEST_LOG" ] && [ -f "$DEST_LOG" ]; then
    echo "R20:      ⚠ newest export ($R20) is OLDER than the log's last event — archiving it"
    echo "          anyway, but confirm it's this session's export"
  fi
  mv "$R20" "$DEST_SESSION"
  echo "R20:      $R20 -> $DEST_SESSION"
fi

echo "done.     next: node tools/fieldtest/dashboard.js $DEST_LOG"
