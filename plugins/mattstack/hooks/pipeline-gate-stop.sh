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
print("%d|%s|%s|%s" % (int(run.get("started_at") or 0), run.get("id") or "?", run.get("current_stage") or "unknown", "held" if held else "open"))
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

cat >&2 <<EOF
Run \`$RUN_ID\` is \`running\` in stage \`$STAGE\`. A turn cannot end here in prose. Four exits: continue the stage; open the decision (\`rt runs field set gate <scope> --stage $STAGE\`, one sentence, then run gate-protocol's Runs integration with kind \`<scope>\`, stop); park it (\`rt runs field set hold "<why>" --stage $STAGE\`); or close it (the close gate, then \`rt runs run-status --status done|failed|abandoned\`). If the user asked you something mid-run, the answer is the sentence before the gate.
EOF
exit 2
