#!/bin/sh
# Stop hook: a session whose pipeline run is still `running` cannot end its
# turn in prose. Exit 2 blocks the stop and hands stderr to Claude as the
# instruction to continue; every other path exits 0 and prints nothing, so a
# broken rt or a slow disk can never trap a session. Claude Code's own cap
# (eight consecutive blocks) is the loop guard; stop_hook_active is
# deliberately not honoured, or the second stop would slip through in prose.
set -u
: "${HOME:=}"

INPUT="$(cat 2>/dev/null)" || exit 0
[ -n "$INPUT" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

RT="$(command -v rt 2>/dev/null || true)"
[ -n "$RT" ] && [ -x "$RT" ] || RT="$HOME/.local/bin/rt"
[ -x "$RT" ] || exit 0

ROOT="${RT_RUNS_ROOT:-$HOME/.mattstack/runs}"
[ -d "$ROOT" ] || exit 0

SESSION="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("session_id") or "")
except Exception:
    pass
' 2>/dev/null)"
[ -n "$SESSION" ] || exit 0

START=$(date +%s)

# `rt runs find` (rt >= PR 175) answers the session question directly, newest
# first. An older rt falls through to the run listing, which is not JSON with
# ok:true, so the candidates come from a directory scan instead: run dirs
# written in the last 48 hours, since a snapshot costs a bun start-up each and
# the budget below is three seconds in total.
CANDIDATES="$("$RT" runs find --session "$SESSION" --running 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
if d.get("ok") is not True or not isinstance(d.get("runs"), list):
    raise SystemExit(1)
for r in d["runs"]:
    if isinstance(r, dict) and r.get("runDb"):
        print(r["runDb"])
' 2>/dev/null)"
FOUND=$?
if [ "$FOUND" -ne 0 ]; then
  CANDIDATES="$(find "$ROOT" -mindepth 3 -maxdepth 3 -name state.db -mmin -2880 2>/dev/null)"
fi

BEST=""
for DB in $CANDIDATES; do
  [ $(( $(date +%s) - START )) -lt 3 ] || break
  [ -f "$DB" ] || continue
  SNAP="$(RT_RUN_DB="$DB" "$RT" runs snapshot 2>/dev/null)" || continue
  LINE="$(printf '%s' "$SNAP" | python3 -c '
import json, sys
sid = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
run = d.get("run") or {}
if run.get("status") != "running":
    raise SystemExit(1)
fields = {f.get("key"): f for f in (d.get("fields") or []) if isinstance(f, dict)}
if (fields.get("claude-session") or {}).get("value") != sid:
    raise SystemExit(1)
last_start = max([int(s.get("started_at") or 0) for s in (d.get("stages") or [])] or [0])
hold = fields.get("hold") or {}
held = hold.get("value") not in (None, "", "-") and int(hold.get("at") or 0) > last_start
wg = fields.get("waiting-gate") or {}
waiting = wg.get("value") not in (None, "", "-") and int(wg.get("at") or 0) > last_start
print("%d|%s|%s|%s" % (int(run.get("started_at") or 0), run.get("id") or "?", run.get("current_stage") or "unknown", "held" if (held or waiting) else "open"))
' "$SESSION" 2>/dev/null)" || continue
  [ -n "$LINE" ] || continue
  if [ -z "$BEST" ] || [ "${LINE%%|*}" -gt "${BEST%%|*}" ]; then BEST="$LINE"; fi
done

# Fields are started_at|id|stage|state; `|` never appears in a run id or a
# stage name, and it survives being pasted where a tab would not.
[ -n "$BEST" ] || exit 0
STATE="${BEST##*|}"
[ "$STATE" = "open" ] || exit 0
REST="${BEST#*|}"; RUN_ID="${REST%%|*}"
REST="${REST#*|}"; STAGE="${REST%%|*}"

# A Stop with a backgrounded MCP call or an async agent still pending is not
# a prose ending: the task's notification re-invokes the pane. The scan runs
# only once a run is open, and every failure of it (no transcript, over the
# size cap, a bad line, out of time) keeps today's block.
TRANSCRIPT="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("transcript_path") or "")
except Exception:
    pass
' 2>/dev/null)"
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  if python3 - "$TRANSCRIPT" >/dev/null 2>&1 <<'PY'
import calendar, json, os, re, sys, time

MAX_AGE_MIN = 120
MAX_BYTES = int(os.environ.get("RT_STOP_HOOK_MAX_BYTES") or 64 * 1024 * 1024)
SCAN_MS = int(os.environ.get("RT_STOP_HOOK_SCAN_MS") or 1500)
path = sys.argv[1]
if os.path.getsize(path) > MAX_BYTES:
    sys.exit(1)
if SCAN_MS <= 0:
    sys.exit(1)
deadline = time.monotonic() + SCAN_MS / 1000.0

MCP = re.compile(r"moved to the background as task ([A-Za-z0-9_-]+)")
TASK_ID = re.compile(r"<task-id>([A-Za-z0-9_-]+)</task-id>")
NEEDLES = (b"background as task", b"async_launched", b"<task-id>", b"TaskStop")

def when(d):
    t = str(d.get("timestamp") or "")[:19]
    return calendar.timegm(time.strptime(t, "%Y-%m-%dT%H:%M:%S"))

pending = {}
with open(path, "rb") as f:
    for raw in f:
        if time.monotonic() > deadline:
            sys.exit(1)
        if not any(n in raw for n in NEEDLES):
            continue
        d = json.loads(raw)
        kind = d.get("type")
        if kind == "user":
            tur = d.get("toolUseResult")
            if isinstance(tur, dict) and tur.get("status") == "async_launched" and tur.get("agentId"):
                pending[tur["agentId"]] = when(d)
                continue
            for item in tur if isinstance(tur, list) else []:
                text = item.get("text") if isinstance(item, dict) and item.get("type") == "text" else None
                m = MCP.search(text) if isinstance(text, str) and text.startswith("MCP tool ") else None
                if m:
                    pending[m.group(1)] = when(d)
        elif kind == "assistant":
            for c in (d.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") == "TaskStop":
                    pending.pop(str((c.get("input") or {}).get("task_id")), None)
        elif kind == "queue-operation" and d.get("operation") == "remove":
            for m in TASK_ID.finditer(d.get("content") or ""):
                pending.pop(m.group(1), None)
        elif kind == "attachment" and (d.get("attachment") or {}).get("type") == "queued_command":
            for m in TASK_ID.finditer((d.get("attachment") or {}).get("prompt") or ""):
                pending.pop(m.group(1), None)

now = time.time()
sys.exit(0 if any(now - at <= MAX_AGE_MIN * 60 for at in pending.values()) else 1)
PY
  then exit 0; fi
fi

cat >&2 <<EOF
Run \`$RUN_ID\` is \`running\` in stage \`$STAGE\`. A turn cannot end here in prose. Five exits: continue the stage; open the decision (\`rt runs field set gate <scope> --stage $STAGE\`, one sentence, then run gate-protocol's Runs integration with kind \`<scope>\`, stop); park it (\`rt runs field set hold "<why>" --stage $STAGE\`); close it (the close gate, then \`rt runs run-status --status done|failed|abandoned\`); or arm a gate wait (\`rt runs field set waiting-gate <gateId> --stage $STAGE\`, fire the background wait per gate-protocol, end the turn). If the user asked you something mid-run, the answer is the sentence before the gate.
EOF
exit 2
