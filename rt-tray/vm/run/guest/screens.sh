#!/bin/bash
# Screen-driving functions shared by drive-setup.sh (the wizard, all five
# screens) and upgrade-to-team.sh (the in-place Settings > Team leg, which
# reuses screen_team/screen_readiness/screen_install/screen_done). Sourced
# only: declares functions and returns, never runs the flow itself, so a
# caller's own SCENARIO/PAT/TEAM_REMOTE/etc. stay whatever it set them to.
HERE="${HERE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

# If the app has to be relaunched by the driver, replay the exact launch env/args (appcast override).
relaunch_app() {
  # shellcheck disable=SC2086
  bash "$HERE/install-app.sh" launch $DRIVER_LAUNCH_ARGS >>"$AX_LOG" 2>&1 || return 1
}

# A solo install's Finish leaves the menu-bar app with no window, so the
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
  ax_shot 06-settings-team
}

screen_welcome() {
  ax_wait_window "mattstack" 60 || ax_fail "setup window never appeared"
  ax_wait_screen welcome 10 || ax_fail "setup.welcome.screen axid missing"
  ax_shot 01-welcome
  ax_click setup.welcome.continue
}

screen_team() {
  local rc
  ax_wait_screen team 10 || ax_fail "setup.team.screen did not appear"
  case "$SCENARIO" in
    create)
      # A fresh guest has no gh identity at this step, so the card offers only
      # the pasted-URL path; Continue stays disabled until the remote is filled.
      [ -n "$TEAM_REMOTE" ] || ax_fail "create needs --team-remote (an empty repo URL the team zone will push to)"
      ax_click setup.team.card.create
      ax_set_field setup.team.create.name "$SLUG"
      ax_set_field setup.team.create.remote "$TEAM_REMOTE"
      ax_shot 02-team-create
      ;;
    join)
      [ -n "$CODE_FILE" ] && [ -f "$CODE_FILE" ] || ax_fail "join needs --invite-code-file"
      ax_click setup.team.card.join
      ax_set_field setup.team.join.code "$(tr -d '\n' < "$CODE_FILE")"
      rc=0; ax_wait_join_note 60 || rc=$?
      [ "$rc" -eq 2 ] && ax_fail "the Join card refused the invite code"
      [ "$rc" -eq 0 ] || ax_fail "no join note on the Join card before Continue"
      ax_find setup.team.screen >/dev/null 2>&1 || ax_fail "the join note did not show on the Team screen"
      ax_find setup.checklist.screen >/dev/null 2>&1 && ax_fail "the checklist opened before Continue was clicked"
      ax_shot 02-team-join
      ;;
    solo)
      ax_click setup.team.card.solo
      ax_shot 02-team-solo
      ;;
    restore) ax_log "restore scenario not implemented"; exit 3;;
  esac
  ax_click setup.team.continue
  # Continue validates the remote(s) with git ls-remote; allow time, then the checklist must appear.
  ax_wait_screen checklist 60 || ax_fail "setup.checklist.screen did not appear after team Continue"
}

