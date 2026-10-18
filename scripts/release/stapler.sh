#!/bin/bash
# scripts/release/stapler.sh <staple|validate> <target>
# `xcrun stapler` with retries for a lost connection to Apple's ticket service.
# Both actions look the ticket up at api.apple-cloudkit.com, and a GitHub
# runner's connection there can drop for a whole morning (NSURLError -1005)
# while notarization itself keeps succeeding. Only that network failure is
# retried; any other refusal fails at once with stapler's own words.
set -uo pipefail

ACTION="${1:-}"
TARGET="${2:-}"
case "$ACTION" in
    staple|validate) ;;
    *) echo "usage: stapler.sh <staple|validate> <target>" >&2; exit 2 ;;
esac
[ -n "$TARGET" ] || { echo "usage: stapler.sh <staple|validate> <target>" >&2; exit 2; }

TRIES=4
WAIT="${STAPLER_RETRY_WAIT:-15}"
for try in $(seq 1 "$TRIES"); do
    out="$(xcrun stapler "$ACTION" "$TARGET" 2>&1)"
    rc=$?
    if [ "$rc" -eq 0 ]; then
        printf '%s\n' "$out"
        exit 0
    fi
    if ! printf '%s' "$out" | grep -qE 'NSURLErrorDomain|CloudKit'; then
        printf '%s\n' "$out" >&2
        exit "$rc"
    fi
    if [ "$try" -lt "$TRIES" ]; then
        echo "  stapler $ACTION lost its connection to Apple's ticket service (try $try of $TRIES); retrying in $((WAIT * try))s" >&2
        sleep "$((WAIT * try))"
    fi
done
printf '%s\n' "$out" >&2
echo "✗ stapler $ACTION gave up after $TRIES tries: Apple's ticket service kept dropping the connection" >&2
exit "$rc"
