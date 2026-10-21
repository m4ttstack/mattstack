#!/bin/sh
# open-gate.sh -- open a board gate from a domain skill's fitted open file.
#   open-gate.sh <status-bin> <state> <kind> <open-file>
# The open file is gate-ctx.sh `fit` output: {"context": <string>,
# "questions": [...]} with every context already a string. Opens it through
# `<status-bin> gate open --open-file`, printing that command's JSON line
# and exiting with its status. The pane-only `next` question is dropped;
# every context goes as is, whole at any size. The fitted open goes through
# a temp file, never argv: macOS caps argv near 1 MB.
# Exit 1: the file is not a gate open. Exit 2: usage.
set -u

[ $# -eq 4 ] || { echo "usage: open-gate.sh <status-bin> <state> <kind> <open-file>" >&2; exit 2; }
BIN=$1; STATE=$2; KIND=$3; OPEN=$4
command -v jq > /dev/null 2>&1 || { echo "open-gate: jq is required but not on PATH" >&2; exit 2; }

FITTED=$(jq -ce '
  select(type == "object" and (.questions | type) == "array")
  | .questions |= map(select(.id != "next"))
' "$OPEN" 2> /dev/null) || { echo "open-gate: $OPEN is not a gate open file" >&2; exit 1; }

FILE=$(mktemp "${TMPDIR:-/tmp}/open-gate.XXXXXX") || { echo "open-gate: cannot create a temp file" >&2; exit 2; }
trap 'rm -f "$FILE"' EXIT
printf '%s' "$FITTED" > "$FILE"
"$BIN" gate open "$STATE" --kind "$KIND" --open-file "$FILE"
