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
# The checkout's own rt (cli.ts), never a bare rt: that is whatever rt is installed, and it reads the real ~/.mattstack.
REPO=$(CDPATH= cd -- "$ROOT/../.." && pwd)
[ -f "$REPO/cli.ts" ] || { echo "FAIL mcp-tools-reference: no rt checkout at $REPO (expected cli.ts)"; exit 1; }
TMP=$(mktemp) || { echo "FAIL mcp-tools-reference: could not make a temp file"; exit 1; }
RT_HOME=$(mktemp -d) || { echo "FAIL mcp-tools-reference: could not make a temp HOME"; exit 1; }
trap 'rm -f "$TMP"; [ -n "$RT_HOME" ] && rm -rf "$RT_HOME"' EXIT
env -i HOME="$RT_HOME" PATH="$PATH" RT_SKIP_SETUP=1 RT_BATCH=1 bun "$REPO/cli.ts" mcp tools --json | bun "$ROOT/scripts/gen-mcp-tools.ts" > "$TMP" || { echo "FAIL mcp-tools-reference: generation failed"; exit 1; }
if cmp -s "$TMP" "$ROOT/attachments/mcp-tools/reference.md"; then echo "ok   mcp-tools-reference"; exit 0; fi
echo "FAIL mcp-tools-reference: attachments/mcp-tools/reference.md is stale; run from the repo root: bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md"
diff "$TMP" "$ROOT/attachments/mcp-tools/reference.md" | head -20
exit 1
