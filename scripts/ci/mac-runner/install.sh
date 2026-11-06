#!/bin/bash
# Installs the repo's self-hosted macOS runners. Run from a real terminal at the
# repo root, as yourself: it needs sudo's password prompt and your gh login.
# Usage: scripts/ci/mac-runner/install.sh [runner count, default 5]
set -euo pipefail

COUNT=${1:-5}
VERSION=2.338.2
case "$(uname -m)" in
  arm64) RUNNER_ARCH=arm64; SHA256=25a065af409ffa317ab4d5a3b614dd15fc9c40f2172bc1b35a1b1258e919a388 ;;
  x86_64) RUNNER_ARCH=x64; SHA256=109fff505a34014a7e8d1acb850c33d404811102f572b8fb9788e2fff013cc49 ;;
  *) echo "No runner build for $(uname -m)." >&2; exit 1 ;;
esac
REPO=m4ttstack/mattstack
CI_USER=mattstack-ci
CI_HOME=/Users/$CI_USER
HOOK_DIR=/usr/local/mattstack-ci
# Not $TMPDIR: the runner user cannot read yours.
TARBALL=$(mktemp /tmp/actions-runner.XXXXXX)

[[ "$COUNT" =~ ^[1-9][0-9]*$ ]] || { echo "The runner count must be a whole number above 0, not $COUNT." >&2; exit 1; }
[ "$(id -u)" != 0 ] || { echo "Run this as yourself, not root." >&2; exit 1; }
[ -f scripts/ci/macos-runner.ts ] || { echo "Run this from the repo root." >&2; exit 1; }
command -v gh >/dev/null || { echo "Install gh and run gh auth login first." >&2; exit 1; }
gh auth status >/dev/null

# The mattstack app ships a universal bun, for a Mac with none on PATH.
BUN=$(command -v bun || echo /Applications/mattstack.app/Contents/Helpers/bun)
"$BUN" --version >/dev/null 2>&1 || { echo "No bun that runs here: install bun or the mattstack app." >&2; exit 1; }

sudo -v

if ! id "$CI_USER" >/dev/null 2>&1; then
  sudo sysadminctl -addUser "$CI_USER" -fullName "mattstack CI" -home "$CI_HOME" -password "$(openssl rand -base64 24)"
  sudo createhomedir -c -u "$CI_USER" >/dev/null
  sudo dscl . create "/Users/$CI_USER" IsHidden 1
fi

# A new macOS user joins staff, which a default home lets in, so every
# world-readable file under it (~/.ssh, ~/.mattstack) would be open to jobs.
if sudo -u "$CI_USER" test -x "$HOME"; then
  echo "$CI_USER can enter $HOME, so jobs could read your files. Run: chmod 700 $HOME" >&2
  exit 1
fi

# Root owns these, so a job cannot rewrite the rule that admits it.
sudo mkdir -p "$HOOK_DIR"
sudo install -o root -g wheel -m 755 "$BUN" "$HOOK_DIR/bun"
sudo install -o root -g wheel -m 644 scripts/ci/macos-runner.ts "$HOOK_DIR/macos-runner.ts"
sudo install -o root -g wheel -m 755 scripts/ci/mac-runner/job-started.sh "$HOOK_DIR/job-started.sh"
sudo install -o root -g wheel -m 755 scripts/ci/mac-runner/job-completed.sh "$HOOK_DIR/job-completed.sh"

# The runner user's commands below cannot start from a directory in your home.
cd /

curl -fsSL -o "$TARBALL" "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-osx-$RUNNER_ARCH-$VERSION.tar.gz"
echo "$SHA256  $TARBALL" | shasum -a 256 -c -
chmod 644 "$TARBALL"

# Hosted macOS images ship these; installing termwright here stops parallel jobs racing to.
sudo -u "$CI_USER" -H bash -c '
  set -euo pipefail
  export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
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

  # A job that passes the hook runs as the same user as the runner and can change
  # its files, so the hook only holds while every admitted job is trustworthy.
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
    <key>ACTIONS_RUNNER_HOOK_JOB_COMPLETED</key><string>$HOOK_DIR/job-completed.sh</string>
    <key>MAC_RUNNER_DIR</key><string>$dir</string>
    <key>MAC_RUNNER_CACHE</key><string>$CI_HOME/.cache/mac-runner</string>
  </dict>
</dict>
</plist>
PLIST
  sudo chown root:wheel "$plist"
  sudo chmod 644 "$plist"
  sudo launchctl bootout "system/$label" 2>/dev/null || true
  # A runner can outlive its bootout, and launchd can refuse the bootstrap with
  # error 5 just after one, which would stop the install with later runners undone.
  for _ in $(seq 1 30); do
    launchctl print "system/$label" >/dev/null 2>&1 || break
    sleep 1
  done
  for attempt in $(seq 1 18); do
    sudo launchctl bootstrap system "$plist" && break
    [ "$attempt" -lt 18 ] || exit 1
    sleep 5
  done
done

# A rerun with a smaller count retires the runners above it.
for plist in /Library/LaunchDaemons/dev.mattstack.ci-runner-*.plist; do
  [ -e "$plist" ] || continue
  label=$(basename "$plist" .plist)
  i=${label##*-}
  [ "$i" -gt "$COUNT" ] || continue
  name=mattstack-mac-$i
  dir=$CI_HOME/$name
  sudo launchctl bootout "system/$label" 2>/dev/null || true
  sudo rm "$plist"
  if sudo test -f "$dir/.runner"; then
    token=$(gh api -X POST "repos/$REPO/actions/runners/remove-token" --jq .token)
    sudo -u "$CI_USER" -H bash -c "cd '$dir' && ./config.sh remove --token '$token'" ||
      echo "$name was not registered from this Mac any more; skipped." >&2
  fi
  sudo rm -rf "${dir:?}"
done

rm -f "$TARBALL"
echo "Installed $COUNT runners. Check them with: gh api repos/$REPO/actions/runners --jq '.runners[] | \"\\(.name) \\(.status)\"'"