screen_readiness() {
  ax_shot 03-readiness-initial
  # Accounts → the forge token (the guest has no gh/glab; the PAT is typed, never logged, masked on screen).
  if ax_find "setup.checklist.row.account.$FORGE" >/dev/null 2>&1; then
    if [ "$SCENARIO" = solo ] && [ -z "$PAT" ]; then
      # solo marks this row required: false; the walkthrough runs without a token.
      ax_log "account.$FORGE row is optional on solo and no token is set on the host; leaving it unconnected"
    else
      [ -n "$PAT" ] || ax_fail "account.$FORGE row present but \$$PAT_ENV is empty on the host"
      ax_click "setup.checklist.row.account.$FORGE.action"
      ax_set_field setup.checklist.connect.field.token "$PAT"
      ax_click setup.checklist.connect.submit
      ax_wait_status "account.$FORGE" ready 60 || ax_fail "$FORGE row not ready"
    fi
  else
    # Name what's actually there instead of letting a wrong row guess surface
    # only as a much later checklist-continue timeout.
    ax_log "account.$FORGE row not found; checklist rows present: $(ax_dump_ids | grep -o 'setup\.checklist\.row\.[A-Za-z0-9._-]*' | sed -E 's/\.(action|status|error)$//' | sort -u | tr '\n' ' ')"
  fi
  # Full Disk Access: button → System Settings → toggle (admin auth for a standard user) → Relaunch.
  if [ "$(ax_status perm.fda || true)" != ready ]; then
    ax_click setup.checklist.row.perm.fda.action
    ax_toggle_in_system_settings mattstack "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" || ax_fail "could not toggle FDA in System Settings"
    ax_shot 03-fda-toggled
    # Relaunch re-execs the app in place with its current arguments + environment, so the appcast
    # override survives.
    # The grant reaches the running process live; the app then offers its own
    # relaunch (its probe flips denied → granted), which re-execs in place.
    local n=20
    while [ "$n" -gt 0 ] && ! ax_find setup.checklist.relaunch >/dev/null 2>&1; do sleep 1; n=$((n-1)); done
    if ax_find setup.checklist.relaunch >/dev/null 2>&1; then
      ax_click setup.checklist.relaunch
    else
      # A granted switch the running process cannot see: the app shows no
      # relaunch hint, so a real user would be stuck here. Quit and reopen the
      # way they eventually would, and leave the finding in the log.
      ax_log "FINDING: FDA is on in System Settings but the app offers no setup.checklist.relaunch; quitting and reopening it"
      ax_osa 'tell application "mattstack" to quit' >/dev/null 2>&1 || true
      sleep 3
      relaunch_app || ax_fail "app did not come back after the driver's FDA relaunch"
    fi
    sleep 3
    if ! ax_wait_window "mattstack" 60; then
      ax_log "app did not come back by itself after FDA relaunch — relaunching with the driver's env/args"
      relaunch_app || ax_fail "app did not come back after FDA relaunch"
      ax_wait_window "mattstack" 60 || ax_fail "app did not come back after FDA relaunch"
    fi
    ax_wait_screen checklist 30 || ax_fail "checklist did not return after FDA relaunch"
    ax_wait_status perm.fda ready 30 || ax_fail "FDA not applied after relaunch"
  fi
  # Background services (Login Items): register → if requiresApproval, open pane and toggle.
  if [ "$(ax_status perm.login-items || true)" != ready ]; then
    ax_click setup.checklist.row.perm.login-items.action
    sleep 2
    if [ "$(ax_status perm.login-items || true)" != ready ]; then
      ax_toggle_in_system_settings mattstack "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" || ax_log "login items toggle not found (may already be enabled)"
    fi
    ax_wait_status perm.login-items ready 60 || ax_fail "login items row not ready"
  fi
  ax_log "note: the 'Background Items Added' banner is not asserted; row status comes from SMAppService"
  # Notifications (optional): Allow the system prompt if the row asks.
  if ax_find setup.checklist.row.perm.notifications >/dev/null 2>&1 && [ "$(ax_status perm.notifications || true)" != ready ]; then
    ax_click setup.checklist.row.perm.notifications.action; sleep 2; ax_allow_notifications
  fi
  # Apple CLT row: the clean room has none; the app's Install… triggers Apple's dialog — a real network install (~minutes).
  if [ "$(ax_status tool.clt || true)" != ready ]; then
    ax_click setup.checklist.row.tool.clt.action
    ax_osa 'tell application "System Events" to tell process "Install Command Line Developer Tools" to click (first button of window 1 whose name is "Install")' >/dev/null 2>&1 || true
    ax_osa 'tell application "System Events" to tell process "Install Command Line Developer Tools" to click (first button of window 1 whose name is "Agree")' >/dev/null 2>&1 || true
    ax_wait_status tool.clt ready 1200 || ax_fail "CLT install did not finish in 20 min"
    ax_shot 03-clt-installed
  fi
  # Rows the checklist expects the user to act on before Install: rt itself
  # links from the bundle; herdr and Claude Code install from their vendors
  # (real network installs, minutes each).
  if [ "$(ax_status tool.rt || true)" != ready ]; then
    ax_click setup.checklist.row.tool.rt.action
    ax_wait_status tool.rt ready 60 || ax_fail "tool.rt not ready after Use mattstack's"
  fi
  # Installed is enough here: herdr's integration and Claude's sign-in are
  # optional follow-ups the row reports as needs-you.
  for tool in herdr claude; do
    if [ "$(ax_status "tool.$tool" || true)" = missing ]; then
      ax_click "setup.checklist.row.tool.$tool.action"
      ax_wait_status_not "tool.$tool" missing 600 || ax_fail "tool.$tool install did not finish in 10 min"
      ax_shot "03-$tool-installed"
    fi
  done
  screen_proxy_row
  ax_shot 03-readiness-final
  # Every row's status, before Install: the one record that explains a
  # Continue that does not advance.
  ax_log "checklist rows: $(for id in $(ax_dump_ids | grep -o 'setup\.checklist\.row\.[A-Za-z0-9._-]*' | sed -E 's/\.(action|status|error)$//' | sed 's/^setup\.checklist\.row\.//' | sort -u); do printf '%s=%s ' "$id" "$(ax_status "$id" 2>/dev/null || echo '?')"; done)"
  # repos.root is required and its only GUI affordance is a native folder panel,
  # which an unattended run cannot answer. The harness is playing the user here,
  # not working around a defect. The recheck is not optional: the app's plan is
  # composed before this write, so Continue stays disabled without it.
  # Presence-gated like account.$FORGE above: the row renders only for join
  # mode or a repo-tracking team, so an unconditional wait would time out and,
  # under set -e, kill every create run before Continue.
  if ax_find setup.checklist.row.repos.root >/dev/null 2>&1; then
    mkdir -p "$HOME/code"
    rt setup repo-root set "$HOME/code" --json
    ax_click setup.checklist.recheck
    ax_wait_status repos.root ready 30 || ax_fail "repos.root never reached ready after the verb answered it"
  fi
  ax_find setup.checklist.continue >/dev/null || ax_fail "setup.checklist.continue axid missing"
  ax_click setup.checklist.continue
}

