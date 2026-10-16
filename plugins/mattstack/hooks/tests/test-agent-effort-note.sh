#!/usr/bin/env bash
# Offline test for agent-effort-note.sh: it prints valid SessionStart JSON
# naming the effort rule and exits 0 whatever arrives on stdin.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../agent-effort-note.sh"

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

out="$(echo '{"source":"startup"}' | sh "$HOOK")"; code=$?
check "exits 0" "0" "$code"
printf '%s' "$out" | jq -e . >/dev/null 2>&1 && valid=yes || valid=no
check "whole output is valid JSON" "yes" "$valid"
check "event name" "SessionStart" "$(printf '%s' "$out" | jq -r .hookSpecificOutput.hookEventName)"
ctx="$(printf '%s' "$out" | jq -r .hookSpecificOutput.additionalContext)"
case "$ctx" in *model*effort*model-tiering*) named=yes ;; *) named=no ;; esac
check "names the effort rule" "yes" "$named"
sh "$HOOK" </dev/null >/dev/null; code=$?
check "empty stdin exits 0" "0" "$code"

[ "$fails" -eq 0 ] && echo "all agent-effort-note tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
