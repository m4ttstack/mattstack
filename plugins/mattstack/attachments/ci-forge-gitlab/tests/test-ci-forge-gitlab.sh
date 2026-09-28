#!/usr/bin/env bash
# Bare tests for the GitLab ci-forge@1 adapter, against a PATH-stubbed glab.
# Run from anywhere:
#   bash skills/forge/ci-forge-gitlab/tests/test-ci-forge-gitlab.sh
# Never tail-pipe this gate; pipes eat $?.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ADAPTER="$HERE/../scripts/ci-forge.sh"
STUB_BIN="$HERE/stub-bin"
FIXTURES="$HERE/fixtures"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok   $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL $1: $2"; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

export PATH="$STUB_BIN:$PATH"
export GLAB_FIXTURES="$FIXTURES"

run() { # runs the adapter with the given args, capturing stdout/stderr/rc
  GLAB_LOG="$TMP/log" "$ADAPTER" "$@" >"$TMP/out" 2>"$TMP/err"
  echo $?
}

# --- walk-recursion: jobs 1 covers the whole tree via bridges ---
: >"$TMP/log"
rc=$(run jobs 1)
n=$(grep -c . "$TMP/out")
ids=$(cut -f2 "$TMP/out" | sort -n | tr '\n' ',')
if [ "$rc" = 0 ] && [ "$n" = 6 ] && [ "$ids" = "11,12,13,21,22,31," ]; then
  ok walk-recursion
else
  fail walk-recursion "rc=$rc n=$n ids=$ids out=$(cat "$TMP/out")"
fi

# --- scope-filter: jobs 1 --scope failed ---
: >"$TMP/log"
rc=$(run jobs 1 --scope failed)
n=$(grep -c . "$TMP/out")
ids=$(cut -f2 "$TMP/out" | sort -n | tr '\n' ',')
if [ "$rc" = 0 ] && [ "$n" = 3 ] && [ "$ids" = "12,13,22," ]; then
  ok scope-filter-rows
else
  fail scope-filter-rows "rc=$rc n=$n ids=$ids"
fi
grep -q 'scope=failed' "$TMP/log" && ok scope-filter-url || fail scope-filter-url "$(cat "$TMP/log")"

# --- name-filter: jobs 1 --name test: ---
rc=$(run jobs 1 --name "test:")
n=$(grep -c . "$TMP/out")
ids=$(cut -f2 "$TMP/out" | sort -n | tr '\n' ',')
if [ "$rc" = 0 ] && [ "$n" = 4 ] && [ "$ids" = "12,13,22,31," ]; then
  ok name-filter
else
  fail name-filter "rc=$rc n=$n ids=$ids"
fi

# --- blocking-column: allow_failure true/false -> allow_failure/blocking ---
rc=$(run jobs 1)
row13=$(awk -F'\t' '$2==13' "$TMP/out")
row11=$(awk -F'\t' '$2==11' "$TMP/out")
if printf '%s' "$row13" | grep -qF $'\tallow_failure' && printf '%s' "$row11" | grep -qF $'\tblocking'; then
  ok blocking-column
else
  fail blocking-column "row13=$row13 row11=$row11"
fi

# --- pipelines-filter: default drops external+schedule; --all-sources keeps; --limit caps ---
rc=$(run pipelines-for-ref feat)
out=$(cat "$TMP/out")
if [ "$rc" = 0 ] && [ "$out" = "$(printf '104\tsuccess\thttps://gitlab.example.com/group/proj/-/pipelines/104')" ]; then
  ok pipelines-filter-default
else
  fail pipelines-filter-default "rc=$rc out=$out"
fi

rc=$(run pipelines-for-ref feat --all-sources --limit 4)
n=$(grep -c . "$TMP/out")
ids=$(cut -f1 "$TMP/out" | tr '\n' ',')
if [ "$rc" = 0 ] && [ "$n" = 4 ] && [ "$ids" = "104,103,102,101," ]; then
  ok pipelines-filter-all-sources
else
  fail pipelines-filter-all-sources "rc=$rc n=$n ids=$ids"
fi

