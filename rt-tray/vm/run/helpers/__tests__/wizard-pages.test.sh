#!/bin/bash
# Exercises the wizard paging in run/guest/ax.sh and run/guest/screens.sh
# against a model of the wizard: no app, no System Events, no VM. It proves
# the order of the presses and that every loop ends. What the real
# accessibility tree holds is outside it: only a VM walkthrough shows that.
#
# The model replaces ax_page_step and ax_click_reading with its own. Their
# real guards (no Back on the first page, Continue only while it reads
# Continue, a press only on the wording asked for) live inside AppleScript,
# and here that script is only compiled and searched for the guard's text.
# Nothing in this file runs those guards.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GUEST_RUN="$(mktemp -d)"; export GUEST_RUN
trap 'rm -rf "$GUEST_RUN"' EXIT
mkdir -p "$GUEST_RUN/in" "$GUEST_RUN/logs"
printf '{"graphics":0}\n' > "$GUEST_RUN/in/params.json"
AX_APP=definitely-not-running
source "$HERE/../../guest/ax.sh"
source "$HERE/../../guest/screens.sh"

fails=0
check() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fails=$((fails+1)); fi; }

# osascript reports a script that never compiled and a miss at run time the
# same way, so each new script is compiled from an ax_osa that prints it.
S="$GUEST_RUN/scripts"; mkdir -p "$S"
ax_osa() { printf '%s' "$1" > "$S/$OUT.applescript"; return 1; }
OUT=step-back; ax_page_step back || true
OUT=step-continue; ax_page_step continue || true
OUT=title; ax_title x || true
OUT=progress; ax_progress || true
OUT=statuses; ax_row_statuses || true
OUT=click; ax_click_raw x || true
OUT=press; ax_click_reading x Install || true
for OUT in step-back step-continue title progress statuses click press; do
  check "$OUT AppleScript compiles" 'osacompile -o "$S/$OUT.scpt" "$S/$OUT.applescript" 2>/dev/null'
done
check "the Back script holds on the first page" 'grep -q "starts with \"3 of \"" "$S/step-back.applescript"'
check "the Continue script presses only a button that reads Continue" 'grep -q "is not \"Continue\" then error" "$S/step-continue.applescript"'
check "the press script holds on any other wording, and on a disabled button" \
  'grep -q "is not \"Install\" then error" "$S/press.applescript" && grep -q "if not (enabled of r) then error" "$S/press.applescript"'
check "every script that clicks brings the app to the front first" \
  '( for f in step-back step-continue click press; do grep -q "set frontmost to true" "$S/$f.applescript" || exit 1; done )'

sleep() { :; }
ax_osa() { printf '3 of 9'; }
ax_progress() { printf '4 of 9'; }
check "a page step that moved returns 0" 'ax_page_step continue 2>/dev/null'
ax_progress() { printf '3 of 9'; }
check "a page step that did not move returns 1" '! ax_page_step continue 2>/dev/null'
ax_progress() { return 1; }
check "a page step whose progress cannot be read returns 1" '! ax_page_step continue 2>/dev/null'
ax_osa() { return 1; }
check "a held page step returns 1" '! ax_page_step back 2>/dev/null'
ax_osa() { : > "$GUEST_RUN/osa-called"; }
check "a page step takes only back or continue" '! ax_page_step install && [ ! -e "$GUEST_RUN/osa-called" ]'
ax_osa() { return 1; }

check "ax_ids_have matches a whole identifier" \
  'ax_ids_have "$(printf "a.b\nc.d\n")" c.d && ! ax_ids_have "$(printf "a.b\nc.d\n")" c && ! ax_ids_have "" c.d'
check "ax_page reads the page's group id" \
  '[ "$(ax_page "$(printf "x\nsetup.checklist.page.agents\ny\n")")" = agents ] && [ -z "$(ax_page "$(printf "x\nsetup.checklist.page.\ny\n")")" ] && ! ax_page "x" >/dev/null'

