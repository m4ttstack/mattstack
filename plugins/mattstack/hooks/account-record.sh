#!/bin/sh
# Hook on SessionStart, UserPromptSubmit, PostToolUse and Stop: when the Claude
# Code config file changed since this session last looked (an account switch
# rewrites it), run `rt usage record-account` so the account is recorded.
# Every path exits 0 and prints nothing, since hook stdout is fed back to the
# model; an rt too old for the verb exits 2 and is swallowed the same way.
set -u
: "${HOME:=}"

INPUT="$(cat 2>/dev/null)" || exit 0
SESSION="$(printf '%s' "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed 's/^[^:]*:[[:space:]]*"\(.*\)"$/\1/' | tr -d '/')"
[ -n "$SESSION" ] || exit 0

CONFIG="$HOME/.claude.json"
[ -z "${CLAUDE_CONFIG_DIR:-}" ] || CONFIG="$CLAUDE_CONFIG_DIR/.claude.json"

if [ -e "$CONFIG" ]; then
  # Size joins mtime: a rewrite inside the same second still changes the key. GNU first, since `stat -f` succeeds there with filesystem data.
  MTIME="$(stat -c '%Y:%s' "$CONFIG" 2>/dev/null || stat -f '%m:%z' "$CONFIG" 2>/dev/null)" || MTIME=""
  [ -n "$MTIME" ] || MTIME=missing
else
  MTIME=missing
  # An API-key session has no config file to watch; without a key there is nothing to record.
  [ -n "${ANTHROPIC_API_KEY:-}" ] || exit 0
fi
KEY="$MTIME:${ANTHROPIC_API_KEY:+key}"

STAMP="${TMPDIR:-/tmp}/mattstack-account-record-${SESSION}"
[ "$(cat "$STAMP" 2>/dev/null)" = "$KEY" ] && exit 0

RT="$(command -v rt 2>/dev/null || true)"
[ -n "$RT" ] && [ -x "$RT" ] || RT="$HOME/.local/bin/rt"
[ -x "$RT" ] || exit 0

"$RT" usage record-account --session "$SESSION" >/dev/null 2>&1
{ printf '%s' "$KEY" > "$STAMP"; } 2>/dev/null
exit 0
