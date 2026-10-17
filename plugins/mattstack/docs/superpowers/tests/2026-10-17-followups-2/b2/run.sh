#!/usr/bin/env bash
# run.sh <system-file> <scenario> <outdir> <reps>
set -u
sys="$1"; scen="$2"; out="$3"; n="${4:-5}"
mkdir -p "$out"
for i in $(seq 1 "$n"); do
  d="$(mktemp -d "$out/rep$i.XXXX")"
  ( cd "$d" && claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
      --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence \
      --append-system-prompt-file "$sys" -p "$(cat "$scen")" > "$out/rep$i.txt" 2>&1 ) &
done
wait
