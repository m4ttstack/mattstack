#!/usr/bin/env bash
# Manage the headless herd session: the invisible place agent panes live.
#
# Usage:
#   herd-session.sh start  [-s <name>]   start it if not already running
#   herd-session.sh status [-s <name>]   running? how many workspaces/panes?
#   herd-session.sh stop   [-s <name>]   stop it and every pane in it
#
# A named herdr session is a separate server with its own socket, workspaces,
# tabs, and panes. Nothing in it renders in the session the user is attached
# to, and there is no way to move a pane between the two (separate server
# processes) -- intervention goes through attend.sh, which streams one pane
# into a temporary split instead.
#
# `start` runs `herdr server` with no client, so the session is headless from
# birth rather than started-then-detached. Prints the session name on stdout;
# everything else goes to stderr. Safe to call repeatedly.
set -euo pipefail

SESSION="${SHEPHERDR_HERD_SESSION:-herd}"
CMD="${1:-}"
[ $# -gt 0 ] && shift
while getopts "s:" opt; do
  case "$opt" in
    s) SESSION="$OPTARG" ;;
    *) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
  esac
done

LOG="$HOME/.mattstack/shepherdr/herd-$SESSION.log"

# Session-targeted herdr. See scripts/hrd for why HERDR_SOCKET_PATH must go.
h() { env -u HERDR_SOCKET_PATH HERDR_SESSION="$SESSION" herdr "$@"; }

reachable() { h workspace list >/dev/null 2>&1; }

case "$CMD" in
  start)
    if reachable; then
      echo "herd-session: '$SESSION' already running" >&2
      echo "$SESSION"
      exit 0
    fi
    mkdir -p "$(dirname "$LOG")"
    env -u HERDR_SOCKET_PATH HERDR_SESSION="$SESSION" nohup herdr server >>"$LOG" 2>&1 &
    disown || true
    for _ in $(seq 1 20); do
      sleep 0.5
      if reachable; then
        echo "herd-session: started '$SESSION' (log: $LOG)" >&2
        echo "$SESSION"
        exit 0
      fi
    done
    echo "herd-session: '$SESSION' did not come up within 10s; see $LOG" >&2
    exit 1
    ;;

  status)
    if ! reachable; then
      echo "herd-session: '$SESSION' not running" >&2
      exit 1
    fi
    h workspace list | python3 -c '
import json, sys
ws = json.load(sys.stdin)["result"]["workspaces"]
panes = sum(w.get("pane_count", 0) for w in ws)
print(len(ws), "workspace(s),", panes, "pane(s)")
for w in ws:
    print("  ", w["workspace_id"], w.get("agent_status", "?").ljust(8), w.get("label", ""))
'
    echo "$SESSION"
    ;;

  stop)
    if ! reachable; then
      echo "herd-session: '$SESSION' not running" >&2
      exit 0
    fi
    env -u HERDR_SOCKET_PATH herdr session stop "$SESSION" >&2
    ;;

  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
    ;;
esac
