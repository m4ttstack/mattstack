#!/bin/sh
# PreToolUse hook on Agent: an Agent call that names a model but no effort
# runs at the harness default effort, not the one model-tiering's table gives
# the work. Blocks that call (exit 2, reason on stderr) so the agent retries
# with an effort. A fork ignores both fields, so it passes. Every other path,
# including a missing python3 or unreadable stdin, exits 0.
set -u
command -v python3 >/dev/null 2>&1 || exit 0
INPUT="$(cat 2>/dev/null)" || exit 0
[ -n "$INPUT" ] || exit 0
VERDICT="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if not isinstance(d, dict) or d.get("tool_name") not in ("Agent", "Task"):
    sys.exit(0)
t = d.get("tool_input") or {}
if not isinstance(t, dict) or t.get("subagent_type") == "fork":
    sys.exit(0)
if (t.get("model") or "").strip() and not (t.get("effort") or "").strip():
    print("block")
' 2>/dev/null)" || exit 0
[ "$VERDICT" = "block" ] || exit 0
echo "This Agent call names a model but no effort, so it would run at the default effort. Add effort (low, medium, high, xhigh or max) from the mattstack:model-tiering table for this kind of work, then call Agent again." >&2
exit 2
