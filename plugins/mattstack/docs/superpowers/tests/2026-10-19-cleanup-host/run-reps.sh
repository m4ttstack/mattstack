#!/bin/bash
# usage: run-reps.sh <red|green> <scenario...>; 5 tool-less reps each, from an empty dir, into runs/
T="$(cd "$(dirname "$0")" && pwd)"
E="$(mktemp -d)"
mkdir -p "$T/runs"; cd "$E" || exit 1
mode=$1; shift
for name in "$@"; do for i in 1 2 3 4 5; do
  ( claude --model sonnet --tools "" --strict-mcp-config --setting-sources local --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence -p < "$T/$mode-$name.md" > "$T/runs/$mode-$name-$i.txt" 2>&1 ) &
done; done; wait; rmdir "$E"
