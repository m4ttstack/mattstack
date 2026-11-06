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
sudo -v

for plist in /Library/LaunchDaemons/dev.mattstack.ci-runner-*.plist; do
  [ -e "$plist" ] || continue
  sudo launchctl bootout "system/$(basename "$plist" .plist)" 2>/dev/null || true
  sudo rm "$plist"
done

# Each runner removes its own registration, so runners another Mac registered
# under the same names stay. One a newer install already replaced fails here.
cd /
for dir in $(sudo find "$CI_HOME" -maxdepth 1 -name 'mattstack-mac-*' 2>/dev/null); do
  sudo test -f "$dir/.runner" || continue
  token=$(gh api -X POST "repos/$REPO/actions/runners/remove-token" --jq .token)
  sudo -u "$CI_USER" -H bash -c "cd '$dir' && ./config.sh remove --token '$token'" ||
    echo "$(basename "$dir") was not registered from this Mac any more; skipped." >&2
done

if id "$CI_USER" >/dev/null 2>&1; then
  sudo sysadminctl -deleteUser "$CI_USER"
fi
if [ -d "$HOOK_DIR" ]; then
  sudo rm -r "$HOOK_DIR"
fi
echo "Removed the Mac runners."
