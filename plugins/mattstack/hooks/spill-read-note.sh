#!/bin/sh
# SessionStart: one line of context. A Bash read (sed, cat, head) of a tool
# result Claude Code saved under ~/.claude trips its sensitive-file prompt,
# once per chunk; the Read tool does not.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"When a tool result is saved to a file, read it with the Read tool, not sed, cat or head in Bash: a Bash read of Claude Code's own folder asks the user for permission."}}
JSON
