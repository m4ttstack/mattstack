#!/bin/bash
# Drive the upgrade-to-team leg on an already-solo install: Settings > Team >
# Create a team… through the same wizard screens drive-setup.sh uses for a
# fresh create, then assert the machine is now a team member. Run by
# walkthrough.sh's team-upgrade phase when --team-remote is given for a
# --scenario solo run.
# Usage: upgrade-to-team.sh --team-slug vmtest --pat-env MATTSTACK_VMTEST_PAT --team-remote <url> [--forge github|gitlab]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; source "$HERE/ax.sh"; source "$HERE/screens.sh"
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
SCENARIO=create
SLUG=vmtest; PAT_ENV=MATTSTACK_VMTEST_PAT; TEAM_REMOTE="${TEAM_REMOTE:-}"; FORGE="${FORGE:-}"
while [ $# -gt 0 ]; do case "$1" in
  --team-slug) SLUG="$2"; shift 2;; --pat-env) PAT_ENV="$2"; shift 2;;
  --team-remote) TEAM_REMOTE="$2"; shift 2;; --forge) FORGE="$2"; shift 2;;
  *) ax_fail "unknown arg $1";; esac; done
[ -n "$TEAM_REMOTE" ] || ax_fail "upgrade-to-team needs --team-remote (an empty repo URL the team zone will push to)"
if [ -z "$FORGE" ]; then case "$TEAM_REMOTE" in *gitlab*) FORGE=gitlab;; *) FORGE=github;; esac; fi
case "$FORGE" in github|gitlab) ;; *) ax_fail "unknown forge: $FORGE (want github|gitlab)";; esac
PAT="${!PAT_ENV:-}"
DRIVER_LAUNCH_ARGS="${DRIVER_LAUNCH_ARGS:-}"
JQ=/Applications/mattstack.app/Contents/Helpers/jq

ax_log "upgrade-to-team: slug=$SLUG forge=$FORGE remote=$TEAM_REMOTE"
ax_wait_window "mattstack" 60 || ax_fail "mattstack window never appeared (is the app running?)"
ax_click settings.team.create
# settings.team.create reopens the same wizard the create scenario drives, so
# the create-scenario screen functions apply unchanged from here.
screen_team
screen_readiness
screen_install
screen_done
ax_log "upgrade-to-team: five screens complete"

if rt team status --json | tail -1 | "$JQ" -e --arg slug "$SLUG" '.slug == $slug' >/dev/null; then
  ax_log "upgrade: rt team status reports slug $SLUG"
else
  ax_fail "rt team status --json did not report slug $SLUG"
fi
if rt apps list --json | tail -1 | "$JQ" -e '[.apps[] | select(.requiresTeam) | .enabled] | all' >/dev/null; then
  ax_log "upgrade: every team-only app is enabled"
else
  ax_fail "rt apps list --json: a team-only app is still disabled after the upgrade"
fi
CODE=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 https://board.mattstack 2>/dev/null || true)
if [ "$CODE" = 200 ]; then
  ax_log "upgrade: https://board.mattstack answers 200"
else
  ax_fail "https://board.mattstack answered '${CODE:-no response}', wanted 200"
fi
ax_log "upgrade-to-team complete"
