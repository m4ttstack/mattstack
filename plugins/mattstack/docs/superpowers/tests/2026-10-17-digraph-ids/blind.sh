#!/usr/bin/env bash
# Blind rep transcripts for scoring.
#
#   blind.sh <dir>... <blind-dir>
#
# Copies every rep-*.txt in each <dir> to <blind-dir>/<random>.txt and writes
# the mapping (blind name, source path) to <blind-dir>/../mapping.tsv. Prints
# the blind names in a random order to score in. <blind-dir> must lie outside
# the repo.
set -euo pipefail

[ "$#" -ge 2 ] || { echo "usage: blind.sh <dir>... <blind-dir>" >&2; exit 64; }
args=("$@")
blind_arg="${args[$(( $# - 1 ))]}"
srcs=("${args[@]:0:$(( $# - 1 ))}")

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
repo_real="$(cd "$repo_root" && pwd -P)"

probe="$blind_arg"
rest=""
while [ ! -d "$probe" ]; do
  rest="/$(basename "$probe")$rest"
  probe="$(dirname "$probe")"
done
blind="$(cd "$probe" && pwd -P)$rest"
case "$blind/" in
  "$repo_real"/*) echo "refusing: <blind-dir> $blind is inside the repo $repo_real" >&2; exit 65 ;;
esac
mkdir -p "$blind"
mapping="$(dirname "$blind")/mapping.tsv"
: > "$mapping"

for d in "${srcs[@]}"; do
  d="$(cd "$d" && pwd -P)"
  for f in "$d"/rep-*.txt; do
    [ -e "$f" ] || continue
    while :; do
      name="$(openssl rand -hex 4)"
      [ -e "$blind/$name.txt" ] || break
    done
    cp "$f" "$blind/$name.txt"
    printf '%s\t%s\n' "$name" "$f" >> "$mapping"
  done
done

cut -f1 "$mapping" | while read -r n; do echo "$RANDOM $n"; done | sort -n | cut -d' ' -f2
