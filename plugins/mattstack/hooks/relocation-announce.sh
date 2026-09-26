#!/bin/sh
# PreToolUse hook on EnterWorktree: hands the hook's stdin to rt so the
# daemon can answer the relocation dialog on this pane. rt's endpoint acts
# only on EnterWorktree, so the matcher and this hook cover EnterWorktree
# only. Every path exits 0 and prints nothing; a missing rt or
# daemon is the human's dialog, never a blocked tool call.
set -u
: "${HOME:=}"
INPUT="$(cat 2>/dev/null)" || exit 0
[ -n "$INPUT" ] || exit 0
RT="$(command -v rt 2>/dev/null || true)"
[ -n "$RT" ] && [ -x "$RT" ] || RT="$HOME/.local/bin/rt"
[ -x "$RT" ] || exit 0
printf '%s' "$INPUT" | "$RT" worktree announce-relocation >/dev/null 2>&1 || true
exit 0
