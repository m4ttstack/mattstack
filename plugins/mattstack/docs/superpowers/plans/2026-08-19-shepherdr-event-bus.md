# shepherdr Event Bus + Herd DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shepherdr's N flappy pane waits and question.md/report.md files with one rt event-bus subscription and a per-run SQLite herd DB, degrading gracefully when the bus is absent.

**Architecture:** Workers publish questions/reports as DB rows via scripts that also emit best-effort doorbell events; the shepherd holds one `rt events wait 'shepherdr/<run>/**'` (15m sweep timeout) plus one bridge process that puts herdr's blocked/gone pane detection onto the bus. Resume correctness comes from DB reconciliation, not the cursor.

**Tech Stack:** python3 stdlib (sqlite3, argparse, json), bash (macOS 3.2-safe), rt events CLI (RT-44 branch), herdr via the existing `hrd` shim.

**Spec:** `docs/superpowers/specs/2026-08-19-shepherdr-event-bus-design.md` — read it before executing any task; every wording choice below argues from it.

## Global Constraints

- python3 stdlib only; no pip installs. Anything needing a map is Python, not bash (macOS ships bash 3.2 — no associative arrays).
- Every script: results on stdout, diagnostics on stderr, meaningful exit codes.
- All herdr traffic goes through `scripts/hrd` (the shim that makes `SHEPHERDR_HERD_SESSION` invisible-herd routing work). Never call `herdr` directly from a new script.
- Topics exactly: `shepherdr/<run>/<job>/question|report|blocked|gone`. Payloads: `{"qid": N}`, `{"rid": N}`, `{}`, `{}`.
- The pane-lane contract is DB-only. No file fallback anywhere — a failed script is loud and the worker stops.
- Worker emits are best-effort: an emit failure must NEVER fail `herd-ask.py`/`herd-report.py`.
- `rt` resolves from PATH. Env overrides exist for tests only: `SHEPHERDR_HRD` (bridge), `SHEPHERDR_RELAY` (herd-answer).
- Test convention: co-located self-contained test scripts run directly (pattern: `skills/pipeline/stage-watch-ci/scripts/ci-attendant.test.sh` — temp dirs, PATH stubs, pass/fail counters, exit nonzero on failure).
- Commit after every task. Skill-file edits (Tasks 8–9) follow superpowers:writing-skills: the RED evidence in Task 1/Task 8 must exist before those edits land.
- Tasks 1, 10, 11, 12 are MAIN-SESSION tasks (live herds, user interaction). Tasks 2–9 are subagent-dispatchable.

## File Structure

```
skills/orchestration/shepherdr/
  SKILL.md                      modify  (Task 9) flow rewrite
  references/
    job-template.md             modify  (Task 8) ask/report sections → script calls
    herd-bus.md                 create  (Task 9) bus + DB mechanics reference
    cloud-lane.md               modify  (Task 9) gains the legacy file contract
    herd-session.md             (untouched)
  scripts/
    herd_db.py                  create  (Task 2) shared sqlite module (schema, connect, state)
    herd-init.py                create  (Task 2) mint/resume run, bus detect, cursor snapshot
    herd-ask.py                 create  (Task 3) worker: insert question + doorbell
    herd-report.py              create  (Task 3) worker: insert report + doorbell
    herd-read.py                create  (Task 4) shepherd: render question/report/open/log
    herd-answer.py              create  (Task 4) shepherd: relay-first answer recording
    herd-job.py                 create  (Task 4) shepherd: jobs.status / handled_at transitions
    herd-wait.sh                create  (Task 5) cursor-threaded bus wait wrapper
    herd-bridge.py              create  (Task 6) pane lifecycle → bus (replaces herd-monitor.py)
    herd-monitor.py             delete  (Task 6) superseded by herd-bridge.py
    herd-scripts.test.sh        create  (Task 2, grows through Task 6)
    spawn-agent.sh              modify  (Task 7) -D/-R/-S/-A flags, jobs upsert, new kickoff
.local-dev/
  rt-events-validation.md       create  (Task 1, updated in Tasks 10–12) evidence log
```

---

### Task 1: Baseline herd — RED evidence for the watch loop (MAIN SESSION)

The writing-skills RED for the shepherd-side changes: measure today's flappy wake behavior on a live herd BEFORE any skill edit. Skipping this makes the before/after comparison in Task 12 impossible — it is the whole point of the handoff.

**Files:**
- Create: `.local-dev/rt-events-validation.md`

- [ ] **Step 1: Run a live baseline herd with the CURRENT skill.** In a herdr session (`HERDR_ENV=1`), follow `skills/orchestration/shepherdr/SKILL.md` as written today: 2–3 workers on trivial jobs in a scratch repo. Each job brief: "Ask the user one multiple-choice question (any small design choice about the file you will create), then create one small text file per the answer, then report." Use the cheapest model tier the bound tiering skill allows.
- [ ] **Step 2: Count wakes.** A "wake" = any completion of a shepherd-side background wait (`hrd agent wait ... --until done --until idle --until blocked`) including re-arms after spurious settles, plus monitor-triggered checks. Tally: total wakes, wakes that carried a real worker message (question/report found), spurious wakes (nothing new). Also record: time from `report.md` written to shepherd noticing, per worker.
- [ ] **Step 3: Record the baseline.** Write `.local-dev/rt-events-validation.md`:

```markdown
# rt-events shepherdr adoption — validation evidence

## Baseline (pre-change), <date>
- Herd: <N> workers, jobs: <names>, model: <model>
- Total shepherd wakes: <n>
- Wakes carrying a real message: <n>
- Spurious wakes (settle, nothing new): <n>
- Report-written → shepherd-noticed latency: <per worker>
- Notes: <anything anomalous>
```

- [ ] **Step 4: Commit**

```bash
git add .local-dev/rt-events-validation.md
git commit -m "test: baseline wake counts for shepherdr event-bus adoption (RED)"
```

---

### Task 2: `herd_db.py` module + `herd-init.py`

**Files:**
- Create: `skills/orchestration/shepherdr/scripts/herd_db.py`
- Create: `skills/orchestration/shepherdr/scripts/herd-init.py`
- Create: `skills/orchestration/shepherdr/scripts/herd-scripts.test.sh`

**Interfaces:**
- Produces: `herd_db.connect(path) -> sqlite3.Connection` (WAL, Row factory, 30s timeout), `herd_db.init_db(path)`, `herd_db.get_state(conn, key) -> str|None`, `herd_db.set_state(conn, key, value)`, `herd_db.now() -> int` (epoch seconds). Schema tables `questions`, `reports`, `jobs`, `state` exactly as below.
- Produces: `herd-init.py --repo <name>` and `herd-init.py --resume <run-dir>` → JSON `{"run":..., "db":..., "mode":"bus"|"degraded", "cursor":N}` on stdout, exit 0; exit 1 with stderr message on collision or missing resume dir.

