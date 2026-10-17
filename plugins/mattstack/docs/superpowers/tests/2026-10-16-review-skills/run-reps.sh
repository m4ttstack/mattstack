#!/usr/bin/env bash
# Run the describe-only test reps for the review skills.
#
#   run-reps.sh <system-dir> <out-dir> [--reps N] [--parallel P] [scenario-id ...]
#
# <system-dir> holds review.md, self-review.md and receive-review.md from
# build-system-files.sh. Each scenario under scenarios/ names its system file
# on its first line. With no ids, every scenario runs. Each rep runs from its
# own fresh empty directory, <out-dir>/<id>/rep-<n>/, and its transcript is
# <out-dir>/<id>/rep-<n>.txt. The claude recipe below is the approved
# describe-only one: no tools, no MCP servers, no hooks, no slash commands,
# no session persistence. Never add a flag that gives a rep a tool.
set -euo pipefail

usage() {
  echo "usage: run-reps.sh <system-dir> <out-dir> [--reps N] [--parallel P] [scenario-id ...]" >&2
  exit 64
}

[ "$#" -ge 2 ] || usage
sys_dir="$(cd "$1" && pwd -P)"
out_arg="$2"
shift 2
reps=5
parallel=10
ids=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reps) reps="$2"; shift 2 ;;
    --parallel) parallel="$2"; shift 2 ;;
    -*) usage ;;
    *) ids+=("$1"); shift ;;
  esac
done

here="$(cd "$(dirname "$0")" && pwd -P)"
repo_real="$(git -C "$here" rev-parse --show-toplevel)"
repo_real="$(cd "$repo_real" && pwd -P)"
mkdir -p "$out_arg"
out="$(cd "$out_arg" && pwd -P)"
case "$out/" in
  "$repo_real"/*) echo "refusing: <out-dir> $out is inside the repo" >&2; exit 65 ;;
esac

if [ "${#ids[@]}" -eq 0 ]; then
  for f in "$here"/scenarios/*.md; do
    b="$(basename "$f" .md)"
    ids+=("${b%%-*}")
  done
fi

jobs_file="$out/.jobs"
: > "$jobs_file"
for id in "${ids[@]}"; do
  matches=("$here"/scenarios/"$id"-*.md)
  [ -f "${matches[0]}" ] || { echo "no scenario $id" >&2; exit 66; }
  scenario="${matches[0]}"
  sys_name="$(sed -n '1s/^System file: \([a-z-]*\.md\).*/\1/p' "$scenario")"
  [ -s "$sys_dir/$sys_name" ] || { echo "no system file $sys_name for $id" >&2; exit 66; }
  for n in $(seq 1 "$reps"); do
    printf '%s\t%s\t%s\t%s\n' "$id" "$n" "$scenario" "$sys_dir/$sys_name" >> "$jobs_file"
  done
done

run_one() {
  local id="$1" n="$2" scenario="$3" sys="$4" out="$5"
  local cwd="$out/$id/rep-$n"
  rm -rf "$cwd"
  mkdir -p "$cwd"
  (cd "$cwd" && claude --model sonnet --tools "" --strict-mcp-config \
    --setting-sources local --settings '{"disableAllHooks":true}' \
    --disable-slash-commands --no-session-persistence \
    --append-system-prompt-file "$sys" -p "$(cat "$scenario")") \
    > "$out/$id/rep-$n.txt" 2> "$out/$id/rep-$n.err" || true
  echo "done $id rep-$n ($(wc -w < "$out/$id/rep-$n.txt") words)"
}
export -f run_one

while IFS=$'\t' read -r id n scenario sys; do
  printf '%s\0%s\0%s\0%s\0%s\0' "$id" "$n" "$scenario" "$sys" "$out"
done < "$jobs_file" | xargs -0 -n 5 -P "$parallel" bash -c 'run_one "$@"' _
