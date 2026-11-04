#!/bin/bash
# Regenerates test-timings.json from a whole run of the unit suite. It measures
# into a new file and moves it over at the end: --update-timings keeps every
# entry it reads, so a deleted test would never leave the old file, and tests
# in the suite read the committed file while it runs.
# Usage: timings.sh [bun test arguments...], from the repo root.
set -uo pipefail
new=test-timings.new.json
rm -f "$new"
bun run test --timings="$new" --update-timings "$@"
status=$?
# bun writes nothing when no test ran.
[ ! -f "$new" ] || mv "$new" test-timings.json
exit "$status"