# The model. State lives in files: the driver reads statuses inside $(...),
# and a page turned there must still be turned afterwards.
M="$GUEST_RUN/model"; mkdir -p "$M"
PAGES="mac accounts agents browser rt team"
REQUIRED=" perm.fda tool.clt tool.herdr tool.claude tool.rt "
HIDE_PROXY=0
# A page whose first press of Continue does nothing, and an Install whose
# screen is not up by the next look.
STICKY_PAGE=""; SLOW_INSTALL=0
rows_on() {  # <page or pane>
  case "$1" in
    mac) echo "perm.fda perm.login-items perm.notifications tool.clt" ;;
    accounts) echo "account.github" ;;
    agents) echo "tool.herdr tool.claude" ;;
    browser) echo "tool.fast-browser tool.fast-browser-extension" ;;
    rt) if [ "$HIDE_PROXY" = 1 ]; then echo "tool.rt"; else echo "tool.rt tool.proxy"; fi ;;
    team) echo "home.backup" ;;
  esac
}
model() {  # <wizard|noplan|summary> <page index> [<rowId>=<status>...]; every other row is ready
  local p r kv
  printf '%s' "$1" > "$M/mode"; printf '%s' "$2" > "$M/cur"; printf 0 > "$M/open"; printf overview > "$M/pane"
  : > "$M/calls"; : > "$M/status"; rm -f "$M/stuck-once" "$M/stale-once"; shift 2
  for p in $PAGES; do for r in $(rows_on "$p"); do printf '%s ready\n' "$r" >> "$M/status"; done; done
  for kv in "$@"; do set_status "${kv%%=*}" "${kv#*=}"; done
}
status_of() { awk -v id="$1" '$1 == id { print $2 }' "$M/status"; }
set_status() { awk -v id="$1" -v s="$2" '$1 == id { $2 = s } { print }' "$M/status" > "$M/status.new"; mv "$M/status.new" "$M/status"; }
note() { printf '%s\n' "$1" >> "$M/calls"; }
calls() { tr '\n' ' ' < "$M/calls"; }
count() { grep -c -- "$1" "$M/calls" || true; }
page_now() { local i; i=$(cat "$M/cur"); set -- $PAGES; shift "$i"; printf '%s' "$1"; }
page_last() { set -- $PAGES; [ "$(cat "$M/cur")" -eq $(($# - 1)) ]; }
page_blocked() {
  local r
  for r in $(rows_on "$(page_now)"); do
    case "$REQUIRED" in *" $r "*) [ "$(status_of "$r")" = ready ] || return 0 ;; esac
  done
  return 1
}
where_now() { if [ "$(cat "$M/mode")" = summary ]; then cat "$M/pane"; else page_now; fi; }
# A row's container id is left out on purpose: the driver must not need it.
screen_ids() {
  local mode r
  mode=$(cat "$M/mode")
  case "$mode" in
    install) echo setup.install.screen; return 0 ;;
    noplan) printf '%s\n' setup.checklist.screen setup.checklist.page. setup.window.progress setup.checklist.back setup.checklist.continue; return 0 ;;
    wizard) printf '%s\n' setup.checklist.screen "setup.checklist.page.$(page_now)" setup.window.progress ;;
    summary) printf '%s\n' setup.done.screen setup.checklist.group.overview; for r in $PAGES; do echo "setup.checklist.group.$r"; done ;;
  esac
  for r in $(rows_on "$(where_now)"); do
    echo "setup.checklist.row.$r.status"
    # A ready row is folded under "No action needed": its button is drawn once the line is open.
    if [ "$(status_of "$r")" != ready ] || [ "$(cat "$M/open")" = 1 ]; then echo "setup.checklist.row.$r.action"; fi
  done
  echo setup.checklist.noAction.toggle
  if [ "$mode" = wizard ]; then printf '%s\n' setup.checklist.recheck setup.checklist.back setup.checklist.continue; fi
}
ax_dump_ids() { screen_ids; }
ax_find_raw() { ax_ids_have "$(screen_ids)" "$1"; }
ax_page_step() {
  local cur
  [ "$(cat "$M/mode")" = wizard ] || { note "held:noplan"; return 1; }
  cur=$(cat "$M/cur")
  case "$1" in
    back)
      [ "$cur" -gt 0 ] || { note held:first; return 1; }
      printf '%s' $((cur - 1)) > "$M/cur" ;;
    continue)
      if page_last; then note held:install; return 1; fi
      if page_blocked; then note held:blocked; return 1; fi
      printf '%s' $((cur + 1)) > "$M/cur" ;;
    *) return 1 ;;
  esac
  printf 0 > "$M/open"; note "$1"
}
ax_click_raw() {
  local r
  ax_find_raw "$1" || return 1
  note "click:$1@$(where_now)"
  case "$1" in
    setup.checklist.noAction.toggle) printf '%s' $((1 - $(cat "$M/open"))) > "$M/open" ;;
    setup.checklist.group.*) printf '%s' "${1#setup.checklist.group.}" > "$M/pane"; printf 0 > "$M/open" ;;
    setup.checklist.row.*.action) r="${1#setup.checklist.row.}"; set_status "${r%.action}" ready ;;
    setup.checklist.continue)
      # A disabled button takes the click and does nothing.
      if page_blocked; then :
      elif [ "$(page_now)" = "$STICKY_PAGE" ] && [ ! -e "$M/stuck-once" ]; then : > "$M/stuck-once"
      elif page_last; then [ "$SLOW_INSTALL" = 1 ] || printf install > "$M/mode"
      else printf '%s' $(($(cat "$M/cur") + 1)) > "$M/cur"; printf 0 > "$M/open"; fi ;;
  esac
}
reveal() { rc=0; ax_reveal_row "$1" 2>/dev/null || rc=$?; }

