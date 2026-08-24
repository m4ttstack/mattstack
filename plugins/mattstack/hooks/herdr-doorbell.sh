#!/bin/sh
# Ring the herdr bell whenever a session in a pane blocks on the user.
#
# Wired as a PreToolUse hook on AskUserQuestion. Symlinked into
# ~/.claude/hooks/ (beside herdr's own managed hook, which tells you to add
# custom hooks next to it rather than editing it).
#
# Why this is a hook and not a rule in SKILL.md:
#
# shepherdr already tells the shepherd to doorbell before putting a question
# in front of Matt. On 2026-08-08 a shepherd made 37 AskUserQuestion calls and
# rang the bell 4 times -- the first four, then never again. One of the unrung
# ones blocked the herd for 1h52m (asked 20:47:03 CDT, answered 22:39:21) while
# four agents sat finished and idle. Matt found it by looking at panes. The
# rule was there; compliance decayed inside a single session. A hook cannot
# decay: the bell is a precondition of the tool call, not a step to remember.
#
# Deliberately NOT gated on pane focus. herdr's `focused` is pane-level within
# the UI, so it stays true while Matt is in another app entirely -- which is
# exactly the two-hour case. A gate on it would have suppressed the one bell
# that mattered.
#
# Never blocks and never fails the tool call: every path exits 0.
set -u

[ "${HERDR_ENV:-}" = "1" ] || exit 0
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
command -v herdr >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

INPUT="$(cat 2>/dev/null)" || exit 0
[ -n "$INPUT" ] || exit 0

# Emits "<title>\t<body>", or nothing when this call should not ring.
FIELDS="$(printf '%s' "$INPUT" | python3 -c '
import json, os, sys

try:
    h = json.loads(sys.stdin.read())
except Exception:
    raise SystemExit(0)

if h.get("tool_name") != "AskUserQuestion":
    raise SystemExit(0)
# Subagents cannot surface a question to the user; only the main loop blocks.
if h.get("agent_id"):
    raise SystemExit(0)

qs = (h.get("tool_input") or {}).get("questions") or []
if not qs:
    raise SystemExit(0)

first = qs[0] if isinstance(qs[0], dict) else {}
body = str(first.get("question") or first.get("header") or "needs an answer")
body = " ".join(body.split())
if len(body) > 140:
    body = body[:137] + "..."
if len(qs) > 1:
    body += f"  (+{len(qs) - 1} more)"

# The tab label is often just an index, so name the bell after the working
# directory, which is what actually tells Matt which pane is waiting.
cwd = h.get("cwd") or os.getcwd()
who = os.path.basename(cwd.rstrip("/")) or "claude"

print(f"{who} needs you\t{body}")
' 2>/dev/null)" || exit 0

[ -n "$FIELDS" ] || exit 0

TITLE="${FIELDS%%	*}"
BODY="${FIELDS#*	}"

herdr notification show "$TITLE" --body "$BODY" --sound request >/dev/null 2>&1 || true
exit 0
