#!/bin/bash
# Screen-driving functions for fast setup, shared by drive-setup.sh (every
# screen of a first run) and upgrade-to-team.sh (Settings > Team > Create a
# team…, which opens the same window at Create a team). Sourced only:
# declares functions and returns, never runs the flow itself, so a caller's
# own SCENARIO/PAT/TEAM_REMOTE/etc. stay whatever it set them to.
#
# Drive order: screen_macos, screen_path, then screen_invite and
# screen_waiting (join) or screen_create_team (create), then screen_connect,
# screen_this_mac, screen_running and screen_ready. Each waits on its own
# setup.fast.<screen> element, presses what a member would, and shoots
# <nn>-<screen>.
HERE="${HERE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

# If the app has to be relaunched by the driver, replay the exact launch env/args (appcast override).
relaunch_app() {
  # shellcheck disable=SC2086
  bash "$HERE/install-app.sh" launch $DRIVER_LAUNCH_ARGS >>"$AX_LOG" 2>&1 || return 1
}

# The team-upgrade leg sets a prefix, so its shots never overwrite the first run's.
screen_shot() { ax_shot "${SHOT_PREFIX:-}$1"; }

# A miss names the screen that is up instead, the one fact a failed wait needs.
screen_wait() {  # <screen> <timeout-s>
  ax_wait_screen "$1" "${2:-30}" && return 0
  ax_fail "setup.fast.$1 did not appear within ${2:-30}s (on screen: $(ax_screen_now || echo no setup screen))"
}

# A solo install's last button leaves the menu-bar app with no window, so the
# Settings window is opened from the status item's menu.
ax_open_settings_team() {
  local deadline
  ax_click_menu_item tray.settings "Settings…"
  ax_wait_window "Settings" 30 || ax_fail "Settings window never appeared"
  sleep 1
  # The toolbar tabs are SwiftUI toolbar items with no AXIdentifier System
  # Events can see, so the Team tab is clicked by its visible name instead.
  ax_click_toolbar_button "Team" || ax_click_button_named "Team" || ax_fail "Team tab not found in Settings toolbar"
  deadline=$((SECONDS + 30))
  until ax_find settings.team.create >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "settings.team.create never appeared"
    sleep 1
  done
  screen_shot 00-settings-team
}