model wizard 0
reveal setup.checklist.row.tool.rt.status
check "a row on a later page is reached forward, with no Back" \
  '[ "$rc" -eq 0 ] && [ "$(page_now)" = rt ] && [ "$(calls)" = "continue continue continue continue " ]'

model wizard 0
reveal setup.checklist.row.tool.rt
check "a bare row id is found by the row's status" '[ "$rc" -eq 0 ] && [ "$(page_now)" = rt ]'

model wizard 2 tool.herdr=missing
reveal setup.checklist.row.perm.fda.status
check "a row on an earlier page is reached by Back, past a page that blocks Continue" \
  '[ "$rc" -eq 0 ] && [ "$(page_now)" = mac ] && [ "$(calls)" = "held:blocked back back held:first " ]'

model wizard 4 tool.rt=missing
reveal setup.checklist.row.account.github.status
check "a row between the first page and this one is reached from the first page forward" \
  '[ "$rc" -eq 0 ] && [ "$(page_now)" = accounts ] && [ "$(calls)" = "held:blocked back back back back held:first continue " ]'

model wizard 5
reveal setup.checklist.row.perm.fda.status
check "from the last page the search never presses Install" \
  '[ "$rc" -eq 0 ] && [ "$(page_now)" = mac ] && [ "$(count "^click:setup.checklist.continue")" -eq 0 ] && [ "$(cat "$M/mode")" = wizard ]'

model wizard 0 tool.clt=missing
reveal setup.checklist.row.tool.rt.status
check "a row past a page that blocks Continue is not reached" \
  '[ "$rc" -ne 0 ] && [ "$(page_now)" = mac ] && [ "$(calls)" = "held:blocked held:first " ]'

model wizard 2
reveal setup.checklist.row.no.such.row.status
check "a row on no page ends the search, with no press of the primary button" \
  '[ "$rc" -ne 0 ] && [ "$(wc -l < "$M/calls")" -lt 20 ] && [ "$(count "^click:setup.checklist.continue")" -eq 0 ] && [ "$(cat "$M/mode")" = wizard ]'

model noplan 0
reveal setup.checklist.row.perm.fda.status
check "before a plan lands nothing is pressed" '[ "$rc" -ne 0 ] && [ "$(count "^click:")" -eq 0 ] && [ "$(count "^held:")" -eq 2 ]'

model wizard 4
reveal setup.checklist.row.tool.proxy.action
check "a folded row's button takes one press of the No action needed line" \
  '[ "$rc" -eq 0 ] && [ "$(calls)" = "click:setup.checklist.noAction.toggle@rt " ]'

