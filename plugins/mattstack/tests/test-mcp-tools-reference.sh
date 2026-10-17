#!/bin/sh
# tests/test-mcp-tools-reference.sh: the committed reference is what rt generates today.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
command -v bun >/dev/null 2>&1 || { echo "skip mcp-tools-reference: no bun on PATH"; exit 0; }
# The header's kept-on-Bash line: a shepherd answers and parks gates with herd_gate_answer and herd_gate_park.
KEPT=$(echo '{"tools":[]}' | bun "$ROOT/scripts/gen-mcp-tools.ts" | grep '^Kept on Bash on purpose:')
[ -n "$KEPT" ] || { echo "FAIL mcp-tools-header: no kept-on-Bash line"; exit 1; }
case "$KEPT" in *"rt gate answer"*) echo "FAIL mcp-tools-header: rt gate answer is kept on Bash; herd_gate_answer covers it"; exit 1 ;; esac
case "$KEPT" in *herd_gate_answer*herd_gate_park*) ;; *) echo "FAIL mcp-tools-header: herd_gate_answer and herd_gate_park are not named"; exit 1 ;; esac
echo "ok   mcp-tools-header"
command -v rt >/dev/null 2>&1 || { echo "skip mcp-tools-reference: no rt on PATH"; exit 0; }
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
rt mcp tools --json | bun "$ROOT/scripts/gen-mcp-tools.ts" > "$TMP" || { echo "FAIL mcp-tools-reference: generation failed"; exit 1; }
if cmp -s "$TMP" "$ROOT/attachments/mcp-tools/reference.md"; then echo "ok   mcp-tools-reference"; exit 0; fi
echo "FAIL mcp-tools-reference: attachments/mcp-tools/reference.md is stale; run: rt mcp tools --json | bun scripts/gen-mcp-tools.ts > attachments/mcp-tools/reference.md"
diff "$TMP" "$ROOT/attachments/mcp-tools/reference.md" | head -20
exit 1
