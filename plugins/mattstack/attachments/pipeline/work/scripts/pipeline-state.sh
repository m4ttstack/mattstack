#!/bin/sh
# pipeline-state.sh -- the ONLY write path to a pipeline's run DB.
# Spec: .local-dev/superpowers/specs/2026-08-21-run-db-design.md
#   run-start   --repo R --work-type T --pipeline P [--run-id ID] [--spawned-by S] [--pack-dirs "DIR:DIR"] [--ticket ID] [--mattstack-sha SHA] [--mattstack-dirty 0|1]
#   run-status  --status done|failed|abandoned
#   stage-start --stage NAME        stage-done --stage NAME
#   stage-fail  --stage NAME [--reason TEXT] [--detail-path PATH]
#   field set KEY VALUE --stage NAME          field get KEY
#   decision record --contract C --scope S --selection JSON --decided-by W
#   snapshot                        full run document as JSON (resume/re-entry)
# Env: RT_RUN_DB (all but run-start), RT_RUNS_ROOT (root override),
#      RT_RUN_EMIT=0 disables event emission (tests).
# Requires: POSIX sh, sqlite3, jq. rt is optional (emission degrades silently).
set -u

RUNS_ROOT="${RT_RUNS_ROOT:-$HOME/.mattstack/runs}"
SCHEMA_VERSION=2

json_fail() { # $1=message $2=exit code
  printf '{"ok":false,"error":"%s"}\n' "$1"; exit "$2"
}

now_ms() { echo $(( $(date +%s) * 1000 )); }

esc() { printf %s "$1" | sed "s/'/''/g"; }

migrate_db() { # bring an existing DB up to SCHEMA_VERSION; safe to call repeatedly
  have=$(sqlite3 "$RT_RUN_DB" "PRAGMA user_version;" 2>/dev/null) || return 0
  [ "${have:-0}" -ge "$SCHEMA_VERSION" ] && return 0
  # Each ALTER is independently tolerant: a half-applied migration from an
  # interrupted call must converge on the next one, not wedge.
  sqlite3 "$RT_RUN_DB" "ALTER TABLE stages ADD COLUMN reason TEXT;" >/dev/null 2>&1
  sqlite3 "$RT_RUN_DB" "ALTER TABLE stages ADD COLUMN detail_path TEXT;" >/dev/null 2>&1
  sqlite3 "$RT_RUN_DB" "ALTER TABLE runs ADD COLUMN pack_commits TEXT;" >/dev/null 2>&1
  sqlite3 "$RT_RUN_DB" "ALTER TABLE runs ADD COLUMN pack_dirty INTEGER DEFAULT 0;" >/dev/null 2>&1
  # Stamp ONLY if the columns are actually there. All stderr above is discarded,
  # so an ALTER that failed for any reason other than duplicate-column would
  # otherwise be invisible, and a stamped version would make every later call
  # return early against a DB that never migrated.
  stage_cols=$(sqlite3 "$RT_RUN_DB" "SELECT name FROM pragma_table_info('stages');" 2>/dev/null)
  run_cols=$(sqlite3 "$RT_RUN_DB" "SELECT name FROM pragma_table_info('runs');" 2>/dev/null)
  case "$stage_cols" in
    *reason*)
      case "$run_cols" in
        *pack_commits*) sqlite3 "$RT_RUN_DB" "PRAGMA user_version=$SCHEMA_VERSION;" >/dev/null 2>&1 ;;
      esac
      ;;
  esac
}

pack_provenance() { # $1=colon-separated dirs; prints "<dirty>|<name=sha,...>"
  dirty=0; out=""
  command -v git >/dev/null 2>&1 || { printf '0|'; return 0; }
  # set -f: a pack path containing a glob character must not expand here.
  set -f; IFS=':'
  for d in $1; do
    [ -n "$d" ] || continue
    # A directory that is not a git checkout records nothing: unknown provenance
    # must read as absent, never as a guess.
    sha=$(git -C "$d" rev-parse --short HEAD 2>/dev/null) || continue
    name=$(basename "$d")
    out="${out:+$out,}$name=$sha"
    # status --porcelain covers unstaged, staged, and untracked in one call;
    # `git diff --quiet` alone misses staged changes and untracked files.
    [ -n "$(git -C "$d" status --porcelain 2>/dev/null)" ] && dirty=1
  done
  set +f; unset IFS
  printf '%s|%s' "$dirty" "$out"
}

need_db() {
  [ -n "${RT_RUN_DB:-}" ] || json_fail "RT_RUN_DB is not set" 2
  [ -f "$RT_RUN_DB" ] || json_fail "run DB not found: $RT_RUN_DB" 2
  migrate_db
}

db_exec() { # $1=sql; busy_timeout guards concurrent helper calls in one run
  sqlite3 "$RT_RUN_DB" "PRAGMA busy_timeout=5000; $1" >/dev/null || json_fail "sqlite write failed" 1
}

db_json() { # $1=sql -> rows as JSON array (empty array when no rows)
  out=$(sqlite3 -json "$RT_RUN_DB" "$1"); [ -n "$out" ] && printf %s "$out" || printf '[]'
}