- [ ] **Step 1: Write the failing test.** Create `herd-scripts.test.sh` (make it executable). It builds a stub `rt` whose behavior is switched by `RT_STUB_MODE` and logged to `RT_STUB_LOG`:

```bash
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

echo "herd-init: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
```

- [ ] **Step 2: Run it to verify it fails.** Run: `skills/orchestration/shepherdr/scripts/herd-scripts.test.sh` — expected: FAIL (herd-init.py does not exist).
- [ ] **Step 3: Write `herd_db.py`:**

```python
"""Shared SQLite access for a shepherdr herd-run DB.

One DB per run at ~/.mattstack/shepherdr/runs/<run-id>/herd.db. This module owns the
schema and connection settings; the herd-* CLI scripts own all behavior.
"""
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS questions(
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  needs TEXT NOT NULL DEFAULT 'answer',
  context TEXT,
  question TEXT NOT NULL,
  options TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  answer TEXT,
  asked_at INTEGER,
  answered_at INTEGER
);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  body TEXT NOT NULL,
  reported_at INTEGER,
  handled_at INTEGER
);
CREATE TABLE IF NOT EXISTS jobs(
  job TEXT PRIMARY KEY,
  repo TEXT, pane TEXT, target TEXT, worktree TEXT, branch TEXT,
  model TEXT, strategy TEXT, account TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  spawned_at INTEGER
);
CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT);
"""


def connect(db_path):
    conn = sqlite3.connect(db_path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path):
    conn = connect(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def get_state(conn, key):
    row = conn.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_state(conn, key, value):
    conn.execute(
        "INSERT OR REPLACE INTO state(key, value) VALUES(?, ?)", (key, str(value))
    )
    conn.commit()


def now():
    return int(time.time())
```

- [ ] **Step 4: Write `herd-init.py`:**

```python
#!/usr/bin/env python3
"""Mint or resume a shepherdr herd run.

  herd-init.py --repo <name>        mint run id, create run dir + DB,
                                    snapshot cursor, detect bus
  herd-init.py --resume <run-dir>   reopen an existing run (relaunched
                                    shepherd); reads state, never re-snapshots

Prints {"run", "db", "mode", "cursor"} JSON on stdout.

Cursor snapshot: `rt events list 'shepherdr/<run>/**' --limit 1`. For a
virgin run id nothing matches and the empty response carries the journal
head. NOTE: --limit 1 returns the OLDEST match when matches exist, so this
snapshot is only valid for a virgin run id — resume reads state instead.
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

import herd_db


def detect_bus(run_id):
    """Return (mode, cursor). Any failure to reach the bus means degraded."""
    try:
        proc = subprocess.run(
            ["rt", "events", "list", f"shepherdr/{run_id}/**", "--limit", "1"],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode != 0:
            return "degraded", 0
        resp = json.loads(proc.stdout)
        if not resp.get("ok"):
            return "degraded", 0
        return "bus", int(resp["cursor"])
    except Exception as exc:  # rt absent, timeout, bad JSON
        print(f"herd-init: bus probe failed: {exc}", file=sys.stderr)
        return "degraded", 0


def main():
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--repo")
    group.add_argument("--resume", metavar="RUN_DIR")
    args = ap.parse_args()

    if args.resume:
        db_path = os.path.join(args.resume, "herd.db")
        if not os.path.isfile(db_path):
            sys.exit(f"herd-init: no herd.db in {args.resume}")
        conn = herd_db.connect(db_path)
        out = {
            "run": herd_db.get_state(conn, "run_id"),
            "db": db_path,
            "mode": herd_db.get_state(conn, "mode"),
            "cursor": int(herd_db.get_state(conn, "cursor") or 0),
        }
        print(json.dumps(out, indent=1))
        return

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_id = f"{args.repo}-{stamp}"
    run_dir = os.path.expanduser(os.path.join("~", ".mattstack", "shepherdr", "runs", run_id))
    os.makedirs(run_dir, exist_ok=False)  # loud on the freak same-second collision
    db_path = os.path.join(run_dir, "herd.db")
    conn = herd_db.init_db(db_path)
    mode, cursor = detect_bus(run_id)
    herd_db.set_state(conn, "run_id", run_id)
    herd_db.set_state(conn, "repo", args.repo)
    herd_db.set_state(conn, "mode", mode)
    herd_db.set_state(conn, "cursor", cursor)
    print(json.dumps({"run": run_id, "db": db_path, "mode": mode, "cursor": cursor}, indent=1))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the test to verify it passes.** Run: `skills/orchestration/shepherdr/scripts/herd-scripts.test.sh` — expected: all pass, exit 0.
- [ ] **Step 6: Commit**

```bash
git add skills/orchestration/shepherdr/scripts/herd_db.py \
        skills/orchestration/shepherdr/scripts/herd-init.py \
        skills/orchestration/shepherdr/scripts/herd-scripts.test.sh
git commit -m "feat(shepherdr): herd run DB module and herd-init (bus detect, cursor snapshot)"
```

---

### Task 3: Worker publish scripts — `herd-ask.py` + `herd-report.py`

**Files:**
- Create: `skills/orchestration/shepherdr/scripts/herd-ask.py`
- Create: `skills/orchestration/shepherdr/scripts/herd-report.py`
- Modify: `skills/orchestration/shepherdr/scripts/herd-scripts.test.sh` (append cases)

**Interfaces:**
- Consumes: `herd_db.connect/now` from Task 2.
- Produces: `herd-ask.py --db D --run R --job J --context C --question Q --option O [--option O]... [--needs pane]` → prints bare qid, exit 0 even when the emit fails. `herd-report.py --db D --run R --job J --body-file F` (or `-` for stdin) → prints bare rid, exit 0 even when the emit fails. Emit commands exactly: `rt events emit shepherdr/<run>/<job>/question --json '{"qid": N}'` (resp. `report`, `{"rid": N}`).

- [ ] **Step 1: Append failing tests to `herd-scripts.test.sh`** (before the final summary lines; from here on the test file keeps one shared `$pass/$fail` and its final `[ "$fail" -eq 0 ]` gate):

```bash
# --- herd-ask / herd-report ---
RT_STUB_MODE=emit-ok
QID="$(python3 "$HERE/herd-ask.py" --db "$DB" --run "$RUN" --job alpha \
  --context "picking a name" --question "Which name?" \
  --option "widget -- short (recommended)" --option "gadget -- descriptive")" \
  && ok || bad "ask exits 0"
