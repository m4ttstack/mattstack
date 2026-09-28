#!/usr/bin/env bash
# fake ci-forge@1 adapter driving the engine tests. Canned data from
# $FAKE_FORGE_SCENARIO (read-only); mutable state in $FAKE_FORGE_STATE.
set -euo pipefail
[ -n "${FAKE_FORGE_SCENARIO:-}" ] || { echo "fake-forge: FAKE_FORGE_SCENARIO unset" >&2; exit 2; }
[ -n "${FAKE_FORGE_STATE:-}" ]    || { echo "fake-forge: FAKE_FORGE_STATE unset" >&2; exit 2; }
if [ "${FAKE_FORGE_FAIL:-}" = "3" ]; then echo "fake-forge: unauthenticated" >&2; exit 3; fi
S=$FAKE_FORGE_SCENARIO
verb=${1:-}; [ -n "$verb" ] && shift || { echo "fake-forge: no verb" >&2; exit 2; }
case $verb in
  pipelines-for-ref)
    [ $# -ge 1 ] || { echo "fake-forge: pipelines-for-ref: missing ref" >&2; exit 2; }
    ref=$1; shift; limit=1; all=0
    while [ $# -gt 0 ]; do case $1 in
      --limit) limit=$2; shift 2 ;;
      --all-sources) all=1; shift ;;
      *) echo "fake-forge: bad flag $1" >&2; exit 2 ;;
    esac; done
    f="$S/pipelines-$ref.tsv"
    [ -f "$f" ] || exit 1
    { if [ "$all" = 1 ]; then awk -F'\t' -v OFS='\t' '{print $1,$2,$3}' "$f"
      else awk -F'\t' -v OFS='\t' '$4!="external" && $4!="schedule" {print $1,$2,$3}' "$f"
      fi | head -n "$limit"; } || true   # head closing first must not SIGPIPE the adapter
    ;;
  pipeline-info)
    [ $# -ge 1 ] || { echo "fake-forge: pipeline-info: missing id" >&2; exit 2; }
    id=$1; f="$S/info-$id"; [ -f "$f" ] || exit 1
    cur="$FAKE_FORGE_STATE/cursor-$id"
    n=$(cat "$cur" 2>/dev/null || echo 0); n=$((n+1))
    total=$(grep -c . "$f"); [ "$n" -gt "$total" ] && n=$total
    echo "$n" >"$cur"
    st=$(sed -n "${n}p" "$f")
    printf '%s\t%s\t%s\n' "$id" "$st" "https://fake/pipelines/$id"
    ;;
  jobs)
    [ $# -ge 1 ] || { echo "fake-forge: jobs: missing id" >&2; exit 2; }
    id=$1; shift; scope=""; name=""
    while [ $# -gt 0 ]; do case $1 in
      --scope) scope=$2; shift 2 ;;
      --name)  name=$2;  shift 2 ;;
      *) echo "fake-forge: bad flag $1" >&2; exit 2 ;;
    esac; done
    f="$S/jobs-$id.tsv"; [ -f "$f" ] || exit 1
    awk -F'\t' -v s="$scope" -v n="$name" \
      '(s=="" || $4==s) && (n=="" || index($3,n)) {print}' "$f"
    ;;
  trace)
    [ $# -ge 2 ] || { echo "fake-forge: trace: missing jid out" >&2; exit 2; }
    jid=$1; out=$2; f="$S/trace-$jid.txt"; [ -f "$f" ] || exit 1; cp "$f" "$out"
    ;;
  retry-job)
    [ $# -ge 1 ] || { echo "fake-forge: retry-job: missing jid" >&2; exit 2; }
    jid=$1; echo "$jid" >>"$FAKE_FORGE_STATE/retries.log"; echo "retried $jid"
    ;;
  target-branch)
    [ $# -ge 1 ] || { echo "fake-forge: target-branch: missing ref" >&2; exit 2; }
    ref=$1; f="$S/target-branch-$ref.txt"
    if [ -f "$f" ]; then cat "$f"; fi
    ;;
  infra-patterns)
    f="$S/infra-patterns.txt"
    if [ -f "$f" ]; then cat "$f"; fi
    ;;
  *) echo "fake-forge: unknown verb $verb" >&2; exit 2 ;;
esac
