#!/usr/bin/env bash
# Forge-agnostic CI triage: verdict (REAL/INFRA/UNCLEAR) x ownership
# (yours/INHERITED/UNKNOWN) for every failed job in a pipeline tree.
# Speaks to the forge ONLY through a ci-forge@1 adapter (--forge).
set -euo pipefail

usage() { echo "usage: ci-triage.sh --forge <entry> [--ref <branch>|--pipeline <id>] [--config <file>] [--base <ref>] [--no-base] [--out-dir <dir>]" >&2; exit 64; }

FORGE="" REF="" PIPELINE_ID="" CONFIG="" BASE_FLAG="" SKIP_BASE=${CI_TRIAGE_SKIP_BASE:-0}
OUT_DIR=${CI_TRIAGE_OUT_DIR:-}
while [ $# -gt 0 ]; do case $1 in
  --forge) FORGE=$2; shift 2 ;;
  --ref) REF=$2; shift 2 ;;
  --pipeline) PIPELINE_ID=$2; shift 2 ;;
  --config) CONFIG=$2; shift 2 ;;
  --base) BASE_FLAG=$2; shift 2 ;;
  --no-base) SKIP_BASE=1; shift ;;
  --out-dir) OUT_DIR=$2; shift 2 ;;
  *) usage ;;
esac; done
[ -n "$FORGE" ] && [ -x "$FORGE" ] || {
  echo "ci-triage: --forge entry missing or not executable: '$FORGE'" >&2
  echo "ci-triage: refusing to run without an adapter; an empty result must never read as a clean pipeline" >&2
  exit 3; }
[ -n "$OUT_DIR" ] || OUT_DIR=$(mktemp -d)
mkdir -p "$OUT_DIR"

FERR="$OUT_DIR/_forge_stderr"
# forge() must NEVER be called inside a command substitution or pipeline:
# `exit 5` from a subshell only kills the subshell, and adapter exit 3 would
# silently become "no pipeline found" (the spec's cardinal failure). Instead
# forge() itself owns the one command substitution (so its `exit 5` runs in
# the MAIN shell), delivers stdout via the global FORGE_OUT, and returns
# 0/1 for the caller to branch on. Every call site is `if forge ...` or
# `forge ... || <handle rc 1>`; never `$(forge ...)`, never `forge ... | ...`.
FORGE_OUT=""
forge() { # sets FORGE_OUT; returns 0/1; exits 5 (whole script) on rc >= 2
  local rc=0
  FORGE_OUT=$("$FORGE" "$@" 2>"$FERR") || rc=$?
  if [ "$rc" -ge 2 ]; then
    echo "ci-triage: adapter verb '$1' failed (exit $rc):" >&2
    cat "$FERR" >&2
    exit 5
  fi
  return "$rc"
}

# Config loading. Plain JSON, jq-parsed, every key optional. Array keys
# (noisy-jobs, real-patterns, infra-patterns) EXTEND the engine defaults;
# scalars (base-depth, base-ref, skip-base) take flag > config > default
# (timeout/interval are parsed for validity elsewhere but unused by triage
# itself -- ci-watch.sh is their consumer).
cfg() { if [ -n "$CONFIG" ]; then jq -r "$1 // empty" "$CONFIG" 2>/dev/null || true; fi; }

BASE_DEPTH=${CI_TRIAGE_BASE_DEPTH:-$(cfg '."base-depth"')}; BASE_DEPTH=${BASE_DEPTH:-3}
if [ "$SKIP_BASE" != 1 ] && [ "$(cfg '."skip-base"')" = "true" ]; then SKIP_BASE=1; fi
BASE_REF=${BASE_FLAG:-${CI_TRIAGE_BASE_REF:-$(cfg '."base-ref"')}}

# REAL/INFRA built-in defaults, per spec section 5 (generic-vs-config
# criterion): broad cross-team tooling only, transcribed verbatim.
REAL_DEFAULTS=(
  'Tests:.*failed'
  'Test Suites:.*failed'
  'FAIL '
  '✕'
  '✗'
  'error TS[0-9]'
  'Type error'
  'ESLint'
  'Prettier'
  'AssertionError'
  'expect\('
  'error Command failed'
  'ELIFECYCLE'
)
INFRA_DEFAULTS=(
  'execution took longer than'
  'gyp ERR'
  'node-pre-gyp ERR'
  'No space left on device'
  'Cannot connect to the Docker daemon'
  'ECONNRESET'
  'ETIMEDOUT'
  '503 Service'
  'failed to pull image'
  'runner system failure'
  'Connection reset by peer'
  'dial tcp.*connection refused'
  'fatal: unable to access'
  'TLS handshake timeout'
)
# Array keys extend the defaults; note the brace groups below are NOT
# subshells, so a forge() abort (adapter exit >= 2) is fatal here too --
# deliberate: a broken adapter must not yield a report with silently
# thinner patterns.
{ printf '%s\n' "${REAL_DEFAULTS[@]}"
  if [ -n "$CONFIG" ]; then jq -r '."real-patterns" // [] | .[]' "$CONFIG"; fi
} >"$OUT_DIR/_real_pat"
{ printf '%s\n' "${INFRA_DEFAULTS[@]}"
  if [ -n "$CONFIG" ]; then jq -r '."infra-patterns" // [] | .[]' "$CONFIG"; fi
  if forge infra-patterns; then
    if [ -n "$FORGE_OUT" ]; then printf '%s\n' "$FORGE_OUT"; fi
  fi
} >"$OUT_DIR/_infra_pat"
{ if [ -n "$CONFIG" ]; then jq -r '."noisy-jobs" // [] | .[]' "$CONFIG"; fi; } >"$OUT_DIR/_noisy"

