#!/bin/sh
# tests/test-mcp-tools-reference.sh: the committed reference is what rt generates today.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
command -v rt >/dev/null 2>&1 || { echo "skip mcp-tools-reference: no rt on PATH"; exit 0; }
command -v bun >/dev/null 2>&1 || { echo "skip mcp-tools-reference: no bun on PATH"; exit 0; }
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
rt mcp tools --json | bun "$ROOT/scripts/gen-mcp-tools.ts" > "$TMP" || { echo "FAIL mcp-tools-reference: generation failed"; exit 1; }
if cmp -s "$TMP" "$ROOT/attachments/mcp-tools/reference.md"; then echo "ok   mcp-tools-reference"; exit 0; fi
echo "FAIL mcp-tools-reference: attachments/mcp-tools/reference.md is stale; run: rt mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md"
diff "$TMP" "$ROOT/attachments/mcp-tools/reference.md" | head -20
exit 1
