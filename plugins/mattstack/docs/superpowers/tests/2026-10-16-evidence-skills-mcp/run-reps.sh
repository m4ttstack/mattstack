#!/usr/bin/env bash
# Run n describe-only reps of one scenario against one compiled system file.
#
#   run-reps.sh <system-file> <scenario-file> <out-dir> <n>
#
# The prompt is common.md (beside the scenario), the scenario, a --- rule and
# the system file. Each rep runs tool-less from its own fresh empty directory,
# all n in parallel, and writes <out-dir>/rep-<i>.txt.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: run-reps.sh <system-file> <scenario-file> <out-dir> <n>" >&2
  exit 64
fi

system_file="$1"
scenario_file="$2"
out_arg="$3"
n="$4"
common_file="$(dirname "$scenario_file")/common.md"
repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
repo_real="$(cd "$repo_root" && pwd -P)"

for f in "$system_file" "$scenario_file" "$common_file"; do
  [ -s "$f" ] || { echo "missing or empty: $f" >&2; exit 66; }
done

mkdir -p "$out_arg"
out="$(cd "$out_arg" && pwd -P)"
case "$out/" in
  "$repo_real"/*)
    echo "refusing: <out-dir> $out is inside the repo $repo_real" >&2
    exit 65
    ;;
esac

prompt="$(cat "$common_file")

$(cat "$scenario_file")

---

$(cat "$system_file")"

pids=()
for i in $(seq 1 "$n"); do
  rep_dir="$(mktemp -d "$out/.rep-$i.XXXXXX")"
  (cd "$rep_dir" && claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
    --settings '{"disableAllHooks":true}' --disable-slash-commands \
    --no-session-persistence -p "$prompt" > "$out/rep-$i.txt" 2> "$out/rep-$i.err") &
  pids+=("$!")
done

status=0
for pid in "${pids[@]}"; do
  wait "$pid" || status=1
done

for i in $(seq 1 "$n"); do
  [ -s "$out/rep-$i.txt" ] || { echo "empty rep: $out/rep-$i.txt" >&2; status=1; }
done
exit "$status"
