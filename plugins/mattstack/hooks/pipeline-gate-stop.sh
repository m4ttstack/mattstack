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
DEADLINE=$(( START + ${RT_STOP_HOOK_RT_BUDGET_S:-25} ))

# hooks.json kills the whole hook at 30 s and Claude Code then ignores it, so a
# slow rt call is cut off here instead, keeping any run already found.
bounded_rt() {
  python3 -c '
import subprocess, sys, time
left = float(sys.argv[1]) - time.time()
if left <= 0:
    sys.exit(124)
try:
    done = subprocess.run(sys.argv[2:], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=left)
except (subprocess.TimeoutExpired, OSError):
    sys.exit(124)
sys.stdout.buffer.write(done.stdout)
sys.exit(done.returncode)
' "$DEADLINE" "$RT" "$@"
}

# `rt runs find` (rt >= PR 175) answers the session question directly, newest
# first. An older rt falls through to the run listing, which is not JSON with
# ok:true, so the candidates come from a directory scan instead: run dirs
# written in the last 48 hours, since a snapshot costs a bun start-up each and
# the budget below is 25 seconds in total.
CANDIDATES="$(bounded_rt runs find --session "$SESSION" --running 2>/dev/null | python3 -c '
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
  [ "$(date +%s)" -lt "$DEADLINE" ] || break
  [ -f "$DB" ] || continue
  SNAP="$(export RT_RUN_DB="$DB"; bounded_rt runs snapshot 2>/dev/null)" || continue
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

# A gate opened without runDb (the board's posting gate) arms no waiting-gate,
# but the daemon still files it against the session's run, so an open or
# parked one means the run is waiting on a person. Any failure keeps the block.
# The rows are matched to the run here too: an rt older than --run ignores the
# flag and lists every open gate.
OPEN_GATES="$(bounded_rt gate list --open --run "$RUN_ID" 2>/dev/null | python3 -c '
import json, sys
run = sys.argv[1]
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
if d.get("ok") is not True or not isinstance(d.get("gates"), list):
    raise SystemExit(1)
mine = [g for g in d["gates"] if isinstance(g, dict) and g.get("status") in ("open", "parked")
        and (g.get("subject") == "run:" + run or (g.get("origin") or {}).get("runId") == run)]
print(len(mine))
' "$RUN_ID" 2>/dev/null)" && [ "${OPEN_GATES:-0}" -gt 0 ] && exit 0

# A Stop with a backgrounded MCP call, an async agent (launched, or resumed
# with SendMessage) or a bare background `sleep` still pending is not a prose
# ending: the task's notification re-invokes the pane. Any other background
# shell may never end (a dev server), so it excuses nothing. The scan runs only once a run is open, and
# every failure of it (no transcript, a bad line, out of time) keeps today's
# block. Only the transcript's tail is read: a task's removal is always
# written after its launch, so a launch inside the window has its removal
# there too, and one outside it is unseen and blocks.
TRANSCRIPT="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("transcript_path") or "")
except Exception:
    pass
' 2>/dev/null)"
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  if python3 - "$TRANSCRIPT" "$START" >/dev/null 2>&1 <<'PY'
import calendar, json, os, re, sys, time

MAX_AGE_MIN = 120
SLEEP_GRACE_S = 60
MAX_BYTES = int(os.environ.get("RT_STOP_HOOK_MAX_BYTES") or 64 * 1024 * 1024)
SCAN_MS = int(os.environ.get("RT_STOP_HOOK_SCAN_MS") or 1500)
# hooks.json kills the hook at 30 s and Claude Code then ignores it, so the
# scan must finish with margin left for python to exit.
HOOK_BUDGET_S = 28
path = sys.argv[1]
remaining = HOOK_BUDGET_S - (time.time() - int(sys.argv[2]))
budget = min(SCAN_MS / 1000.0, remaining)
if budget <= 0:
    sys.exit(1)
deadline = time.monotonic() + budget

MCP = re.compile(r"moved to the background as task ([A-Za-z0-9_-]+)")
TASK_ID = re.compile(r"<task-id>([A-Za-z0-9_-]+)</task-id>")
SLEEP = re.compile(r"\s*sleep (\d+)\s*")
NEEDLES = (b"background as task", b"async_launched", b"resumedAgentId", b"<task-id>", b"TaskStop",
           b"run_in_background", b"backgroundTaskId")

