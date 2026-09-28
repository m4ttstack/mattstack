#!/usr/bin/env bash
# Render every ```dot block in a SKILL.md to SVG (needs graphviz `dot`).
# Usage: render.sh [path/to/SKILL.md] [out-dir]
#   defaults: SKILL.md next to this script; out-dir a fresh temp dir (path printed at the end).
# Exits non-zero when a block fails to parse, when Graphviz prints any warning, when a
# ```dot fence is indented (it would be skipped), or when the file has no dot block at all.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
md="${1:-$here/SKILL.md}"
out="${2:-$(mktemp -d)}"

command -v dot >/dev/null 2>&1 || { echo "graphviz 'dot' not found (brew install graphviz)"; exit 1; }
[ -f "$md" ] || { echo "no file at: $md"; exit 1; }
mkdir -p "$out"

if grep -nE '^[[:space:]]+```dot[[:space:]]*$' "$md" >/dev/null; then
  echo "FAIL  indented \`\`\`dot fence (move it to column 1):"
  grep -nE '^[[:space:]]+```dot[[:space:]]*$' "$md" | sed 's/^/        /'
  exit 1
fi

awk -v out="$out" '
  /^```dot[ \t]*$/ { inblk=1; body=""; next }
  inblk && /^```+[ \t]*$/ {
    inblk=0
    name="graph_" (++n)
    if (match(body, /digraph[ \t]+[A-Za-z0-9_]+/)) {
      nm=substr(body, RSTART, RLENGTH); sub(/digraph[ \t]+/, "", nm); name=nm "_" n
    }
    path=out "/" name ".dot"; printf "%s", body > path; close(path); print path; next
  }
  inblk { body=body $0 "\n" }
' "$md" > "$out/.blocks"

count=0; fail=0
while IFS= read -r dotf; do
  count=$((count+1)); svg="${dotf%.dot}.svg"; log="${dotf%.dot}.err"
  if dot -Tsvg "$dotf" -o "$svg" 2>"$log" && [ ! -s "$log" ]; then
    echo "ok    $(basename "$svg")"
  else
    fail=$((fail+1)); echo "FAIL  $(basename "$dotf")"; sed 's/^/        /' "$log"
  fi
done < "$out/.blocks"
rm -f "$out/.blocks"

echo "---"
echo "$count block(s), $fail failed  ->  $out"
if [ "$count" -eq 0 ]; then echo "FAIL  no \`\`\`dot block found in $md"; exit 1; fi
[ "$fail" -eq 0 ]
