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
case "$n" in
  ""|*[!0-9]*|0*) echo "refusing: <n> must be a positive integer, got $n" >&2; exit 64 ;;
esac
common_file="$(dirname "$scenario_file")/common.md"
repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
repo_real="$(cd "$repo_root" && pwd -P)"

for f in "$system_file" "$scenario_file" "$common_file"; do
  [ -s "$f" ] || { echo "missing or empty: $f" >&2; exit 66; }
done

# The real path of a directory that may not exist yet: the nearest existing
# ancestor resolved with pwd -P, plus the missing tail.
real_path() {
  local p="$1" tail=""
  while [ ! -d "$p" ]; do
    case "$(basename "$p")" in
      ..|.) echo "refusing: <out-dir> $1 has a . or .. in a missing part" >&2; exit 65 ;;
    esac
    tail="/$(basename "$p")$tail"
    p="$(dirname "$p")"
  done
  echo "$(cd "$p" && pwd -P)$tail"
}

out="$(real_path "$out_arg")"
case "$out/" in
  "$repo_real"/*)
    echo "refusing: <out-dir> $out is inside the repo $repo_real" >&2
    exit 65
    ;;
esac
mkdir -p "$out"

prompt="$(cat "$common_file")

$(cat "$scenario_file")

---

$(cat "$system_file")"

pids=()
rep_dirs=()
for i in $(seq 1 "$n"); do
  rep_dir="$(mktemp -d "$out/.rep-$i.XXXXXX")"
  rep_dirs+=("$rep_dir")
  (cd "$rep_dir" && claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
    --settings '{"disableAllHooks":true}' --disable-slash-commands \
    --no-session-persistence -p "$prompt" > "$out/rep-$i.txt" 2> "$out/rep-$i.err") &
  pids+=("$!")
done

status=0
for pid in "${pids[@]}"; do
  wait "$pid" || status=1
done
for d in "${rep_dirs[@]}"; do
  case "$d" in
    "$out"/.rep-*) rm -rf "$d" ;;
  esac
done

for i in $(seq 1 "$n"); do
  [ -s "$out/rep-$i.txt" ] || { echo "empty rep: $out/rep-$i.txt" >&2; status=1; }
done
exit "$status"
