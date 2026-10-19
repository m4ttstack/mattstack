#!/bin/bash
# usage: run-reps.sh <red|green> <scenario...>; 5 tool-less reps each, from an empty dir, into runs/
# Exits 1 when any rep's claude process failed; its output file holds the error.
T="$(cd "$(dirname "$0")" && pwd)"
E="$(mktemp -d)"
mkdir -p "$T/runs"; cd "$E" || exit 1
mode=$1; shift
pids=(); outs=()
for name in "$@"; do for i in 1 2 3 4 5; do
  out="$T/runs/$mode-$name-$i.txt"
  claude --model sonnet --tools "" --strict-mcp-config --setting-sources local --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence -p < "$T/$mode-$name.md" > "$out" 2>&1 &
  pids+=($!); outs+=("$out")
done; done
failed=0
for k in "${!pids[@]}"; do wait "${pids[$k]}" || { echo "failed: ${outs[$k]}" >&2; failed=1; }; done
rmdir "$E"
exit $failed
