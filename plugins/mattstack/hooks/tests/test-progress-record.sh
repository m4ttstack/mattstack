#!/usr/bin/env bash
# Offline tests for progress-record.sh.
#
# `rt` is a stub that appends its argv to a calls file. HOME and TMPDIR are
# sandboxed, so the throttle stamp and the rt lookup never touch the real ones.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../progress-record.sh"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
SANDBOX="$(cd "$SANDBOX" && pwd -P)"
mkdir -p "$SANDBOX/bin" "$SANDBOX/home" "$SANDBOX/tmp" "$SANDBOX/plain"
CALLS="$SANDBOX/calls"
cat > "$SANDBOX/bin/rt" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RT_STUB_CALLS"
if [ -f "${RT_STUB_USAGE:-/nonexistent}" ]; then echo "usage: rt progress ..."; echo "unknown verb" >&2; exit 2; fi
exit 0
STUB
chmod +x "$SANDBOX/bin/rt"

REPO="$SANDBOX/repo"
git init -q "$REPO"

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

run() { # session cwd [path] -> "exit=<code> out=<stdout+stderr>"
  local out code
  out="$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"PostToolUse"}' "$1" "$2" \
    | env -i HOME="$SANDBOX/home" TMPDIR="$SANDBOX/tmp" PATH="${3:-$SANDBOX/bin:/usr/bin:/bin}" \
        RT_STUB_CALLS="$CALLS" ${RT_STUB_USAGE:+RT_STUB_USAGE="$RT_STUB_USAGE"} sh "$HOOK" 2>&1)"
  code=$?
  printf 'exit=%s out=%s' "$code" "$out"
}
calls() { if [ -f "$CALLS" ]; then wc -l < "$CALLS" | tr -d ' '; else echo 0; fi; }
reset() { rm -f "$CALLS" "$SANDBOX"/tmp/*; }

reset
check "no sdd dir skips rt: exit" "exit=0 out=" "$(run s1 "$REPO")"
check "no sdd dir skips rt: calls" "0" "$(calls)"

mkdir -p "$REPO/.superpowers/sdd"
reset
check "sdd dir records once: exit" "exit=0 out=" "$(run s2 "$REPO")"
check "sdd dir records once: calls" "1" "$(calls)"
check "sdd dir records once: argv" "progress record --tree $REPO" "$(cat "$CALLS")"

check "second call inside 60s is throttled: exit" "exit=0 out=" "$(run s2 "$REPO")"
check "second call inside 60s is throttled: calls" "1" "$(calls)"

echo $(( $(date +%s) - 120 )) > "$SANDBOX/tmp/mattstack-progress-record-s2"
run s2 "$REPO" >/dev/null
check "stale stamp records again" "2" "$(calls)"

reset
touch "$SANDBOX/usage"
check "old rt usage exit stays silent" "exit=0 out=" "$(RT_STUB_USAGE="$SANDBOX/usage" run s3 "$REPO")"
check "old rt usage exit still called rt" "1" "$(calls)"

reset
check "no rt on PATH exits 0" "exit=0 out=" "$(run s4 "$REPO" /usr/bin:/bin)"
check "no rt on PATH made no calls" "0" "$(calls)"

reset
check "cwd outside git exits 0" "exit=0 out=" "$(run s5 "$SANDBOX/plain")"
check "cwd outside git made no calls" "0" "$(calls)"

[ "$fails" -eq 0 ] && echo "all progress-record tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
