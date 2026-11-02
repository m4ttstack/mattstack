#!/bin/bash
# The approval watcher runs in its own process group (so its approve-join.sh
# dies with it), which under job control means bash no longer hands it
# /dev/null. Without a real tty a SIGTTIN cannot be shown here, so these
# check its two halves: the watcher never inherits the walkthrough's stdin,
# and stopping a watcher whose group is stopped (what SIGTTIN does) returns
# within its bound.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WALK="$HERE/../../walkthrough.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
check() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fails=$((fails+1)); fi; }

START=$(grep -oE 'set -m; approve_watcher[^;]*& APPROVE_PID=\$!; set \+m' "$WALK" | head -1)
STOP=$(sed -n '/^stop_approve_watcher()/,/^}/p' "$WALK")
check "walkthrough starts the watcher in its own process group" '[ -n "$START" ]'

# The stand-in watcher records what it can read from stdin; the test feeds a
# line on stdin, as an operator's terminal would hold one.
cat > "$T/start.sh" <<EOF
approve_watcher() { local x; read -r -t 1 x || x=none; printf '%s' "\$x" > "$T/read"; }
$START
wait "\$APPROVE_PID" 2>/dev/null
EOF
printf 'operator-typed\n' | /bin/bash "$T/start.sh"
check "the watcher reads nothing from the walkthrough's stdin" '[ "$(cat "$T/read" 2>/dev/null)" = none ]'

cat > "$T/stop.sh" <<EOF
$STOP
# A stopped group whose process also outlasts SIGTERM: only an escalation ends it.
set -m; /bin/bash -c 'trap "" TERM; while :; do sleep 1; done' </dev/null & APPROVE_PID=\$!; set +m
sleep 1
kill -STOP -- -"\$APPROVE_PID"
pid=\$APPROVE_PID; printf %s "\$pid" > "$T/pid"
stop_approve_watcher
kill -0 "\$pid" 2>/dev/null && exit 3
[ -z "\$APPROVE_PID" ] || exit 4
exit 0
EOF
/bin/bash "$T/stop.sh" & runner=$!
for _ in $(seq 1 30); do kill -0 "$runner" 2>/dev/null || break; sleep 1; done
if kill -0 "$runner" 2>/dev/null; then
  kill -KILL -- -"$(cat "$T/pid" 2>/dev/null)" 2>/dev/null; kill -KILL "$runner" 2>/dev/null; wait "$runner" 2>/dev/null; rc=124
else
  wait "$runner"; rc=$?
fi
check "stopping a stopped watcher group returns within its bound and leaves nothing running (rc=$rc)" '[ "$rc" -eq 0 ]'

echo; [ "$fails" -eq 0 ] && echo "  all approval watcher checks ok" || { echo "  $fails check(s) failed"; exit 1; }
