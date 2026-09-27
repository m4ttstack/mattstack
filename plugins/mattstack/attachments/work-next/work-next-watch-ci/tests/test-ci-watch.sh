#!/usr/bin/env bash
# Bare tests for the stage-watch-ci poll-loop engine. Run from anywhere:
#   bash attachments/pipeline/stage-watch-ci/tests/test-ci-watch.sh
# Never tail-pipe this gate; pipes eat $?.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FORGE="$HERE/fixtures/fake-forge/scripts/ci-forge.sh"
WATCH="$HERE/../scripts/ci-watch.sh"
SCEN="$HERE/fixtures/scenarios"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok   $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL $1: $2"; }
newstate() { mktemp -d; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# run_watch: $1=scenario dir name, rest=args to ci-watch.sh. Always runs
# with the wait-phase knobs at subsecond values so no test sleeps for real.
run_watch() {
  FAKE_FORGE_SCENARIO="$SCEN/$1" FAKE_FORGE_STATE=$(newstate) \
    CI_WATCH_WAIT_INTERVAL=0 CI_WATCH_WAIT_LIMIT=1 \
    "$WATCH" --forge "$FORGE" "${@:2}" >"$TMP/out" 2>"$TMP/err"
  echo $?
}

# run_watch_git: like run_watch but executes from a FRESH, isolated cwd with
# its own git repo whose origin/HEAD is pinned to $1 -- needed so ci-triage.sh
# (invoked by ci-watch.sh as a subprocess, inheriting cwd) has a deterministic
# default-branch fallback instead of leaking this repo's own origin.
run_watch_git() { # $1=default-branch $2=scenario, rest=args to ci-watch.sh
  local defb=$1 scen=$2; shift 2
  local wd; wd=$(mktemp -d)
  ( cd "$wd" && git init -q && git symbolic-ref refs/remotes/origin/HEAD "refs/remotes/origin/$defb" ) >/dev/null 2>&1
  ( cd "$wd" && FAKE_FORGE_SCENARIO="$SCEN/$scen" FAKE_FORGE_STATE=$(newstate) \
      CI_WATCH_WAIT_INTERVAL=0 CI_WATCH_WAIT_LIMIT=1 \
      "$WATCH" --forge "$FORGE" "$@" >"$TMP/out" 2>"$TMP/err" ); echo $?
}

# --- brief's representative cases, verbatim ---
rc=$(run_watch watch-green --ref feat-g --interval 0 --timeout 60)
[ "$rc" = 0 ] && ok watch-green || fail watch-green "rc=$rc out=$(cat "$TMP/out") err=$(cat "$TMP/err")"

rc=$(run_watch watch-red --ref feat-r --interval 0 --timeout 60)
[ "$rc" = 1 ] && ok watch-red-rc || fail watch-red-rc "rc=$rc"
n=$(grep -c 'EARLY WARNING' "$TMP/out")
[ "$n" = 1 ] && ok early-once || fail early-once "n=$n"
grep -q 'verdict:' "$TMP/out" && ok watch-triage-ran || fail watch-triage-ran "$(cat "$TMP/out")"

rc=$(run_watch watch-green --ref no-such-ref)
[ "$rc" = 4 ] && ok wait-exhausted || fail wait-exhausted "rc=$rc"

rc=$(run_watch watch-timeout --ref feat-t --interval 0 --timeout 0)
[ "$rc" = 2 ] && ok loop-timeout || fail loop-timeout "rc=$rc"
grep -q 'verdict:' "$TMP/out" && ok partial-triage || fail partial-triage "$(cat "$TMP/out")"

# midloop-bogus-id: the wait phase resolves a pipeline id (71) from
# pipelines-feat-v.tsv, but no info-71 file exists -- the stale-id race the
# spec calls out. The main loop's first pipeline-info call gets adapter
# exit 1, which must be a loud rc 4, distinct from wait-phase exhaustion.
rc=$(run_watch watch-vanish --ref feat-v --interval 0 --timeout 60)
[ "$rc" = 4 ] && ok midloop-bogus-id || fail midloop-bogus-id "rc=$rc"
[ -s "$TMP/err" ] && ok midloop-bogus-id-stderr || fail midloop-bogus-id-stderr ""

# --- enumerated extras ---

# missing --forge: rc 3
"$WATCH" --forge /nonexistent --ref feat-g >"$TMP/out" 2>"$TMP/err"; rc=$?
[ "$rc" = 3 ] && ok missing-forge || fail missing-forge "rc=$rc"

# unknown flag: rc 64
"$WATCH" --forge "$FORGE" --bogus >"$TMP/out" 2>"$TMP/err"; rc=$?
[ "$rc" = 64 ] && ok usage-rc64 || fail usage-rc64 "rc=$rc"

# FAKE_FORGE_FAIL=3: proves the forge() abort escapes the wait-phase
# command substitution -- rc 5, not a hang, not a false "no pipeline" (4).
rc=$(FAKE_FORGE_SCENARIO="$SCEN/watch-green" FAKE_FORGE_STATE=$(newstate) \
  CI_WATCH_WAIT_INTERVAL=0 CI_WATCH_WAIT_LIMIT=1 FAKE_FORGE_FAIL=3 \
  "$WATCH" --forge "$FORGE" --ref feat-g --interval 0 --timeout 60 >"$TMP/out" 2>"$TMP/err"; echo $?)
[ "$rc" = 5 ] && ok adapter-fail-rc5 || fail adapter-fail-rc5 "rc=$rc"

# config timeout honored when no flag: config {"timeout": 0} -> rc 2
cat >"$TMP/cfg-zero.json" <<'EOF'
{ "timeout": 0 }
EOF
rc=$(run_watch watch-green --ref feat-g --interval 0 --config "$TMP/cfg-zero.json")
[ "$rc" = 2 ] && ok config-timeout-honored || fail config-timeout-honored "rc=$rc"

# CLI flag beats config: config {"timeout": 0} + --timeout 60 on green -> rc 0
rc=$(run_watch watch-green --ref feat-g --interval 0 --config "$TMP/cfg-zero.json" --timeout 60)
[ "$rc" = 0 ] && ok cli-flag-beats-config || fail cli-flag-beats-config "rc=$rc"

# ref-forwarded-to-triage (F1 regression): ci-watch resolves --ref itself
# but must forward that same ref to every ci-triage.sh call it drives.
# feat-stack's immediate base is release-1 (stacked MR), NOT the repo's
# default branch (main, which has no pipelines in this scenario); "build"
# fails on both feat-stack and release-1. Without the ref forwarded,
# ci-triage can't resolve release-1 via target-branch and falls back to
# comparing only against main -- which has zero scanned base pipelines --
# so the shared failure reads as UNKNOWN instead of INHERITED.
rc=$(run_watch_git main watch-inherited --ref feat-stack --interval 0 --timeout 60)
grep -q 'ownership: INHERITED (also failing on release-1)' "$TMP/out" \
  && ok ref-forwarded-inherited || fail ref-forwarded-inherited "rc=$rc out=$(cat "$TMP/out") err=$(cat "$TMP/err")"

# ref-forwarded-final-report: isolates ci-watch's FINAL triage call (the
# one after the poll loop breaks), distinct from the early-warning call
# above. watch-inherited-terminal's pipeline is already terminal (failed)
# on the VERY FIRST pipeline-info poll, so the loop breaks before the
# jobs/early-warning block ever runs -- the only triage report printed is
# the final one at the bottom of ci-watch.sh. A prior fix that forwarded
# --ref to the early-warning and timeout-partial call sites but missed the
# final one would still fail this: the final report's ownership would read
# UNKNOWN instead of INHERITED, and the early-warning output (which never
# ran here) can't paper over it.
rc=$(run_watch_git main watch-inherited-terminal --ref feat-final --interval 0 --timeout 60)
if grep -q 'EARLY WARNING' "$TMP/out"; then
  fail ref-forwarded-final-report "unexpected EARLY WARNING; scenario must be terminal on first poll"
else
  grep -q 'ownership: INHERITED (also failing on release-2)' "$TMP/out" \
    && ok ref-forwarded-final-report || fail ref-forwarded-final-report "rc=$rc out=$(cat "$TMP/out") err=$(cat "$TMP/err")"
fi

echo; echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] || exit 1
exit 0
