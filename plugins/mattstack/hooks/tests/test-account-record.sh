#!/usr/bin/env bash
# Offline tests for account-record.sh.
#
# `rt` is a stub that appends its argv to a calls file and exits RT_STUB_EXIT (default 0). HOME and TMPDIR are
# sandboxed, so the stamp, the config file and the rt lookup never touch the real ones.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../account-record.sh"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
SANDBOX="$(cd "$SANDBOX" && pwd -P)"
mkdir -p "$SANDBOX/bin" "$SANDBOX/home" "$SANDBOX/tmp" "$SANDBOX/cfg"
CALLS="$SANDBOX/calls"
cat > "$SANDBOX/bin/rt" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RT_STUB_CALLS"
echo "noise"; echo "noise" >&2
exit "${RT_STUB_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/rt"

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

run() { # session [extra env assignments...] -> "exit=<code> out=<stdout+stderr>"
  local out code sid="$1"; shift
  out="$(printf '{"session_id":"%s","hook_event_name":"Stop"}' "$sid" \
    | env -i HOME="$SANDBOX/home" TMPDIR="$SANDBOX/tmp" PATH="$SANDBOX/bin:/usr/bin:/bin" \
        RT_STUB_CALLS="$CALLS" "$@" sh "$HOOK" 2>&1)"
  code=$?
  printf 'exit=%s out=%s' "$code" "$out"
}
calls() { if [ -f "$CALLS" ]; then wc -l < "$CALLS" | tr -d ' '; else echo 0; fi; }
reset() { rm -f "$CALLS" "$SANDBOX"/tmp/* "$SANDBOX/home/.claude.json" "$SANDBOX/cfg/.claude.json"; }

reset
echo '{}' > "$SANDBOX/home/.claude.json"
check "first call: exit" "exit=0 out=" "$(run s1)"
check "first call: calls" "1" "$(calls)"
check "first call: argv" "usage record-account --session s1" "$(cat "$CALLS")"

check "unchanged config: exit" "exit=0 out=" "$(run s1)"
check "unchanged config: no new call" "1" "$(calls)"

touch -t 203001010000 "$SANDBOX/home/.claude.json"
run s1 >/dev/null
check "touched config calls again" "2" "$(calls)"

reset
printf '{}' > "$SANDBOX/home/.claude.json"
touch -t 203001010000 "$SANDBOX/home/.claude.json"
run s7 >/dev/null
printf '{"a":1}' > "$SANDBOX/home/.claude.json"
touch -t 203001010000 "$SANDBOX/home/.claude.json"
run s7 >/dev/null
check "same mtime, different size calls again" "2" "$(calls)"

reset
check "missing config, no api key: exit" "exit=0 out=" "$(run s2)"
check "missing config, no api key: no call" "0" "$(calls)"
check "missing config, api key: exit" "exit=0 out=" "$(run s2 ANTHROPIC_API_KEY=x)"
check "missing config, api key: calls" "1" "$(calls)"
run s2 ANTHROPIC_API_KEY=x >/dev/null
check "missing config, api key: unchanged key, no new call" "1" "$(calls)"

reset
echo '{}' > "$SANDBOX/home/.claude.json"
run s3 >/dev/null
run s3 ANTHROPIC_API_KEY=x >/dev/null
check "api key appearing changes the key" "2" "$(calls)"

reset
echo '{}' > "$SANDBOX/home/.claude.json"
echo '{}' > "$SANDBOX/cfg/.claude.json"
run s4 CLAUDE_CONFIG_DIR="$SANDBOX/cfg" >/dev/null
touch -t 203001010000 "$SANDBOX/home/.claude.json"
run s4 CLAUDE_CONFIG_DIR="$SANDBOX/cfg" >/dev/null
check "CLAUDE_CONFIG_DIR ignores HOME config" "1" "$(calls)"
touch -t 203001010000 "$SANDBOX/cfg/.claude.json"
run s4 CLAUDE_CONFIG_DIR="$SANDBOX/cfg" >/dev/null
check "CLAUDE_CONFIG_DIR watches its own file" "2" "$(calls)"

reset
echo '{}' > "$SANDBOX/home/.claude.json"
out="$(printf '{"hook_event_name":"Stop"}' | env -i HOME="$SANDBOX/home" TMPDIR="$SANDBOX/tmp" PATH="$SANDBOX/bin:/usr/bin:/bin" RT_STUB_CALLS="$CALLS" sh "$HOOK" 2>&1; echo "exit=$?")"
check "no session id: silent" "exit=0" "$out"
check "no session id: no call" "0" "$(calls)"

reset
echo '{}' > "$SANDBOX/home/.claude.json"
out="$(printf '{"session_id":"s5"}' | env -i HOME="$SANDBOX/home" TMPDIR="$SANDBOX/tmp" PATH=/usr/bin:/bin sh "$HOOK" 2>&1; echo "exit=$?")"
check "no rt anywhere exits 0 silently" "exit=0" "$out"
check "no rt: no stamp written" "0" "$(ls "$SANDBOX/tmp" | wc -l | tr -d ' ')"

reset
echo '{}' > "$SANDBOX/home/.claude.json"
FAILSTAMP="$SANDBOX/tmp/mattstack-account-fail-s6"
check "rt exit 2 and noise stays silent" "exit=0 out=" "$(run s6 RT_STUB_EXIT=2)"
check "rt exit 2: no success stamp" "0" "$(ls "$SANDBOX/tmp" | grep -c '^mattstack-account-record-')"
check "rt exit 2: failure stamp holds epoch seconds" "1" "$(grep -Ec '^[0-9]{10,}$' "$FAILSTAMP")"
check "rt failed: immediate second call is throttled" "exit=0 out=" "$(run s6)"
check "rt failed: immediate second call does not call rt" "1" "$(calls)"

echo $(( $(date +%s) - 120 )) > "$FAILSTAMP"
run s6 RT_STUB_EXIT=2 >/dev/null
check "failure stamp older than 60s: rt is called again" "2" "$(calls)"
check "a failed retry refreshes the failure stamp" "1" "$(( $(date +%s) - $(cat "$FAILSTAMP") < 60 ))"

echo $(( $(date +%s) - 120 )) > "$FAILSTAMP"
run s6 >/dev/null
check "success after a failure calls rt" "3" "$(calls)"
check "success clears the failure stamp" "no" "$([ -e "$FAILSTAMP" ] && echo yes || echo no)"
check "success writes the stamp" "1" "$(ls "$SANDBOX/tmp" | grep -c '^mattstack-account-record-')"

reset
echo '{}' > "$SANDBOX/home/.claude.json"
run s8 RT_STUB_EXIT=2 >/dev/null
check "throttle is per session" "exit=0 out=" "$(run s9)"
check "throttle is per session: other session calls rt" "2" "$(calls)"

[ "$fails" -eq 0 ] && echo "all account-record tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
