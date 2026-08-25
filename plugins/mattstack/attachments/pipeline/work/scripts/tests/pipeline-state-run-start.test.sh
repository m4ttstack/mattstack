#!/bin/sh
# attachments/pipeline/work/scripts/tests/pipeline-state-run-start.test.sh
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PS="$HERE/../pipeline-state.sh"
export HOME=$(mktemp -d)
out=$(sh "$PS" run-start --repo r --work-type feature --pipeline feature \
  --ticket ABC-1 --mattstack-sha deadbee --mattstack-dirty 1 --pack-dirs "")
db=$(printf '%s' "$out" | jq -r .runDb)
fail=0
[ "$(sqlite3 "$db" "SELECT value FROM fields WHERE key='ticket';")" = "ABC-1" ] || { echo "FAIL ticket field"; fail=1; }
[ "$(sqlite3 "$db" "SELECT produced_by FROM fields WHERE key='ticket';")" = "work" ] || { echo "FAIL ticket produced_by"; fail=1; }
case "$(sqlite3 "$db" "SELECT pack_commits FROM runs;")" in *"mattstack=deadbee"*) ;; *) echo "FAIL mattstack sha"; fail=1 ;; esac
[ "$(sqlite3 "$db" "SELECT pack_dirty FROM runs;")" = "1" ] || { echo "FAIL dirty"; fail=1; }
out2=$(sh "$PS" run-start --repo r --work-type feature --pipeline feature --pack-dirs "")
db2=$(printf '%s' "$out2" | jq -r .runDb)
[ -z "$(sqlite3 "$db2" "SELECT value FROM fields WHERE key='ticket';")" ] || { echo "FAIL ticket written without --ticket"; fail=1; }
out3=$(sh "$PS" run-start --repo r --work-type feature --pipeline feature \
  --mattstack-sha deadbee --mattstack-dirty 0 --pack-sha acme=abc1234 --pack-dirs "")
db3=$(printf '%s' "$out3" | jq -r .runDb)
case "$(sqlite3 "$db3" "SELECT pack_commits FROM runs;")" in
  *"mattstack=deadbee"*"acme=abc1234"*) ;;
  *) echo "FAIL pack sha"; fail=1 ;;
esac
[ "$fail" = 0 ] && echo "ok   run-start flags"
exit $fail
