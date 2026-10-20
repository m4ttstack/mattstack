#!/usr/bin/env bash
# SessionStart (matcher startup): sign a new session in when chat.autoSignIn
# is on for its repo.
#
# Only an interactive session in a herdr pane qualifies: a `claude -p` run
# started inside a pane inherits HERDR_PANE_ID, and CLAUDE_CODE_ENTRYPOINT
# (cli vs sdk-cli) is what tells the two apart. Always exits 0 -- a session
# start must never fail on this.
set -u

home="${HOME:-}"
[ -n "$home" ] || exit 0
[ "${CLAUDE_CODE_ENTRYPOINT:-}" = "cli" ] || exit 0
[ -n "${HERDR_PANE_ID:-}" ] || exit 0

command -v jq >/dev/null 2>&1 || exit 0

input="$(cat 2>/dev/null)" || exit 0
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)"
[ -n "$session_id" ] || exit 0

[ -f "$home/.mattstack/rt/chat/sessions/$session_id.json" ] && exit 0

cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
[ -n "$cwd" ] || cwd="${PWD:-}"
[ -d "$cwd" ] || exit 0
cd "$cwd" || exit 0

command -v rt >/dev/null 2>&1 || exit 0

enabled="$(rt settings get chat.autoSignIn --repo "$cwd" --json 2>/dev/null | jq -r '.value' 2>/dev/null)"
[ "$enabled" = "true" ] || exit 0

result="$(rt chat sign-in --session "$session_id" --json 2>/dev/null)" || exit 0
fields="$(printf '%s' "$result" | jq -r 'select(.ok == true) | [(.name // .handle // empty), (.room // empty)] | @tsv' 2>/dev/null)"
[ -n "$fields" ] || exit 0
IFS=$'\t' read -r name room <<< "$fields"
[ -n "$name" ] || exit 0

if [ -n "$room" ]; then
  message="rt chat: you are signed in as ${name} (room #${room}); chat messages arrive in your context automatically."
else
  message="rt chat: you are signed in as ${name}; chat messages arrive in your context automatically."
fi

jq -nc --arg msg "$message" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $msg}}' 2>/dev/null
exit 0
