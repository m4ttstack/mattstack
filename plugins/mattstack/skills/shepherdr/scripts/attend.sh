#!/usr/bin/env bash
# Surface one invisible herd pane in the visible session so the user can
# intervene, then get out of the way again.
#
# Usage:
#   attend.sh <herd-pane-id> [-s <session>] [-l <label>]
#
# Herd panes live in a separate herdr server, and panes cannot move between
# servers. So this does not relocate the agent: it opens a tab in the visible
# session and attaches that tab's terminal to the herd pane. The agent never
# moves or restarts; the user is just looking at it through a window.
#
# `terminal attach` is the interactive primitive, and it is the only one that
# works here. `terminal session control` sounds right and is not: it is the
# thin client's wire protocol, so pointing a tab at it fills the screen with
# JSON frames of base64 ANSI. It also keys on terminal ids, not pane ids,
# hence the lookup below.
#
# A tab, not a split: the attached terminal renders at the size of whatever
# surface it lands in, and a full tab is the one that will not clip a Claude
# TUI.
#
# Detach with ctrl+b q. The tab is left open (the user may want to look
# again); the shepherd closes it with `herdr tab close <tab-id>` when the
# intervention is resolved. Prints "<tab-id> <pane-id>" for the visible tab
# on stdout, so the shepherd can clean up without guessing.
set -euo pipefail

SESSION="${SHEPHERDR_HERD_SESSION:-herd}"
LABEL=""
TARGET="${1:-}"
[ $# -gt 0 ] && shift
while getopts "s:l:" opt; do
  case "$opt" in
    s) SESSION="$OPTARG" ;;
    l) LABEL="$OPTARG" ;;
    *) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
  esac
done
[ -n "$TARGET" ] || { echo "attend: <herd-pane-id> required" >&2; exit 2; }

# Resolve the pane to the terminal it hosts. Doubles as the existence check:
# a stale pane id fails here with a clear message instead of as a dead tab
# the user has to diagnose from the inside.
TERM_ID="$(env -u HERDR_SOCKET_PATH HERDR_SESSION="$SESSION" herdr pane get "$TARGET" 2>/dev/null \
  | python3 -c 'import sys,json
d = json.load(sys.stdin)["result"]
print((d.get("pane") or d).get("terminal_id") or "")' 2>/dev/null || true)"
if [ -z "$TERM_ID" ]; then
  echo "attend: no terminal for pane $TARGET in herd session '$SESSION'" >&2
  exit 1
fi

# The visible session: plain herdr, no session override, inheriting this
# pane's injected socket. This is the one place in shepherdr that must NOT
# route through scripts/hrd.
read -r TAB PANE < <(
  herdr tab create --workspace "$HERDR_WORKSPACE_ID" --label "attend: ${LABEL:-$TARGET}" --focus \
    | python3 -c 'import sys,json; r=json.load(sys.stdin)["result"]; print(r["tab"]["tab_id"], r["root_pane"]["pane_id"])'
)

herdr pane run "$PANE" \
  "env -u HERDR_SOCKET_PATH HERDR_SESSION=$SESSION herdr terminal attach $TERM_ID --takeover"

echo "attend: streaming herd pane $TARGET into $PANE (detach with ctrl+b q)" >&2
echo "$TAB $PANE"
