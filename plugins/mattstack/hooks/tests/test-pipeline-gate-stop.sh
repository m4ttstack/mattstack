#!/usr/bin/env bash
# Offline tests for pipeline-gate-stop.sh.
#
# `rt` is stubbed: `rt runs snapshot` prints the JSON stored beside the run's
# state.db (state.db.snapshot.json), so each case controls exactly what the
# hook sees. Nothing here touches the real runs root or the real rt.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../pipeline-gate-stop.sh"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin" "$SANDBOX/home" "$SANDBOX/runs"
cat > "$SANDBOX/bin/rt" <<'STUB'
#!/usr/bin/env bash
[ -f "${RT_STUB_USAGE:-/nonexistent}" ] && { echo "usage: rt runs ..."; exit 2; }
if [ "$1" = "runs" ] && [ "$2" = "find" ]; then
  # With the find fixture present, behave like rt >= PR 175; without it,
  # behave like an older rt whose dispatcher falls through to the listing.
  if [ -f "${RT_STUB_FIND:-/nonexistent}" ]; then cat "$RT_STUB_FIND"; exit 0; fi
  echo "RUN            REPO   STATUS"; exit 0
fi
[ "$1" = "runs" ] && [ "$2" = "snapshot" ] || exit 2
cat "$RT_RUN_DB.snapshot.json"
STUB
chmod +x "$SANDBOX/bin/rt"

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

mkrun() { # repo runId status session [hold_value hold_at] -> writes a fixture run
  local d="$SANDBOX/runs/$1/$2"; mkdir -p "$d"; : > "$d/state.db"
  local hold=""
  [ -n "${5:-}" ] && hold=",{\"key\":\"hold\",\"value\":\"$5\",\"produced_by\":\"work\",\"at\":$6}"
  cat > "$d/state.db.snapshot.json" <<EOF
{"ok":true,
 "run":{"id":"$2","repo":"$1","work_type":"feature","pipeline":"feature","status":"$3","current_stage":"ship","started_at":${7:-1000}},
 "stages":[{"name":"plan","status":"done","attempt":1,"started_at":1000},{"name":"ship","status":"running","attempt":1,"started_at":2000}],
 "fields":[{"key":"claude-session","value":"$4","produced_by":"run","at":1000}$hold],
 "decisions":[]}
EOF
}

run() { # stdin-json -> "exit=<code> err=<stderr first line> out=<stdout>"
  local out err code
  out="$(printf '%s' "$1" | env -i HOME="$SANDBOX/home" PATH="$SANDBOX/bin:/usr/bin:/bin" RT_RUNS_ROOT="$SANDBOX/runs" ${RT_STUB_USAGE:+RT_STUB_USAGE="$RT_STUB_USAGE"} ${RT_STUB_FIND:+RT_STUB_FIND="$RT_STUB_FIND"} sh "$HOOK" 2>"$SANDBOX/err")"
  code=$?
  err="$(head -1 "$SANDBOX/err" 2>/dev/null)"
  printf 'exit=%s err=%s out=%s' "$code" "$err" "$out"
}

SID="11111111-2222-3333-4444-555555555555"
STOP="{\"session_id\":\"$SID\",\"hook_event_name\":\"Stop\",\"stop_hook_active\":false}"
STOP_ACTIVE="{\"session_id\":\"$SID\",\"hook_event_name\":\"Stop\",\"stop_hook_active\":true}"

# No runs root at all: silent.
rm -rf "$SANDBOX/runs"
check "no runs root exits 0" "exit=0 err= out=" "$(run "$STOP")"
mkdir -p "$SANDBOX/runs"

# No run matches this session: silent.
mkrun repo-a 20260901-000001-aaaa-1 running other-session
check "other session's run exits 0" "exit=0 err= out=" "$(run "$STOP")"

# This session's running run: blocked, message names the run and the stage.
mkrun repo-a 20260901-000002-bbbb-2 running "$SID"
r="$(run "$STOP")"
case "$r" in exit=2*20260901-000002-bbbb-2*) echo "ok   running run exits 2 naming the run";; *) echo "FAIL running run exits 2 naming the run"; echo "       got : $r"; fails=$((fails+1));; esac
case "$r" in *"stage \`ship\`"*) echo "ok   message names the stage";; *) echo "FAIL message names the stage"; fails=$((fails+1));; esac
case "$r" in *"Four exits"*) echo "ok   message lists the exits";; *) echo "FAIL message lists the exits"; fails=$((fails+1));; esac
case "$r" in *"out=") echo "ok   no stdout on block";; *) echo "FAIL no stdout on block"; fails=$((fails+1));; esac

# stop_hook_active does not open a side door.
r="$(run "$STOP_ACTIVE")"
case "$r" in exit=2*) echo "ok   stop_hook_active still exits 2";; *) echo "FAIL stop_hook_active still exits 2"; echo "       got : $r"; fails=$((fails+1));; esac

