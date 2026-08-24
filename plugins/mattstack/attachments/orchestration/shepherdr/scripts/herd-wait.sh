#!/usr/bin/env bash
# The shepherd's single bus wait. Threads the persisted cursor into
# `rt events wait`, persists the returned cursor (every response carries
# one, including timeouts), prints rt's JSON verbatim, and passes rt's
# exit code through: 0 events / 124 timeout (sweep) / 1 bus unrecoverable.
# The persisted cursor is a wake optimization; resume correctness comes
# from DB reconciliation (see references/herd-bus.md), so persisting
# before the shepherd handles the events is safe.
#
# Usage: herd-wait.sh --db <herd.db> [--timeout 15m]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB=""; TIMEOUT="15m"
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "herd-wait: unknown arg $1" >&2; exit 2 ;;
  esac
done
[ -n "$DB" ] || { echo "herd-wait: --db required" >&2; exit 2; }

read -r RUN CURSOR < <(python3 -c "
import sys; sys.path.insert(0, '$HERE'); import herd_db
c = herd_db.connect('$DB')
print(herd_db.get_state(c, 'run_id'), herd_db.get_state(c, 'cursor') or 0)
")

set +e
OUT="$(rt events wait "shepherdr/$RUN/**" --after "$CURSOR" --timeout "$TIMEOUT")"
CODE=$?
set -e

if [ "$CODE" -eq 0 ] || [ "$CODE" -eq 124 ]; then
  echo "$OUT" | python3 -c "
import json, sys
sys.path.insert(0, '$HERE'); import herd_db
resp = json.load(sys.stdin)
c = herd_db.connect('$DB')
herd_db.set_state(c, 'cursor', resp['cursor'])
"
fi
[ -n "$OUT" ] && echo "$OUT"
exit "$CODE"