# The Local proxy row's own button, not Install's proxy step: it has to raise
# macOS's admin dialog, a Cancel there has to end as a row error rather than a
# spinner, and a second try with credentials has to reach ready (needs-you
# when the certificate trust is declined, which the proxy survives).
screen_proxy_row() {
  local s want waiting deadline
  s=$(ax_status tool.proxy || true)
  [ -n "$s" ] || ax_fail "tool.proxy row is not on the checklist"
  if [ "$s" = ready ]; then ax_log "tool.proxy already ready; the row leg has nothing to install"; return 0; fi
  ax_log "tool.proxy is $s; driving the row's own button"

  ax_click setup.checklist.row.tool.proxy.action
  ax_wait_admin_dialog 90 || ax_fail "the Local proxy row's button raised no macOS admin dialog within 90s (row is '$(ax_status tool.proxy || true)')"
  waiting=$(ax_value setup.checklist.row.tool.proxy.waiting || true)
  ax_log "tool.proxy waiting copy: ${waiting:-none}"
  ax_shot 03-proxy-admin-dialog
  ax_admin_cancel_once || ax_fail "could not click Cancel in the admin dialog"
  ax_wait_status_not tool.proxy checking 60 || ax_fail "tool.proxy still spinning 60s after Cancel on the admin dialog"
  ax_find setup.checklist.row.tool.proxy.error >/dev/null 2>&1 || ax_fail "Cancel on the admin dialog left tool.proxy '$(ax_status tool.proxy || true)' with no row error"
  ax_log "tool.proxy error after Cancel: $(ax_value setup.checklist.row.tool.proxy.error || true)"
  ax_shot 03-proxy-cancelled

  want=ready; [ "${AX_TRUST_DECLINE:-0}" = 1 ] && want=needs-you
  ax_click setup.checklist.row.tool.proxy.action
  ax_admin_auth || ax_fail "the Local proxy row's second try raised no macOS admin dialog within 30s"
  ax_shot 03-proxy-admin-auth
  deadline=$((SECONDS + 300))
  while [ "$SECONDS" -lt "$deadline" ]; do
    ax_admin_auth_once || true
    s=$(ax_status tool.proxy || true)
    [ "$s" = "$want" ] && break
    sleep 2
  done
  [ "$s" = "$want" ] || ax_fail "tool.proxy is '${s:-?}' 300s after the row's install, wanted $want$(ax_find setup.checklist.row.tool.proxy.error >/dev/null 2>&1 && printf '; row error: %s' "$(ax_value setup.checklist.row.tool.proxy.error || true)")"
  ax_log "row tool.proxy = $want through the row's own button"
  ax_shot 03-proxy-installed
}

