#!/usr/bin/env bash
# Bare tests for the stage-watch-ci engine. Run from anywhere:
#   bash attachments/pipeline/stage-watch-ci/tests/test-ci-triage.sh
# Never tail-pipe this gate; pipes eat $?.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FORGE="$HERE/fixtures/fake-forge/scripts/ci-forge.sh"
TRIAGE="$HERE/../scripts/ci-triage.sh"
SCEN="$HERE/fixtures/scenarios"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok   $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL $1: $2"; }
newstate() { mktemp -d; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# --- fixture self-checks ---
export FAKE_FORGE_SCENARIO="$SCEN/basic" FAKE_FORGE_STATE=$(newstate)
out=$("$FORGE" pipelines-for-ref feat-x --limit 1); rc=$?
[ "$rc" = 0 ] && [ "$out" = "$(printf '11\trunning\thttps://fake/pipelines/11')" ] \
  && ok ff-pipelines || fail ff-pipelines "rc=$rc out=$out"
out=$("$FORGE" pipelines-for-ref sched-only --limit 5); rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && ok ff-filtered-empty || fail ff-filtered-empty "rc=$rc out=$out"
out=$("$FORGE" pipelines-for-ref sched-only --limit 5 --all-sources); rc=$?
[ "$rc" = 0 ] && [ -n "$out" ] && ok ff-all-sources || fail ff-all-sources "rc=$rc"
"$FORGE" pipelines-for-ref no-such-ref >/dev/null 2>&1; rc=$?
[ "$rc" = 1 ] && ok ff-ref-missing || fail ff-ref-missing "rc=$rc"
out=$("$FORGE" pipeline-info 11); [ "$out" = "$(printf '11\trunning\thttps://fake/pipelines/11')" ] \
  && ok ff-info || fail ff-info "$out"
out=$("$FORGE" pipeline-info 11); echo "$out" | grep -q "failed" \
  && ok ff-info-cursor || fail ff-info-cursor "$out"   # second call = second line
"$FORGE" jobs 999 >/dev/null 2>&1; rc=$?
[ "$rc" = 1 ] && ok ff-jobs-unknown || fail ff-jobs-unknown "rc=$rc"
out=$("$FORGE" jobs 11 --scope failed); n=$(printf '%s\n' "$out" | grep -c .)
[ "$n" = 2 ] && ok ff-jobs-scope || fail ff-jobs-scope "n=$n"
FAKE_FORGE_FAIL=3 "$FORGE" jobs 11 >/dev/null 2>&1; rc=$?
[ "$rc" = 3 ] && ok ff-fail-inject || fail ff-fail-inject "rc=$rc"
"$FORGE" pipeline-info >/dev/null 2>&1; rc=$?
[ "$rc" = 2 ] && ok ff-usage-missing-arg || fail ff-usage-missing-arg "rc=$rc"

# --- triage core ---
# run_triage always executes from a FRESH, isolated cwd (mktemp'd, own git
# repo with origin/HEAD -> main) so the real repo's own remote can never
# leak into the engine's default-branch detection. TRIAGE/FORGE/SCEN are
# absolute, so cd-ing elsewhere before invoking them is safe.
run_triage() { # $1=scenario, rest=args; captures out+rc without pipefail games
  local wd; wd=$(mktemp -d)
  ( cd "$wd" && git init -q && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
    FAKE_FORGE_SCENARIO="$SCEN/$1" FAKE_FORGE_STATE=$(newstate) \
      "$TRIAGE" --forge "$FORGE" "${@:2}" >"$TMP/out" 2>"$TMP/err" ); echo $?
}
# run_triage_git: like run_triage but with an explicit origin/HEAD default
# branch ($1), or NO git repo at all when $1 is empty -- needed for the
# ownership rows that must control (or remove) default-branch fallback.
run_triage_git() { # $1=default-branch-or-empty $2=scenario, rest=args
  local defb=$1 scen=$2; shift 2
  local wd; wd=$(mktemp -d)
  if [ -n "$defb" ]; then
    ( cd "$wd" && git init -q && git symbolic-ref refs/remotes/origin/HEAD "refs/remotes/origin/$defb" ) >/dev/null 2>&1
  fi
  ( cd "$wd" && FAKE_FORGE_SCENARIO="$SCEN/$scen" FAKE_FORGE_STATE=$(newstate) \
      "$TRIAGE" --forge "$FORGE" "$@" >"$TMP/out" 2>"$TMP/err" ); echo $?
}
rc=$(run_triage verdicts --pipeline 21 --no-base --out-dir "$TMP/t1")
grep -q 'verdict: REAL'    "$TMP/out" && ok real-verdict    || fail real-verdict "$(cat "$TMP/out")"
grep -q 'verdict: INFRA'   "$TMP/out" && ok infra-verdict   || fail infra-verdict ""
grep -q 'verdict: UNCLEAR' "$TMP/out" && ok unclear-verdict || fail unclear-verdict ""
[ "$rc" = 0 ] && ok triage-rc0 || fail triage-rc0 "rc=$rc"
grep -q '── BLOCKING'      "$TMP/out" && ok blocking-section || fail blocking-section ""
grep -q '── NON-BLOCKING'  "$TMP/out" && ok nonblocking-section || fail nonblocking-section ""
ls "$TMP/t1" | grep -q '\.log$' && ok trace-files || fail trace-files ""

# real-beats-infra: trace hits both REAL and INFRA patterns -> REAL wins
rc=$(run_triage verdicts --pipeline 22 --no-base --out-dir "$TMP/t2")
grep -q 'verdict: REAL' "$TMP/out" && ok real-beats-infra || fail real-beats-infra "$(cat "$TMP/out")"

# exclusion-filter: "0 failed" on an otherwise-passing line is excluded -> UNCLEAR
rc=$(run_triage verdicts --pipeline 23 --no-base --out-dir "$TMP/t3")
if grep -q 'verdict: UNCLEAR' "$TMP/out" && ! grep -q 'verdict: REAL' "$TMP/out"; then
  ok exclusion-filter-lower
else
  fail exclusion-filter-lower "$(cat "$TMP/out")"
fi

# exclusion-filter: case-insensitive on "0 Failed" too -> UNCLEAR
rc=$(run_triage verdicts --pipeline 24 --no-base --out-dir "$TMP/t4")
if grep -q 'verdict: UNCLEAR' "$TMP/out" && ! grep -q 'verdict: REAL' "$TMP/out"; then
  ok exclusion-filter-mixed
else
  fail exclusion-filter-mixed "$(cat "$TMP/out")"
fi

# ansi-stripped: ANSI-wrapped FAIL still hits REAL; saved .log has no raw ESC
rc=$(run_triage verdicts --pipeline 25 --no-base --out-dir "$TMP/t5")
grep -q 'verdict: REAL' "$TMP/out" && ok ansi-real || fail ansi-real "$(cat "$TMP/out")"
logf=$(ls "$TMP/t5"/*.log 2>/dev/null | head -1)
if [ -n "$logf" ] && ! grep -q "$(printf '\033')" "$logf"; then
  ok ansi-stripped
else
  fail ansi-stripped "logf=$logf"
fi

# infra-hits-alongside-real-verdict: REAL pattern on one trace line, INFRA
# pattern on a distinct line -> verdict REAL, but both hit lines still print
rc=$(run_triage verdicts --pipeline 26 --no-base --out-dir "$TMP/t11")
if grep -q 'verdict: REAL' "$TMP/out" && grep -q 'error TS1234' "$TMP/out" && grep -q 'ECONNRESET' "$TMP/out"; then
  ok infra-hits-alongside-real
else
  fail infra-hits-alongside-real "$(cat "$TMP/out")"
fi

# no-pipeline-for-ref: ref with no pipelines file -> friendly stdout, rc 0
rc=$(run_triage verdicts --ref ghost-ref --out-dir "$TMP/t6")
[ "$rc" = 0 ] && ok no-pipeline-rc0 || fail no-pipeline-rc0 "rc=$rc"
grep -q 'no pipeline found' "$TMP/out" && ok no-pipeline-message || fail no-pipeline-message "$(cat "$TMP/out")"

# all-sources-fallback: ref whose pipelines are all schedule-sourced still resolves
rc=$(run_triage verdicts --ref sched --out-dir "$TMP/t7")
[ "$rc" = 0 ] && ok fallback-rc0 || fail fallback-rc0 "rc=$rc"
grep -q 'https://fake/pipelines/30' "$TMP/out" && ok fallback-header || fail fallback-header "$(cat "$TMP/out")"

# bogus-pipeline-id: no info-/jobs- files for the id -> loud stderr, rc 4, no report
rc=$(run_triage verdicts --pipeline 404404 --out-dir "$TMP/t8")
[ "$rc" = 4 ] && ok bogus-pipeline-rc4 || fail bogus-pipeline-rc4 "rc=$rc"
[ -s "$TMP/err" ] && ok bogus-pipeline-stderr || fail bogus-pipeline-stderr ""
grep -q '── BLOCKING' "$TMP/out" && fail bogus-pipeline-quiet "unexpected BLOCKING in output" || ok bogus-pipeline-quiet

# missing-forge: --forge points nowhere -> rc 3
"$TRIAGE" --forge /nonexistent --pipeline 1 >"$TMP/out" 2>"$TMP/err"; rc=$?
[ "$rc" = 3 ] && ok missing-forge || fail missing-forge "rc=$rc"

# adapter-fail-3: every verb exits 3 -> rc 5, adapter stderr relayed
FAKE_FORGE_SCENARIO="$SCEN/verdicts" FAKE_FORGE_STATE=$(newstate) FAKE_FORGE_FAIL=3 \
  "$TRIAGE" --forge "$FORGE" --pipeline 21 --out-dir "$TMP/t9" >"$TMP/out" 2>"$TMP/err"; rc=$?
[ "$rc" = 5 ] && ok adapter-fail-rc5 || fail adapter-fail-rc5 "rc=$rc"
grep -q 'unauthenticated' "$TMP/err" && ok adapter-fail-relayed || fail adapter-fail-relayed "$(cat "$TMP/err")"

# usage: unknown flag -> rc 64
"$TRIAGE" --bogus >"$TMP/out" 2>"$TMP/err"; rc=$?
[ "$rc" = 64 ] && ok usage-rc64 || fail usage-rc64 "rc=$rc"

# header: report contains the pipeline's web_url from pipeline-info
rc=$(run_triage verdicts --pipeline 21 --no-base --out-dir "$TMP/t10")
grep -q 'https://fake/pipelines/21' "$TMP/out" && ok header-weburl || fail header-weburl "$(cat "$TMP/out")"

# --- ownership + config ---
cat >"$TMP/cfg.json" <<'EOF'
{ "noisy-jobs": ["flaky:screenshot"], "real-patterns": ["MY_TEAM_MARKER"], "base-depth": 2 }
EOF
rc=$(run_triage ownership --ref feat-y --config "$TMP/cfg.json" --out-dir "$TMP/t2")
grep -q 'ownership: INHERITED' "$TMP/out" && ok inherited || fail inherited "$(cat "$TMP/out")"
grep -q 'ownership: yours'     "$TMP/out" && ok yours     || fail yours ""
grep -q 'MY_TEAM_MARKER'       "$TMP/out" && ok config-real-extends || fail config-real-extends ""
grep -q '(known noisy)'        "$TMP/out" && ok noisy-flag || fail noisy-flag ""

# schedule-excluded-from-window: same fixtures/config; base-depth 2 with a
# schedule pipeline (27) newest on main proves the window is built from the
# DEFAULT-filtered listing (schedule never eats a depth slot) -- if the
# engine wrongly used --all-sources here, pipeline 28 (which carries the
# INHERITED-proving test:app failure) would fall outside the depth-2 window
# and this INHERITED assertion would fail.
rc=$(run_triage ownership --ref feat-y --config "$TMP/cfg.json" --out-dir "$TMP/t14")
grep -q 'ownership: INHERITED (also failing on main)' "$TMP/out" \
  && ok schedule-excluded-from-window || fail schedule-excluded-from-window "$(cat "$TMP/out")"

# no-base-flag: --no-base -> every ownership line UNKNOWN (base comparison off)
rc=$(run_triage ownership --ref feat-y --no-base --out-dir "$TMP/t12")
n=$(grep -c 'ownership: UNKNOWN (base comparison off)' "$TMP/out")
[ "$n" = 3 ] && ok no-base-flag || fail no-base-flag "n=$n out=$(cat "$TMP/out")"
grep -q 'INHERITED' "$TMP/out" && fail no-base-flag-clean "unexpected INHERITED" || ok no-base-flag-clean

# env-skip: CI_TRIAGE_SKIP_BASE=1 has the same effect as --no-base
wd=$(mktemp -d)
( cd "$wd" && git init -q && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
  FAKE_FORGE_SCENARIO="$SCEN/ownership" FAKE_FORGE_STATE=$(newstate) CI_TRIAGE_SKIP_BASE=1 \
    "$TRIAGE" --forge "$FORGE" --ref feat-y --out-dir "$TMP/t13" >"$TMP/out" 2>"$TMP/err" ); rc=$?
n=$(grep -c 'ownership: UNKNOWN (base comparison off)' "$TMP/out")
[ "$n" = 3 ] && ok env-skip || fail env-skip "n=$n out=$(cat "$TMP/out")"

# base-flag-overrides: --base other beats config base-ref "wrongbase"; the
# INHERITED result for test:new is only reachable through other's pipelines
cat >"$TMP/cfg-baseref.json" <<'EOF'
{ "base-ref": "wrongbase" }
EOF
rc=$(run_triage_git other ownership --ref feat-y --base other --config "$TMP/cfg-baseref.json" --out-dir "$TMP/t15")
grep -q 'also failing on other' "$TMP/out" && ok base-flag-overrides || fail base-flag-overrides "$(cat "$TMP/out")"

# self-excluded: the triaged pipeline (33) also appears in its own base
# listing (target-branch feat-self -> feat-self) and must be dropped, so
# test:self compares only against sibling pipeline 34 (which lacks it) -> yours
rc=$(run_triage_git feat-self ownership --ref feat-self --out-dir "$TMP/t16")
grep -q 'ownership: yours (not failing on base)' "$TMP/out" && ok self-excluded || fail self-excluded "$(cat "$TMP/out")"

# unknown-when-no-base-pipelines: target-branch resolves to "orphan-base",
# which has no pipelines file at all (and the default branch is pinned to
# the same orphan-base, so no second ref masks the zero-scanned result)
rc=$(run_triage_git orphan-base ownership --ref feat-orphan --out-dir "$TMP/t17")
grep -q 'ownership: UNKNOWN (no base pipelines scanned)' "$TMP/out" \
  && ok unknown-when-no-base-pipelines || fail unknown-when-no-base-pipelines "$(cat "$TMP/out")"

# infra-patterns-appended: adapter's infra-patterns verb output (FAKE_REGISTRY_DOWN)
# is appended to the INFRA pattern file and a trace hit gets the INFRA verdict
rc=$(run_triage ownership --ref feat-infra --no-base --out-dir "$TMP/t18")
grep -q 'verdict: INFRA' "$TMP/out" && grep -q 'FAKE_REGISTRY_DOWN' "$TMP/out" \
  && ok infra-patterns-appended || fail infra-patterns-appended "$(cat "$TMP/out")"

# example-fixture-loads: the example fixture's noisy-jobs/infra-patterns extend
# defaults; semgrep-sast (allow_failure) is flagged noisy, unix-dgram -> INFRA
FIXTURE="$HERE/fixtures/example-domain-config.json"
rc=$(run_triage ownership --ref feat-fixture --config "$FIXTURE" --no-base --out-dir "$TMP/t19")
grep -q 'job: semgrep-sast (id 601) (known noisy)' "$TMP/out" && ok example-fixture-noisy || fail example-fixture-noisy "$(cat "$TMP/out")"
grep -q 'verdict: INFRA' "$TMP/out" && ok example-fixture-infra || fail example-fixture-infra "$(cat "$TMP/out")"

# default-branch-fallback: no target-branch file, no --base, and a cwd with
# NO git repo at all -> git symbolic-ref fails -> falls back to "master"
rc=$(run_triage_git "" ownership --ref feat-fallback --out-dir "$TMP/t20")
grep -q 'also failing on master' "$TMP/out" && ok default-branch-fallback || fail default-branch-fallback "$(cat "$TMP/out")"

# ownership-index-ere-metachar: a job name containing ERE metacharacters
# (test+coverage) that also fails on base must still resolve INHERITED --
# the index lookup is an exact-field match, not a regex search, so it
# cannot be fooled by +, ?, (, ), {, }, | etc. in the job name
rc=$(run_triage ownership --ref feat-plus --out-dir "$TMP/t21")
grep -q 'ownership: INHERITED (also failing on main)' "$TMP/out" \
  && ok ownership-index-ere-metachar || fail ownership-index-ere-metachar "$(cat "$TMP/out")"

# pipeline-and-ref-together (F1 coverage): a caller who already knows the
# pipeline id must still be able to hand over --ref alongside it, so base-ref
# resolution (target-branch) still runs -- this is the combination ci-watch.sh
# now relies on for its own triage calls.
rc=$(run_triage_git main ownership --pipeline 31 --ref feat-y --out-dir "$TMP/t22")
grep -q 'ownership: INHERITED (also failing on main)' "$TMP/out" \
  && ok pipeline-and-ref-together || fail pipeline-and-ref-together "rc=$rc out=$(cat "$TMP/out")"

echo; echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] || exit 1
exit 0
