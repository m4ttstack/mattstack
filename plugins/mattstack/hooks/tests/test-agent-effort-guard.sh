#!/usr/bin/env bash
# Offline test for agent-effort-guard.sh: an Agent call that names a model
# but no effort is blocked (exit 2, reason on stderr); everything else passes.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../agent-effort-guard.sh"

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}
run() { # stdin -> "<exit code>"
  printf '%s' "$1" | sh "$HOOK" >/dev/null 2>"$ERR"; echo $?
}
ERR="$(mktemp)"; trap 'rm -f "$ERR"' EXIT

call() { # tool_input JSON
  printf '{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":%s}' "$1"
}

check "model without effort blocks" "2" "$(run "$(call '{"subagent_type":"general-purpose","model":"haiku","prompt":"x","description":"d"}')")"
case "$(cat "$ERR")" in *effort*model-tiering*) named=yes ;; *) named=no ;; esac
check "block reason names effort and the skill" "yes" "$named"

check "model with effort passes" "0" "$(run "$(call '{"subagent_type":"general-purpose","model":"haiku","effort":"medium","prompt":"x","description":"d"}')")"
check "no model passes" "0" "$(run "$(call '{"subagent_type":"Explore","prompt":"x","description":"d"}')")"
check "empty effort blocks" "2" "$(run "$(call '{"subagent_type":"general-purpose","model":"opus","effort":"","prompt":"x","description":"d"}')")"
check "fork with model passes" "0" "$(run "$(call '{"subagent_type":"fork","model":"opus","prompt":"x","description":"d"}')")"
check "other tool passes" "0" "$(run '{"tool_name":"Bash","tool_input":{"model":"haiku","command":"ls"}}')"
check "null effort blocks" "2" "$(run "$(call '{"model":"opus","effort":null}')")"
check "non-string effort passes" "0" "$(run "$(call '{"model":"opus","effort":0}')")"
check "non-string model passes" "0" "$(run "$(call '{"model":5}')")"
check "non-dict tool_input passes" "0" "$(run '{"tool_name":"Agent","tool_input":"x"}')"
code="$(printf '%s' "$(call '{"model":"opus"}')" | PATH=/nonexistent /bin/sh "$HOOK" >/dev/null 2>&1; echo $?)"
check "missing python3 passes" "0" "$code"
check "malformed stdin passes" "0" "$(run 'not json')"
check "empty stdin passes" "0" "$(run '')"

[ "$fails" -eq 0 ] && echo "all agent-effort-guard tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