screen_install() {
  ax_wait_screen install 10 || ax_fail "setup.install.screen did not appear"
  ax_shot 04-install-start
  # Steps stream; a privileged step raises the admin prompt (standard user → admin creds). The
  # loop must stay a fast ~2s tick — ax_admin_auth_once returns immediately when no dialog is up,
  # unlike ax_admin_auth's own 30s wait-for-appearance form, which would turn every tick into a
  # 30s stall and the 15-minute budget below into hours.
  local n=900 failed
  while [ "$n" -gt 0 ]; do
    ax_admin_auth_once && ax_shot 04-admin-auth || true
    if ax_wait_window "mattstack" 1 && ax_find setup.done.continue >/dev/null 2>&1; then ax_shot 04-install-done; return 0; fi
    # Failure = the Retry button is present; the failing step's own AXIdentifier is the nearest
    # setup.install.step.* seen before it in the flattened tree (the button lives inside that step's row).
    if ax_find setup.install.retry >/dev/null 2>&1; then
      failed=$(ax_dump_ids | awk '
          /setup\.install\.step\./ { match($0, /setup\.install\.step\.[A-Za-z0-9._-]*/); last = substr($0, RSTART, RLENGTH) }
          /setup\.install\.retry/  { print last; exit }
        ')
      failed="${failed%.status}"; failed="${failed%.log}"
      ax_fail "install step failed (${failed:-see setup.install.retry}); log: setup.install.log.copy"
    fi
    sleep 2; n=$((n-2))
  done
  ax_fail "install did not reach Done in 15 min"
}

screen_done() {
  ax_wait_screen done 10 || ax_fail "setup.done.screen did not appear"
  ax_shot 05-done
  # Neither the section showing, nor one gated row's presence, says anything
  # about another: this guest may carry the Fast Browser row (gated when
  # Chrome is missing), the writing-style row, both, or neither, and each is
  # handled on its own. A row's own container id never surfaces (confirmed by
  # a host-side XCUITest run, 2026-09-23) -- only its .action/.status children
  # do -- so presence is always probed by the .action id, never by the bare
  # row id or by "the section is showing".
  ax_wait_done_gate 60 || ax_fail "Done never settled: no Before you finish section and Finish still disabled (or a refresh error is up)"
  : > "$GUEST_RUN/logs/finish-gate.txt"

  if ax_find setup.done.beforeYouFinish.tool.fast-browser-extension.action >/dev/null 2>&1; then
    ax_click setup.done.skip.tool.fast-browser-extension
    ax_wait_text "Skip the Fast Browser extension?" 10 || ax_fail "skip confirm sheet did not appear"
    ax_wait_text "Without the Fast Browser extension, agents cannot capture screenshots or annotate evidence from your browser. You can load it later from Settings." 5 || ax_fail "skip confirm sheet body is not the pinned copy"
    ax_shot 05-skip-confirm
    ax_click_sheet_button "Skip for now" || ax_fail "could not click Skip for now in the sheet"
    local n=30
    while [ "$n" -gt 0 ] && ax_find setup.done.beforeYouFinish.tool.fast-browser-extension.action >/dev/null 2>&1; do sleep 1; n=$((n-1)); done
    ax_find setup.done.beforeYouFinish.tool.fast-browser-extension.action >/dev/null 2>&1 && ax_fail "the Fast Browser row is still under Before you finish after Skip for now"
    # The bare row id can be absent from the tree the same way a row's own
    # container id can (see the beforeYouFinish finding above); its .status
    # child always surfaces.
    ax_find setup.done.stillToDo.tool.fast-browser-extension.status >/dev/null 2>&1 || ax_fail "the skipped row did not move to Still to do"
    ax_shot 05-skipped
    echo "fast-browser-extension=skipped" >> "$GUEST_RUN/logs/finish-gate.txt"
  fi

  if ax_find setup.done.beforeYouFinish.skills.writing-style.action >/dev/null 2>&1; then
    local style="mattstack:writing-style-conversational"
    ax_click setup.done.beforeYouFinish.skills.writing-style.action
    ax_wait_sheet_id "setup.choose.option.$style" 10 || ax_fail "the writing-style choose sheet did not open with the $style option"
    ax_shot 05-writing-style-choose
    ax_click_sheet_id "setup.choose.option.$style" || ax_fail "could not click the $style option in the choose sheet"
    ax_wait_sheet_enabled setup.choose.submit 10 || ax_fail "Use this style never enabled after picking $style"
    ax_click_sheet_id setup.choose.submit || ax_fail "could not click Use this style in the choose sheet"
    local n=30
    while [ "$n" -gt 0 ] && ax_find setup.done.beforeYouFinish.skills.writing-style.action >/dev/null 2>&1; do sleep 1; n=$((n-1)); done
    ax_find setup.done.beforeYouFinish.skills.writing-style.action >/dev/null 2>&1 && ax_fail "the writing-style row is still under Before you finish after Use this style"
    ax_shot 05-writing-style-chosen
    echo "writing-style=$style" >> "$GUEST_RUN/logs/finish-gate.txt"
  fi

  ax_wait_enabled setup.done.continue 30 || ax_fail "Finish did not enable after resolving the Before you finish rows"
  ax_find setup.done.refreshError >/dev/null 2>&1 && ax_fail "Done fell open on a failed re-check: $(ax_texts | grep -F "Couldn't confirm the checklist" | head -1)"
  [ -s "$GUEST_RUN/logs/finish-gate.txt" ] || echo open > "$GUEST_RUN/logs/finish-gate.txt"
  ax_click setup.done.continue
}
