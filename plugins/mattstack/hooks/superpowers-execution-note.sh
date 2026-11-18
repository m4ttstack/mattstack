#!/bin/sh
# SessionStart: names the execution mode superpowers.execution picks, so a
# session running mattstack's superpowers fork skips the "which execution
# approach?" question. Silent unless superpowers@mattstack is installed and
# enabled for this session (user, then project, then local settings, the
# last that names it winning); an rt that fails or answers late falls back
# to the default mode.
command -v python3 >/dev/null 2>&1 || exit 0
# -I: python never imports a module from the session's folder.
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}" python3 -I -c '
import json, os, shutil, subprocess, sys

FORK = "superpowers@mattstack"
# Under the 5s hook timeout, with room for python and the checks.
RT_BUDGET_S = 3
cfg = os.environ["CFG"]

def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}

try:
    event = json.load(sys.stdin)
except Exception:
    event = {}
project = os.environ.get("CLAUDE_PROJECT_DIR") or event.get("cwd") or ""

enabled = None
layers = [os.path.join(cfg, "settings.json")]
if project:
    layers += [os.path.join(project, ".claude", "settings.json"), os.path.join(project, ".claude", "settings.local.json")]
for path in layers:
    value = load(path).get("enabledPlugins", {}).get(FORK)
    if isinstance(value, bool):
        enabled = value
if enabled is not True:
    sys.exit(0)
if FORK not in load(os.path.join(cfg, "plugins", "installed_plugins.json")).get("plugins", {}):
    sys.exit(0)

mode = None
rt = shutil.which("rt")
if rt:
    try:
        # From HOME: a compiled rt loads a bunfig from its cwd, and a project one may preload code.
        res = subprocess.run([rt, "settings", "get", "superpowers.execution", "--json"], capture_output=True, text=True, timeout=RT_BUDGET_S, cwd=os.path.expanduser("~"))
        if res.returncode == 0:
            mode = json.loads(res.stdout or "{}").get("value")
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
' 2>/dev/null
exit 0
