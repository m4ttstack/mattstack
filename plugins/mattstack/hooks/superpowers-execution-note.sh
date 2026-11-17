#!/bin/sh
# SessionStart: names the execution mode superpowers.execution picks, so a
# session running mattstack's superpowers fork skips the "which execution
# approach?" question. Silent unless superpowers@mattstack is installed and
# enabled in this Claude folder; rt failing falls back to the default mode.
command -v python3 >/dev/null 2>&1 || exit 0
RT_JSON=""
if command -v rt >/dev/null 2>&1; then
  RT_JSON="$(rt settings get superpowers.execution --json 2>/dev/null)" || RT_JSON=""
fi
RT_JSON="$RT_JSON" CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}" python3 - <<'PY' 2>/dev/null
import json, os, sys

FORK = "superpowers@mattstack"
cfg = os.environ["CFG"]

def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}

if load(os.path.join(cfg, "settings.json")).get("enabledPlugins", {}).get(FORK) is not True:
    sys.exit(0)
if FORK not in load(os.path.join(cfg, "plugins", "installed_plugins.json")).get("plugins", {}):
    sys.exit(0)

try:
    mode = json.loads(os.environ.get("RT_JSON") or "{}").get("value")
except Exception:
    mode = None
if mode == "ask":
    sys.exit(0)

NAMES = {
    "native-with-reviews": "Native with reviews (superpowers:executing-plans, Native with reviews variant)",
    "subagent-driven": "subagent-driven (superpowers:subagent-driven-development)",
    "native": "Native (superpowers:executing-plans)",
}
if mode not in NAMES:
    mode = "native-with-reviews"
line = "When a superpowers plan is ready to execute, use " + NAMES[mode] + " without asking which execution approach"
if mode == "subagent-driven":
    line += "."
else:
    line += "; use subagent-driven instead when the user asks for it or the plan is long enough to compact mid-run."
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": line}}))
PY
exit 0