model wizard 4
reveal setup.checklist.row.tool.proxy.error
check "a row with no error is left where it is: no press, no page turned" '[ "$rc" -eq 1 ] && [ -z "$(calls)" ]'

model wizard 4
reveal setup.checklist.row.tool.proxy.status
check "a status on the page on screen needs nothing" '[ "$rc" -eq 0 ] && [ -z "$(calls)" ]'

model wizard 0
reveal setup.checklist.continue
check "anything that is not a checklist row is left alone" '[ "$rc" -eq 0 ] && [ -z "$(calls)" ]'

model summary 0 tool.fast-browser-extension=needs-you
reveal setup.checklist.row.tool.fast-browser-extension.status
check "on the summary a row is reached through the sidebar, never through Overview" \
  '[ "$rc" -eq 0 ] && [ "$(cat "$M/pane")" = browser ] && [ "$(count "group.overview")" -eq 0 ] && [ "$(count "^click:setup.checklist.group")" -ge 1 ]'

model summary 0
reveal setup.checklist.row.no.such.row.status
check "on the summary a row in no pane ends the search" '[ "$rc" -ne 0 ] && [ "$(count "^click:setup.checklist.group")" -eq 6 ]'

# screen_readiness against the model. The waits are single looks: the model
# answers at once, and a real wait would spin on the clock.
ax_status() {
  ax_reveal_row "setup.checklist.row.$1.status" || true
  ax_find_raw "setup.checklist.row.$1.status" || return 1
  status_of "$1"
}
ax_wait_status() { [ "$(ax_status "$1" || true)" = "$2" ]; }
ax_wait_status_not() { [ "$(ax_status "$1" || true)" != "$2" ]; }
ax_enabled() { if [ "$1" = setup.checklist.continue ] && page_blocked; then echo false; else echo true; fi; }
ax_wait_enabled() { [ "$(ax_enabled "$1")" = true ]; }
wording_now() { if page_last; then echo Install; else echo Continue; fi; }
# blank: the wording does not read. stale: the last page's button is read as
# Continue once, the way a read just before a plan lands would see it.
TITLE_MODE=truth
ax_title() {
  case "$TITLE_MODE" in
    blank) return 0 ;;
    stale) if page_last && [ ! -e "$M/stale-once" ]; then : > "$M/stale-once"; echo Continue; return 0; fi ;;
  esac
  wording_now
}
ax_click_reading() {
  [ "$(wording_now)" = "$2" ] || { note "held:reads-$(wording_now)"; return 1; }
  if page_blocked; then note held:disabled; return 1; fi
  ax_click_raw "$1"
}
ax_row_statuses() { local r; for r in $(rows_on "$(where_now)"); do echo "$r=$(status_of "$r")"; done; }
ax_shot() { :; }
ax_allow_notifications() { :; }
ax_toggle_in_system_settings() { :; }
SCENARIO=solo; FORGE=github; PAT=""; PAT_ENV=NONE
# errexit as drive-setup.sh runs it: a subshell on the left of || would switch it off.
readiness() { set +e; ( set -e; screen_readiness ) >/dev/null 2>&1; rc=$?; set -e; }
clicks() { grep '^click:' "$M/calls" | sed 's/^click:setup\.checklist\.//' | tr '\n' ' '; }

model wizard 0 perm.login-items=missing perm.notifications=needs-you tool.clt=missing account.github=needs-you \
  tool.herdr=missing tool.claude=missing tool.rt=missing
readiness
check "solo: rows are answered page by page, and Install is the last press" \
  '[ "$rc" -eq 0 ] && [ "$(cat "$M/mode")" = install ] && [ "$(clicks)" = "row.perm.login-items.action@mac row.perm.notifications.action@mac row.tool.clt.action@mac continue@mac continue@accounts row.tool.herdr.action@agents row.tool.claude.action@agents continue@agents continue@browser row.tool.rt.action@rt continue@rt continue@team " ]'
