#!/usr/bin/env bash
# Offline test for spill-read-note.sh: it prints valid SessionStart JSON and
# exits 0 whatever arrives on stdin.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../spill-read-note.sh"

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

out="$(echo '{"source":"startup"}' | sh "$HOOK")"; code=$?
check "exits 0" "0" "$code"
check "event name" "SessionStart" "$(printf '%s' "$out" | jq -r .hookSpecificOutput.hookEventName)"
ctx="$(printf '%s' "$out" | jq -r .hookSpecificOutput.additionalContext)"
case "$ctx" in *"Read tool"*) named=yes ;; *) named=no ;; esac
check "names the Read tool" "yes" "$named"
sh "$HOOK" </dev/null >/dev/null; code=$?
check "empty stdin exits 0" "0" "$code"

[ "$fails" -eq 0 ] && echo "all spill-read-note tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
