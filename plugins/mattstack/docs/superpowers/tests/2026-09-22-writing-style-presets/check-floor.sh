#!/bin/sh
# check-floor.sh <outputs-dir> -- mechanical floor violations in preset outputs.
set -u
DIR=${1:?usage: check-floor.sh <outputs-dir>}
HITS=0
report() { echo "$1"; HITS=1; }

if grep -rn "$(printf '\342\200\224')\|$(printf '\342\200\223')" "$DIR"; then report "FAIL: em or en dash"; fi

PHRASES='smoking gun|load-bearing|razor-sharp|money question|nails it|plot thickens|here.s the kicker|dive in|great catch|good catch|nice find|you.re (absolutely )?right|thanks for (flagging|catching|the review)|in order to|facilitate|leverage|please let me know|happy to discuss|worth flagging|one thing i noticed|took a look|i just wanted to'
if grep -rniE "$PHRASES" "$DIR"; then report "FAIL: banned phrase"; fi

if grep -rnE '`(issue|suggestion|question|nitpick|thought)( \(non-blocking\))?:`' "$DIR"; then report "FAIL: label as a code span"; fi

[ "$HITS" -eq 0 ] && echo "ok floor"
exit "$HITS"
