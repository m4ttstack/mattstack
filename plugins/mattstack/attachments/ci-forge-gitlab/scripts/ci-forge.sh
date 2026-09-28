#!/usr/bin/env bash
# GitLab ci-forge@1 adapter. Speaks to GitLab only through `glab`; all JSON
# parsing goes through jq. See the contract this implements:
#   attachments/ci-forge-gitlab/references/ci-forge-contract.md
set -euo pipefail

command -v glab >/dev/null 2>&1 || { echo "ci-forge-gitlab: glab not found" >&2; exit 3; }

usage_err() { echo "ci-forge-gitlab: $1" >&2; exit 2; }

# jq snippet normalizing GitLab's native pipeline/job statuses onto the
# ci-forge@1 vocabulary: running pending success failed canceled skipped.
JQ_NORM='
  def norm:
    if . == "created" or . == "waiting_for_resource" or . == "preparing"
       or . == "scheduled" or . == "manual" or . == "pending" then "pending"
    elif . == "canceled" or . == "cancelled" then "canceled"
    else . end;
'

# api <path> -- runs `glab api <path>`, prints the raw body on stdout.
# Return codes:
#   0  success, body on stdout
#   1  the failure was a 404 (not found) -- caller decides what that means
#   (never returns on any other failure: relays stderr and exits 3 directly,
#   since that failure mode is never "not found" and must not be mistaken
#   for one by a caller that only checks a return code)
api() {
  local path="$1" out rc=0
  out=$(glab api "$path" 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    if printf '%s' "$out" | grep -q '404'; then
      return 1
    fi
    echo "$out" >&2
    exit 3
  fi
  printf '%s' "$out"
}

cmd_pipelines_for_ref() {
  [ $# -ge 1 ] || usage_err "pipelines-for-ref: missing ref"
  local ref="$1"; shift
  local limit=1 all=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --limit) [ $# -ge 2 ] || usage_err "pipelines-for-ref: --limit requires a value"; limit="$2"; shift 2 ;;
      --all-sources) all=1; shift ;;
      *) usage_err "pipelines-for-ref: unknown argument $1" ;;
    esac
  done
  local body
  body=$(api "projects/:fullpath/pipelines?ref=${ref}&per_page=20")
  # $body is fetched successfully at this point (a 404 above already exited
  # via set -e propagation from the api() failure). An empty result after
  # the source filter is a legitimate exit-0 empty answer, never exit 1.
  { printf '%s' "$body" | jq -r --argjson all "$all" "
      ${JQ_NORM}
      .[] | select(\$all == 1 or (.source as \$s | ([\"external\",\"schedule\"] | index(\$s)) | not))
          | [(.id|tostring), (.status|norm), .web_url] | @tsv
    " | head -n "$limit"; } || true
}

cmd_pipeline_info() {
  [ $# -ge 1 ] || usage_err "pipeline-info: missing pipeline_id"
  local id="$1" body
  body=$(api "projects/:fullpath/pipelines/${id}")
  printf '%s' "$body" | jq -r --arg pid "$id" "
    ${JQ_NORM}
    [\$pid, (.status|norm), .web_url] | @tsv
  "
}

# walk <pipeline_id> <outfile> -- appends raw (already status-normalized)
# TSV rows for one pipeline's own jobs to <outfile>, then recurses into
# every bridge's downstream pipeline (nested children included). Uses the
# global SCOPE for the jobs query string; --name filtering happens one
# level up, in cmd_jobs.
#
# Every api() call in here is checked explicitly with `|| return $?`: a
# `body=$(api ...)` capture forks a subshell, and a non-404 failure inside
# api() calls `exit 3` INSIDE that subshell -- under bash's errexit, that
# does NOT reliably propagate out through further nesting (a recursive
# walk() call itself captured via another `$(...)`, or a `bridges | while
# read` pipeline, both fork their own subshells that would otherwise
# silently swallow the inner exit and let the tree walk continue as if
# nothing failed). So: no command substitution ever wraps a walk() call,
# no pipe ever feeds a loop that calls walk() recursively, and every
# capture that CAN fail is followed by an explicit `|| return $?` so the
# real code (1 for 404, 3 for anything else) comes back out of this
# function as its own return status instead of being lost.
SCOPE=""
NAME_FILTER=""
walk() {
  local pid="$1" outfile="$2" body scope_q bridges children child
  scope_q=""
  [ -n "$SCOPE" ] && scope_q="&scope=${SCOPE}"
  body=$(api "projects/:fullpath/pipelines/${pid}/jobs?per_page=100${scope_q}") || return $?
  # Sixth field is the job's RAW (unnormalized) status, carried only for
  # cmd_jobs's own --scope filtering below; it is never part of the
  # documented 5-column jobs output. A scope like "manual" is a native
  # GitLab name that normalizes away (-> "pending"), so filtering against
  # the normalized column would silently drop every match.
  printf '%s' "$body" | jq -r --arg pid "$pid" "
    ${JQ_NORM}
    .[] | [\$pid, (.id|tostring), .name, (.status|norm),
      (if .allow_failure then \"allow_failure\" else \"blocking\" end), .status] | @tsv
  " >>"$outfile"

  bridges=$(api "projects/:fullpath/pipelines/${pid}/bridges?per_page=100") || return $?
  children=$(printf '%s' "$bridges" | jq -r '.[].downstream_pipeline.id // empty')
  for child in $children; do
    [ -n "$child" ] || continue
    walk "$child" "$outfile" || return $?
  done
}

cmd_jobs() {
  [ $# -ge 1 ] || usage_err "jobs: missing pipeline_id"
  local root="$1"; shift
  SCOPE=""; NAME_FILTER=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --scope) [ $# -ge 2 ] || usage_err "jobs: --scope requires a value"; SCOPE="$2"; shift 2 ;;
      --name)  [ $# -ge 2 ] || usage_err "jobs: --name requires a value"; NAME_FILTER="$2"; shift 2 ;;
      *) usage_err "jobs: unknown argument $1" ;;
    esac
  done
  # Root existence check before walking: a 404 here means the pipeline
  # itself doesn't exist (exit 1), distinct from an existing pipeline with
  # zero jobs (exit 0, empty output) once we do walk it.
  api "projects/:fullpath/pipelines/${root}" >/dev/null

  local rowsfile rc
  rowsfile=$(mktemp)
  if walk "$root" "$rowsfile"; then
    :
  else
    rc=$?
    rm -f "$rowsfile"
    # Same vocabulary as api(): 1 = not-found-flavored, 3 = anything else.
    # Never fall through to printing a partial tree as if it were exit 0.
    exit "$rc"
  fi

  if [ ! -s "$rowsfile" ]; then
    rm -f "$rowsfile"
    return 0
  fi
  while IFS=$'\t' read -r pid jid name status af native; do
    if { [ -z "$NAME_FILTER" ] || printf '%s' "$name" | grep -qF -- "$NAME_FILTER"; } \
       && { [ -z "$SCOPE" ] || [ "$native" = "$SCOPE" ]; }; then
      printf '%s\t%s\t%s\t%s\t%s\n' "$pid" "$jid" "$name" "$status" "$af"
    fi
  done <"$rowsfile"
  rm -f "$rowsfile"
}

cmd_trace() {
  [ $# -ge 2 ] || usage_err "trace: missing job_id or out_file"
  local jid="$1" out="$2" errfile
  errfile=$(mktemp)
  if glab api "projects/:fullpath/jobs/${jid}/trace" >"$out" 2>"$errfile"; then
    rm -f "$errfile"
    return 0
  fi
  local errmsg
  errmsg=$(cat "$errfile"); rm -f "$errfile"
  rm -f "$out" 2>/dev/null || true
  if printf '%s' "$errmsg" | grep -q '404'; then
    exit 1
  fi
  echo "$errmsg" >&2
  exit 3
}

cmd_retry_job() {
  [ $# -ge 1 ] || usage_err "retry-job: missing job_id"
  local jid="$1" out rc=0
  out=$(glab ci retry "$jid" 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    if printf '%s' "$out" | grep -q '404'; then
      exit 1
    fi
    echo "$out" >&2
    exit 3
  fi
  printf '%s\n' "$out"
}

cmd_target_branch() {
  [ $# -ge 1 ] || usage_err "target-branch: missing ref"
  local ref="$1"
  case "$ref" in
    refs/merge-requests/*/head)
      local iid body
      iid=$(printf '%s' "$ref" | sed 's|^refs/merge-requests/\([0-9]*\)/head$|\1|')
      body=$(api "projects/:fullpath/merge_requests/${iid}")
      printf '%s' "$body" | jq -r '.target_branch'
      return 0
      ;;
    *)
      local body tb
      body=$(api "projects/:fullpath/merge_requests?source_branch=${ref}&state=opened&per_page=1")
      tb=$(printf '%s' "$body" | jq -r '.[0].target_branch // empty')
      if [ -n "$tb" ]; then
        printf '%s\n' "$tb"
      fi
      return 0
      ;;
  esac
}

cmd_infra_patterns() {
  printf '%s\n' 'registry.gitlab.com.*error'
}

main() {
  [ $# -ge 1 ] || usage_err "missing verb"
  local verb="$1"; shift
  case "$verb" in
    pipelines-for-ref) cmd_pipelines_for_ref "$@" ;;
    pipeline-info)     cmd_pipeline_info "$@" ;;
    jobs)              cmd_jobs "$@" ;;
    trace)             cmd_trace "$@" ;;
    retry-job)         cmd_retry_job "$@" ;;
    target-branch)     cmd_target_branch "$@" ;;
    infra-patterns)    cmd_infra_patterns "$@" ;;
    *) usage_err "unknown verb: $verb" ;;
  esac
}

main "$@"
