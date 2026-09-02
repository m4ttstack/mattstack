#!/bin/sh
# stubs-no-source-collision.sh -- guards attachments/<verb>/ against `rt
# skills compile`, which deletes that directory before writing a public verb;
# a hand-written SKILL.md left there would be destroyed silently.
# Run bare: tests/stubs-no-source-collision.sh. Exit 0 = clean, 1 = collision.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
STUBS="$ROOT/pack/stubs.jsonc"

command -v python3 >/dev/null 2>&1 || { echo "FAIL stubs-no-source-collision: python3 not found"; exit 1; }

VERBS=$(python3 - "$STUBS" <<'PY'
import json, re, sys
path = sys.argv[1]
with open(path) as f:
    lines = [ln for ln in f if not re.match(r'^\s*//', ln)]
data = json.loads("".join(lines))
for k in data.get("verbs", {}):
    print(k)
PY
) || exit 1

FAILED=0
for v in $VERBS; do
  f="$ROOT/attachments/$v/SKILL.md"
  if [ -f "$f" ] && ! grep -q "compiled by rt skills compile" "$f"; then
    echo "FAIL stubs-no-source-collision: $f"
    FAILED=1
  fi
done

[ "$FAILED" -eq 0 ] && echo "ok   stubs-no-source-collision"
exit "$FAILED"
