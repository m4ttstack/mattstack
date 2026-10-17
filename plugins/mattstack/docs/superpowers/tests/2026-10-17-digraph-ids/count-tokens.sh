#!/usr/bin/env bash
# Count the input tokens each id scheme costs, as the model sees it.
#
#   count-tokens.sh <system-dir> <out-dir> [scheme ...]
#
# <system-dir> holds the compiled files from build-system-files.sh. Each file
# is converted per scheme (convert.py) into <out-dir>, then loaded as the
# appended system prompt of one tool-less `claude -p "Reply with OK."` call;
# the input tokens it reports, less an empty-file baseline, are the file's
# cost. Prints a markdown table.
set -euo pipefail

[ "$#" -ge 2 ] || { echo "usage: count-tokens.sh <system-dir> <out-dir> [scheme ...]" >&2; exit 64; }
sys_dir="$(cd "$1" && pwd -P)"
mkdir -p "$2"
out="$(cd "$2" && pwd -P)"
shift 2
schemes=("$@")
[ "${#schemes[@]}" -gt 0 ] || schemes=(all plaintext calls+boxes over:3)
here="$(cd "$(dirname "$0")" && pwd -P)"

tokens() {
  (cd "$out" && claude --model sonnet --tools "" --strict-mcp-config --setting-sources local \
    --settings '{"disableAllHooks":true}' --disable-slash-commands --no-session-persistence \
    --output-format json --append-system-prompt-file "$1" -p "Reply with OK.") |
    python3 -c 'import json,sys; u=json.load(sys.stdin)["usage"]; print(u["input_tokens"]+u["cache_creation_input_tokens"]+u["cache_read_input_tokens"])'
}

: > "$out/empty.md"
base="$(tokens "$out/empty.md")"
echo "| file | scheme | tokens | saved | saved % |"
echo "|---|---|---|---|---|"
for f in "$sys_dir"/*.md; do
  name="$(basename "$f" .md)"
  full=$(( $(tokens "$f") - base ))
  echo "| $name | full text (today) | $full | 0 | 0.0 |"
  for s in "${schemes[@]}"; do
    conv="$out/$name.${s//[:+]/-}.md"
    python3 "$here/convert.py" --scheme "$s" "$f" "$conv"
    t=$(( $(tokens "$conv") - base ))
    awk -v n="$name" -v s="$s" -v t="$t" -v f="$full" 'BEGIN { printf "| %s | %s | %d | %d | %.1f |\n", n, s, t, f - t, 100 * (f - t) / f }'
  done
done