# The owner or group a team repo URL sits under: Create team takes that and
# makes the repo there itself.
screen_remote_group() {  # <remote url>
  local p="${1%.git}"
  case "$p" in
    *://*) p="${p#*://}"; p="${p#*/}" ;;
    *:*) p="${p#*:}" ;;
  esac
  case "$p" in */*) printf '%s' "${p%/*}" ;; *) return 1 ;; esac
}

# P1: rt's three macOS rows. No button: the screen moves on by itself once all
# three are done, which screen_path's wait asserts.
screen_macos() {
  local deadline=$((SECONDS + 90)) now
  ax_wait_window "mattstack" 60 || ax_fail "setup window never appeared"
  # The window opens on loading until rt's first read lands, and a Mac whose
  # three rows are already done goes straight on to the cards.
  while :; do
    now=$(ax_screen_now || true)
    case "$now" in macos) break ;; path) ax_log "the three macOS rows were already done; P1 never showed"; return 0 ;; esac
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "setup.fast.macos did not appear within 90s (on screen: ${now:-no setup screen})"
    sleep 1
  done
  screen_shot 01-macos
  screen_row_fda
  screen_row_notifications
  screen_row_fancy_urls
  ax_log "macos rows: $(ax_fast_rows | tr '\n' ' ')"
}

# P1 moves on the moment its last row is done, taking that row with it, so
# reaching the cards counts as done.
screen_macos_row_done() {  # <rowId>
  local ids; ids=$(ax_dump_ids || true)
  [ "$(ax_screen_in "$ids" || true)" = path ] && return 0
  [ "$(ax_fast_row_state "$ids" "$1")" = done ]
}

screen_wait_macos_row() {  # <rowId> <timeout-s>
  local deadline=$((SECONDS + ${2:-60}))
  until screen_macos_row_done "$1"; do
    [ "$SECONDS" -lt "$deadline" ] || { ax_log "row $1 not done after ${2:-60}s"; return 1; }
    sleep 1
  done
  ax_log "row $1 done"
}

# The running app only sees a Full Disk Access grant after a relaunch. The
# driver quits and reopens it with the launch's own env and args, the way a
# member would, and the window comes back on P1.
screen_row_fda() {
  screen_macos_row_done perm.fda && { ax_log "perm.fda already done"; return 0; }
  ax_click setup.fast.row.perm.fda.action
  ax_toggle_in_system_settings mattstack "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" || ax_fail "could not toggle Full Disk Access in System Settings"
  screen_shot 01b-fda-toggled
  ax_osa 'tell application "mattstack" to activate' >/dev/null 2>&1 || true
  screen_wait_macos_row perm.fda 20 && return 0
  ax_log "perm.fda still open after the toggle; quitting and reopening mattstack so it reads the grant"
  ax_osa 'tell application "mattstack" to quit' >/dev/null 2>&1 || true
  sleep 3
  relaunch_app || ax_fail "app did not come back after the Full Disk Access relaunch"
  ax_wait_window "mattstack" 60 || ax_fail "app did not come back after the Full Disk Access relaunch"
  ax_wait_screen macos 90 || ax_wait_screen path 1 || ax_fail "setup.fast.macos did not come back after the Full Disk Access relaunch (on screen: $(ax_screen_now || echo no setup screen))"
  screen_shot 01c-fda-relaunched
  screen_wait_macos_row perm.fda 60 || ax_fail "Full Disk Access still reads off after a quit and reopen"
}

screen_row_notifications() {
  screen_macos_row_done perm.notifications && return 0
  ax_click setup.fast.row.perm.notifications.action
  sleep 2
  ax_allow_notifications
  screen_wait_macos_row perm.notifications 60 || ax_fail "Notifications still open 60s after Allow"
}

# Fancy URLs installs the local proxy as root. Its Allow has to raise macOS's
# admin dialog, a Cancel there has to end as a row error rather than a
# spinner, and a second try with credentials has to finish the row.
screen_row_fancy_urls() {
  local row=mac.fancy-urls p=setup.fast.row.mac.fancy-urls deadline
  screen_macos_row_done "$row" && { ax_log "Fancy URLs already done; nothing to install"; return 0; }
  ax_click "$p.action"
  ax_wait_admin_dialog 90 || ax_fail "Fancy URLs' Allow raised no macOS admin dialog within 90s"
  ax_log "Fancy URLs waiting copy: $(ax_value "$p.waiting" || echo none)"
  screen_shot 01d-fancy-urls-admin-dialog
  ax_admin_cancel_once || ax_fail "could not click Cancel in the admin dialog"
  deadline=$((SECONDS + 60))
  while ax_find "$p.waiting" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "Fancy URLs still spinning 60s after Cancel on the admin dialog"
    sleep 1
  done
  ax_find "$p.error" >/dev/null 2>&1 || ax_fail "Cancel on the admin dialog left Fancy URLs with no row error"
  ax_log "Fancy URLs error after Cancel: $(ax_value "$p.error" || true)"
  screen_shot 01d-fancy-urls-cancelled
  ax_click "$p.action"
  ax_admin_auth || ax_fail "Fancy URLs' second try raised no macOS admin dialog within 30s"
  screen_shot 01d-fancy-urls-admin-auth
  deadline=$((SECONDS + 300))
  until screen_macos_row_done "$row"; do
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "Fancy URLs not done 300s after its install$(ax_find "$p.error" >/dev/null 2>&1 && printf '; row error: %s' "$(ax_value "$p.error" || true)")"
    ax_admin_auth_once || true
    sleep 2
  done
  ax_log "Fancy URLs done through the row's own button"
}

# P2: four cards to pick from, then Continue moves on.
screen_path() {
  local card
  screen_wait path 60
  screen_shot 02-path
  case "$SCENARIO" in
    join|create|solo) card="$SCENARIO" ;;
    restore) ax_log "restore scenario not implemented"; exit 3 ;;
    *) ax_fail "no card for scenario $SCENARIO" ;;
  esac
  ax_click "setup.fast.path.card.$card"
  ax_wait_enabled setup.fast.path.primary 10 || ax_fail "setup.fast.path.primary stayed off after picking $card"
  ax_click setup.fast.path.primary
}

# The rows a screen draws are answered once each, the way a member would,
# until the screen's primary button enables. rt's section can land after the
# screen does, so the rows are read again on every pass.
screen_answer_rows() {  # <screen> <timeout-s>
  local screen="$1" deadline=$((SECONDS + ${2:-600})) ids kv id state answered=" "
  while :; do
    ids=$(ax_dump_ids || true)
    ax_ids_have "$ids" "setup.fast.$screen" || ax_fail "left setup.fast.$screen before its button was pressed (on screen: $(ax_screen_in "$ids" || echo no setup screen))"
    for kv in $(ax_fast_rows "$ids"); do
      id="${kv%=*}"; state="${kv##*=}"
      case "$state" in done|waiting) continue ;; esac
      case "$answered" in *" $id "*) continue ;; esac
      answered="$answered$id "
      screen_row "$id" || ax_log "$screen: no answer for row $id ($state); leaving it"
    done
    if [ "$(ax_enabled "setup.fast.$screen.primary" || true)" = true ]; then
      ax_log "$screen rows: $(ax_fast_rows | tr '\n' ' ')"
      return 0
    fi
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "setup.fast.$screen.primary never enabled within ${2:-600}s; rows: $(ax_fast_rows | tr '\n' ' ')"
    sleep 2
  done
}

screen_row() {  # <rowId> → 1 when the walkthrough has no answer for it
  case "$1" in
    tool.clt) screen_row_clt ;;
    forge.token|forge) screen_row_token "$1" ;;
    claude) screen_row_claude ;;
    fast-browser) screen_row_fast_browser ;;
    repos.root) screen_row_repo_root ;;
    repos.place:*) screen_row_repo_place "$1" ;;
    settings.backup) screen_row_backup ;;
    *) return 1 ;;
  esac
}

# The clean room has no Command Line Tools: the row's Install raises Apple's
# dialog, a real network install of minutes. rt drops the row once git is there.
screen_row_clt() {
  local deadline=$((SECONDS + 1200)) ids
  ax_click setup.fast.row.tool.clt.action
  ax_osa 'tell application "System Events" to tell process "Install Command Line Developer Tools" to click (first button of window 1 whose name is "Install")' >/dev/null 2>&1 || true
  ax_osa 'tell application "System Events" to tell process "Install Command Line Developer Tools" to click (first button of window 1 whose name is "Agree")' >/dev/null 2>&1 || true
  while :; do
    ids=$(ax_dump_ids || true)
    ax_ids_have "$(ax_fast_row_ids "$ids")" tool.clt || break
    [ "$(ax_fast_row_state "$ids" tool.clt)" = done ] && break
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "Command Line Tools did not install in 20 min"
    sleep 5
  done
  ax_log "Command Line Tools installed"
  screen_shot clt-installed
}

# The guest has no gh or glab, so the forge token is typed: never logged, masked on screen.
screen_row_token() {  # <rowId>
  local p="setup.fast.row.$1"
  if [ -z "$PAT" ]; then
    [ "$SCENARIO" = solo ] && { ax_log "$1 is optional on solo and no token is set on the host; leaving it"; return 0; }
    ax_fail "$1 asks for the forge token but \$$PAT_ENV is empty on the host"
  fi
  ax_find "$p.field" >/dev/null 2>&1 || ax_fail "$1 offers no token field ($p.field)"
  ax_set_field "$p.field" "$PAT"
  ax_click "$p.action"
  ax_wait_row_done "$1" 60 || ax_fail "$1 not connected 60s after the token$(ax_find "$p.error" >/dev/null 2>&1 && printf ': %s' "$(ax_value "$p.error" || true)")"
}

# Claude Code installs from its vendor (minutes). Its sign-in finishes in a
# browser on claude.ai, which no script here can do: the operator signs in by
# hand in the guest window while screen_connect waits.
screen_row_claude() {
  local deadline=$((SECONDS + 600)) p=setup.fast.row.claude ids
  ids=$(ax_dump_ids || true)
  # The row's one button reads Install until Claude Code is there, then Sign in.
  if ax_ids_have "$ids" "$p.action" && ! ax_ids_have "$ids" "$p.field" && [ "$(ax_title "$p.action" || true)" = Install ]; then
    ax_click "$p.action"
    sleep 5
    ids=$(ax_dump_ids || true)
    while screen_claude_installing "$ids"; do
      [ "$SECONDS" -lt "$deadline" ] || ax_fail "Claude Code install did not finish in 10 min"
      sleep 5; ids=$(ax_dump_ids || true)
    done
    screen_shot claude-installed
  fi
  [ "$(ax_fast_row_state "$ids" claude)" = done ] && return 0
  ax_log "FINDING: Sign in to Claude waits on a browser sign-in; sign in by hand in the guest window within ${CONNECT_WAIT_S:-900}s of Connect opening"
}

# Installing draws the spinner with no control; waiting on the sign-in draws
# it beside the code field and its button. Until rt's next read lands the
# row can still offer Install, which is the install still to come.
screen_claude_installing() {  # <ax_dump_ids output>
  local p=setup.fast.row.claude
  ax_ids_have "$1" "$p.field" && return 1
  ax_ids_have "$1" "$p.action" || { ax_ids_have "$1" "$p.waiting"; return; }
  [ "$(ax_title "$p.action" || true)" = Install ]
}

# The chrome phase force-installs the extension by policy, so Add to Chrome
# is never pressed (it opens the store). Coming back to the app re-checks the
# row, as a member's return from Chrome does.
screen_row_fast_browser() {
  local deadline=$((SECONDS + ${FB_EXTENSION_WAIT_S:-300}))
  until ax_row_done fast-browser; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      ax_log "FINDING: Fast Browser still not added after ${FB_EXTENSION_WAIT_S:-300}s; the policy install did not land (logs/chrome.log)"; return 0
    fi
    ax_osa 'tell application "Finder" to activate' >/dev/null 2>&1 || true
    sleep 2
    ax_osa 'tell application "mattstack" to activate' >/dev/null 2>&1 || true
    sleep 13
  done
  ax_log "Fast Browser added"
}

# Choose… opens a folder panel at rt's suggested folder; Return takes it.
screen_row_repo_root() {
  ax_click setup.fast.row.repos.root.action
  sleep 2
  ax_osa "tell application \"System Events\" to tell process \"$AX_APP\" to keystroke return" >/dev/null 2>&1 || true
  ax_wait_row_done repos.root 30 || ax_fail "repos.root not answered after taking the suggested folder"
}

# A tracked repo nobody placed yet asks "Clone it fresh" or "Already on this
# Mac" before anything else: the clean room has no checkout, so the first tile
# is the answer, and it records rt's suggested clone location. A row that is
# already answered (a found checkout is pre-picked) draws no tiles, and takes
# the location its one-click button shows instead.
screen_row_repo_place() {  # <repos.place:<identity>>
  local p="setup.fast.row.$1" ids; ids=$(ax_dump_ids || true)
  if ax_ids_have "$ids" "$p.segment.clone"; then
    ax_click "$p.segment.clone"
  else
    ax_find "$p.action.oneClick" >/dev/null 2>&1 || ax_fail "$1 needs a placement but offers no clone tile and no one-click button"
    ax_click "$p.action.oneClick"
  fi
  ax_wait_row_done "$1" 60 || ax_fail "$1 not placed after its answer"
}

# Where settings live asks until picked, and Set up this Mac stays locked
# until then. The clean room has no GitHub browser sign-in to confirm a
# remote, so the answer is always the local tile; settings.remote never shows.
screen_row_backup() {
  local p=setup.fast.row.settings.backup
  ax_find "$p.action.local" >/dev/null 2>&1 || ax_fail "settings.backup offers no local tile ($p.action.local)"
  ax_click "$p.action.local"
  ax_wait_row_done settings.backup 60 || ax_fail "settings.backup not answered after the local tile"
}

# P3: the invite code, then rt's invite rows (git, the forge token), then Join.
screen_invite() {
  local rc
  [ -n "$CODE_FILE" ] && [ -f "$CODE_FILE" ] || ax_fail "join needs --invite-code-file"
  screen_wait invite 30
  ax_fill_verified setup.fast.invite.code "$(tr -d '\n' < "$CODE_FILE")"
  rc=0; ax_wait_invite_verdict 60 || rc=$?
  [ "$rc" -eq 2 ] && ax_fail "the invite screen refused the code"
  [ "$rc" -eq 0 ] || ax_fail "the invite screen never read the code"
  screen_answer_rows invite 1500
  screen_shot 03-invite
  ax_click setup.fast.invite.primary
}

# P3c: the team's name, its forge, the owner or group from --team-remote,
# then rt's create rows, then Create team, which makes and pushes the repo.
screen_create_team() {
  local group label owner read_as deadline
  [ -n "$TEAM_REMOTE" ] || ax_fail "create needs --team-remote (its owner or group is where Create team makes the team's repo)"
  group=$(screen_remote_group "$TEAM_REMOTE") || ax_fail "no owner or group in --team-remote $TEAM_REMOTE"
  case "$FORGE" in github) label=GitHub; owner=Owner ;; gitlab) label=GitLab; owner=Group ;; *) ax_fail "unknown forge: $FORGE" ;; esac
  screen_wait create-team 30
  ax_set_field setup.fast.create-team.name "$SLUG"
  ax_pick_segment setup.fast.create-team.forge "$label" || ax_fail "could not pick $label in setup.fast.create-team.forge"
  # The forge's options may expose no selected state, so the owner field's label is what shows the pick took.
  read_as=$(ax_title setup.fast.create-team.group || true)
  [ "$read_as" = "$owner" ] || ax_fail "picked $label, but setup.fast.create-team.group reads '${read_as}', not $owner"
  ax_set_field setup.fast.create-team.group "$group"
  screen_answer_rows create-team 1500
  screen_shot 03-create-team
  ax_click setup.fast.create-team.primary
  deadline=$((SECONDS + 300))
  until ax_find setup.fast.connect >/dev/null 2>&1; do
    ax_find setup.fast.create-team.failure >/dev/null 2>&1 && ax_fail "Create team failed: $(ax_value setup.fast.create-team.failure || true)"
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "Create team did not reach Connect within 300s"
    sleep 2
  done
}

# P4: the join is sent and the admin has yet to approve it. The host plays the
# admin: walkthrough.sh runs run/host/approve-join.sh when in/join-waiting.req
# appears. Approval moves the window to Connect by itself; Hide is never
# pressed, since it only closes the window.
screen_waiting() {
  local deadline now by_hand=0 hand_wait="${JOIN_HAND_WAIT_S:-1800}"
  # Joining clones the team's settings: allow for the network.
  deadline=$((SECONDS + 300))
  while :; do
    now=$(ax_screen_now || true)
    case "$now" in waiting|connect) break ;; esac
    ax_find setup.fast.invite.failure >/dev/null 2>&1 && ax_fail "Join failed: $(ax_value setup.fast.invite.failure || true)"
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "the join reached neither setup.fast.waiting nor setup.fast.connect within 300s (on screen: ${now:-no setup screen})"
    sleep 2
  done
  if [ "$now" = connect ]; then
    ax_log "FINDING: the join went straight to Connect; the waiting screen never showed"
    return 0
  fi
  screen_shot 04-waiting
  rm -f "$GUEST_RUN/in/join-approve.done" "$GUEST_RUN/in/join-approve.failed" "$GUEST_RUN/in/join-approve.manual"
  : > "$GUEST_RUN/in/join-waiting.req"
  ax_log "join: waiting for approval; asked the host to approve"
  deadline=$((SECONDS + 300))
  until ax_find setup.fast.connect >/dev/null 2>&1; do
    [ -e "$GUEST_RUN/in/join-approve.failed" ] && ax_fail "the host could not approve the join (logs/approve.log)"
    # The host minted no team (an --invite-code-file join), so the team's
    # owner has to run rt team members sync, then rt team publish, on their own Mac.
    if [ "$by_hand" = 0 ] && [ -e "$GUEST_RUN/in/join-approve.manual" ]; then
      by_hand=1; deadline=$((SECONDS + hand_wait))
      ax_log "join: the host cannot approve this join; approve this join by hand within ${hand_wait}s: on the team owner's Mac run rt team members sync, then rt team publish"
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      [ "$by_hand" = 1 ] && ax_fail "the join was not approved by hand within ${hand_wait}s (the owner runs rt team members sync, then rt team publish)"
      ax_fail "the join was not approved within 300s of asking the host"
    fi
    sleep 3
  done
  ax_log "join approved; on Connect"
}

# P5: rt's connect rows, then Continue, which unlocks once each is connected.
screen_connect() {
  screen_wait connect 60
  screen_answer_rows connect "${CONNECT_WAIT_S:-900}"
  screen_shot 05-connect
  ax_click setup.fast.connect.primary
}

# P5b: the repos folder, each tracked repo's clone tile, where settings live
# (the local tile), then Set up this Mac, pressed only while it reads so.
screen_this_mac() {
  screen_wait this-mac 30
  screen_answer_rows this-mac 1500
  screen_shot 06-this-mac
  ax_click_reading setup.fast.this-mac.primary "Set up this Mac" \
    || ax_fail "setup.fast.this-mac.primary did not read Set up this Mac, or was disabled: nothing was pressed"
}

# P6 runs by itself and nothing on it may raise a dialog: an admin prompt
# here is a finding, answered so the run can still end. P6b fails the run,
# with its log opened for the screenshot.
screen_running() {
  local deadline=$((SECONDS + ${RUN_WAIT_S:-1800})) now seen=0
  while :; do
    if ax_admin_dialog_up; then
      ax_log "FINDING: a macOS admin dialog came up on the running screen"
      screen_shot 07-running-admin-dialog
      ax_admin_auth_once || true
    fi
    now=$(ax_screen_now || true)
    case "$now" in
      ready) return 0 ;;
      paused)
        screen_shot 07-paused
        ax_click setup.fast.paused.secondary
        sleep 2
        screen_shot 07-paused-log
        ax_fail "setup paused: $(ax_texts | tr '\n' ' ' | cut -c1-300)"
        ;;
      running) [ "$seen" = 1 ] || { seen=1; screen_shot 07-running; } ;;
    esac
    [ "$SECONDS" -lt "$deadline" ] || ax_fail "setup did not finish within ${RUN_WAIT_S:-1800}s (on screen: ${now:-no setup screen})"
    sleep 2
  done
}

# P7: the run is done. Fast setup asks nothing after Set up this Mac, so no
# row was skipped: the gate reads open, and assert-installed.sh checks that
# setup.waived holds nothing.
screen_ready() {
  screen_wait ready 60
  screen_shot 08-ready
  echo open > "$GUEST_RUN/logs/finish-gate.txt"
  ax_click setup.fast.ready.primary
}