rc=$(run pipelines-for-ref feat --all-sources --limit 2)
n=$(grep -c . "$TMP/out")
ids=$(cut -f1 "$TMP/out" | tr '\n' ',')
if [ "$rc" = 0 ] && [ "$n" = 2 ] && [ "$ids" = "104,103," ]; then
  ok pipelines-filter-limit-caps
else
  fail pipelines-filter-limit-caps "rc=$rc n=$n ids=$ids"
fi

# --- pipelines-boundary: pipelines exist but all filtered -> exit 0 empty;
#     no pipelines for ref at all -> exit 1 ---
rc=$(run pipelines-for-ref sched-only --limit 5)
if [ "$rc" = 0 ] && [ ! -s "$TMP/out" ]; then
  ok pipelines-boundary-empty
else
  fail pipelines-boundary-empty "rc=$rc out=$(cat "$TMP/out")"
fi
rc=$(run pipelines-for-ref ghost-ref)
[ "$rc" = 1 ] && ok pipelines-boundary-missing || fail pipelines-boundary-missing "rc=$rc"

# --- info-normalize: pipeline-53 waiting_for_resource -> pending ---
rc=$(run pipeline-info 53)
out=$(cat "$TMP/out")
if [ "$rc" = 0 ] && [ "$out" = "$(printf '53\tpending\thttps://gitlab.example.com/group/proj/-/pipelines/53')" ]; then
  ok info-normalize
else
  fail info-normalize "rc=$rc out=$out"
fi

# --- info-404: unknown pipeline id ---
rc=$(run pipeline-info 9999)
[ "$rc" = 1 ] && ok info-404 || fail info-404 "rc=$rc"

# --- trace-write: writes file content exactly; unknown job -> exit 1 ---
rc=$(run trace 101 "$TMP/trace-out")
if [ "$rc" = 0 ] && cmp -s "$TMP/trace-out" "$FIXTURES/trace-101.txt"; then
  ok trace-write
else
  fail trace-write "rc=$rc"
fi
rc=$(run trace 9999 "$TMP/trace-out-missing")
[ "$rc" = 1 ] && ok trace-404 || fail trace-404 "rc=$rc"

# --- target-branch-mr-ref: refs/merge-requests/<iid>/head -> mr-7.json's target_branch ---
rc=$(run target-branch refs/merge-requests/7/head)
out=$(cat "$TMP/out")
[ "$rc" = 0 ] && [ "$out" = "main" ] && ok target-branch-mr-ref || fail target-branch-mr-ref "rc=$rc out=$out"

# --- target-branch-lookup: source-branch lookup; empty list -> exit 0 empty ---
rc=$(run target-branch feat)
out=$(cat "$TMP/out")
[ "$rc" = 0 ] && [ "$out" = "develop" ] && ok target-branch-lookup || fail target-branch-lookup "rc=$rc out=$out"
rc=$(run target-branch no-such-branch)
if [ "$rc" = 0 ] && [ ! -s "$TMP/out" ]; then
  ok target-branch-none
else
  fail target-branch-none "rc=$rc out=$(cat "$TMP/out")"
fi

# --- retry: retry-job 101 logs "ci retry 101" ---
: >"$TMP/log"
rc=$(run retry-job 101)
if [ "$rc" = 0 ] && grep -q 'ci retry 101' "$TMP/log"; then
  ok retry
else
  fail retry "rc=$rc log=$(cat "$TMP/log")"
fi

# --- infra-patterns: prints exactly the one GitLab pattern ---
rc=$(run infra-patterns)
out=$(cat "$TMP/out")
[ "$rc" = 0 ] && [ "$out" = 'registry.gitlab.com.*error' ] && ok infra-patterns || fail infra-patterns "rc=$rc out=$out"

# --- usage: unknown verb/flag, missing required arg -> exit 2 ---
rc=$(run bogus-verb)
[ "$rc" = 2 ] && ok usage-unknown-verb || fail usage-unknown-verb "rc=$rc"
rc=$(run jobs 1 --bogus-flag)
[ "$rc" = 2 ] && ok usage-unknown-flag || fail usage-unknown-flag "rc=$rc"
rc=$(run pipeline-info)
[ "$rc" = 2 ] && ok usage-missing-arg || fail usage-missing-arg "rc=$rc"