check "solo: Back is never pressed from the first page" '[ "$(count "^back$")" -eq 0 ] && [ "$(count "^held:first$")" -eq 1 ]'

model wizard 5
readiness
check "a wizard that opens on its last page is walked back to the first before anything is pressed" \
  '[ "$rc" -eq 0 ] && [ "$(cat "$M/mode")" = install ] && [ "$(count "^back$")" -eq 5 ] && [ "$(clicks)" = "continue@mac continue@accounts continue@agents continue@browser continue@rt continue@team " ]'

model wizard 0 tool.herdr=error
readiness
check "a page whose required row the walkthrough cannot answer fails there, by name" \
  '[ "$rc" -ne 0 ] && [ "$(page_now)" = agents ] && [ "$(count "continue@agents")" -eq 0 ] && grep -q "the wizard is stuck on page .agents." "$AX_LOG"'

HIDE_PROXY=1
model wizard 0
readiness
check "a checklist with no proxy row fails before Install is pressed" \
  '[ "$rc" -ne 0 ] && [ "$(cat "$M/mode")" = wizard ] && [ "$(count "continue@team")" -eq 0 ] && grep -q "tool.proxy row is not on the checklist" "$AX_LOG"'
HIDE_PROXY=0

SLOW_INSTALL=1
model wizard 0
readiness
check "nothing is pressed after a button that read Install" '[ "$rc" -eq 0 ] && [ "$(count "continue@team")" -eq 1 ]'
SLOW_INSTALL=0

TITLE_MODE=blank
model wizard 0
readiness
check "a primary button whose wording does not read is never pressed" \
  '[ "$rc" -ne 0 ] && [ "$(page_now)" = mac ] && [ "$(count "^click:")" -eq 0 ] && [ "$(count "^held:")" -eq 1 ] && grep -q "FAIL: setup.checklist.continue reads .. on page .mac., neither Continue nor Install: nothing was pressed" "$AX_LOG"'

TITLE_MODE=stale
model wizard 0
readiness
check "a wording read before the page became the last one presses nothing, and Install is pressed once on the next read" \
  '[ "$rc" -eq 0 ] && [ "$(cat "$M/mode")" = install ] && [ "$(count "^held:reads-Install$")" -eq 1 ] && [ "$(count "continue@team")" -eq 1 ]'

HIDE_PROXY=1
model wizard 0
readiness
check "Install's checks still run when the page became the last one after the read" \
  '[ "$rc" -ne 0 ] && [ "$(cat "$M/mode")" = wizard ] && [ "$(count "^held:reads-Install$")" -eq 1 ] && [ "$(count "continue@team")" -eq 0 ]'
HIDE_PROXY=0
TITLE_MODE=truth

STICKY_PAGE=rt
screen_proxy_row() { note proxy-row; }
model wizard 0 tool.rt=missing
readiness
check "a press that did not turn the page is pressed again, and the page's rows are not driven twice" \
  '[ "$rc" -eq 0 ] && [ "$(cat "$M/mode")" = install ] && [ "$(count "continue@rt")" -eq 2 ] && [ "$(count "^proxy-row$")" -eq 1 ] && [ "$(count "row.tool.rt.action")" -eq 1 ]'
STICKY_PAGE=""

# The last page holds every row the walkthrough insists on, so only the
# guard on a first press that reads Install stands in the way.
ax_page_step() { note "held:$1"; return 1; }
PAGES="mac accounts agents browser rt"
model wizard 4
readiness
check "a wizard that opens on its last page and cannot be turned back fails before Install" \
  '[ "$rc" -ne 0 ] && [ "$(cat "$M/mode")" = wizard ] && [ "$(count "continue@rt")" -eq 0 ] && grep -q "could not be turned back to its first" "$AX_LOG"'

model noplan 0
screen_wait_plan() { return 1; }
readiness
check "a checklist that never draws a row fails before any press" '[ "$rc" -ne 0 ] && [ -z "$(calls)" ]'

echo; [ "$fails" -eq 0 ] && echo "  all wizard paging checks ok" || { echo "  $fails check(s) failed"; exit 1; }
