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
      # With GitHub connected the card defaults to creating a private repo,
      # which hides the URL field; the walkthrough pushes to its own repo.
      if ax_find setup.team.create.useGh >/dev/null 2>&1 && [ "$(ax_value setup.team.create.useGh 2>/dev/null)" = 1 ]; then
        ax_click setup.team.create.useGh
      fi
      ax_set_field setup.team.create.remote "$TEAM_REMOTE"
      ax_shot 02-team-create
      ;;
    join)
      [ -n "$CODE_FILE" ] && [ -f "$CODE_FILE" ] || ax_fail "join needs --invite-code-file"
      ax_click setup.team.card.join
      ax_fill_verified setup.team.join.code "$(tr -d '\n' < "$CODE_FILE")"
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

# The checklist opens before its first plan lands: no row, no page, and a
# primary button that reads Install.
screen_wait_plan() {  # <timeout-s>
  local deadline=$((SECONDS + ${1:-60})) ids
  while [ "$SECONDS" -lt "$deadline" ]; do
    ids=$(ax_dump_ids || true)
    case "$ids" in *setup.checklist.row.*) return 0 ;; esac
    sleep 1
  done
  return 1
}

# True the first time a row is on the page a dump was taken from. A row's
# status is in the tree whenever its page is, folded away or not. Once only:
# a press that did not turn the page must not drive the page's rows again.
screen_row_due() {  # <ax_dump_ids output> <rowId>
  case "$SCREEN_ROWS_DONE" in *" $2 "*) return 1 ;; esac
  ax_ids_have "$1" "setup.checklist.row.$2.status" || return 1
  SCREEN_ROWS_DONE="$SCREEN_ROWS_DONE$2 "
}

# Accounts → the forge token (the guest has no gh/glab; the PAT is typed, never logged, masked on screen).
screen_row_account() {
  if [ "$(ax_status "account.$FORGE" || true)" = ready ]; then
    # A later pass (solo's team upgrade) finds the token it connected earlier; the row has no action.
    ax_log "account.$FORGE row is already ready; nothing to connect"
  elif [ "$SCENARIO" = solo ] && [ -z "$PAT" ]; then
    # solo marks this row required: false; the walkthrough runs without a token.
    ax_log "account.$FORGE row is optional on solo and no token is set on the host; leaving it unconnected"
  else
    [ -n "$PAT" ] || ax_fail "account.$FORGE row present but \$$PAT_ENV is empty on the host"
    ax_click "setup.checklist.row.account.$FORGE.action"
    ax_set_field setup.checklist.connect.field.token "$PAT"
    ax_click setup.checklist.connect.submit
    ax_wait_status "account.$FORGE" ready 60 || ax_fail "$FORGE row not ready"
  fi
}

# Full Disk Access: button → System Settings → toggle (admin auth for a standard user) → Relaunch.
screen_row_fda() {
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
    # The wizard reopens on the first page that still holds a required row,
    # which need not be this one; the status wait turns back to it.
    screen_wait_plan 60 || ax_fail "the checklist drew no row after the FDA relaunch"
    ax_wait_status perm.fda ready 30 || ax_fail "FDA not applied after relaunch"
  fi
}

# Background services (Login Items): register → if requiresApproval, open pane and toggle.
screen_row_login_items() {
  if [ "$(ax_status perm.login-items || true)" != ready ]; then
    ax_click setup.checklist.row.perm.login-items.action
    sleep 2
    if [ "$(ax_status perm.login-items || true)" != ready ]; then
      ax_toggle_in_system_settings mattstack "x-apple.systempreferences:com.apple.LoginItems-Settings.extension" || ax_log "login items toggle not found (may already be enabled)"
    fi
    ax_wait_status perm.login-items ready 60 || ax_fail "login items row not ready"
  fi
  ax_log "note: the 'Background Items Added' banner is not asserted; row status comes from SMAppService"
}

# Notifications (optional): Allow the system prompt if the row asks.
screen_row_notifications() {
  if [ "$(ax_status perm.notifications || true)" != ready ]; then
    ax_click setup.checklist.row.perm.notifications.action; sleep 2; ax_allow_notifications
  fi
}

# Apple CLT row: the clean room has none; the row's Install button triggers Apple's dialog, a real network install (minutes).
screen_row_clt() {
  if [ "$(ax_status tool.clt || true)" != ready ]; then
    ax_click setup.checklist.row.tool.clt.action
    ax_osa 'tell application "System Events" to tell process "Install Command Line Developer Tools" to click (first button of window 1 whose name is "Install")' >/dev/null 2>&1 || true
    ax_osa 'tell application "System Events" to tell process "Install Command Line Developer Tools" to click (first button of window 1 whose name is "Agree")' >/dev/null 2>&1 || true
    ax_wait_status tool.clt ready 1200 || ax_fail "CLT install did not finish in 20 min"
    ax_shot 03-clt-installed
  fi
}

