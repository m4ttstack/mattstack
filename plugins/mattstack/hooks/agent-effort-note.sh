#!/bin/sh
# SessionStart: one line of context, so an agent knows the effort rule before
# agent-effort-guard.sh blocks its first Agent call.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Agent calls: if you set a model, also set an effort (low, medium, high, xhigh or max), picked from the mattstack:model-tiering table. A model with no effort gets blocked."}}
JSON
