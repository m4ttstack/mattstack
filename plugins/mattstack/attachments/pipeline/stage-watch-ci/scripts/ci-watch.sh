#!/usr/bin/env bash
# Forge-agnostic CI watch loop: polls a pipeline for a ref to terminal
# status, driving ci-triage.sh for progress reports along the way.
# Speaks to the forge ONLY through a ci-forge@1 adapter (--forge).
set -euo pipefail

usage() { echo "usage: ci-watch.sh --forge <entry> [--ref <branch>] [--timeout <s>] [--interval <s>] [--config <file>]" >&2; exit 64; }

FORGE="" REF="" TIMEOUT_FLAG="" INTERVAL_FLAG="" CONFIG=""
while [ $# -gt 0 ]; do case $1 in
  --forge) FORGE=$2; shift 2 ;;
  --ref) REF=$2; shift 2 ;;
  --timeout) TIMEOUT_FLAG=$2; shift 2 ;;
  --interval) INTERVAL_FLAG=$2; shift 2 ;;
  --config) CONFIG=$2; shift 2 ;;
  *) usage ;;
esac; done

[ -n "$FORGE" ] && [ -x "$FORGE" ] || {
  echo "ci-watch: --forge entry missing or not executable: '$FORGE'" >&2
  echo "ci-watch: refusing to run without an adapter; an empty result must never read as a clean pipeline" >&2
  exit 3; }

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TRIAGE_PATH="$HERE/ci-triage.sh"
[ -x "$TRIAGE_PATH" ] || {
  echo "ci-watch: ci-triage.sh missing or not executable at '$TRIAGE_PATH'" >&2
  echo "ci-watch: refusing to run without it; without it every result reads healthy" >&2
  exit 3; }

[ -n "$REF" ] || REF=$(git rev-parse --abbrev-ref HEAD)

FERR=$(mktemp)
trap 'rm -f "$FERR"' EXIT
# forge() must NEVER be called inside a command substitution or pipeline:
# `exit 5` from a subshell only kills the subshell, and adapter exit 3 would
# silently become a false-clean read (the spec's cardinal failure). Instead
# forge() itself owns the one command substitution (so its `exit 5` runs in
# the MAIN shell), delivers stdout via the global FORGE_OUT, and returns
# 0/1 for the caller to branch on. Every call site is `if forge ...` or
# `forge ... || <handle rc 1>`; never `$(forge ...)`, never `forge ... | ...`.
FORGE_OUT=""
forge() { # sets FORGE_OUT; returns 0/1; exits 5 (whole script) on rc >= 2
  local rc=0
  FORGE_OUT=$("$FORGE" "$@" 2>"$FERR") || rc=$?
  if [ "$rc" -ge 2 ]; then
    echo "ci-watch: adapter verb '$1' failed (exit $rc):" >&2
    cat "$FERR" >&2
    exit 5
  fi
  return "$rc"
}

# Scalar precedence: flag > config > built-in default. jq only touches the
# config file when --config was actually given.
cfg() { if [ -n "$CONFIG" ]; then jq -r "$1 // empty" "$CONFIG" 2>/dev/null || true; fi; }
TIMEOUT=${TIMEOUT_FLAG:-$(cfg '.timeout')}; TIMEOUT=${TIMEOUT:-900}
INTERVAL=${INTERVAL_FLAG:-$(cfg '.interval')}; INTERVAL=${INTERVAL:-30}

# --- wait phase: give the ref a chance to produce a pipeline at all ---
WAIT_I=${CI_WATCH_WAIT_INTERVAL:-5}; WAIT_L=${CI_WATCH_WAIT_LIMIT:-60}
waited=0; PIPELINE_ID=""
while :; do
  rows=""
  if forge pipelines-for-ref "$REF" --limit 1; then rows=$FORGE_OUT; fi
  if [ -n "$rows" ]; then PIPELINE_ID=$(printf '%s\n' "$rows" | head -1 | cut -f1); break; fi
  [ "$waited" -ge "$WAIT_L" ] && { echo "ci-watch: no pipeline appeared for '$REF' within ${WAIT_L}s (was the branch pushed?)" >&2; exit 4; }
  sleep "$WAIT_I"; waited=$((waited + WAIT_I))
  [ "$WAIT_I" = 0 ] && waited=$((waited + 1))   # subsecond test mode still terminates
done

# --- main loop: poll until terminal, or until --timeout expires ---
elapsed=0
EARLY_WARNED=0
status=""
while :; do
  forge pipeline-info "$PIPELINE_ID" || {
    echo "ci-watch: pipeline '$PIPELINE_ID' not found (adapter exit 1); aborting" >&2
    exit 4; }
  IFS=$'\t' read -r pid status url <<<"$FORGE_OUT"
  case "$status" in
    success|failed|canceled|skipped) break ;;
  esac
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "ci-watch: --timeout ${TIMEOUT}s expired for pipeline '$PIPELINE_ID' (still $status); running a partial triage" >&2
    "$TRIAGE_PATH" --forge "$FORGE" --pipeline "$PIPELINE_ID" --ref "$REF" ${CONFIG:+--config "$CONFIG"}
    exit 2
  fi
  forge jobs "$PIPELINE_ID" --scope failed || {
    echo "ci-watch: pipeline '$PIPELINE_ID' jobs lookup failed (adapter exit 1); aborting" >&2
    exit 4; }
  n=$(printf '%s\n' "$FORGE_OUT" | awk -F'\t' '$5=="blocking"' | grep -c . || true)
  echo "ci-watch: [${elapsed}s] status=$status blocking_fails=$n"
  if [ "$n" -gt 0 ] && [ "$EARLY_WARNED" = 0 ]; then
    EARLY_WARNED=1
    echo "ci-watch: EARLY WARNING -- blocking failure(s) detected while the pipeline is still running"
    "$TRIAGE_PATH" --forge "$FORGE" --pipeline "$PIPELINE_ID" --ref "$REF" ${CONFIG:+--config "$CONFIG"}
  fi
  sleep "$INTERVAL"; elapsed=$((elapsed + INTERVAL))
  [ "$INTERVAL" = 0 ] && elapsed=$((elapsed + 1))   # subsecond test mode still terminates
done

# --- terminal: final report, exit reflects pipeline color ---
"$TRIAGE_PATH" --forge "$FORGE" --pipeline "$PIPELINE_ID" --ref "$REF" ${CONFIG:+--config "$CONFIG"}
[ "$status" = success ] && exit 0
exit 1
