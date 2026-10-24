#!/bin/sh
# resolve-args.sh -- resolve /board:question's launch flags into one JSON object.
#
# The other board wrappers' resolve-args.sh resolves slot bindings. This
# wrapper has no slots (it delegates to no domain skill), so its script
# resolves the launch instead: it checks every flag the board passes is
# there, reads the review report json, picks out the one finding, and
# hashes the file. The hash is what `question send-back --report-sha`
# compares, so it must be of the exact bytes on disk, never a re-serialized
# copy. Run it again to re-read the report after a "report changed" refusal.
#
#   Invoke: "${CLAUDE_SKILL_DIR}/scripts/resolve-args.sh" <mrUrl> \
#             --state <handle> --status-bin <path> --report <md> \
#             --report-json <json> --finding <id> --gate <id>
#   Exit 0: {"ok":true,"mrUrl","state","statusBin","report","reportJson",
#            "findingId","gate","reportSha","finding":{...}}
#   Exit 1: {"ok":false,"code","message"}: the report is unreadable, or the
#           finding is not in it.
#   Exit 2: {"ok":false,"code","message"}: a missing or unknown flag, or no jq.
# Requires: POSIX sh, jq, and shasum or sha256sum. No bash-isms.

set -u

fail() { # $1=exit $2=code $3=message
  if command -v jq > /dev/null 2>&1; then
    jq -cn --arg code "$2" --arg msg "$3" '{ok: false, code: $code, message: $msg}'
  else
    printf '{"ok":false,"code":"%s","message":"jq is required but not on PATH"}\n' "$2"
  fi
  exit "$1"
}

command -v jq > /dev/null 2>&1 || fail 2 jq-missing "jq is required but not on PATH"

MR_URL="" STATE="" STATUS_BIN="" REPORT="" REPORT_JSON="" FINDING="" GATE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --state | --status-bin | --report | --report-json | --finding | --gate)
      [ $# -ge 2 ] || fail 2 usage "$1 needs a value"
      case "$1" in
        --state) STATE=$2 ;;
        --status-bin) STATUS_BIN=$2 ;;
        --report) REPORT=$2 ;;
        --report-json) REPORT_JSON=$2 ;;
        --finding) FINDING=$2 ;;
        --gate) GATE=$2 ;;
      esac
      shift 2
      ;;
    --*) fail 2 usage "unknown flag $1" ;;
    *)
      [ -z "$MR_URL" ] || fail 2 usage "a second positional argument: $1"
      MR_URL=$1
      shift
      ;;
  esac
done

[ -n "$MR_URL" ] || fail 2 usage "no <mrUrl>"
for pair in "state:$STATE" "status-bin:$STATUS_BIN" "report:$REPORT" \
  "report-json:$REPORT_JSON" "finding:$FINDING" "gate:$GATE"; do
  [ -n "${pair#*:}" ] || fail 2 usage "no --${pair%%:*}"
done

[ -r "$REPORT_JSON" ] || fail 1 report-unreadable "cannot read the review report json at $REPORT_JSON"

if command -v shasum > /dev/null 2>&1; then
  SHA=$(shasum -a 256 < "$REPORT_JSON" | awk '{print $1}')
elif command -v sha256sum > /dev/null 2>&1; then
  SHA=$(sha256sum < "$REPORT_JSON" | awk '{print $1}')
else
  fail 2 sha-missing "neither shasum nor sha256sum is on PATH"
fi

FINDING_JSON=$(jq -c --arg id "$FINDING" \
  'first((.findings // [])[] | select(.id == $id)) // empty' "$REPORT_JSON" 2> /dev/null) ||
  fail 1 report-invalid "the review report json at $REPORT_JSON is not valid JSON"
[ -n "$FINDING_JSON" ] || fail 1 finding-missing "finding $FINDING is not in the review report at $REPORT_JSON"

jq -cn \
  --arg mrUrl "$MR_URL" --arg state "$STATE" --arg statusBin "$STATUS_BIN" \
  --arg report "$REPORT" --arg reportJson "$REPORT_JSON" \
  --arg findingId "$FINDING" --arg gate "$GATE" --arg reportSha "$SHA" \
  --argjson finding "$FINDING_JSON" \
  '{ok: true, mrUrl: $mrUrl, state: $state, statusBin: $statusBin,
    report: $report, reportJson: $reportJson, findingId: $findingId,
    gate: $gate, reportSha: $reportSha, finding: $finding}'