[ "$QID" = "1" ] && ok || bad "ask prints qid 1 (got $QID)"
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
  --context c --question q2 --option "a" --needs pane)" \
  && ok || bad "ask survives daemon down"
[ "$QID2" = "2" ] && ok || bad "second qid is 2"

RT_STUB_MODE=emit-ok
echo "job done, all green" > "$WORK/rep.md"
RID="$(python3 "$HERE/herd-report.py" --db "$DB" --run "$RUN" --job alpha --body-file "$WORK/rep.md")" \
  && ok || bad "report exits 0"
grep -q "events emit shepherdr/$RUN/alpha/report --json {\"rid\": 1}" "$RT_STUB_LOG" \
  && ok || bad "report emitted doorbell with rid"
```

- [ ] **Step 2: Run to verify the new cases fail.** Expected: FAIL (scripts missing).
- [ ] **Step 3: Write `herd-ask.py`:**

```python
#!/usr/bin/env python3
"""Worker-side: publish a question to the herd DB and ring the doorbell.

The insert is the contract; the emit is best-effort (a dead rt daemon is
invisible to workers — the shepherd's degraded-mode polling finds the row).
Prints the qid. After running this, STOP and wait for the answer.
"""
import argparse
import json
import subprocess
import sys

import herd_db


def best_effort_emit(topic, payload):
    try:
        subprocess.run(
            ["rt", "events", "emit", topic, "--json", json.dumps(payload)],
            capture_output=True, text=True, timeout=30,
        )
    except Exception as exc:
        print(f"herd-ask: emit skipped ({exc})", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--job", required=True)
    ap.add_argument("--context", required=True)
    ap.add_argument("--question", required=True)
    ap.add_argument("--option", action="append", default=[],
                    help="repeatable; the FIRST option is your recommendation")
    ap.add_argument("--needs", choices=["answer", "pane"], default="answer")
    args = ap.parse_args()

    conn = herd_db.connect(args.db)
    cur = conn.execute(
        "INSERT INTO questions(job, needs, context, question, options, asked_at)"
        " VALUES(?,?,?,?,?,?)",
        (args.job, args.needs, args.context, args.question,
         json.dumps(args.option), herd_db.now()),
    )
    conn.commit()
    qid = cur.lastrowid
    best_effort_emit(f"shepherdr/{args.run}/{args.job}/question", {"qid": qid})
    print(qid)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write `herd-report.py`:**

```python
#!/usr/bin/env python3
"""Worker-side: publish a report to the herd DB and ring the doorbell.

Same best-effort emit semantics as herd-ask.py. Prints the rid. After a
completion report, STOP; after a milestone report, STOP for review.
"""
import argparse
import json
import subprocess
import sys

import herd_db


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--job", required=True)
    ap.add_argument("--body-file", required=True, help="path, or - for stdin")
    args = ap.parse_args()

    body = sys.stdin.read() if args.body_file == "-" else open(args.body_file).read()
    if not body.strip():
        sys.exit("herd-report: empty report body")

    conn = herd_db.connect(args.db)
    cur = conn.execute(
        "INSERT INTO reports(job, body, reported_at) VALUES(?,?,?)",
        (args.job, body, herd_db.now()),
    )
    conn.commit()
    rid = cur.lastrowid
    try:
        subprocess.run(
            ["rt", "events", "emit", f"shepherdr/{args.run}/{args.job}/report",
             "--json", json.dumps({"rid": rid})],
            capture_output=True, text=True, timeout=30,
        )
    except Exception as exc:
        print(f"herd-report: emit skipped ({exc})", file=sys.stderr)
    print(rid)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the test file — expected: all pass.**
- [ ] **Step 6: Commit**

```bash
git add skills/orchestration/shepherdr/scripts/herd-ask.py \
        skills/orchestration/shepherdr/scripts/herd-report.py \
        skills/orchestration/shepherdr/scripts/herd-scripts.test.sh
git commit -m "feat(shepherdr): worker publish scripts with best-effort doorbells"
```

---

### Task 4: Shepherd read/answer/status scripts — `herd-read.py`, `herd-answer.py`, `herd-job.py`

**Files:**
- Create: `skills/orchestration/shepherdr/scripts/herd-read.py`
- Create: `skills/orchestration/shepherdr/scripts/herd-answer.py`
- Create: `skills/orchestration/shepherdr/scripts/herd-job.py`
- Modify: `skills/orchestration/shepherdr/scripts/herd-scripts.test.sh` (append cases)

**Interfaces:**
- Consumes: rows written by Task 3; `herd_db` from Task 2.
- Produces:
  - `herd-read.py --db D question <qid> | report <rid> | open-questions | log` → rendered markdown on stdout. `question` exits 0 only when the row exists; prints `status:` so the shepherd can detect stale replays.
  - `herd-answer.py --db D --qid N --target T <answer>` → runs relay FIRST via `${SHEPHERDR_RELAY:-<script-dir>/relay-answer.sh} T <answer>`; only on relay exit 0 marks the row answered. Relay failure: row stays open, exit 1. `--pane-handled` (no --target/answer) marks a needs:pane row answered as `(handled in pane)` without relaying.
  - `herd-job.py --db D <job> [--status active|done|crashed|closed] [--handled <rid>]` → updates jobs.status and/or reports.handled_at.

- [ ] **Step 1: Append failing tests:**

```bash
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

python3 "$HERE/herd-answer.py" --db "$DB" --qid 2 --pane-handled \
  && ok || bad "pane-handled exits 0"
python3 -c "
import sqlite3,sys
r=sqlite3.connect('$DB').execute('select status,answer from questions where id=2').fetchone()
sys.exit(0 if r==('answered','(handled in pane)') else 1)
" && ok || bad "pane-handled records placeholder answer"

# --- herd-job ---
python3 "$HERE/herd-job.py" --db "$DB" alpha --status done --handled 1 \
  && ok || bad "herd-job exits 0"
python3 -c "
import sqlite3,sys
c=sqlite3.connect('$DB')
h=c.execute('select handled_at from reports where id=1').fetchone()[0]
sys.exit(0 if h else 1)
" && ok || bad "report marked handled"
```

Note: `jobs` has no `alpha` row yet — `herd-job.py --status` on a missing job must insert-or-update (`INSERT OR IGNORE` then `UPDATE`), because in degraded startup order the shepherd may set status before spawn upserted. Add one assertion:

```bash
python3 -c "
import sqlite3,sys
r=sqlite3.connect('$DB').execute(\"select status from jobs where job='alpha'\").fetchone()
sys.exit(0 if r and r[0]=='done' else 1)
" && ok || bad "jobs row upserted with status done"

# --- herd-read log ---
python3 "$HERE/herd-read.py" --db "$DB" log | grep -q "alpha" \
  && ok || bad "log lists the job"
```

- [ ] **Step 2: Run to verify the new cases fail.**
- [ ] **Step 3: Write `herd-read.py`:**

```python
#!/usr/bin/env python3
"""Shepherd-side rendering of herd-DB rows. The shepherd never composes SQL.

  herd-read.py --db D question <qid>
  herd-read.py --db D report <rid>
  herd-read.py --db D open-questions
  herd-read.py --db D log
"""
import argparse
import json
import sys

import herd_db


def render_question(conn, qid):
    q = conn.execute("SELECT * FROM questions WHERE id=?", (qid,)).fetchone()
    if not q:
        sys.exit(f"herd-read: no question {qid}")
    print(f"# QUESTION qid {q['id']} from job {q['job']}")
    print(f"status: {q['status']}")
    print(f"needs: {q['needs']}")
    print(f"## Context\n{q['context'] or ''}")
    print(f"## Question\n{q['question']}")
    print("## Options")
    for i, opt in enumerate(json.loads(q["options"] or "[]"), 1):
        print(f"{i}. {opt}")
    if q["answer"]:
        print(f"## Answer\n{q['answer']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("verb", choices=["question", "report", "open-questions", "log"])
    ap.add_argument("id", nargs="?")
    args = ap.parse_args()
    conn = herd_db.connect(args.db)

    if args.verb == "question":
        render_question(conn, args.id)
    elif args.verb == "report":
        r = conn.execute("SELECT * FROM reports WHERE id=?", (args.id,)).fetchone()
        if not r:
            sys.exit(f"herd-read: no report {args.id}")
        handled = "handled" if r["handled_at"] else "unhandled"
        print(f"# REPORT rid {r['id']} from job {r['job']} ({handled})")
        print(r["body"])
    elif args.verb == "open-questions":
        for q in conn.execute(
            "SELECT id, job, needs, question FROM questions WHERE status='open' ORDER BY id"
        ):
            print(f"qid {q['id']} [{q['job']}] needs:{q['needs']} -- {q['question']}")
    elif args.verb == "log":
        for j in conn.execute("SELECT * FROM jobs ORDER BY spawned_at"):
            reports = conn.execute(
                "SELECT count(*) c FROM reports WHERE job=?", (j["job"],)
            ).fetchone()["c"]
            open_qs = conn.execute(
                "SELECT count(*) c FROM questions WHERE job=? AND status='open'",
                (j["job"],),
            ).fetchone()["c"]
            print(
                f"| {j['job']} | {j['pane'] or '-'} | {j['account'] or '-'} |"
                f" {j['strategy'] or '-'} | {j['status']} |"
                f" reports:{reports} open-questions:{open_qs} |"
            )


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write `herd-answer.py`:**

```python
#!/usr/bin/env python3
"""Shepherd-side: deliver an answer, then record it.

Relay FIRST (relay-answer.sh, overridable via SHEPHERDR_RELAY for tests);
only successful delivery marks the row answered. A failed relay leaves the
question open — it is still live — and exits 1 so the shepherd reports it.
--pane-handled records a needs:pane question the user resolved in the pane.
"""
import argparse
import os
import subprocess
import sys

import herd_db

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--qid", required=True, type=int)
    ap.add_argument("--target")
    ap.add_argument("--pane-handled", action="store_true")
    ap.add_argument("answer", nargs="?")
    args = ap.parse_args()

    conn = herd_db.connect(args.db)
    q = conn.execute("SELECT * FROM questions WHERE id=?", (args.qid,)).fetchone()
    if not q:
        sys.exit(f"herd-answer: no question {args.qid}")
    if q["status"] != "open":
        sys.exit(f"herd-answer: question {args.qid} is {q['status']}, not open")

    if args.pane_handled:
        answer = "(handled in pane)"
    else:
        if not args.target or args.answer is None:
            sys.exit("herd-answer: --target and an answer are required unless --pane-handled")
        relay = os.environ.get("SHEPHERDR_RELAY", os.path.join(HERE, "relay-answer.sh"))
        proc = subprocess.run([relay, args.target, args.answer])
        if proc.returncode != 0:
            sys.exit(f"herd-answer: relay failed (exit {proc.returncode}); question stays open")
        answer = args.answer

    conn.execute(
        "UPDATE questions SET status='answered', answer=?, answered_at=? WHERE id=?",
        (answer, herd_db.now(), args.qid),
    )
    conn.commit()


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Write `herd-job.py`:**

```python
#!/usr/bin/env python3
"""Shepherd-side jobs.status / reports.handled_at transitions.

  herd-job.py --db D <job> --status done|crashed|closed|active
  herd-job.py --db D <job> --handled <rid>       (marks the report handled)

Both flags may be combined (typical completion: --status done --handled N).
"""
import argparse
import sys

import herd_db


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("job")
    ap.add_argument("--status", choices=["active", "done", "crashed", "closed"])
    ap.add_argument("--handled", type=int, metavar="RID")
    args = ap.parse_args()
    if not args.status and args.handled is None:
        sys.exit("herd-job: nothing to do")

    conn = herd_db.connect(args.db)
    if args.status:
        conn.execute("INSERT OR IGNORE INTO jobs(job) VALUES(?)", (args.job,))
        conn.execute("UPDATE jobs SET status=? WHERE job=?", (args.status, args.job))
    if args.handled is not None:
        conn.execute(
            "UPDATE reports SET handled_at=? WHERE id=?", (herd_db.now(), args.handled)
        )
    conn.commit()


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run the test file — expected: all pass.**
- [ ] **Step 7: Commit**

```bash
git add skills/orchestration/shepherdr/scripts/herd-read.py \
        skills/orchestration/shepherdr/scripts/herd-answer.py \
        skills/orchestration/shepherdr/scripts/herd-job.py \
        skills/orchestration/shepherdr/scripts/herd-scripts.test.sh
git commit -m "feat(shepherdr): shepherd-side read/answer/status scripts (relay-first answers)"
```

---

### Task 5: `herd-wait.sh` — the one bus wait

**Files:**
- Create: `skills/orchestration/shepherdr/scripts/herd-wait.sh`
- Modify: `skills/orchestration/shepherdr/scripts/herd-scripts.test.sh` (append cases)

**Interfaces:**
- Consumes: `state` keys `run_id`/`cursor` from Task 2.
- Produces: `herd-wait.sh --db <db> [--timeout 15m]` → prints rt's JSON response verbatim on stdout, persists the returned cursor into `state` on exit 0 AND 124, exits with rt's code (0 events / 124 timeout / 1 unrecoverable — no persist on 1). The shepherd re-arms this in a background Bash after handling each exit.

- [ ] **Step 1: Append failing tests:**

```bash
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
" && bad "timeout cursor overwrote wrongly" || ok   # stub timeout returns 42; persisted

RT_STUB_MODE=down "$HERE/herd-wait.sh" --db "$DB" >/dev/null 2>&1; CODE=$?
[ "$CODE" -eq 1 ] && ok || bad "bus-unrecoverable passes through 1 (got $CODE)"
```

(The stub's `wait-timeout` returns cursor 42, so after this sequence the persisted cursor is 42 again — the third assertion verifies timeouts DO persist their cursor, per the rt spec's "every response carries a cursor".)

- [ ] **Step 2: Run to verify the new cases fail.**
- [ ] **Step 3: Write `herd-wait.sh`:**

```bash
#!/usr/bin/env bash
# The shepherd's single bus wait. Threads the persisted cursor into
# `rt events wait`, persists the returned cursor (every response carries
# one, including timeouts), prints rt's JSON verbatim, and passes rt's
# exit code through: 0 events / 124 timeout (sweep) / 1 bus unrecoverable.
# The persisted cursor is a wake optimization; resume correctness comes
# from DB reconciliation (see references/herd-bus.md), so persisting
# before the shepherd handles the events is safe.
#
# Usage: herd-wait.sh --db <herd.db> [--timeout 15m]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB=""; TIMEOUT="15m"
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "herd-wait: unknown arg $1" >&2; exit 2 ;;
  esac
done
[ -n "$DB" ] || { echo "herd-wait: --db required" >&2; exit 2; }

read -r RUN CURSOR < <(python3 -c "
import sys; sys.path.insert(0, '$HERE'); import herd_db
c = herd_db.connect('$DB')
print(herd_db.get_state(c, 'run_id'), herd_db.get_state(c, 'cursor') or 0)
")

set +e
OUT="$(rt events wait "shepherdr/$RUN/**" --after "$CURSOR" --timeout "$TIMEOUT")"
CODE=$?
set -e

if [ "$CODE" -eq 0 ] || [ "$CODE" -eq 124 ]; then
  echo "$OUT" | python3 -c "
import json, sys
sys.path.insert(0, '$HERE'); import herd_db
resp = json.load(sys.stdin)
c = herd_db.connect('$DB')
herd_db.set_state(c, 'cursor', resp['cursor'])
"
fi
[ -n "$OUT" ] && echo "$OUT"
exit "$CODE"
```

- [ ] **Step 4: `chmod +x` it, run the test file — expected: all pass.**
- [ ] **Step 5: Commit**

```bash
git add skills/orchestration/shepherdr/scripts/herd-wait.sh \
        skills/orchestration/shepherdr/scripts/herd-scripts.test.sh
git commit -m "feat(shepherdr): herd-wait.sh -- cursor-threaded single bus wait"
```

---

### Task 6: `herd-bridge.py` — pane lifecycle onto the bus (replaces herd-monitor.py)

**Files:**
- Create: `skills/orchestration/shepherdr/scripts/herd-bridge.py`
- Delete: `skills/orchestration/shepherdr/scripts/herd-monitor.py`
- Modify: `skills/orchestration/shepherdr/scripts/herd-scripts.test.sh` (append cases)

**Interfaces:**
- Consumes: `jobs` rows (`status='active'`, `pane`), `state.run_id`; `hrd` shim (override `SHEPHERDR_HRD` for tests).
- Produces: long-running `herd-bridge.py --db <db> [--interval 30]`, plus `--once` (single poll cycle, for tests and sweeps). Emits `shepherdr/<run>/<job>/blocked` on a transition INTO blocked and `shepherdr/<run>/<job>/gone` once when an active job's pane vanishes; prints the transition instead when the emit fails. Previous pane states persist in `state` key `bridge_prev` (JSON) so `--once` cycles and bridge restarts keep transition detection.

- [ ] **Step 1: Append failing tests.** The `hrd` stub serves `pane list` from a file the test rewrites between cycles:

```bash
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
```

- [ ] **Step 2: Run to verify the new cases fail.**
- [ ] **Step 3: Write `herd-bridge.py`** (adapt `collect_panes` from herd-monitor.py verbatim; delete herd-monitor.py in the same change):

```python
#!/usr/bin/env python3
"""Bridge herdr pane lifecycle onto the rt event bus.

Watches jobs with status='active' in the herd DB, polls `pane list`
through the hrd shim (SHEPHERDR_HERD_SESSION keeps working), and emits
shepherdr/<run>/<job>/blocked on transitions into blocked and .../gone
once when a watched pane vanishes. When an emit fails (bus absent), it
prints the transition instead — which is the old herd-monitor.py behavior,
so the same process serves bus and degraded modes.

Previous pane states persist in state.bridge_prev, so restarts and --once
cycles keep transition detection.

Usage:
    herd-bridge.py --db <herd.db> [--interval 30] [--once]
"""
import argparse
import json
import os
import subprocess
import sys
import time

import herd_db

HERE = os.path.dirname(os.path.abspath(__file__))
HRD = os.environ.get("SHEPHERDR_HRD", os.path.join(HERE, "hrd"))


def collect_panes(node, found):
    """Find {pane_id: agent_status} anywhere in the pane-list JSON."""
    if isinstance(node, dict):
        if "pane_id" in node:
            found[node["pane_id"]] = node.get("agent_status", "unknown")
        for v in node.values():
            collect_panes(v, found)
    elif isinstance(node, list):
        for v in node:
            collect_panes(v, found)


def snapshot():
    proc = subprocess.run([HRD, "pane", "list"], capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        return None
    found = {}
    try:
        collect_panes(json.loads(proc.stdout), found)
    except json.JSONDecodeError:
        return None
    return found


def emit_or_print(run, job, kind, pane, old):
    topic = f"shepherdr/{run}/{job}/{kind}"
    try:
        proc = subprocess.run(
            ["rt", "events", "emit", topic, "--json", "{}"],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode == 0:
            return
    except Exception:
        pass
    print(f"{pane} {old} -> {kind} ({job})", flush=True)


def cycle(conn):
    run = herd_db.get_state(conn, "run_id")
    prev = json.loads(herd_db.get_state(conn, "bridge_prev") or "{}")
    watch = {
        r["pane"]: r["job"]
        for r in conn.execute("SELECT pane, job FROM jobs WHERE status='active' AND pane IS NOT NULL")
    }
    snap = snapshot()
    if snap is None:
        print("herd-bridge: `pane list` failed", flush=True)
        return
    cur = {}
    for pane, job in watch.items():
        status = snap.get(pane, "gone")
        cur[pane] = status
        old = prev.get(pane)
        if old is None or old == status:
            continue
        if status == "blocked":
            emit_or_print(run, job, "blocked", pane, old)
        elif status == "gone":
            emit_or_print(run, job, "gone", pane, old)
    herd_db.set_state(conn, "bridge_prev", json.dumps(cur))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    conn = herd_db.connect(args.db)
    if args.once:
        cycle(conn)
        return
    while True:
        cycle(conn)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Delete `herd-monitor.py`.** `git rm skills/orchestration/shepherdr/scripts/herd-monitor.py`. Grep the skill dir for remaining `herd-monitor` references — SKILL.md's are rewritten in Task 9; there must be none in scripts/.
- [ ] **Step 5: Run the test file — expected: all pass.**
- [ ] **Step 6: Commit**

```bash
git add -A skills/orchestration/shepherdr/scripts/
git commit -m "feat(shepherdr): herd-bridge.py puts pane lifecycle on the bus; retire herd-monitor.py"
```

---

### Task 7: `spawn-agent.sh` — DB plumbing and the new kickoff

**Files:**
- Modify: `skills/orchestration/shepherdr/scripts/spawn-agent.sh`

**Interfaces:**
- Consumes: `herd_db` schema (jobs upsert), Task 3 script names for the kickoff text.
- Produces: new REQUIRED flags `-D <herd.db>` and `-R <run-id>`; new optional `-S <strategy>` and `-A <account>` (recorded in the jobs row). Everything else (flags, output contract `"<pane-id> <target>"`) unchanged.

- [ ] **Step 1: Add the flags.** In the getopts loop add `D:R:S:A:` cases setting `DB`, `RUN`, `STRATEGY`, `ACCOUNT`; add to the required-checks line: `: "${DB:?-D herd.db path required}" "${RUN:?-R run id required}"`. Update the usage comment block (lines 4–27) to document them.
- [ ] **Step 2: Upsert the jobs row.** Insert after the `TARGET` naming block (after line 156, before the kickoff), so pane and target are known:

```bash
# Record the spawn in the herd DB: the bridge derives its watch set from
# active jobs rows, and the wrap-up table is a SELECT over this.
python3 - "$DB" "$JOB" "$REPO_NAME" "$PANE" "$TARGET" "$WORKTREE" "${BRANCH:-}" "${MODEL:-}" "${STRATEGY:-}" "${ACCOUNT:-}" <<'PY'
import sqlite3, sys, time
db, job, repo, pane, target, worktree, branch, model, strategy, account = sys.argv[1:]
conn = sqlite3.connect(db, timeout=30)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute(
    "INSERT OR REPLACE INTO jobs(job,repo,pane,target,worktree,branch,model,strategy,account,status,spawned_at)"
    " VALUES(?,?,?,?,?,?,?,?,?,'active',?)",
    (job, repo, pane, target, worktree, branch, model, strategy, account, int(time.time())),
)
conn.commit()
PY
```

- [ ] **Step 3: Replace the default kickoff** (the `if [ -z "$KICKOFF" ]` block) with:

```bash
if [ -z "$KICKOFF" ]; then
  KICKOFF="Your job brief is at $JOB_DIR/job.md; read it and complete the entire job it describes. Its ## Method section names the method to run, and its verification must pass. Work only inside this worktree and write only within the brief's write fence. To ask the user a question, run the exact command in the brief's 'Asking the user a question' section, then stop and wait; the answer arrives as your next message. Every question is multiple choice; the first option is your recommendation. To publish a report (at completion, or at a Method milestone), follow the brief's 'Publishing a report' section, then stop. If a publish command fails, stop and wait -- never invent another channel. Commit incrementally on this branch; never push."
fi
```

- [ ] **Step 4: Verify by hand.** Run `spawn-agent.sh` with a missing `-D` and confirm the loud usage error; run `bash -n` on the script. (Full spawn behavior is live-validated in Task 10 — this script's herdr paths cannot run headless.)
- [ ] **Step 5: Commit**

```bash
git add skills/orchestration/shepherdr/scripts/spawn-agent.sh
git commit -m "feat(shepherdr): spawn-agent gains herd-DB plumbing and DB-contract kickoff"
```

---

### Task 8: `job-template.md` rewrite + wording micro-test (writing-skills GREEN)

**Files:**
- Modify: `skills/orchestration/shepherdr/references/job-template.md`

This is behavior-shaping guidance → per the spec's process section, the failure type is wrong-shaped output, so the form is a **positive recipe** (exact command), no prohibitions beyond the single stop rule, no nuance clauses. RED is the no-guidance control; GREEN is 5+ reps producing correct calls.

- [ ] **Step 1: RED — no-guidance control.** Dispatch 3 fresh subagents (cheapest tier). Each gets: a realistic brief assembled from the CURRENT template minus its "Asking the user a question" section, a real herd DB (created via `herd-init.py --repo micro-test`), and a task that forces a question ("create a file whose name the user must choose"). Instruct them to simulate a worker turn and STOP where they would ask. Expected: none of the 3 invents a `herd-ask.py` call (they'll ask in-session or write a file). Read each transcript manually; record the shapes in the commit message. If the control already produces correct calls, STOP — the guidance is unnecessary; re-plan.
- [ ] **Step 2: GREEN edit — replace the template's "Asking the user a question" section** (the block from `## Asking the user a question` through `Delete question.md after you receive the answer.`) with:

```markdown
## Asking the user a question
Run exactly (real values are filled in below; do not improvise paths):

    python3 <scripts-dir>/herd-ask.py --db <db-path> --run <run-id> --job <job> \
      --context "<what you're doing and what led here; enough that the user
                  can answer from this alone without opening your pane>" \
      --question "<one sentence>" \
      --option "<your recommendation> -- <one-line tradeoff>" \
      --option "<alternative> -- <one-line tradeoff>"

then STOP and wait; the answer arrives as your next message. Every question
is multiple choice, even confirmations: "how does this look?" becomes
--option "Approve, proceed" --option "Approve with changes (describe)"
--option "Walk me through <section> first". The first --option is always
your recommendation. If the user must see your screen, add --needs pane.
If the command fails, stop and wait.

## Publishing a report
Write the report your Method section requires to
.superpowers/report-draft.md in this worktree, then run:

    python3 <scripts-dir>/herd-report.py --db <db-path> --run <run-id> \
      --job <job> --body-file .superpowers/report-draft.md

then STOP. A Method that stops at milestones publishes each milestone the
same way.
```

Also update the template's Write fence line to `\`.superpowers/\` in this worktree is a permitted write path (superpowers owns \`sdd/\`; the report draft lives here too)`, and the Git section's contract sentence to: "Questions and reports go through the herd DB commands above, never into the repo." The shepherd fills `<scripts-dir>`, `<db-path>`, `<run-id>`, `<job>` when assembling each brief (this instruction goes in the template's header paragraph, next to the existing slot-filling sentence).

- [ ] **Step 3: GREEN verification — 5 reps.** Dispatch 5 fresh subagents with a brief assembled from the NEW template (slots really filled, real micro-test DB) and the same question-forcing task. Manually read all 5. Pass criteria, every rep: (a) runs `herd-ask.py` with ≥2 `--option`, recommendation first; (b) stops after asking — no in-session question, no question.md; (c) after being handed an answer, publishes via `herd-report.py` and stops. Verify rows: `herd-read.py --db <db> open-questions` and `log`. Any rep failing → tighten the wording (form, not nuance clauses) and re-run all 5.
- [ ] **Step 4: Commit** (record RED shapes and GREEN tally in the body):

```bash
git add skills/orchestration/shepherdr/references/job-template.md
git commit -m "feat(shepherdr): job template speaks the herd-DB contract (micro-tested 5/5)"
```

---

### Task 9: SKILL.md rewrite, `references/herd-bus.md`, cloud-lane deltas

**Files:**
- Modify: `skills/orchestration/shepherdr/SKILL.md`
- Create: `skills/orchestration/shepherdr/references/herd-bus.md`
- Modify: `skills/orchestration/shepherdr/references/cloud-lane.md`

The shepherd-side flow is conditional behavior (bus vs degraded) → conditionals keyed to observable exit codes, per the spec. SKILL.md must not grow materially: mechanics go to herd-bus.md.

- [ ] **Step 1: Create `references/herd-bus.md`:**

```markdown
# herd bus + herd DB mechanics

Loaded when herding. SKILL.md owns the flow; this file owns the machinery.

## the run

`herd-init.py --repo <repo>` mints `<repo>-<yyyymmdd-HHMMSS>`, creates
`~/.mattstack/shepherdr/runs/<run>/herd.db`, snapshots the bus cursor, and prints
`{run, db, mode, cursor}`. `mode: "degraded"` = no bus; use the degraded
loop below. `herd-init.py --resume <run-dir>` reopens a run after a
shepherd relaunch (never re-snapshots).

## topics and payloads

    shepherdr/<run>/<job>/question   {"qid": N}   herd-ask.py
    shepherdr/<run>/<job>/report     {"rid": N}   herd-report.py
    shepherdr/<run>/<job>/blocked    {}           herd-bridge.py
    shepherdr/<run>/<job>/gone       {}           herd-bridge.py

Events are doorbells; rows are the letters. Job names must be unique
within a run — prefix with the repo when a multi-repo herd collides.

## the DB

questions(id, job, needs, context, question, options, status
  open|answered|stale, answer, asked_at, answered_at)
reports(id, job, body, reported_at, handled_at)
jobs(job PK, repo, pane, target, worktree, branch, model, strategy,
  account, status active|done|crashed|closed, spawned_at)
state(key, value)  -- cursor, run_id, repo, mode, bridge_prev

Never compose SQL: herd-read.py renders, herd-answer.py records answers
(relay-first: a failed relay leaves the row open and exits 1),
herd-job.py transitions status/handled. Before ANY deliberate pane close
(respawn, mid-flight kill, wrap-up): `herd-job.py --db <db> <job>
--status closed` — otherwise the bridge reports a spurious crash.

## the wait

    scripts/herd-wait.sh --db <db>          # background Bash, re-arm on exit

| exit | meaning | act |
|---|---|---|
| 0 | events (stdout JSON) | handle each by topic, re-arm |
| 124 | 15m sweep | `hrd pane list`; cross-check settled panes against open questions / unhandled reports; a blocked pane the bus never announced = bridge sick (respawn it, say so); re-arm |
| 1 | bus unrecoverable (CLI could not reach or restart the daemon) | announce, switch to degraded |

A transiently killed daemon is NOT exit 1 — the rt CLI restarts it and
resumes from the cursor. Settled-silent workers are caught by the sweep,
up to 15 minutes late; accepted cost, the failure is rare and loud in
the pane.

## resume (shepherd relaunched mid-herd)

The DB, not the cursor, makes resume correct:
1. `herd-init.py --resume ~/.mattstack/shepherdr/runs/<run>`
2. Reconcile: relay every open question (`herd-read.py open-questions`);
   run completion for every report with no handled_at (`herd-read.py log`
   shows counts; `herd-job.py --handled` closes them out).
3. One pane-list sweep against active jobs.
4. Restart herd-bridge.py, re-arm herd-wait.sh. Replayed events whose
   rows are already answered/handled skip idempotently.

## degraded mode

Today's loop with the DB in place of files: per-agent waits
(`hrd agent wait <target> --until done --until idle --until blocked
--timeout 3600000`), herd-bridge.py keeps running (its emits fail, it
prints), and on every wake check `herd-read.py open-questions` and the
report counts instead of `ls`-ing a job dir. No automatic re-promotion
mid-herd.
```

- [ ] **Step 2: Rewrite SKILL.md sections.** Precise edit list (keep everything not named; keep all slot/accounts/strategy machinery):
  1. **"the job-dir contract" section** → retitle "## the herd contract". New body: "All shepherd–agent communication flows through the run's herd DB (`~/.mattstack/shepherdr/runs/<run>/herd.db`) plus one file: `~/.mattstack/shepherdr/jobs/<repo>/<job>/job.md`, the brief, copied in by spawn — outside every repo. Workers publish questions and reports with the scripts named in their brief; each publish rings an rt event doorbell so you wake only for real messages. Mechanics, schema, and every command: `references/herd-bus.md` (REQUIRED read at herd start)."
  2. **"job.md: two verbatim copies"**: add one sentence: "Fill the Method body's `<question-file>`/`<report-file>` slots with pointers to the brief's 'Asking the user a question' / 'Publishing a report' sections (the draft path is `.superpowers/report-draft.md`); the strategy skill stays medium-agnostic."
  3. **"step 2: spawn"**: before worktree acquisition add: "**Herd start:** run `scripts/herd-init.py --repo <repo>` once; it prints `{run, db, mode, cursor}`. `mode: "degraded"` = run today's watch loop (see herd-bus.md) — everything else below is identical." Update the spawn call signature to include `-D <db> -R <run> [-S <strategy>] [-A <account>]`.
  4. **"step 3: watch"** → replace both watcher blocks with: one background `scripts/herd-wait.sh --db <db>`, one background `scripts/herd-bridge.py --db <db>`, then the exit-code table (copy from herd-bus.md's "the wait" table). Replace the "when an event fires" table with a topic-keyed table: question → read row, relay; report → read row, completion; blocked → check open questions first, then pane; gone → active row = crash (report, `herd-job.py --status crashed`), non-active = deliberate close, skip.
  5. **"question relay"**: step 1 becomes `herd-read.py question <qid>` (skip unless `status: open`); the relay step becomes `herd-answer.py --db <db> --qid <id> --target $TARGET "2"`; the `needs: pane` step gains "afterwards `herd-answer.py --qid <id> --pane-handled`".
  6. **"completion"**: read via `herd-read.py report <rid>`; after the two objective checks add `herd-job.py --db <db> <job> --status done --handled <rid>`.
  7. **Respawn text (accounts section)**: replace the question.md/report.md sentences inside the quoted kickoff with the Task 7 kickoff's ask/report sentences; add "run `herd-job.py --db <db> <job> --status closed` before closing the pane" ahead of the close instruction.
  8. **"mid-flight changes"**: add the same `--status closed` rule before kills.
  9. **"wrap up"**: status table becomes "`herd-read.py log`, reformat for the user"; cleanup list: job dirs and worktrees as today, plus "the run dir `~/.mattstack/shepherdr/runs/<run>` is the run log — retain it; deleting it is only ever an explicit user ask."
  10. **"red flags"**: replace the pane-reading flag's wording with "the wait will tell you"; add: "About to compose SQL against herd.db? Stop — herd-read/herd-answer/herd-job are the only DB surface."; "About to close a pane without `herd-job.py --status closed`? Stop — the bridge will report a phantom crash."; "Sweep found a blocked pane the bus never announced? The bridge is sick — respawn it and say so."
- [ ] **Step 3: cloud-lane.md deltas.** In the intro, change "The job-dir contract is unchanged: job.md in, question.md/report.md out" to "Cloud lanes keep the FILE contract — a pod has no herd DB and no skill scripts: job.md in, question.md/report.md out, answers back in." Add to the "Brief deltas vs a pane lane" list: "Replace the brief's 'Asking the user a question' and 'Publishing a report' sections with the file contract below." Then append a new section `## question/report files (cloud contract)` containing, verbatim, the question-format block deleted from job-template.md in Task 8 (the `# QUESTION` format, the multiple-choice rule, `needs: pane`, delete-after-answer) plus one report line: "When the job is complete, write report.md to the in-pod job dir per the brief's Method contract, then stop."
- [ ] **Step 4: Consistency pass.** `grep -rn "question\.md\|report\.md\|herd-monitor" skills/orchestration/shepherdr/` — hits must exist ONLY in cloud-lane.md. `grep -n "herd-" skills/orchestration/shepherdr/SKILL.md` — every referenced script must exist in scripts/. Check SKILL.md length: `wc -w` before vs after — after must not exceed before by more than ~10%.
- [ ] **Step 5: Commit**

```bash
git add skills/orchestration/shepherdr/SKILL.md \
        skills/orchestration/shepherdr/references/herd-bus.md \
        skills/orchestration/shepherdr/references/cloud-lane.md
git commit -m "feat(shepherdr): SKILL.md speaks the bus; mechanics in herd-bus.md; cloud lane keeps files"
```

---

### Task 10: Live validation — bus mode (MAIN SESSION, success criterion 1)

- [ ] **Step 1: Run the mirror of Task 1's herd** (same job shapes, same worker count, same model tier) following the NEW skill end to end: herd-init, spawn with `-D/-R`, herd-wait + herd-bridge, relay via herd-answer, completion via herd-job.
- [ ] **Step 2: Measure.** Count shepherd wakes (herd-wait exits + any other background completions) and classify: real message / sweep / spurious. Target: wakes ≈ real worker messages + sweeps; zero spurious settle wakes. Record report-written → shepherd-noticed latency (expect seconds).
- [ ] **Step 3: Relaunch resume.** Mid-herd (with at least one worker still working), kill the shepherd session and start a fresh one: `herd-init.py --resume`, reconcile per herd-bus.md, re-arm. Then have a worker publish — confirm the resumed shepherd receives it and that nothing published during the gap was lost (check `herd-read.py log` totals vs worker activity).
- [ ] **Step 4: Append results to `.local-dev/rt-events-validation.md`** (same fields as baseline plus resume outcome). Commit: `git commit -am "test: bus-mode live herd results (GREEN)"`.

### Task 11: Live validation — resilience (MAIN SESSION, success criterion 2)

- [ ] **Step 1: Daemon kill = self-heal.** With a worker mid-job and herd-wait armed, kill the rt daemon process. Expected: the CLI restarts it; herd-wait does NOT exit 1; a subsequent worker publish arrives with no missed events. Record what actually happened — if the CLI does not restart it, that is a real finding about the rt transport; report it honestly and test degradation with this same lever.
- [ ] **Step 2: Forced degradation.** Make the bus unrecoverable (pin the mechanism live — e.g. move the rt binary aside or stop the daemon in a way its restart path can't recover, whichever proves out). Expected: herd-wait exits 1; shepherd announces, switches to degraded (per-agent waits + open-questions polling); workers keep working; a question asked during degradation reaches the user via polling; no worker errors (emits best-effort). Restore rt afterwards.
- [ ] **Step 3: Append results + commit.**

### Task 12: Evidence write-up and wrap

- [ ] **Step 1: Finish `.local-dev/rt-events-validation.md`** with the before/after wake-count comparison table and a one-paragraph verdict on RT-44's premise (honest either way — a negative result is a result).
- [ ] **Step 2: Sweep for loopholes observed during Tasks 10–11** (worker or shepherd misbehavior: hand-rolled SQL, question.md habits, skipped `--status closed`). Each observed one gets a counter in SKILL.md/template + a re-test per writing-skills REFACTOR. Unobserved failure modes get nothing.
- [ ] **Step 3: Final commit; update the spec's Status line to "Implemented + validated" with a pointer to the evidence file.**

---

## Self-Review (performed at write time)

- **Spec coverage:** run identity/layout (T2), topics (T3/T6), schema (T2/T4), worker scripts (T3), shepherd scripts (T4/T5), bridge + hrd shim + active-only watch (T6), spawn plumbing + kickoff (T7), template recipe + micro-test (T8), SKILL/herd-bus/cloud-lane + slot-fill rule + wrap-up retention + red flags (T9), watch-loop table + sweep + resume (T5/T9/T10), degraded mode (T2/T6/T9/T11), validation criteria 1–3 (T10–T12), writing-skills RED/GREEN/REFACTOR (T1/T8/T12).
- **Type consistency:** state keys (`run_id`, `repo`, `mode`, `cursor`, `bridge_prev`) uniform across T2/T5/T6; flag names `--db/--run/--job` uniform across worker scripts; `herd-job.py` statuses match the schema's four values; spawn's `-D/-R` feed the same paths herd-init printed.
- **Placeholders:** none — every step carries its code or exact edit text; live tasks carry measurable pass criteria.