# is_noisy: rc 0 if $1 (a job name) contains any configured noisy-jobs
# substring. Noisy jobs have no built-in defaults (moved to domain config
# / the example fixture entirely, per spec section 5).
is_noisy() { # $1=job name
  [ -s "$OUT_DIR/_noisy" ] || return 1
  local pat
  while IFS= read -r pat; do
    [ -n "$pat" ] || continue
    case "$1" in *"$pat"*) return 0 ;; esac
  done <"$OUT_DIR/_noisy"
  return 1
}

# ownership_of: prints the "ownership: ..." suffix for a failed job name,
# using the base-window index built into $OUT_DIR/_base_failures.tsv
# (columns: base_ref, base_pipeline_id, job_name) and the $SCANNED count of
# base pipelines actually scanned (set by the base-comparison block below).
# The lookup is an exact-field match via awk string equality, not a regex
# search -- a regex needs escaping for every ERE metacharacter a job name
# could contain (+ ? ( ) { } | . * ^ $ [ ] /), and a missed metachar
# silently turns an exact-match lookup into a wrong pattern match, which
# is worse than a crash on this axis. awk '$3 == n' has no such class.
ownership_of() { # $1=job name
  if [ "$SKIP_BASE" = 1 ]; then printf 'UNKNOWN (base comparison off)'; return 0; fi
  if [ "$SCANNED" -eq 0 ]; then printf 'UNKNOWN (no base pipelines scanned)'; return 0; fi
  local hit refs
  hit=$(awk -F'\t' -v n="$1" '$3 == n' "$OUT_DIR/_base_failures.tsv" || true)
  if [ -n "$hit" ]; then
    refs=$(printf '%s\n' "$hit" | cut -f1 | sort -u | paste -sd, -)
    printf 'INHERITED (also failing on %s)' "$refs"
  else
    printf 'yours (not failing on base)'
  fi
}

# Per failed job: fetch trace, ANSI-strip it, classify, print a report block.
print_job() { # $1=pid $2=jid $3=name $4=blocking|allow_failure
  local safe; safe=$(printf '%s' "$3" | tr -c 'A-Za-z0-9._-' '_')
  local log="$OUT_DIR/$safe.$2.log"
  forge trace "$2" "$log.raw" || { echo "  (trace unavailable for job $2)"; return 0; }
  sed $'s/\x1b\\[[0-9;]*m//g' "$log.raw" >"$log"; rm -f "$log.raw"
  local real_hits infra_hits verdict noisy_suffix=""
  real_hits=$(grep -Eiv 'passed|0 failed|0 error' "$log" | grep -E -f "$OUT_DIR/_real_pat" | head -5 || true)
  infra_hits=$(grep -E -f "$OUT_DIR/_infra_pat" "$log" | head -3 || true)
  if [ -n "$real_hits" ]; then verdict=REAL
  elif [ -n "$infra_hits" ]; then verdict=INFRA
  else verdict=UNCLEAR; fi
  if [ "$4" = "allow_failure" ] && is_noisy "$3"; then noisy_suffix=" (known noisy)"; fi
  echo "  job: $3 (id $2)$noisy_suffix"
  echo "  verdict: $verdict"
  echo "  ownership: $(ownership_of "$3")"
  echo "  trace: $log"
  if [ -n "$real_hits" ]; then printf '%s\n' "$real_hits" | sed 's/^/    /'; fi
  if [ -n "$infra_hits" ]; then printf '%s\n' "$infra_hits" | sed 's/^/    /'; fi
  echo "  retry: $FORGE retry-job $2"
  echo
}

# Ref default only matters when resolving by ref (no --pipeline given).
if [ -z "$PIPELINE_ID" ]; then
  [ -n "$REF" ] || REF=$(git rev-parse --abbrev-ref HEAD)
  rows=""
  if forge pipelines-for-ref "$REF" --limit 1; then rows=$FORGE_OUT; fi
  if [ -z "$rows" ]; then
    if forge pipelines-for-ref "$REF" --limit 1 --all-sources; then rows=$FORGE_OUT; fi
  fi
  if [ -z "$rows" ]; then echo "no pipeline found for ref '$REF'"; exit 0; fi
  PIPELINE_ID=$(printf '%s\n' "$rows" | head -1 | cut -f1)
