#!/usr/bin/env bash
# Offline tests for herdr-doorbell.sh.
#
# `herdr` is stubbed with a recorder on PATH, so each case asserts on the exact
# notification the hook would have shown -- or on its silence.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../herdr-doorbell.sh"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/herdr" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$SANDBOX/rang"
STUB
chmod +x "$SANDBOX/bin/herdr"
export PATH="$SANDBOX/bin:$PATH"

fails=0
run() { # payload -- returns the recorded notification, or "" for silence
  : > "$SANDBOX/rang"
  printf '%s' "$1" | env HERDR_ENV="${OVR_ENV-1}" HERDR_PANE_ID="${OVR_PANE-w7Z:p1}" \
    "$HOOK" >/dev/null 2>&1
  cat "$SANDBOX/rang" 2>/dev/null
}
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

ASK='{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion","cwd":"/Users/matt/Documents/GitHub/mattari","tool_input":{"questions":[{"question":"Should spendMicro include byok_usage?","header":"Contract","options":[{"label":"Yes","description":"x"},{"label":"No","description":"y"}]}]}}'

# The incident case: a shepherd blocking on Matt must ring, every time.
out=$(run "$ASK")
check "AskUserQuestion rings" \
  'notification show mattari needs you --body Should spendMicro include byok_usage? --sound request' "$out"

# Batched questions name the first and count the rest.
MULTI='{"tool_name":"AskUserQuestion","cwd":"/tmp/mattari","tool_input":{"questions":[{"question":"Pick a model","header":"Model"},{"question":"Pick an account","header":"Acct"},{"question":"Third","header":"T"}]}}'
out=$(run "$MULTI")
check "batched questions count the rest" \
  'notification show mattari needs you --body Pick a model  (+2 more) --sound request' "$out"

# Long questions are truncated so the notification stays readable.
LONG="{\"tool_name\":\"AskUserQuestion\",\"cwd\":\"/tmp/repo\",\"tool_input\":{\"questions\":[{\"question\":\"$(printf 'x%.0s' $(seq 1 300))\"}]}}"
out=$(run "$LONG")
n=$(printf '%s' "$out" | wc -c | tr -d ' ')
if [ "$n" -lt 220 ] && printf '%s' "$out" | grep -q '\.\.\.'; then echo "ok   long question truncated"
else echo "FAIL long question truncated (len $n)"; fails=$((fails+1)); fi

# Newlines in a question must not break the single-line notification.
NL='{"tool_name":"AskUserQuestion","cwd":"/tmp/repo","tool_input":{"questions":[{"question":"line one\nline two\n\nline three"}]}}'
out=$(run "$NL")
check "newlines collapse" \
  'notification show repo needs you --body line one line two line three --sound request' "$out"

# Everything below must stay silent.
out=$(run '{"tool_name":"Bash","cwd":"/tmp/repo","tool_input":{"command":"ls"}}')
check "other tools stay silent" "" "$out"

out=$(run '{"tool_name":"AskUserQuestion","agent_id":"a123","cwd":"/tmp/repo","tool_input":{"questions":[{"question":"q"}]}}')
check "subagent asks stay silent" "" "$out"

out=$(run '{"tool_name":"AskUserQuestion","cwd":"/tmp/repo","tool_input":{"questions":[]}}')
check "empty questions stay silent" "" "$out"

out=$(run 'not json at all')
check "malformed payload stays silent" "" "$out"

out=$(run '')
check "empty payload stays silent" "" "$out"

OVR_ENV=0 out=$(OVR_ENV=0 run "$ASK")
check "outside herdr stays silent" "" "$out"

OVR_PANE="" out=$(OVR_PANE="" run "$ASK")
check "no pane id stays silent" "" "$out"

# A hook that fails the tool call is worse than a missed bell.
printf '%s' 'garbage' | env HERDR_ENV=1 HERDR_PANE_ID=w1:p1 "$HOOK" >/dev/null 2>&1
check "malformed payload still exits 0" "0" "$?"
printf '%s' "$ASK" | env HERDR_ENV=1 HERDR_PANE_ID=w1:p1 "$HOOK" >/dev/null 2>&1
check "normal path exits 0" "0" "$?"

# The hook must print nothing: PreToolUse stdout is fed back to the model.
sout=$(printf '%s' "$ASK" | env HERDR_ENV=1 HERDR_PANE_ID=w1:p1 "$HOOK" 2>/dev/null)
check "no stdout leaks to the model" "" "$sout"

[ "$fails" -eq 0 ] && echo "all doorbell tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