def when(d):
    t = str(d.get("timestamp") or "")[:19]
    return calendar.timegm(time.strptime(t, "%Y-%m-%dT%H:%M:%S"))

# task id -> when it stops counting as pending
pending = {}
sleeps = {}
with open(path, "rb") as f:
    size = os.fstat(f.fileno()).st_size
    if size > MAX_BYTES:
        f.seek(size - MAX_BYTES - 1)
        if f.read(1) != b"\n":
            f.readline()
    for raw in f:
        if time.monotonic() > deadline:
            sys.exit(1)
        if not any(n in raw for n in NEEDLES):
            continue
        d = json.loads(raw)
        kind = d.get("type")
        if kind == "user":
            if d.get("isSidechain") is True:
                continue
            tur = d.get("toolUseResult")
            if isinstance(tur, dict) and tur.get("status") == "async_launched" and tur.get("agentId"):
                pending[tur["agentId"]] = when(d) + MAX_AGE_MIN * 60
                continue
            # SendMessage restarts a finished agent under its own id.
            if isinstance(tur, dict) and tur.get("success") is True and tur.get("resumedAgentId"):
                pending[tur["resumedAgentId"]] = when(d) + MAX_AGE_MIN * 60
                continue
            if isinstance(tur, dict) and tur.get("backgroundTaskId"):
                for c in (d.get("message") or {}).get("content") or []:
                    seconds = sleeps.get(c.get("tool_use_id")) if isinstance(c, dict) else None
                    if seconds is not None:
                        pending[tur["backgroundTaskId"]] = when(d) + min(seconds + SLEEP_GRACE_S, MAX_AGE_MIN * 60)
                continue
            for item in tur if isinstance(tur, list) else []:
                text = item.get("text") if isinstance(item, dict) and item.get("type") == "text" else None
                m = MCP.search(text) if isinstance(text, str) and text.startswith("MCP tool ") else None
                if m:
                    pending[m.group(1)] = when(d) + MAX_AGE_MIN * 60
        elif kind == "assistant":
            for c in (d.get("message") or {}).get("content") or []:
                if not isinstance(c, dict) or c.get("type") != "tool_use":
                    continue
                args = c.get("input") or {}
                if c.get("name") == "TaskStop":
                    pending.pop(str(args.get("task_id")), None)
                elif c.get("name") == "Bash" and args.get("run_in_background") is True:
                    m = SLEEP.fullmatch(str(args.get("command")))
                    if m:
                        sleeps[c.get("id")] = int(m.group(1))
        elif kind == "queue-operation" and d.get("operation") == "remove":
            m = TASK_ID.search(d.get("content") or "")
            if m:
                pending.pop(m.group(1), None)
        elif kind == "attachment" and (d.get("attachment") or {}).get("type") == "queued_command":
            m = TASK_ID.search((d.get("attachment") or {}).get("prompt") or "")
            if m:
                pending.pop(m.group(1), None)

now = time.time()
sys.exit(0 if any(now <= until for until in pending.values()) else 1)
PY
  then exit 0; fi
fi

cat >&2 <<EOF
Run \`$RUN_ID\` is \`running\` in stage \`$STAGE\`. A turn cannot end here in prose. A decision the developer must make is always a gate, never run_hold: a hold asks nothing and the console shows no question. Five exits: continue the stage; open the decision with gate_ask or gate_open, passing runDb and stage \`$STAGE\` (the tool writes the run's gate field, and waiting-gate when its paneAction is wait), then act on that paneAction per gate-protocol; close it (the close gate, then run_close with done, failed or abandoned); at a gate already open whose paneAction was wait, fire the background rt gate wait per gate-protocol and end the turn; or park it with run_hold, only when nothing is being asked: the developer paused it or answered hold, or the step you are on names run_hold. Waiting on a running background subagent, MCP call or sleep needs no exit, and never run_hold: such a turn ends by itself, so this block means none was found running. If the user asked you something mid-run, the answer is the sentence before the gate.
EOF
exit 2
