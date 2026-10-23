#!/bin/sh
# PostToolUse hook: record the plan ledgers of the repo this session works in
# through `rt progress record`, at most once a minute per session. Every path
# exits 0 and prints nothing, since PostToolUse stdout is fed back to the
# model; an rt too old for the verb exits 2 and is swallowed the same way.
set -u
: "${HOME:=}"

INPUT="$(cat 2>/dev/null)" || exit 0
field() { printf '%s' "$INPUT" | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1; }
SESSION="$(field session_id)"
CWD="$(field cwd)"
[ -n "$CWD" ] || exit 0

STAMP="${TMPDIR:-/tmp}/mattstack-progress-record-${SESSION:-global}"
NOW="$(date +%s)"
LAST="$(cat "$STAMP" 2>/dev/null || echo 0)"
case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac
[ $((NOW - LAST)) -lt 60 ] && exit 0

ROOT="$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$ROOT" ] || exit 0
[ -d "$ROOT/.superpowers/sdd" ] || exit 0

RT="$(command -v rt 2>/dev/null || true)"
[ -n "$RT" ] && [ -x "$RT" ] || RT="$HOME/.local/bin/rt"
[ -x "$RT" ] || exit 0

echo "$NOW" > "$STAMP" 2>/dev/null
"$RT" progress record --tree "$ROOT" >/dev/null 2>&1
exit 0
