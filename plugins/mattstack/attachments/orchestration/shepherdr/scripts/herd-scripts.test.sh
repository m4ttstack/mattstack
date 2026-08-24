#!/bin/bash
# Tests for the shepherdr herd-DB scripts. Run directly:
#   ./herd-scripts.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"; mkdir -p "$HOME"
export RT_STUB_LOG="$WORK/rt.log"; : > "$RT_STUB_LOG"
export RT_STUB_MODE=list-empty
mkdir -p "$WORK/stub"
cat > "$WORK/stub/rt" <<'EOF'
#!/bin/bash
echo "$@" >> "$RT_STUB_LOG"
case "${RT_STUB_MODE:-}" in
  list-empty)   echo '{"ok":true,"events":[],"cursor":42}' ;;
  emit-ok)      echo '{"ok":true,"id":7}' ;;
  down)         echo "rt: daemon not running" >&2; exit 1 ;;
  wait-events)  cat "${RT_STUB_WAIT_FILE}" ;;
  wait-timeout) echo '{"ok":true,"timedOut":true,"cursor":42}'; exit 124 ;;
esac
EOF
chmod +x "$WORK/stub/rt"
export PATH="$WORK/stub:$PATH"

pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); echo "FAIL: $1"; }

# --- herd-init ---
OUT="$(python3 "$HERE/herd-init.py" --repo demo)" && ok || bad "fresh init exits 0"
RUN="$(echo "$OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["run"])')"
DB="$(echo "$OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin)["db"])')"
echo "$RUN" | grep -Eq '^demo-[0-9]{8}-[0-9]{6}$' && ok || bad "run id is <repo>-<yyyymmdd-HHMMSS> (got $RUN)"
[ -f "$DB" ] && ok || bad "db created at $DB"
echo "$OUT" | grep -q '"mode": "bus"' && ok || bad "bus mode detected (got $OUT)"
echo "$OUT" | grep -q '"cursor": 42' && ok || bad "cursor snapshot from list response"
grep -q "events list shepherdr/$RUN/\*\* --limit 1" "$RT_STUB_LOG" && ok || bad "snapshot used run-scoped pattern"
python3 -c "
import sqlite3,sys
c=sqlite3.connect('$DB')
tables={r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")}
sys.exit(0 if {'questions','reports','jobs','state'} <= tables else 1)
" && ok || bad "schema has all four tables"

# resume returns the same identity without re-snapshotting
RESUMED="$(python3 "$HERE/herd-init.py" --resume "$(dirname "$DB")")" && ok || bad "resume exits 0"
echo "$RESUMED" | grep -q "\"run\": \"$RUN\"" && ok || bad "resume returns same run id"

# degraded when rt is down
RT_STUB_MODE=down OUT2="$(python3 "$HERE/herd-init.py" --repo demo2)" && ok || bad "init succeeds with daemon down"
echo "$OUT2" | grep -q '"mode": "degraded"' && ok || bad "degraded mode detected"

# --- herd-ask / herd-report ---
RT_STUB_MODE=emit-ok
QID="$(python3 "$HERE/herd-ask.py" --db "$DB" --run "$RUN" --job alpha \
  --context "picking a name" --question "Which name?" \
  --option "widget -- short (recommended)" --option "gadget -- descriptive")" \
  && ok || bad "ask exits 0"
[ "$QID" = "published question qid=1" ] && ok || bad "ask prints qid 1 (got $QID)"
grep -q "events emit shepherdr/$RUN/alpha/question --json {\"qid\": 1}" "$RT_STUB_LOG" \
  && ok || bad "ask emitted doorbell with qid"
python3 -c "
import sqlite3,sys
r=sqlite3.connect('$DB').execute('select job,needs,status,question from questions where id=1').fetchone()
sys.exit(0 if r==('alpha','answer','open','Which name?') else 1)
" && ok || bad "question row inserted open"

# emit failure must not fail the worker
RT_STUB_MODE=down
QID2="$(python3 "$HERE/herd-ask.py" --db "$DB" --run "$RUN" --job alpha \
  --context c --question q2 --option "a" --option "b" --needs pane)" \
  && ok || bad "ask survives daemon down"
[ "$QID2" = "published question qid=2" ] && ok || bad "second qid is 2"

# herd-ask must refuse fewer than 2 options (T5)
python3 "$HERE/herd-ask.py" --db "$DB" --run "$RUN" --job alpha \
  --context c --question "onlyone" --option "solo" \
  && bad "ask with 1 option must exit nonzero" || ok
python3 -c "
import sqlite3,sys
n=sqlite3.connect('$DB').execute(\"select count(*) from questions where question='onlyone'\").fetchone()[0]
sys.exit(0 if n==0 else 1)
" && ok || bad "ask with 1 option inserts no row"

RT_STUB_MODE=emit-ok
echo "job done, all green" > "$WORK/rep.md"
RID="$(python3 "$HERE/herd-report.py" --db "$DB" --run "$RUN" --job alpha --body-file "$WORK/rep.md")" \
  && ok || bad "report exits 0"
grep -q "events emit shepherdr/$RUN/alpha/report --json {\"rid\": 1}" "$RT_STUB_LOG" \
  && ok || bad "report emitted doorbell with rid"

# --- herd-read ---
python3 "$HERE/herd-read.py" --db "$DB" question 1 | grep -q "Which name?" \
  && ok || bad "read question renders text"
python3 "$HERE/herd-read.py" --db "$DB" question 1 | grep -q "status: open" \
  && ok || bad "read question shows status"
python3 "$HERE/herd-read.py" --db "$DB" question 1 | grep -q "1. widget -- short (recommended)" \
  && ok || bad "read question numbers options"
python3 "$HERE/herd-read.py" --db "$DB" open-questions | grep -c "qid" | grep -q "2" \
  && ok || bad "two open questions listed"
python3 "$HERE/herd-read.py" --db "$DB" report 1 | grep -q "all green" \
  && ok || bad "read report renders body"

# unhandled-reports lists rid 1 while its handled_at is still NULL (T1, part 1)
python3 "$HERE/herd-read.py" --db "$DB" unhandled-reports | grep -q "^rid 1 \[alpha\]" \
  && ok || bad "unhandled-reports lists an unhandled rid"

# --- herd-answer: relay-first ordering ---
cat > "$WORK/stub/relay-ok" <<'EOF'
#!/bin/bash
echo "$@" >> "$RT_STUB_LOG"; exit 0
EOF
cat > "$WORK/stub/relay-fail" <<'EOF'
#!/bin/bash
exit 1
EOF
chmod +x "$WORK/stub/relay-ok" "$WORK/stub/relay-fail"

SHEPHERDR_RELAY="$WORK/stub/relay-fail" \
  python3 "$HERE/herd-answer.py" --db "$DB" --qid 1 --target alpha "1" \
  && bad "failed relay must exit nonzero" || ok
python3 "$HERE/herd-read.py" --db "$DB" question 1 | grep -q "status: open" \
  && ok || bad "failed relay leaves question open"

SHEPHERDR_RELAY="$WORK/stub/relay-ok" \
  python3 "$HERE/herd-answer.py" --db "$DB" --qid 1 --target alpha "1" \
  && ok || bad "successful relay exits 0"
grep -q "^alpha 1$" "$RT_STUB_LOG" && ok || bad "relay received target and answer"
python3 "$HERE/herd-read.py" --db "$DB" question 1 | grep -q "status: answered" \
  && ok || bad "successful relay marks answered"

# herd-answer must refuse a non-open row and leave it unchanged (T3)
BEFORE_Q1="$(python3 "$HERE/herd-read.py" --db "$DB" question 1)"
SHEPHERDR_RELAY="$WORK/stub/relay-ok" \
  python3 "$HERE/herd-answer.py" --db "$DB" --qid 1 --target alpha "2" \
  && bad "answering an already-answered qid must exit nonzero" || ok
AFTER_Q1="$(python3 "$HERE/herd-read.py" --db "$DB" question 1)"
[ "$BEFORE_Q1" = "$AFTER_Q1" ] && ok || bad "non-open answer attempt leaves the row unchanged"

python3 "$HERE/herd-answer.py" --db "$DB" --qid 2 --pane-handled \
  && ok || bad "pane-handled exits 0"
python3 -c "
import sqlite3,sys
r=sqlite3.connect('$DB').execute('select status,answer from questions where id=2').fetchone()
sys.exit(0 if r==('answered','(handled in pane)') else 1)
" && ok || bad "pane-handled records placeholder answer"

# --- herd-job ---

# herd-job must not phantom-create a jobs row: --status on a job with no
# existing row exits nonzero and inserts nothing (T4)
python3 "$HERE/herd-job.py" --db "$DB" ghost --status done \
  && bad "herd-job on a missing job must exit nonzero" || ok
python3 -c "
import sqlite3,sys
r=sqlite3.connect('$DB').execute(\"select 1 from jobs where job='ghost'\").fetchone()
sys.exit(0 if r is None else 1)
" && ok || bad "missing-job herd-job creates no row"

# Mimic spawn-agent.sh's upsert so the real (non-phantom) --status path below
# has a row to update.
python3 -c "
import sys; sys.path.insert(0,'$HERE'); import herd_db
c=herd_db.connect('$DB')
c.execute(\"INSERT OR REPLACE INTO jobs(job,status) VALUES('alpha','active')\")
c.commit()
"

python3 "$HERE/herd-job.py" --db "$DB" alpha --status done --handled 1 \
  && ok || bad "herd-job exits 0"
python3 -c "
import sqlite3,sys
c=sqlite3.connect('$DB')
h=c.execute('select handled_at from reports where id=1').fetchone()[0]
sys.exit(0 if h else 1)
" && ok || bad "report marked handled"

# unhandled-reports drops rid 1 once handled_at is set (T1, part 2)
python3 "$HERE/herd-read.py" --db "$DB" unhandled-reports | grep -q "rid 1" \
  && bad "handled report must not appear in unhandled-reports" || ok

python3 -c "
import sqlite3,sys
r=sqlite3.connect('$DB').execute(\"select status from jobs where job='alpha'\").fetchone()
sys.exit(0 if r and r[0]=='done' else 1)
" && ok || bad "jobs row updated to status done"

# --- herd-read log ---
python3 "$HERE/herd-read.py" --db "$DB" log | grep -q "alpha" \
  && ok || bad "log lists the job"

# --- herd-wait.sh ---
cat > "$WORK/wait-events.json" <<EOF
{"ok":true,"events":[{"id":43,"topic":"shepherdr/$RUN/alpha/question","payload":{"qid":1},"emittedAt":1}],"cursor":43}
EOF
export RT_STUB_WAIT_FILE="$WORK/wait-events.json"
RT_STUB_MODE=wait-events OUT="$("$HERE/herd-wait.sh" --db "$DB" --timeout 5s)"; CODE=$?
[ "$CODE" -eq 0 ] && ok || bad "wait passes through exit 0 (got $CODE)"
echo "$OUT" | grep -q '"qid": *1' && ok || bad "wait prints events json"
grep -q "events wait shepherdr/$RUN/\*\* --after 42 --timeout 5s" "$RT_STUB_LOG" \
  && ok || bad "wait threaded persisted cursor 42"
python3 -c "
import sys; sys.path.insert(0,'$HERE'); import herd_db
c=herd_db.connect('$DB'); sys.exit(0 if herd_db.get_state(c,'cursor')=='43' else 1)
" && ok || bad "cursor persisted to 43 after events"

RT_STUB_MODE=wait-timeout "$HERE/herd-wait.sh" --db "$DB" >/dev/null; CODE=$?
[ "$CODE" -eq 124 ] && ok || bad "timeout passes through 124 (got $CODE)"
grep -q -- "--after 43" "$RT_STUB_LOG" && ok || bad "re-arm used updated cursor 43"
python3 -c "
import sys; sys.path.insert(0,'$HERE'); import herd_db
c=herd_db.connect('$DB'); sys.exit(0 if herd_db.get_state(c,'cursor')=='42' else 1)
" && ok || bad "timeout must persist its cursor"

RT_STUB_MODE=down "$HERE/herd-wait.sh" --db "$DB" >/dev/null 2>&1; CODE=$?
[ "$CODE" -eq 1 ] && ok || bad "bus-unrecoverable passes through 1 (got $CODE)"

# --- herd-bridge ---
cat > "$WORK/stub/hrd" <<'EOF'
#!/bin/bash
cat "$HRD_STUB_PANES"
EOF
chmod +x "$WORK/stub/hrd"
export SHEPHERDR_HRD="$WORK/stub/hrd"
export HRD_STUB_PANES="$WORK/panes.json"

python3 -c "
import sys; sys.path.insert(0,'$HERE'); import herd_db
c=herd_db.connect('$DB')
c.execute(\"INSERT OR REPLACE INTO jobs(job,pane,status) VALUES('alpha','1-2','active')\")
c.execute(\"INSERT OR REPLACE INTO jobs(job,pane,status) VALUES('beta','1-3','closed')\")
c.commit()
"
echo '{"result":[{"pane_id":"1-2","agent_status":"working"},{"pane_id":"1-3","agent_status":"working"}]}' > "$HRD_STUB_PANES"
RT_STUB_MODE=emit-ok python3 "$HERE/herd-bridge.py" --db "$DB" --once && ok || bad "bridge --once exits 0"

echo '{"result":[{"pane_id":"1-2","agent_status":"blocked"}]}' > "$HRD_STUB_PANES"
: > "$RT_STUB_LOG"
RT_STUB_MODE=emit-ok python3 "$HERE/herd-bridge.py" --db "$DB" --once && ok || bad "second cycle exits 0"
grep -q "events emit shepherdr/$RUN/alpha/blocked" "$RT_STUB_LOG" \
  && ok || bad "blocked transition emitted"
grep -q "beta" "$RT_STUB_LOG" && bad "closed job must not be watched" || ok

echo '{"result":[]}' > "$HRD_STUB_PANES"
: > "$RT_STUB_LOG"
RT_STUB_MODE=emit-ok python3 "$HERE/herd-bridge.py" --db "$DB" --once
grep -q "events emit shepherdr/$RUN/alpha/gone" "$RT_STUB_LOG" \
  && ok || bad "vanished active pane emitted gone"

# emit failure degrades to printing (monitor behavior)
echo '{"result":[{"pane_id":"1-2","agent_status":"blocked"}]}' > "$HRD_STUB_PANES"
RT_STUB_MODE=emit-ok python3 "$HERE/herd-bridge.py" --db "$DB" --once >/dev/null
echo '{"result":[]}' > "$HRD_STUB_PANES"
LINE="$(RT_STUB_MODE=down python3 "$HERE/herd-bridge.py" --db "$DB" --once)"
echo "$LINE" | grep -q "1-2.*gone" && ok || bad "emit failure prints transition (got: $LINE)"

# a pane's FIRST sighting already blocked must still emit (T2)
python3 -c "
import sys; sys.path.insert(0,'$HERE'); import herd_db
c=herd_db.connect('$DB')
c.execute(\"INSERT OR REPLACE INTO jobs(job,pane,status) VALUES('gamma','1-9','active')\")
c.commit()
"
echo '{"result":[{"pane_id":"1-9","agent_status":"blocked"}]}' > "$HRD_STUB_PANES"
: > "$RT_STUB_LOG"
RT_STUB_MODE=emit-ok python3 "$HERE/herd-bridge.py" --db "$DB" --once \
  && ok || bad "first-sighting-blocked cycle exits 0"
grep -q "events emit shepherdr/$RUN/gamma/blocked" "$RT_STUB_LOG" \
  && ok || bad "first sighting already blocked is emitted, not swallowed"

echo "herd-scripts: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