# Rows the checklist expects the user to act on before Install: rt itself
# links from the bundle; herdr and Claude Code install from their vendors
# (real network installs, minutes each).
screen_row_rt() {
  if [ "$(ax_status tool.rt || true)" != ready ]; then
    ax_click setup.checklist.row.tool.rt.action
    ax_wait_status tool.rt ready 60 || ax_fail "tool.rt not ready after Use mattstack's"
  fi
}

# Installed is enough here: herdr's integration and Claude's sign-in are
# optional follow-ups the row reports as needs-you.
screen_row_tool() {  # <herdr|claude>
  if [ "$(ax_status "tool.$1" || true)" = missing ]; then
    ax_click "setup.checklist.row.tool.$1.action"
    ax_wait_status_not "tool.$1" missing 600 || ax_fail "tool.$1 install did not finish in 10 min"
    ax_shot "03-$1-installed"
  fi
}

# repos.root is required and its only GUI affordance is a native folder panel,
# which an unattended run cannot answer. The harness is playing the user here,
# not working around a defect. The recheck is not optional: the app's plan is
# composed before this write, so Continue stays disabled without it.
# The row renders only for join mode or a repo-tracking team.
screen_row_repo_root() {
  mkdir -p "$HOME/code"
  rt setup repo-root set "$HOME/code" --json
  ax_click setup.checklist.recheck
  ax_wait_status repos.root ready 30 || ax_fail "repos.root never reached ready after the verb answered it"
}

