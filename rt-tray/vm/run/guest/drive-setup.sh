#!/bin/bash
# Drive the five setup screens of mattstack.app in the guest, as tester.
# Usage: drive-setup.sh <create|join|restore|solo> [--team-slug vmtest] [--pat-env MATTSTACK_VMTEST_PAT] [--invite-code-file <p>] [--team-remote <url>] [--forge github|gitlab]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; source "$HERE/ax.sh"; source "$HERE/screens.sh"
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
SCENARIO="${1:-create}"; shift || true
SLUG=vmtest; PAT_ENV=MATTSTACK_VMTEST_PAT; CODE_FILE=""; TEAM_REMOTE="${TEAM_REMOTE:-}"; FORGE="${FORGE:-}"
while [ $# -gt 0 ]; do case "$1" in
  --team-slug) SLUG="$2"; shift 2;; --pat-env) PAT_ENV="$2"; shift 2;; --invite-code-file) CODE_FILE="$2"; shift 2;;
  --team-remote) TEAM_REMOTE="$2"; shift 2;; --forge) FORGE="$2"; shift 2;;
  *) ax_fail "unknown arg $1";; esac; done
case "$SCENARIO" in create|join|restore|solo) ;; *) ax_fail "unknown scenario: $SCENARIO (want create|join|restore|solo)";; esac
# The one PAT the run carries belongs to the team's forge: the remote's host
# names it for create; join learns the forge from the invite, so it is passed.
if [ -z "$FORGE" ]; then case "$TEAM_REMOTE" in *gitlab*) FORGE=gitlab;; *) FORGE=github;; esac; fi
case "$FORGE" in github|gitlab) ;; *) ax_fail "unknown forge: $FORGE (want github|gitlab)";; esac
PAT="${!PAT_ENV:-}"
DRIVER_LAUNCH_ARGS="${DRIVER_LAUNCH_ARGS:-}"

ax_log "scenario=$SCENARIO slug=$SLUG forge=$FORGE"
screen_welcome; screen_team; screen_readiness; screen_install; screen_done
ax_log "five screens complete"
