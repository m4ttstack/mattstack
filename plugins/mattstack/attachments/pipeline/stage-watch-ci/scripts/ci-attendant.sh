#!/bin/bash
# ci-attendant.sh -- BOARD-10: the one-CI-attendant-per-MR lease, watch-ci side.
#
# One JSON file per MR under ~/.mattstack/ci-attendants/ (override:
# MATTSTACK_ATTENDANTS_DIR). The mr-board triage/doctor honors the same files
# (mr-board src/triage/attendant.ts); the filename slug MUST stay identical to
# that module's leaseFileName(). Freshness = heartbeatAt within ttlSeconds; a
# crashed holder needs no cleanup, staleness handles it.
#
# Usage:
#   ci-attendant.sh claim     <mr-url> <iid> [--branch <name>] [--label <s>]
#       exit 0 claimed (or re-claimed by watch-ci) / 3 held by someone else
#       (holder JSON on stdout) / 2 usage
#   ci-attendant.sh heartbeat <mr-url> <iid>   refresh own lease (no-op if foreign)
#   ci-attendant.sh release   <mr-url> <iid>   remove own lease (no-op if foreign)
#   ci-attendant.sh status    <mr-url> <iid>   fresh lease JSON + exit 0, or "none" + exit 1
set -u

DIR="${MATTSTACK_ATTENDANTS_DIR:-$HOME/.mattstack/ci-attendants}"
TTL_SECONDS=600
HOLDER="watch-ci"

cmd="${1:-}"; mr="${2:-}"; iid="${3:-}"
if [ -z "$cmd" ] || [ -z "$mr" ] || [ -z "$iid" ]; then
  echo "usage: ci-attendant.sh claim|heartbeat|release|status <mr-url> <iid> [--branch b] [--label s]" >&2
  exit 2
fi
shift 3
branch=""; label="watch-ci"
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) branch="${2:-}"; shift 2 ;;
    --label)  label="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

# Slug identical to attendant.ts leaseFileName(): URL pathname before "/-/",
# lowercased, runs of non-alphanumerics collapsed to "-", trimmed.
path_part="$(printf %s "$mr" | sed -E "s#^[a-z]+://[^/]+##; s#/-/.*##")"
slug="$(printf %s "$path_part" | tr "[:upper:]" "[:lower:]" | sed -E "s#[^a-z0-9]+#-#g; s#^-+##; s#-+\$##")"
LEASE="$DIR/$slug-$iid.json"

now_ms() { echo $(( $(date +%s) * 1000 )); }

lease_json() {
  local now; now="$(now_ms)"
  jq -n --arg mr "$mr" --arg branch "$branch" --arg label "$label" \
    --argjson now "$now" --argjson ttl "$TTL_SECONDS" --argjson pid "$$" \
    '{mr: $mr, branch: $branch, holder: "watch-ci", sessionLabel: $label,
      pid: $pid, startedAt: $now, heartbeatAt: $now, ttlSeconds: $ttl}'
}

# Fresh lease JSON on stdout, or nothing (missing/stale/malformed).
read_fresh() {
  [ -f "$LEASE" ] || return 1
  local now; now="$(now_ms)"
  jq -e --argjson now "$now" \
    'select((.heartbeatAt | type == "number") and (.ttlSeconds | type == "number"))
     | select($now - .heartbeatAt <= .ttlSeconds * 1000)' "$LEASE" 2>/dev/null
}

atomic_write() { # $1 = content
  local tmp; tmp="$LEASE.$$.tmp"
  printf %s "$1" > "$tmp" && mv "$tmp" "$LEASE"
}

case "$cmd" in
  claim)
    mkdir -p "$DIR"
    tmp="$LEASE.$$.tmp"
    printf %s "$(lease_json)" > "$tmp"
    if ln "$tmp" "$LEASE" 2>/dev/null; then
      rm -f "$tmp"; exit 0            # atomic create won
    fi
    rm -f "$tmp"
    existing="$(read_fresh || true)"
    if [ -n "$existing" ]; then
      holder="$(printf %s "$existing" | jq -r .holder)"
      if [ "$holder" != "$HOLDER" ]; then
        printf '%s\n' "$existing"     # fresh foreign lease: report and refuse
        exit 3
      fi
    fi
    atomic_write "$(lease_json)"      # stale, malformed, or our own: take it
    exit 0
    ;;
  heartbeat)
    existing="$(cat "$LEASE" 2>/dev/null || true)"
    [ -n "$existing" ] || exit 0
    holder="$(printf %s "$existing" | jq -r .holder 2>/dev/null || true)"
    [ "$holder" = "$HOLDER" ] || exit 0
    atomic_write "$(printf %s "$existing" | jq --argjson now "$(now_ms)" '.heartbeatAt = $now')"
    ;;
  release)
    holder="$(jq -r .holder "$LEASE" 2>/dev/null || true)"
    [ "$holder" = "$HOLDER" ] && rm -f "$LEASE"
    exit 0
    ;;
  status)
    existing="$(read_fresh || true)"
    if [ -n "$existing" ]; then printf '%s\n' "$existing"; exit 0; fi
    echo none; exit 1
    ;;
  *)
    echo "unknown command: $cmd" >&2; exit 2
    ;;
esac
