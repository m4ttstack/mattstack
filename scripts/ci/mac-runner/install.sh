#!/bin/bash
# Installs the repo's self-hosted macOS runners. Run from a real terminal at the
# repo root, as yourself: it needs sudo's password prompt and your gh login.
# Usage: scripts/ci/mac-runner/install.sh [runner count, default 5]
set -euo pipefail

COUNT=${1:-5}
VERSION=2.338.2
SHA256=25a065af409ffa317ab4d5a3b614dd15fc9c40f2172bc1b35a1b1258e919a388
REPO=m4ttstack/mattstack
CI_USER=mattstack-ci
CI_HOME=/Users/$CI_USER
HOOK_DIR=/usr/local/mattstack-ci
TARBALL=$(mktemp -t actions-runner)

[ "$(id -u)" != 0 ] || { echo "Run this as yourself, not root." >&2; exit 1; }
[ -f scripts/ci/macos-runner.ts ] || { echo "Run this from the repo root." >&2; exit 1; }
gh auth status >/dev/null

sudo -v

if ! id "$CI_USER" >/dev/null 2>&1; then
  sudo sysadminctl -addUser "$CI_USER" -fullName "mattstack CI" -home "$CI_HOME" -password "$(openssl rand -base64 24)"
  sudo createhomedir -c -u "$CI_USER" >/dev/null
  sudo dscl . create "/Users/$CI_USER" IsHidden 1
fi

if sudo -u "$CI_USER" test -r "$HOME/.mattstack"; then
  echo "$CI_USER can read $HOME/.mattstack, so it would see your tokens. Stopping." >&2
  exit 1
fi

# Root owns these, so a job cannot rewrite the rule that admits it.
sudo mkdir -p "$HOOK_DIR"
sudo install -o root -g wheel -m 755 "$(command -v bun)" "$HOOK_DIR/bun"
sudo install -o root -g wheel -m 644 scripts/ci/macos-runner.ts "$HOOK_DIR/macos-runner.ts"
sudo install -o root -g wheel -m 755 scripts/ci/mac-runner/job-started.sh "$HOOK_DIR/job-started.sh"

curl -fsSL -o "$TARBALL" "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-osx-arm64-$VERSION.tar.gz"
echo "$SHA256  $TARBALL" | shasum -a 256 -c -
chmod 644 "$TARBALL"

# Hosted macOS images ship these; installing termwright here stops parallel jobs racing to.
sudo -u "$CI_USER" -H bash -c '
  set -euo pipefail
  export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin"
  command -v rustup >/dev/null || curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
  command -v termwright >/dev/null || cargo install termwright
'

for i in $(seq 1 "$COUNT"); do
  name=mattstack-mac-$i
  dir=$CI_HOME/$name
  label=dev.mattstack.ci-runner-$i
  plist=/Library/LaunchDaemons/$label.plist

  if ! sudo test -f "$dir/.runner"; then
    token=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)
    sudo -u "$CI_USER" -H mkdir -p "$dir"
    sudo -u "$CI_USER" -H tar xzf "$TARBALL" -C "$dir"
    sudo -u "$CI_USER" -H bash -c "cd '$dir' && ./config.sh --unattended --url 'https://github.com/$REPO' --token '$token' --name '$name' --labels mattstack-mac --replace"
  fi

  # A root-owned plist carries the hook setting: a job can edit the runner's own .env.
  sudo tee "$plist" >/dev/null <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>UserName</key><string>$CI_USER</string>
  <key>WorkingDirectory</key><string>$dir</string>
  <key>ProgramArguments</key><array><string>$dir/run.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$dir/launchd.log</string>
  <key>StandardErrorPath</key><string>$dir/launchd.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$CI_HOME</string>
    <key>PATH</key><string>$CI_HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>ACTIONS_RUNNER_HOOK_JOB_STARTED</key><string>$HOOK_DIR/job-started.sh</string>
    <key>MAC_RUNNER_CACHE</key><string>$CI_HOME/.cache/mac-runner</string>
  </dict>
</dict>
</plist>
PLIST
  sudo chown root:wheel "$plist"
  sudo chmod 644 "$plist"
  sudo launchctl bootout "system/$label" 2>/dev/null || true
  sudo launchctl bootstrap system "$plist"
done

rm -f "$TARBALL"
echo "Installed $COUNT runners. Check them with: gh api repos/$REPO/actions/runners --jq '.runners[] | \"\\(.name) \\(.status)\"'"