fi
forge pipeline-info "$PIPELINE_ID" || {
  echo "ci-triage: pipeline '$PIPELINE_ID' not found (adapter exit 1); refusing to render an empty report for a bogus id" >&2; exit 4; }
info=$FORGE_OUT

forge jobs "$PIPELINE_ID" --scope failed || {
  echo "ci-triage: pipeline '$PIPELINE_ID' not found (adapter exit 1); refusing to render an empty report for a bogus id" >&2; exit 4; }
printf '%s\n' "$FORGE_OUT" >"$OUT_DIR/_failed_jobs.tsv"

# Ownership: base-window comparison. Base refs = --base flag > config
# base-ref > target-branch <ref> verb > default branch (git symbolic-ref
# fallback master); the default branch is appended as a second comparison
# ref when different. Per base ref: pipelines-for-ref <bref> --limit
# (BASE_DEPTH+1) using the DEFAULT-filtered listing (never --all-sources
# here), drop the pipeline under triage if it appears, keep the first
# BASE_DEPTH, index failed job names per base pipeline scanned.
SCANNED=0
: >"$OUT_DIR/_base_failures.tsv"
if [ "$SKIP_BASE" != 1 ]; then
  DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|.*/||') || true
  [ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=master

  if [ -z "$BASE_REF" ] && [ -n "$REF" ]; then
    if forge target-branch "$REF"; then
      if [ -n "$FORGE_OUT" ]; then BASE_REF="$FORGE_OUT"; fi
    fi
  fi
  [ -n "$BASE_REF" ] || BASE_REF="$DEFAULT_BRANCH"

  BASE_REFS="$BASE_REF"
  if [ "$DEFAULT_BRANCH" != "$BASE_REF" ]; then BASE_REFS="$BASE_REF $DEFAULT_BRANCH"; fi

  for bref in $BASE_REFS; do
    if forge pipelines-for-ref "$bref" --limit $((BASE_DEPTH+1)); then
      printf '%s\n' "$FORGE_OUT" | awk -F'\t' -v skip="$PIPELINE_ID" '$1!=skip' | head -n "$BASE_DEPTH" >"$OUT_DIR/_base_win.tsv"
    else
      echo "ci-triage: base ref '$bref' has no pipelines; skipping" >&2
      continue
    fi
    while IFS=$'\t' read -r bpid bstatus burl; do
      [ -n "${bpid:-}" ] || continue
      SCANNED=$((SCANNED+1))
      if forge jobs "$bpid" --scope failed; then
        if [ -n "$FORGE_OUT" ]; then
          printf '%s\n' "$FORGE_OUT" | awk -F'\t' -v OFS='\t' -v b="$bref" '{print b, $1, $3}' >>"$OUT_DIR/_base_failures.tsv"
        fi
      else
        echo "ci-triage: base pipeline '$bpid' jobs unavailable; skipping" >&2
      fi
    done <"$OUT_DIR/_base_win.tsv"
  done
fi

IFS=$'\t' read -r hid hstatus hurl <<<"$info"

echo "CI Triage Report"
echo "pipeline: $hid"
echo "status: $hstatus"
echo "url: $hurl"
echo

echo "── BLOCKING (must fix before merge) ──"
blocking_count=0; blocking_yours=0; blocking_inherited=0
while IFS=$'\t' read -r pid jid name jstatus flag; do
  [ -n "${jid:-}" ] || continue
  [ "$flag" = "blocking" ] || continue
  case "$(ownership_of "$name")" in
    INHERITED*) blocking_inherited=$((blocking_inherited+1)) ;;
    yours*)     blocking_yours=$((blocking_yours+1)) ;;
  esac
  print_job "$pid" "$jid" "$name" "$flag"
  blocking_count=$((blocking_count+1))
done <"$OUT_DIR/_failed_jobs.tsv"
[ "$blocking_count" -gt 0 ] || echo "  (none)"
echo

echo "── NON-BLOCKING (allow_failure, won't stop merge) ──"
nonblocking_count=0; NOISY_NAMES=""
while IFS=$'\t' read -r pid jid name jstatus flag; do
  [ -n "${jid:-}" ] || continue
  [ "$flag" = "allow_failure" ] || continue
  if is_noisy "$name"; then
    if [ -n "$NOISY_NAMES" ]; then NOISY_NAMES="$NOISY_NAMES, $name"; else NOISY_NAMES="$name"; fi
  fi
  print_job "$pid" "$jid" "$name" "$flag"
  nonblocking_count=$((nonblocking_count+1))
done <"$OUT_DIR/_failed_jobs.tsv"
[ "$nonblocking_count" -gt 0 ] || echo "  (none)"
echo

echo "summary: $blocking_count blocking failure(s) ($blocking_yours yours, $blocking_inherited inherited), $nonblocking_count non-blocking failure(s)"
if [ -n "$NOISY_NAMES" ]; then echo "noisy (known noisy): $NOISY_NAMES"; fi
exit 0
