#!/bin/bash
# Removes everything install.sh added. Run from a real terminal, as yourself.
# Clear the MAC_RUNNER repo variable first, or queued jobs wait for runners that are gone.
set -euo pipefail

REPO=m4ttstack/mattstack
CI_USER=mattstack-ci
HOOK_DIR=/usr/local/mattstack-ci

[ "$(id -u)" != 0 ] || { echo "Run this as yourself, not root." >&2; exit 1; }
sudo -v

for plist in /Library/LaunchDaemons/dev.mattstack.ci-runner-*.plist; do
  [ -e "$plist" ] || continue
  sudo launchctl bootout "system/$(basename "$plist" .plist)" 2>/dev/null || true
  sudo rm "$plist"
done

ids=$(gh api "repos/$REPO/actions/runners" --paginate --jq '.runners[] | select(.name | startswith("mattstack-mac-")) | .id')
for id in $ids; do
  gh api -X DELETE "repos/$REPO/actions/runners/$id"
done

if id "$CI_USER" >/dev/null 2>&1; then
  sudo sysadminctl -deleteUser "$CI_USER"
fi
if [ -d "$HOOK_DIR" ]; then
  sudo rm -r "$HOOK_DIR"
fi
echo "Removed the Mac runners."
