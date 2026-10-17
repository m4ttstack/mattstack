#!/usr/bin/env bash
# Run N fresh describe-only reps of one prompt with the ship-ci lane's recipe.
#
#   run-reps.sh --prompt <prompt-file> --out <dir> [--system <file>] [--reps N]
#
# Without --system the prompt file is the whole prompt. With --system that
# file goes in through --append-system-prompt-file and the prompt file is the
# user turn. Each rep runs tool-less from its own fresh empty directory under
# <out>'s parent and writes its stdout to <out>/rep-<n>.txt. At most 5 reps
# run at once. <out> must lie outside the repo. The prompt follows `--`
# because a skill file opens with `---`, which the CLI reads as an option.
set -euo pipefail

usage() { echo "usage: run-reps.sh --prompt <prompt-file> --out <dir> [--system <file>] [--reps N]" >&2; exit 64; }

prompt="" out_arg="" system="" reps=5
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prompt) [ "$#" -ge 2 ] || usage; prompt="$2"; shift 2 ;;
    --out) [ "$#" -ge 2 ] || usage; out_arg="$2"; shift 2 ;;
    --system) [ "$#" -ge 2 ] || usage; system="$2"; shift 2 ;;
    --reps) [ "$#" -ge 2 ] || usage; reps="$2"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$prompt" ] && [ -n "$out_arg" ] || usage
[ -s "$prompt" ] || { echo "empty or missing prompt file: $prompt" >&2; exit 66; }
[ -z "$system" ] || [ -s "$system" ] || { echo "empty or missing system file: $system" >&2; exit 66; }
case "$reps" in ''|*[!0-9]*|0) usage ;; esac

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
repo_real="$(cd "$repo_root" && pwd -P)"

# Resolve <out> through its nearest existing ancestor, so the refusal fires
# before anything is created inside the repo.
probe="$out_arg"
rest=""
while [ ! -d "$probe" ]; do
  rest="/$(basename "$probe")$rest"
  probe="$(dirname "$probe")"
done
out="$(cd "$probe" && pwd -P)$rest"
case "$out/" in
  "$repo_real"/*) echo "refusing: <out> $out is inside the repo $repo_real" >&2; exit 65 ;;
esac
mkdir -p "$out"
prompt="$(cd "$(dirname "$prompt")" && pwd -P)/$(basename "$prompt")"
[ -z "$system" ] || system="$(cd "$(dirname "$system")" && pwd -P)/$(basename "$system")"

parent="$(dirname "$out")"
tag="$(basename "$out")"

run_one() {
  local n="$1" dir
  dir="$(mktemp -d "$parent/rep-$tag-$n.XXXXXX")"
  local sys_args=()
  [ -z "$system" ] || sys_args=(--append-system-prompt-file "$system")
  (cd "$dir" && claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
    --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence \
    ${sys_args[@]+"${sys_args[@]}"} -p -- "$(cat "$prompt")") > "$out/rep-$n.txt" 2> "$out/rep-$n.err" || true
  local bytes
  bytes="$(wc -c < "$out/rep-$n.txt" | tr -d ' ')"
  if [ "$bytes" -eq 0 ]; then
    echo "rep $n: EMPTY, stderr: $(head -c 200 "$out/rep-$n.err" | tr '\n' ' ')"
  else
    echo "rep $n: $bytes bytes, dir $dir"
  fi
}

pids=()
for n in $(seq 1 "$reps"); do
  run_one "$n" &
  pids+=("$!")
  if [ "${#pids[@]}" -ge 5 ]; then
    wait "${pids[0]}"
    pids=("${pids[@]:1}")
  fi
done
for p in ${pids[@]+"${pids[@]}"}; do wait "$p"; done