# A finished run is not this session's problem.
rm -rf "$SANDBOX/runs/repo-a/20260901-000002-bbbb-2"
mkrun repo-a 20260901-000003-cccc-3 done "$SID"
check "done run exits 0" "exit=0 err= out=" "$(run "$STOP")"

# Two matching running runs: the newer started_at is the one named.
mkrun repo-a 20260901-000004-dddd-4 running "$SID" "" "" 5000
mkrun repo-a 20260901-000005-eeee-5 running "$SID" "" "" 9000
r="$(run "$STOP")"
case "$r" in exit=2*20260901-000005-eeee-5*) echo "ok   newest of two matches is named";; *) echo "FAIL newest of two matches is named"; echo "       got : $r"; fails=$((fails+1));; esac
rm -rf "$SANDBOX/runs/repo-a/20260901-000004-dddd-4" "$SANDBOX/runs/repo-a/20260901-000005-eeee-5"

# A held run (hold newer than the latest stage start, not the cleared sentinel) may end its turn.
mkrun repo-a 20260901-000006-ffff-6 running "$SID" "parked for the night" 3000
check "held run exits 0" "exit=0 err= out=" "$(run "$STOP")"
rm -rf "$SANDBOX/runs/repo-a/20260901-000006-ffff-6"

# A cleared hold (`-`) does not count.
mkrun repo-a 20260901-000007-gggg-7 running "$SID" "-" 3000
r="$(run "$STOP")"
case "$r" in exit=2*) echo "ok   cleared hold still exits 2";; *) echo "FAIL cleared hold still exits 2"; echo "       got : $r"; fails=$((fails+1));; esac
rm -rf "$SANDBOX/runs/repo-a/20260901-000007-gggg-7"

# A stale hold (older than the latest stage start) does not count.
mkrun repo-a 20260901-000008-hhhh-8 running "$SID" "old" 1500
r="$(run "$STOP")"
case "$r" in exit=2*) echo "ok   stale hold still exits 2";; *) echo "FAIL stale hold still exits 2"; echo "       got : $r"; fails=$((fails+1));; esac
rm -rf "$SANDBOX/runs/repo-a/20260901-000008-hhhh-8"

# A run dir untouched for more than 48 hours is not scanned.
mkrun repo-a 20260901-000009-iiii-9 running "$SID"
touch -t 202601010000 "$SANDBOX/runs/repo-a/20260901-000009-iiii-9/state.db"
check "old run dir is not scanned" "exit=0 err= out=" "$(run "$STOP")"
rm -rf "$SANDBOX/runs/repo-a/20260901-000009-iiii-9"

# With `rt runs find` available, the scan is skipped: an old run dir the scan
# would ignore is still found through find, and a run find does not return is
# not blocked even though the scan would see it.
mkrun repo-a 20260901-000011-kkkk-11 running "$SID"
touch -t 202601010000 "$SANDBOX/runs/repo-a/20260901-000011-kkkk-11/state.db"
printf '{"ok":true,"runs":[{"repo":"repo-a","runId":"20260901-000011-kkkk-11","runDb":"%s","status":"running","current_stage":"ship","started_at":1000,"ended_at":null}]}' "$SANDBOX/runs/repo-a/20260901-000011-kkkk-11/state.db" > "$SANDBOX/find.json"
r="$(RT_STUB_FIND="$SANDBOX/find.json" run "$STOP")"
case "$r" in exit=2*20260901-000011-kkkk-11*) echo "ok   find result is used over the scan";; *) echo "FAIL find result is used over the scan"; echo "       got : $r"; fails=$((fails+1));; esac
mkrun repo-a 20260901-000012-llll-12 running "$SID"
printf '{"ok":true,"runs":[]}' > "$SANDBOX/find-empty.json"
check "empty find result exits 0 without scanning" "exit=0 err= out=" "$(RT_STUB_FIND="$SANDBOX/find-empty.json" run "$STOP")"
rm -rf "$SANDBOX/runs/repo-a/20260901-000011-kkkk-11" "$SANDBOX/runs/repo-a/20260901-000012-llll-12" "$SANDBOX/find.json" "$SANDBOX/find-empty.json"

# rt printing usage instead of JSON: silent.
mkrun repo-a 20260901-000010-jjjj-10 running "$SID"
: > "$SANDBOX/usage-flag"
RT_STUB_USAGE="$SANDBOX/usage-flag" r="$(RT_STUB_USAGE="$SANDBOX/usage-flag" run "$STOP")"
check "rt printing usage exits 0" "exit=0 err= out=" "$r"
rm -f "$SANDBOX/usage-flag"

# rt missing entirely: silent.
mv "$SANDBOX/bin/rt" "$SANDBOX/bin/rt.off"
check "rt missing exits 0" "exit=0 err= out=" "$(run "$STOP")"
mv "$SANDBOX/bin/rt.off" "$SANDBOX/bin/rt"

# Malformed and empty stdin: silent.
check "malformed stdin exits 0" "exit=0 err= out=" "$(run 'not json')"
check "empty stdin exits 0" "exit=0 err= out=" "$(run '')"

[ "$fails" -eq 0 ] && echo "all pipeline-gate-stop tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
