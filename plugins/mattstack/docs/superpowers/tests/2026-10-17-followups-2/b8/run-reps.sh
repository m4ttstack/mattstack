#!/usr/bin/env bash
# Run n describe-only reps of one scenario against one compiled system file.
#
#   run-reps.sh <system-file> <prompt-file> <out-dir> <n>
#
# <prompt-file> is the whole user prompt. Each rep runs tool-less from its own
# fresh empty directory, all n in parallel, writing <out-dir>/rep-<i>.txt.
set -euo pipefail
[ "$#" -eq 4 ] || { echo "usage: run-reps.sh <system-file> <prompt-file> <out-dir> <n>" >&2; exit 64; }
sys="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"
prompt_file="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"; out="$3"; n="$4"
mkdir -p "$out"
pids=()
for i in $(seq 1 "$n"); do
  d="$(mktemp -d "$out/.rep-$i.XXXXXX")"
  (cd "$d" && claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
    --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence \
    --append-system-prompt-file "$sys" -p "$(cat "$prompt_file")" > "$out/rep-$i.txt" 2> "$out/rep-$i.err"; rmdir "$d") &
  pids+=("$!")
done
status=0
for p in "${pids[@]}"; do wait "$p" || status=1; done
exit "$status"