flag() { # $1=flag name, rest=argv; prints value or nothing
  f="$1"; shift
  while [ $# -gt 1 ]; do [ "$1" = "$f" ] && { printf %s "$2"; return; }; shift; done
}

emit_update() { # $1=kind $2=stage("" for run-level). Never blocks: DB write has
                # already landed; a wedged daemon costs nothing here.
  [ "${RT_RUN_EMIT:-1}" = "0" ] && return 0
  command -v rt >/dev/null 2>&1 || return 0
  row=$(sqlite3 "$RT_RUN_DB" "SELECT id || '|' || repo FROM runs LIMIT 1;" 2>/dev/null) || return 0
  rid=${row%%|*}; rrepo=${row#*|}
  payload=$(jq -nc --arg repo "$rrepo" --arg runId "$rid" --arg stage "$2" --arg kind "$1" \
    '{repo:$repo, runId:$runId, stage:(if $stage == "" then null else $stage end), kind:$kind}')
  ( rt events emit run-updated --json "$payload" >/dev/null 2>&1 </dev/null & )
}

cmd="${1:-}"; [ -n "$cmd" ] && shift || json_fail "usage: pipeline-state.sh <subcommand>" 2

case "$cmd" in
  run-start)
    REPO=$(flag --repo "$@" x); WT=$(flag --work-type "$@" x)
    PIPE=$(flag --pipeline "$@" x); SPAWN=$(flag --spawned-by "$@" x)
    RUN_ID=$(flag --run-id "$@" x)
    PACK_DIRS=$(flag --pack-dirs "$@" x)
    TICKET=$(flag --ticket "$@" x)
    MS_SHA=$(flag --mattstack-sha "$@" x)
    MS_DIRTY=$(flag --mattstack-dirty "$@" x)
    [ -n "$REPO" ] && [ -n "$WT" ] && [ -n "$PIPE" ] || json_fail "run-start needs --repo --work-type --pipeline" 2
    [ -n "$RUN_ID" ] || RUN_ID="$(date +%Y%m%d-%H%M%S)-$(awk 'BEGIN{srand();printf "%04x",int(rand()*65536)}')-$$"
    RUN_DIR="$RUNS_ROOT/$REPO/$RUN_ID"
    mkdir -p "$RUN_DIR" || json_fail "cannot create $RUN_DIR" 1
    RT_RUN_DB="$RUN_DIR/state.db"
    sqlite3 "$RT_RUN_DB" "
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, repo TEXT NOT NULL, work_type TEXT NOT NULL,
        pipeline TEXT NOT NULL, status TEXT NOT NULL, current_stage TEXT,
        spawned_by TEXT, started_at INTEGER NOT NULL, ended_at INTEGER,
        pack_commits TEXT, pack_dirty INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS stages (
        run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL,
        status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
        started_at INTEGER, ended_at INTEGER, reason TEXT, detail_path TEXT,
        PRIMARY KEY (run_id, name, attempt));
      CREATE TABLE IF NOT EXISTS fields (
        run_id TEXT NOT NULL REFERENCES runs(id), key TEXT NOT NULL,
        value TEXT NOT NULL, produced_by TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (run_id, key));
      CREATE TABLE IF NOT EXISTS decisions (
        run_id TEXT NOT NULL REFERENCES runs(id), contract TEXT NOT NULL,
        scope TEXT NOT NULL, selection TEXT NOT NULL, decided_by TEXT NOT NULL,
        decided_at INTEGER NOT NULL, PRIMARY KEY (run_id, contract, scope));
    " >/dev/null || json_fail "run DB creation failed" 1

    # Between the schema and the row: an existing v1 DB is brought up before
    # anything claims a version, and a refused INSERT below cannot mislabel it.
    migrate_db

    PACK_DIRTY=0
    PACKC=""
    if [ -n "$PACK_DIRS" ]; then
      prov=$(pack_provenance "$PACK_DIRS")
      PACK_DIRTY=${prov%%|*}
      PACKC=${prov#*|}
    fi
    if [ -n "$MS_SHA" ]; then PACKC="${PACKC:+$PACKC,}mattstack=$MS_SHA"; fi
    [ "$MS_DIRTY" = 1 ] && PACK_DIRTY=1

    sqlite3 "$RT_RUN_DB" "
      INSERT INTO runs (id, repo, work_type, pipeline, status, spawned_by, started_at, pack_commits, pack_dirty)
      VALUES ('$(esc "$RUN_ID")', '$(esc "$REPO")', '$(esc "$WT")', '$(esc "$PIPE")',
              'running', $( [ -n "$SPAWN" ] && printf "'%s'" "$(esc "$SPAWN")" || printf NULL ),
              $(now_ms),
              $( [ -n "$PACKC" ] && printf "'%s'" "$(esc "$PACKC")" || printf NULL ),
              $PACK_DIRTY);
    " >/dev/null || json_fail "run id already exists: $RUN_ID" 1
    if [ -n "$TICKET" ]; then
      sqlite3 "$RT_RUN_DB" "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at)
        VALUES ('$(esc "$RUN_ID")', 'ticket', '$(esc "$TICKET")', 'work', $(now_ms));" >/dev/null \
        || json_fail "could not record ticket" 1
    fi
    export RT_RUN_DB
    emit_update run-start ""
    printf '{"ok":true,"runId":"%s","runDb":"%s"}\n' "$RUN_ID" "$RT_RUN_DB"
    ;;

  run-status)
    need_db
    STATUS=$(flag --status "$@" x)
    case "$STATUS" in done|failed|abandoned) ;; *) json_fail "run-status needs --status done|failed|abandoned" 2 ;; esac
    db_exec "UPDATE runs SET status='$(esc "$STATUS")', ended_at=$(now_ms);"
    emit_update run-status ""
    printf '{"ok":true}\n'
    ;;

  snapshot)
    need_db
    jq -n \
      --argjson run       "$(db_json 'SELECT * FROM runs LIMIT 1;')" \
      --argjson stages    "$(db_json 'SELECT * FROM stages ORDER BY started_at, attempt;')" \
      --argjson fields    "$(db_json 'SELECT * FROM fields ORDER BY at;')" \
      --argjson decisions "$(db_json 'SELECT * FROM decisions ORDER BY decided_at;')" \
      '{ok:true, run:($run[0] // null), stages:$stages, fields:$fields, decisions:$decisions}'
    ;;

  stage-start)
    need_db
    STAGE=$(flag --stage "$@" x); [ -n "$STAGE" ] || json_fail "stage-start needs --stage" 2
    db_exec "
      INSERT INTO stages (run_id, name, status, attempt, started_at)
      SELECT id, '$(esc "$STAGE")', 'running',
             COALESCE((SELECT MAX(attempt) FROM stages WHERE name='$(esc "$STAGE")'),0)+1,
             $(now_ms) FROM runs;
      UPDATE runs SET current_stage='$(esc "$STAGE")';"
    emit_update stage-start "$STAGE"
    printf '{"ok":true}\n'
    ;;

  stage-done|stage-fail)
    need_db
    STAGE=$(flag --stage "$@" x); [ -n "$STAGE" ] || json_fail "$cmd needs --stage" 2
    [ "$cmd" = "stage-done" ] && ST=done || ST=failed
    REASON=$(flag --reason "$@" x); DETAIL=$(flag --detail-path "$@" x)
    db_exec "
      UPDATE stages SET status='$ST', ended_at=$(now_ms),
        reason=$( [ -n "$REASON" ] && printf "'%s'" "$(esc "$REASON")" || printf NULL ),
        detail_path=$( [ -n "$DETAIL" ] && printf "'%s'" "$(esc "$DETAIL")" || printf NULL )
      WHERE name='$(esc "$STAGE")'
        AND attempt=(SELECT MAX(attempt) FROM stages WHERE name='$(esc "$STAGE")');"
    emit_update "$cmd" "$STAGE"
    printf '{"ok":true}\n'
    ;;

  field)
    need_db
    sub="${1:-}"; shift 2>/dev/null || true
    case "$sub" in
      set)
        KEY="${1:-}"; VAL="${2:-}"; shift 2 2>/dev/null || json_fail "field set needs KEY VALUE" 2
        STAGE=$(flag --stage "$@" x); [ -n "$STAGE" ] || json_fail "field set needs --stage" 2
        db_exec "INSERT OR REPLACE INTO fields (run_id, key, value, produced_by, at)
                 SELECT id, '$(esc "$KEY")', '$(esc "$VAL")', '$(esc "$STAGE")', $(now_ms) FROM runs;"
        emit_update field-set "$STAGE"
        printf '{"ok":true}\n'
        ;;
      get)
        KEY="${1:-}"; [ -n "$KEY" ] || json_fail "field get needs KEY" 2
        VAL=$(sqlite3 "$RT_RUN_DB" "SELECT value FROM fields WHERE key='$(esc "$KEY")';")
        [ -n "$VAL" ] || exit 3
        printf '%s\n' "$VAL"
        ;;
      *) json_fail "field needs set|get" 2 ;;
    esac
    ;;

  decision)
    need_db
    [ "${1:-}" = "record" ] || json_fail "decision needs record" 2; shift
    C=$(flag --contract "$@" x); S=$(flag --scope "$@" x)
    SEL=$(flag --selection "$@" x); W=$(flag --decided-by "$@" x)
    [ -n "$C" ] && [ -n "$S" ] && [ -n "$SEL" ] && [ -n "$W" ] || json_fail "decision record needs --contract --scope --selection --decided-by" 2
    db_exec "INSERT OR REPLACE INTO decisions (run_id, contract, scope, selection, decided_by, decided_at)
             SELECT id, '$(esc "$C")', '$(esc "$S")', '$(esc "$SEL")', '$(esc "$W")', $(now_ms) FROM runs;"
    emit_update decision "$S"
    printf '{"ok":true}\n'
    ;;

  *) json_fail "unknown subcommand: $cmd" 2 ;;
esac