# --- no-glab: PATH without the stub (and without a real glab) -> exit 3 ---
scratch="$TMP/no-glab-path"; mkdir -p "$scratch"
for tool in bash sh sed cat grep cut awk jq mktemp rm printf tr; do
  p=$(command -v "$tool" 2>/dev/null) || continue
  case "$p" in *glab*) continue ;; esac
  ln -sf "$p" "$scratch/$tool" 2>/dev/null || true
done
GLAB_LOG="$TMP/log" PATH="$scratch" "$ADAPTER" jobs 1 >"$TMP/out" 2>"$TMP/err"
rc=$?
[ "$rc" = 3 ] && ok no-glab || fail no-glab "rc=$rc err=$(cat "$TMP/err")"

# --- auth-fail: GLAB_STUB_AUTH_FAIL=1, root check fails non-404 -> exit 3, stderr relayed ---
GLAB_STUB_AUTH_FAIL=1 GLAB_LOG="$TMP/log" "$ADAPTER" jobs 1 >"$TMP/out" 2>"$TMP/err"
rc=$?
if [ "$rc" = 3 ] && grep -q '401' "$TMP/err"; then
  ok auth-fail
else
  fail auth-fail "rc=$rc err=$(cat "$TMP/err")"
fi

# --- mid-walk-fail-401: a failure on a NON-root pipeline (2, reached via
#     bridges-1 from root pipeline 1) must propagate as exit 3 with stderr
#     relayed -- never exit 0 with pipeline 2's jobs silently missing from
#     the listing. Pipeline 1's own jobs (11,12,13) and pipeline 3's jobs
#     (31, reached via bridges-2 off pipeline 2) must NOT appear either:
#     a truncated listing is exactly the bug this guards against, whether
#     or not the truncation happens to include some real rows.
GLAB_STUB_FAIL_PIPELINE=2 GLAB_LOG="$TMP/log" "$ADAPTER" jobs 1 >"$TMP/out" 2>"$TMP/err"
rc=$?
if [ "$rc" = 3 ] && grep -q '401' "$TMP/err" && [ ! -s "$TMP/out" ]; then
  ok mid-walk-fail-401
else
  fail mid-walk-fail-401 "rc=$rc err=$(cat "$TMP/err") out=$(cat "$TMP/out")"
fi

# --- mid-walk-fail-404: same shape, but the failure text contains "404" --
#     that's the not-found flavor, so it must map to exit 1, not exit 3.
GLAB_STUB_FAIL_PIPELINE_404=2 GLAB_LOG="$TMP/log" "$ADAPTER" jobs 1 >"$TMP/out" 2>"$TMP/err"
rc=$?
if [ "$rc" = 1 ] && [ ! -s "$TMP/out" ]; then
  ok mid-walk-fail-404
else
  fail mid-walk-fail-404 "rc=$rc err=$(cat "$TMP/err") out=$(cat "$TMP/out")"
fi

# --- scope-native-name (F3): a scope whose native GitLab name normalizes
#     away (manual -> pending) must still be honored -- filtering has to
#     happen against the job's NATIVE status, not the normalized one, or a
#     scope like "manual" always comes back empty even though the API
#     query for it succeeded.
: >"$TMP/log"
rc=$(run jobs 4 --scope manual)
n=$(grep -c . "$TMP/out")
ids=$(cut -f2 "$TMP/out" | sort -n | tr '\n' ',')
if [ "$rc" = 0 ] && [ "$n" = 1 ] && [ "$ids" = "41," ]; then
  ok scope-native-name
else
  fail scope-native-name "rc=$rc n=$n ids=$ids out=$(cat "$TMP/out")"
fi
row41=$(awk -F'\t' '$2==41' "$TMP/out")
printf '%s' "$row41" | grep -qF $'\tpending\t' && ok scope-native-name-normalized-output \
  || fail scope-native-name-normalized-output "row41=$row41"

echo; echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] || exit 1
exit 0
