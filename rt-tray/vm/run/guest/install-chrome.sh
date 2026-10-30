#!/bin/bash
# Guest side of the chrome phase: put Google Chrome in /Applications and
# force-install the Fast Browser extension through Chrome's
# ExtensionInstallForcelist policy (admin, through sudo), then open Chrome once
# as tester so the extension lands in the profile, as a member's own Chrome would.
# Usage: install-chrome.sh install <extension id> <update url> | open <extension id>
set -euo pipefail
GUEST_RUN="${GUEST_RUN:-/Volumes/My Shared Files/run}"
[ -d "$GUEST_RUN" ] || { echo "install-chrome.sh runs in the guest; $GUEST_RUN is not mounted" >&2; exit 1; }
LOG="$GUEST_RUN/logs/chrome.log"; mkdir -p "$(dirname "$LOG")"
say() {
  local line; line="$(date -u +%H:%M:%S) $*"
  printf '%s\n' "$line" >&2
  printf '%s\n' "$line" >>"$LOG" 2>/dev/null || true
}
usage() { echo "usage: install-chrome.sh install <extension id> <update url> | open <extension id>" >&2; exit 1; }
# Empty in the guest; a test points it at a scratch directory.
ROOT="${CHROME_ROOT:-}"
APP="$ROOT/Applications/Google Chrome.app"
POLICY="$ROOT/Library/Managed Preferences/com.google.Chrome"
DMG_URL="${CHROME_DMG_URL:-https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg}"

check_id() { [[ "${1:-}" =~ ^[a-p]{32}$ ]] || { say "not a Chrome extension id: '${1:-}' (want 32 letters a-p)"; exit 1; }; }

cmd="${1:-}"; shift || true
case "$cmd" in
  install)
    ID="${1:-}"; URL="${2:-}"
    check_id "$ID"; [ -n "$URL" ] || usage
    TMP=$(mktemp -d "${TMPDIR:-/tmp}/chrome.XXXXXX")
    trap 'hdiutil detach "$TMP/m" -quiet 2>/dev/null || true; rm -rf "$TMP"' EXIT
    curl -fsSL --retry 3 -o "$TMP/googlechrome.dmg" "$DMG_URL" || { say "could not download Chrome from $DMG_URL"; exit 1; }
    hdiutil attach "$TMP/googlechrome.dmg" -nobrowse -quiet -mountpoint "$TMP/m"
    [ -d "$TMP/m/Google Chrome.app" ] || { say "the Chrome dmg has no Google Chrome.app"; exit 1; }
    sudo mkdir -p "$ROOT/Applications"
    sudo rm -rf "$APP"
    sudo ditto "$TMP/m/Google Chrome.app" "$APP"
    sudo chown -R root:admin "$APP"
    hdiutil detach "$TMP/m" -quiet
    say "Chrome copied to $APP"
    sudo mkdir -p "$(dirname "$POLICY")"
    sudo defaults write "$POLICY" ExtensionInstallForcelist -array "$ID;$URL"
    sudo chown root:wheel "$POLICY.plist"
    sudo chmod 644 "$POLICY.plist"
    defaults read "$POLICY" ExtensionInstallForcelist 2>/dev/null | grep -qF "$ID;$URL" \
      || { say "the ExtensionInstallForcelist policy did not read back"; exit 1; }
    say "Chrome policy force-installs $ID"
    ;;
  open)
    ID="${1:-}"; check_id "$ID"
    [ -d "$APP" ] || { say "no Chrome at $APP"; exit 1; }
    open -g -a "$APP" --args --no-first-run --no-default-browser-check
    EXT="$HOME/Library/Application Support/Google/Chrome/Default/Extensions/$ID"
    for _ in $(seq 1 "${CHROME_WAIT_S:-180}"); do
      [ -d "$EXT" ] && { say "the extension $ID is in Chrome's profile"; exit 0; }
      sleep 1
    done
    say "the extension $ID never landed in Chrome's profile ($EXT)"; exit 1
    ;;
  *) usage;;
esac
