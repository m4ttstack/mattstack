#!/bin/bash
# Removes everything install.sh added. Run from a real terminal, as yourself.
# Clear the MAC_RUNNER repo variable first, or queued jobs wait for runners that
# are gone, unless another Mac's runners already took over.
set -euo pipefail

REPO=m4ttstack/mattstack
CI_USER=mattstack-ci
CI_HOME=/Users/$CI_USER
HOOK_DIR=/usr/local/mattstack-ci

[ "$(id -u)" != 0 ] || { echo "Run this as yourself, not root." >&2; exit 1; }
command -v gh >/dev/null || { echo "Install gh and run gh auth login first." >&2; exit 1; }
gh auth status >/dev/null
sudo -v

# config.sh remove fails both when GitHub already dropped the runner and when
# it could not reach GitHub; only the first is safe to clean up after.
# Called after ||, where set -e is off, so every failure returns by hand.
deregister() { # runner dir
  local dir=$1 name token ids
  name=$(basename "$dir")
  token=$(gh api -X POST "repos/$REPO/actions/runners/remove-token" --jq .token) || return 1
  sudo -u "$CI_USER" -H bash -c "cd '$dir' && ./config.sh remove --token '$token'" && return 0
  ids=$(gh api "repos/$REPO/actions/runners" --paginate --jq ".runners[] | select(.name == \"$name\") | .id") || return 1
  [ -z "$ids" ] || { echo "Could not remove $name from GitHub; kept its files so a rerun can retry." >&2; return 1; }
}

for plist in /Library/LaunchDaemons/dev.mattstack.ci-runner-*.plist; do
  [ -e "$plist" ] || continue
  label=$(basename "$plist" .plist)
  sudo launchctl bootout "system/$label" 2>/dev/null || true
  for _ in $(seq 1 30); do
    launchctl print "system/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  sudo rm "$plist"
done

# Each runner removes its own registration by the ID in its .runner file, so
# another Mac's runners, registered under that Mac's own names, stay. A runner
# still registered stops the uninstall before the user and its files go.
cd /
for dir in $(sudo find "$CI_HOME" -maxdepth 1 -name 'mattstack-*' 2>/dev/null); do
  sudo test -f "$dir/.runner" || continue
  deregister "$dir" || exit 1
done

if id "$CI_USER" >/dev/null 2>&1; then
  sudo sysadminctl -deleteUser "$CI_USER"
fi
if [ -d "$HOOK_DIR" ]; then
  sudo rm -r "$HOOK_DIR"
fi
echo "Removed the Mac runners."
