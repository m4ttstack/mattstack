#!/usr/bin/env bash
# Relay an answer to an agent: clear any auto-drafted input, then submit.
# Agents in auto mode often draft a suggested answer into their own input
# buffer; submitting on top would send the draft, not your answer. Always
# ctrl+c first, then `agent prompt`, which submits atomically under
# bracketed paste. Delivery is verified by watching for `working` rather
# than trusted to agent prompt's own stall error, which cannot be relied
# on; resend once if the agent never starts.
#
# Usage: relay-answer.sh <pane-id-or-agent-name> <answer text...>
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: relay-answer.sh <pane-id-or-name> <answer text...>" >&2; exit 2; }

# Routed through the shim so the same relay works whether the agent is in a
# visible pane or an invisible herd session. See scripts/hrd.
HRD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hrd"

TARGET="$1"; shift
"$HRD" agent send-keys "$TARGET" ctrl+c >/dev/null
sleep 1
# Task-1 probing showed agent prompt's stall error cannot be relied on
# (a blocked agent discards the text with exit 0), so verify delivery by
# watching for `working`; resend once if the agent never starts.
"$HRD" agent prompt "$TARGET" "$*" >/dev/null
if ! "$HRD" agent wait "$TARGET" --until working --timeout 8000 >/dev/null 2>&1; then
  echo "relay-answer: answer not picked up; resending once" >&2
  "$HRD" agent prompt "$TARGET" "$*" >/dev/null
  "$HRD" agent wait "$TARGET" --until working --timeout 8000 >/dev/null 2>&1 \
    || { echo "relay-answer: answer may be unsubmitted for $TARGET" >&2; exit 1; }
fi
