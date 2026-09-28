#!/bin/bash
# Hook: inject the machine's current time into model context.
# Usage: inject-time.sh <UserPromptSubmit|PostToolUse>
# UserPromptSubmit always emits; PostToolUse emits only when 5+ minutes have
# passed since the last emit for this session (state file in TMPDIR).
set -uo pipefail

event="${1:-UserPromptSubmit}"
session=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
state="${TMPDIR:-/tmp}/claude-time-inject-${session:-global}"
now=$(date +%s)

if [ "$event" = "PostToolUse" ]; then
  last=$(cat "$state" 2>/dev/null || echo 0)
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  [ $((now - last)) -lt 300 ] && exit 0
fi
echo "$now" > "$state"

# IANA zone name: /etc/localtime is a symlink into zoneinfo on macOS and most
# Linux; /etc/timezone is the Debian-style fallback.
zone=""
if [ -L /etc/localtime ]; then
  zone=$(readlink /etc/localtime | sed 's|.*/zoneinfo/||')
elif [ -r /etc/timezone ]; then
  zone=$(cat /etc/timezone)
fi

local_ts=$(date "+%Y-%m-%d %H:%M:%S %Z (UTC%z)")
utc_ts=$(date -u "+%Y-%m-%d %H:%M:%S")

printf '{"suppressOutput":true,"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"Current time: %s | Zone: %s | UTC: %s"}}\n' \
  "$event" "$local_ts" "$zone" "$utc_ts"