# One wizard page at a time, in the wizard's own order: a page's Continue
# stays off until its required rows are ready, so a row on a later page
# cannot be reached before them. Each page gets the rows the walkthrough
# answers that are on it, then its primary button, which is Install on the
# last page.
screen_readiness() {
  local n=12 turned=0 paged=0 ids page wording tool
  SCREEN_ROWS_DONE=" "
  ax_shot 03-readiness-initial
  screen_wait_plan 60 || ax_fail "the checklist drew no row within 60s"
  ax_page_rewind || true
  while [ "$n" -gt 0 ]; do
    ids=$(ax_dump_ids || true)
    if ax_ids_have "$ids" setup.install.screen; then return 0; fi
    page=$(ax_page "$ids" || true)
    # An app from before the wizard (the update leg installs one) draws a
    # single list with no page id, whose button reads Install from the start.
    # Latched: one look that misses a wizard's page id must not lift the guard.
    if ax_page "$ids" >/dev/null; then paged=1; fi
    if screen_row_due "$ids" perm.fda; then screen_row_fda; fi
    if screen_row_due "$ids" perm.login-items; then screen_row_login_items; fi
    if screen_row_due "$ids" perm.notifications; then screen_row_notifications; fi
    if screen_row_due "$ids" tool.clt; then screen_row_clt; fi
    if screen_row_due "$ids" "account.$FORGE"; then screen_row_account; fi
    if screen_row_due "$ids" tool.rt; then screen_row_rt; fi
    for tool in herdr claude; do
      if screen_row_due "$ids" "tool.$tool"; then screen_row_tool "$tool"; fi
    done
    if screen_row_due "$ids" tool.proxy; then
      screen_proxy_row
    fi
    if screen_row_due "$ids" repos.root; then screen_row_repo_root; fi
    # Every row's status on the page, before its button: the one record that
    # explains a page that does not advance.
    ax_log "checklist page ${page:-?}: $(ax_row_statuses | tr '\n' ' ')"
    ax_shot "03-readiness-${page:-page$((13 - n))}"
    ax_wait_enabled setup.checklist.continue 60 || ax_fail "the wizard is stuck on page '${page:-?}': its primary button never enabled"
    wording=$(ax_title setup.checklist.continue || true)
    case "$wording" in
      Continue) ;;
      Install)
        # The wizard opens on its first page, and a relaunch that landed
        # further on was turned back above, so Install on the first pass means
        # the pages before it went unwalked.
        [ "$turned" = 1 ] || [ "$paged" = 0 ] || ax_fail "the wizard is on its last page before any page was walked: it could not be turned back to its first"
        case "$SCREEN_ROWS_DONE" in *" tool.proxy "*) ;; *) ax_fail "tool.proxy row is not on the checklist" ;; esac
        case "$SCREEN_ROWS_DONE" in *" account.$FORGE "*) ;; *) ax_log "account.$FORGE row is on no page of the checklist" ;; esac
        ;;
      # A button whose wording did not read may be Install: it is never pressed.
      *) ax_fail "setup.checklist.continue reads '$wording' on page '${page:-?}', neither Continue nor Install: nothing was pressed" ;;
    esac
    # A plan that lands after the read above can make this the last page. The
    # press then finds another wording and holds, and the next pass reads it
    # again with Install's checks in front.
    if ax_click_reading setup.checklist.continue "$wording"; then
      if [ "$wording" = Install ]; then return 0; fi
      turned=1
    else
      ax_log "setup.checklist.continue no longer reads '$wording', or is disabled, on page '${page:-?}'; nothing was pressed"
    fi
    sleep 1; n=$((n-1))
  done
  ax_fail "the wizard did not reach Install in 12 tries at its primary button"
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
  # The summary shows its Overview alone until the post-install check has
  # confirmed the rows, then opens on Needs you when a row blocks Finish.
  # The Overview's own button stands in where its container id does not surface.
  ax_find setup.done.overview >/dev/null 2>&1 || ax_find setup.done.openBoard >/dev/null 2>&1 || ax_find setup.checklist.group.needs-you >/dev/null 2>&1 \
    || ax_fail "the summary drew neither Overview nor Needs you"
  ax_shot 05-done
  # Neither the Needs you pane showing, nor one gated row's presence, says
  # anything about another: this guest may carry the Fast Browser row (gated
  # when Chrome is missing), the writing-style row, both, or neither, and each
  # is handled on its own. A row's container id may not surface where its
  # .action/.status children do, so presence is always probed by the .action
  # id, never by the bare row id or by "the pane is showing".
  ax_wait_done_gate 60 || ax_fail "the summary never settled: no Needs you entry and Finish still disabled (or a refresh error is up)"
  : > "$GUEST_RUN/logs/finish-gate.txt"

  if ax_find setup.done.beforeYouFinish.tool.fast-browser-extension.action >/dev/null 2>&1; then
    ax_click setup.done.skip.tool.fast-browser-extension
    ax_wait_text "Skip the Fast Browser extension?" 10 || ax_fail "skip confirm sheet did not appear"
    ax_wait_text "Without the Fast Browser extension, agents cannot capture screenshots or annotate evidence from your browser. You can load it later from Settings." 5 || ax_fail "skip confirm sheet body is not the pinned copy"
    ax_shot 05-skip-confirm
    ax_click_sheet_button "Skip for now" || ax_fail "could not click Skip for now in the sheet"
    local n=30
    while [ "$n" -gt 0 ] && ax_find setup.done.beforeYouFinish.tool.fast-browser-extension.action >/dev/null 2>&1; do sleep 1; n=$((n-1)); done
    ax_find setup.done.beforeYouFinish.tool.fast-browser-extension.action >/dev/null 2>&1 && ax_fail "the Fast Browser row is still under Needs you after Skip for now"
    # A skipped row is back in its own group's pane, under the checklist's row
    # ids; ax_find turns the sidebar to it. Probed by its .status child, which
    # surfaces where a row's container id may not.
    ax_find setup.checklist.row.tool.fast-browser-extension.status >/dev/null 2>&1 || ax_fail "the skipped row is not in its group's pane on the summary"
    ax_shot 05-skipped
    echo "fast-browser-extension=skipped" >> "$GUEST_RUN/logs/finish-gate.txt"
    # The sidebar keeps the pane that probe picked, and the next row is looked
    # for under Needs you.
    if ax_find setup.checklist.group.needs-you >/dev/null 2>&1; then ax_click setup.checklist.group.needs-you; fi
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
    ax_find setup.done.beforeYouFinish.skills.writing-style.action >/dev/null 2>&1 && ax_fail "the writing-style row is still under Needs you after Use this style"
    ax_shot 05-writing-style-chosen
    echo "writing-style=$style" >> "$GUEST_RUN/logs/finish-gate.txt"
  fi

  ax_wait_enabled setup.done.continue 30 || ax_fail "Finish did not enable after resolving the Needs you rows"
  ax_find setup.done.refreshError >/dev/null 2>&1 && ax_fail "the summary fell open on a failed re-check: $(ax_value setup.done.refreshError || true)"
  [ -s "$GUEST_RUN/logs/finish-gate.txt" ] || echo open > "$GUEST_RUN/logs/finish-gate.txt"
  ax_click setup.done.continue
}
