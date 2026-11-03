#!/bin/bash
# Exercises the fast setup drivers in run/guest/ax.sh and run/guest/screens.sh
# against a model of the setup window: no app, no System Events, no VM. It
# proves the order of the screens and presses and that every wait ends. What
# the real accessibility tree holds is outside it: only a VM walkthrough
# shows that.
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
# same way, so each AppleScript is compiled from an ax_osa that prints it.
S="$GUEST_RUN/scripts"; mkdir -p "$S"
ax_osa() { printf '%s' "$1" > "$S/$OUT.applescript"; return 1; }
OUT=click; ax_click_raw x || true
OUT=status; ax_fast_status x || true
OUT=segment; ax_pick_segment x GitHub || true
for OUT in click status segment; do
  check "$OUT AppleScript compiles" 'osacompile -o "$S/$OUT.scpt" "$S/$OUT.applescript" 2>/dev/null'
done
check "the click script brings the app to the front first" 'grep -q "set frontmost to true" "$S/click.applescript"'

# A button is read, checked and pressed in one ax-button.js run.
JS="$HERE/../../guest/ax-button.js"
ax_button() { printf '%s\n' "$*" >> "$S/button-calls"; return 1; }
ax_title x || true; ax_click_reading x "Set up this Mac" || true
check "each read and press is one ax-button.js run" \
  '[ "$(cat "$S/button-calls")" = "$(printf "read x\npress x Set up this Mac")" ]'
check "ax-button.js compiles" 'osacompile -l JavaScript -o "$S/button.scpt" "$JS" 2>/dev/null'
check "ax-button.js presses only after its guard, with the app in front" \
  '[ "$(grep -c "pressEl(b" "$JS")" -eq 1 ] && [ -z "$(awk "/pressEl\(b/ && prev !~ /refuse\(/ { print FNR } { prev = \$0 }" "$JS")" ] && [ "$(grep -c "p.frontmost = true" "$JS")" -eq 1 ]'
check "ax-button.js no longer turns wizard pages" '! grep -qE "stepHeld|setup\.checklist|setup\.window" "$JS"'
guard() {
  osascript -l JavaScript -e "eval(\$.NSString.stringWithContentsOfFileEncodingError('$JS', \$.NSUTF8StringEncoding, null).js); run = function () { return String($1); };" 2>/dev/null
}
held() { [ -n "$(guard "$1")" ]; }
check "the press holds on any other wording, on no wording, and on a disabled button" \
  '! held "pressHeld(\"x\", \"Set up this Mac\", \"Set up this Mac\", true)" && held "pressHeld(\"x\", \"Set up this Mac\", \"Continue\", true)" && held "pressHeld(\"x\", \"\", \"\", true)" && held "pressHeld(\"x\", \"Set up this Mac\", \"Set up this Mac\", false)"'
check "a wording is the title, else the description, else the attributed description" \
  '[ "$(guard "wordingOf(\"Join\", \"\", \"Continue\", \"button\")")" = Join ] && [ "$(guard "wordingOf(\"\", \"Back\", \"Continue\", \"button\")")" = Back ] && [ "$(guard "wordingOf(null, \"\", \"Continue\", \"button\")")" = Continue ]'
check "the role description never reads as a wording" \
  '[ -z "$(guard "wordingOf(\"\", \"button\", \"\", \"button\")")" ] && [ -z "$(guard "wordingOf(\"\", \"Taste\", \"\", \"Taste\")")" ] && [ "$(guard "wordingOf(\"\", \"button\", \"Continue\", \"button\")")" = Continue ]'
ax_button() { return 1; }

# Ids, rows and screens, read from a dump.
DUMP=$(printf '%s\n' setup.fast.connect setup.fast.row.forge.done setup.fast.row.claude.action setup.fast.row.claude.waiting \
  setup.fast.row.forge.token.field setup.fast.row.forge.token.action setup.fast.row.forge.token.action.link \
  setup.fast.row.slack.error setup.fast.row.slack.action "setup.fast.row.repos.place:github.com/acme/widgets.action.oneClick" \
  "setup.fast.row.repos.place:github.com/acme/widgets.status" setup.fast.row.linear.field.apiKey setup.fast.connect.primary)
check "ax_ids_have matches a whole identifier" \
  'ax_ids_have "$(printf "a.b\nc.d\n")" c.d && ! ax_ids_have "$(printf "a.b\nc.d\n")" c && ! ax_ids_have "" c.d'
check "ax_fast_row_ids reads each row once, dotted ids and parts included" \
  '[ "$(ax_fast_row_ids "$DUMP" | tr "\n" " ")" = "forge claude forge.token slack repos.place:github.com/acme/widgets linear " ]'
ax_fast_status() { [ "$1" = "repos.place:github.com/acme/widgets" ] && echo needs-you; }
check "a row reads done, waiting, error or todo from its children" \
  '[ "$(ax_fast_rows "$DUMP" | tr "\n" " ")" = "forge=done claude=waiting forge.token=todo slack=error repos.place:github.com/acme/widgets=todo linear=todo " ]'
ax_fast_status() { echo ready; }
check "a repo placement row reads done from its status value" '[ "$(ax_fast_row_state "$DUMP" "repos.place:github.com/acme/widgets")" = done ]'
check "ax_screen_in names the fast setup screen in a dump, and nothing without one" \
  '[ "$(ax_screen_in "$DUMP")" = connect ] && [ "$(ax_screen_in "$(printf "setup.fast.this-mac\nsetup.fast.this-mac.primary\n")")" = this-mac ] && ! ax_screen_in "settings.team.create" >/dev/null'
check "screen_remote_group reads the owner or group a repo URL sits under" \
  '[ "$(screen_remote_group https://github.com/acme/widgets.git)" = acme ] && [ "$(screen_remote_group https://gitlab.com/acme/platform/widgets.git)" = acme/platform ] && [ "$(screen_remote_group git@github.com:acme/widgets.git)" = acme ] && ! screen_remote_group https://github.com/widgets >/dev/null'

# The model of the setup window. State lives in files: the drivers read it
# inside $(...), and a screen moved there must still be moved afterwards.
M="$GUEST_RUN/model"; mkdir -p "$M"
note() { printf '%s\n' "$1" >> "$M/calls"; }
calls() { tr '\n' ' ' < "$M/calls"; }
count() { grep -c -- "$1" "$M/calls" || true; }
mget() { cat "$M/$1" 2>/dev/null || true; }
mset() { printf '%s' "$2" > "$M/$1"; }
# rows: "<screen> <id> <kind> <state>"; kind is action, field or place.
# A row id can sit on more than one screen (git, the token), so each helper
# works on the rows of the screen up now, or of the one named.
row_state() { awk -v sc="${2:-$(mget screen)}" -v id="$1" '$1 == sc && $2 == id { print $4 }' "$M/rows"; }
set_row() { awk -v sc="${3:-$(mget screen)}" -v id="$1" -v s="$2" '$1 == sc && $2 == id { $4 = s } { print }' "$M/rows" > "$M/rows.new"; mv "$M/rows.new" "$M/rows"; }
drop_row() { awk -v sc="$(mget screen)" -v id="$1" '!($1 == sc && $2 == id)' "$M/rows" > "$M/rows.new"; mv "$M/rows.new" "$M/rows"; }
screen_done() { ! awk -v sc="$1" '$1 == sc && $4 != "done" { found = 1 } END { exit !found }' "$M/rows"; }
# FDA_LIVE: the running app sees the Full Disk Access grant without a relaunch.
# HOST: what the admin's host answers (done, failed, manual, none).
# RUN_END: where the bar ends (ready or paused). ADMIN_IN_RUN: a dialog comes up on P6.
FDA_LIVE=0; CLT_SLOW=0; CLAUDE_AFTER=done; CLAUDE_LAG=0; HOST=done; HAND_AFTER=-1; RUN_END=ready; ADMIN_IN_RUN=0; STRAIGHT_IN=0
model() {  # <scenario>
  : > "$M/calls"; rm -f "$M"/claude "$M"/claude-lag "$M"/clt "$M"/dialog "$M"/looks "$M"/hand "$M"/admin-shown "$GUEST_RUN"/in/join-*
  mset screen macos; mset code ""
  cat > "$M/rows" <<ROWS
macos perm.fda action todo
macos perm.notifications action todo
macos mac.fancy-urls action todo
invite tool.clt action todo
invite forge.token field todo
create-team tool.clt action todo
create-team forge.token field todo
connect forge action done
connect claude claude install
connect fast-browser action done
this-mac repos.root action todo
this-mac repos.place:github.com/acme/widgets place todo
this-mac settings.backup segment done
ROWS
  SCENARIO="$1"
}
screen_ids() {
  local s r kind st
  s=$(mget screen)
  [ -n "$s" ] || return 0
  echo "setup.fast.$s"
  awk -v s="$s" '$1 == s { print $2, $3, $4 }' "$M/rows" | while read -r r kind st; do
    # A two-option choice draws only its segment, done or not.
    [ "$kind" = segment ] && { echo "setup.fast.row.$r.action"; continue; }
    if [ "$kind" = claude ]; then
      case "$st" in
        install|signin) echo "setup.fast.row.$r.action" ;;
        installing) echo "setup.fast.row.$r.waiting" ;;
        code) echo "setup.fast.row.$r.waiting"; echo "setup.fast.row.$r.field"; echo "setup.fast.row.$r.action" ;;
        done) echo "setup.fast.row.$r.done" ;;
      esac
      continue
    fi
    case "$st" in
      done) [ "$kind" = place ] && echo "setup.fast.row.$r.status" || echo "setup.fast.row.$r.done" ;;
      waiting) echo "setup.fast.row.$r.waiting"; echo "setup.fast.row.$r.action" ;;
      error) echo "setup.fast.row.$r.error"; echo "setup.fast.row.$r.action" ;;
      *) case "$kind" in
           field) echo "setup.fast.row.$r.field"; echo "setup.fast.row.$r.action" ;;
           place) echo "setup.fast.row.$r.status"; echo "setup.fast.row.$r.action.oneClick" ;;
           *) echo "setup.fast.row.$r.action" ;;
         esac ;;
    esac
  done
  case "$s" in
    invite) [ -n "$(mget code)" ] && echo setup.fast.invite.line; echo setup.fast.invite.code ;;
    paused) echo setup.fast.paused.secondary ;;
    path) printf 'setup.fast.path.card.%s\n' join create solo restore ;;
  esac
  case "$s" in macos|path) ;; *) echo "setup.fast.$s.primary" ;; esac
}
# The host answers the waiting request, and the bar moves, on every look.
world_turn() {
  local s; s=$(mget screen)
  if [ -e "$GUEST_RUN/in/join-waiting.req" ] && [ "$HOST" != none ]; then
    rm -f "$GUEST_RUN/in/join-waiting.req"; : > "$GUEST_RUN/in/join-approve.$HOST"
    [ "$HOST" = done ] && mset screen connect
  fi
  if [ "$s" = waiting ] && [ "$HOST" = manual ] && [ -e "$GUEST_RUN/in/join-approve.manual" ] && [ "$HAND_AFTER" -ge 0 ]; then
    mset hand $(($(mget hand || echo 0) + 1)); [ "$(mget hand)" -gt "$HAND_AFTER" ] && mset screen connect
  fi
  if [ "$s" = running ]; then
    mset looks $(($(mget looks || echo 0) + 1))
    if [ "$ADMIN_IN_RUN" = 1 ] && [ ! -e "$M/admin-shown" ]; then : > "$M/admin-shown"; : > "$M/dialog"; fi
    [ "$(mget looks)" -ge 3 ] && mset screen "$RUN_END"
  fi
  if [ "$s" = macos ] && screen_done macos; then mset screen path; fi
  # rt's read after the press lands a couple of looks later: the row still offers Install.
  if [ -e "$M/claude-lag" ]; then
    mset claude-lag $(($(mget claude-lag) + 1))
    [ "$(mget claude-lag)" -ge 2 ] && { rm -f "$M/claude-lag"; set_row claude installing connect; mset claude 0; }
  fi
  if [ -e "$M/claude" ]; then
    mset claude $(($(mget claude) + 1))
    [ "$(mget claude)" -ge 3 ] && { set_row claude "$CLAUDE_AFTER" connect; rm -f "$M/claude"; note claude-installed; }
  fi
  if [ -e "$M/clt" ]; then
    mset clt $(($(mget clt) + 1))
    [ "$(mget clt)" -ge 4 ] && { drop_row tool.clt; rm -f "$M/clt"; note clt-landed; }
  fi
  return 0
}
ax_dump_ids() { world_turn; screen_ids; }
ax_find_raw() {
  local r
  ax_ids_have "$(ax_dump_ids)" "$1" || return 1
  r="${1#setup.fast.row.}"; r="${r%.action}"
  if awk -v id="$r" '$2 == id && $3 == "segment" { found = 1 } END { exit !found }' "$M/rows"; then echo "radio group"; else echo button; fi
}
ax_fast_status() { if [ "$(row_state "$1")" = done ]; then echo ready; else echo needs-you; fi; }
ax_enabled() {
  local s; s=$(mget screen)
  case "$1" in
    "setup.fast.$s.primary") if screen_done "$s"; then echo true; else echo false; fi ;;
    *) return 1 ;;
  esac
}
ax_button() {
  if [ "$1" = read ] && [ "$2" = setup.fast.row.claude.action ]; then
    if [ "$(row_state claude connect)" = install ]; then echo Install; else echo "Sign in"; fi
    return 0
  fi
  [ "$1" = press ] || return 1
  [ "$2" = setup.fast.this-mac.primary ] && [ "$3" = "Set up this Mac" ] && [ "$(ax_enabled "$2")" = true ] || { note "held:$2"; return 1; }
  note "press:$2"; mset screen running
}
ax_click_raw() {
  local r
  ax_find_raw "$1" || return 1
  note "click:$1"
  case "$1" in
    setup.fast.row.perm.fda.action) ;;
    setup.fast.row.perm.notifications.action) set_row perm.notifications done ;;
    setup.fast.row.mac.fancy-urls.action) : > "$M/dialog"; set_row mac.fancy-urls waiting ;;
    setup.fast.row.tool.clt.action) if [ "$CLT_SLOW" = 1 ]; then set_row tool.clt waiting; mset clt 0; else drop_row tool.clt; fi ;;
    setup.fast.row.forge.token.action) set_row forge.token done ;;
    setup.fast.row.claude.action)
      if [ "$(row_state claude)" = install ]; then
        if [ "$CLAUDE_LAG" = 1 ]; then mset claude-lag 0; else set_row claude installing; mset claude 0; fi
      fi ;;
    setup.fast.row.repos.root.action) set_row repos.root done ;;
    setup.fast.row.*.action.oneClick) r="${1#setup.fast.row.}"; set_row "${r%.action.oneClick}" done ;;
    setup.fast.path.card.join) mset screen invite ;;
    setup.fast.path.card.create) mset screen create-team ;;
    setup.fast.path.card.solo) mset screen connect ;;
    setup.fast.invite.primary) if [ "$STRAIGHT_IN" = 1 ]; then mset screen connect; else mset screen waiting; fi ;;
    setup.fast.create-team.primary) mset screen connect ;;
    setup.fast.connect.primary) mset screen this-mac ;;
  esac
}
ax_set_field() { note "set:$1=$2"; [ "$1" = setup.fast.invite.code ] && mset code "$2"; return 0; }
ax_value() { case "$1" in setup.fast.invite.code) mget code ;; *) echo x ;; esac; }
ax_pick_segment() { note "pick:$1=$2"; }
ax_shot() { note "shot:$1"; }
ax_texts() { echo "Setup paused"; }
ax_wait_window() { :; }
ax_osa() { note osa; }
ax_allow_notifications() { note allow; }
ax_toggle_in_system_settings() { note toggle; [ "$FDA_LIVE" = 1 ] && set_row perm.fda done; return 0; }
relaunch_app() { note relaunch; set_row perm.fda done; mset screen macos; }
ax_admin_dialog_up() { [ -e "$M/dialog" ]; }
ax_wait_admin_dialog() { [ -e "$M/dialog" ]; }
ax_admin_cancel_once() { [ -e "$M/dialog" ] || return 1; rm -f "$M/dialog"; note cancel; set_row mac.fancy-urls error; }
ax_admin_auth_once() { [ -e "$M/dialog" ] || return 1; rm -f "$M/dialog"; note auth; [ "$(mget screen)" = macos ] && set_row mac.fancy-urls done; return 0; }
ax_admin_auth() { ax_admin_auth_once; }
sleep() { SECONDS=$((SECONDS + ${1%.*})); }
FORGE=github; SLUG=widgets; PAT=test-token; PAT_ENV=MATTSTACK_VMTEST_PAT
TEAM_REMOTE=https://github.com/acme/widgets.git
CODE_FILE="$GUEST_RUN/in/code.txt"; printf 'ABCD-EFGH\n' > "$CODE_FILE"
FB_EXTENSION_WAIT_S=30
# errexit as drive-setup.sh runs it: a subshell on the left of || would switch it off.
drive() { set +e; ( set -e; "$@" ) >"$GUEST_RUN/drive.out" 2>&1; rc=$?; set -e; }
whole_run() {
  screen_macos; screen_path
  case "$SCENARIO" in join) screen_invite; screen_waiting ;; create) screen_create_team ;; esac
  screen_connect; screen_this_mac; screen_running; screen_ready
}
screen_shots() { grep '^shot:[0-9][0-9]-[a-z-]*$' "$M/calls" | sed 's/^shot://' | tr '\n' ' '; }
presses() { grep -E '^(click|press):setup\.fast\.[a-z-]+\.(primary|card\.[a-z]+)$|^(click|press):setup\.fast\.path' "$M/calls" | sed -E 's/^(click|press):setup\.fast\.//' | tr '\n' ' '; }

model join; drive whole_run
check "join: every screen in drive order, one shot each" \
  '[ "$rc" -eq 0 ] && [ "$(screen_shots)" = "01-macos 02-path 03-invite 04-waiting 05-connect 06-this-mac 07-running 08-ready " ]'
check "join: the card, Join, Continue, Set up this Mac and Open the board, and nothing else of the footers" \
  '[ "$(presses)" = "path.card.join invite.primary connect.primary this-mac.primary ready.primary " ]'
check "join: the waiting screen asks the host once, and Hide is never pressed" \
  '[ -e "$GUEST_RUN/in/join-approve.done" ] && [ "$(count "waiting.primary")" -eq 0 ]'
check "join: git and the token are answered before Join" \
  'c=$(calls); case "$c" in *"click:setup.fast.row.tool.clt.action"*"set:setup.fast.row.forge.token.field=test-token"*"click:setup.fast.row.forge.token.action"*"click:setup.fast.invite.primary"*) true ;; *) false ;; esac'
check "join: the invite code is typed into its own field" '[ "$(count "^set:setup.fast.invite.code=ABCD-EFGH$")" -ge 1 ]'
check "join: Full Disk Access takes a relaunch, and P1 moves on by itself" \
  'c=$(calls); case "$c" in *"click:setup.fast.row.perm.fda.action toggle"*"relaunch"*"shot:01c-fda-relaunched"*"shot:02-path"*) true ;; *) false ;; esac'
check "join: Fancy URLs is cancelled once, then answered with credentials" \
  'c=$(calls); case "$c" in *"click:setup.fast.row.mac.fancy-urls.action"*cancel*"click:setup.fast.row.mac.fancy-urls.action"*auth*) true ;; *) false ;; esac'
check "join: this Mac's folder and repo are answered before Set up this Mac" \
  'c=$(calls); case "$c" in *"click:setup.fast.row.repos.root.action"*"click:setup.fast.row.repos.place:github.com/acme/widgets.action.oneClick"*"press:setup.fast.this-mac.primary"*) true ;; *) false ;; esac'
check "join: the gate file reads open" '[ "$(cat "$GUEST_RUN/logs/finish-gate.txt")" = open ]'

model create; drive whole_run
check "create: every screen in drive order, one shot each" \
  '[ "$rc" -eq 0 ] && [ "$(screen_shots)" = "01-macos 02-path 03-create-team 05-connect 06-this-mac 07-running 08-ready " ]'
check "create: the name, the forge segment and the group from --team-remote, then Create team" \
  'c=$(calls); case "$c" in *"set:setup.fast.create-team.name=widgets"*"pick:setup.fast.create-team.forge=GitHub"*"set:setup.fast.create-team.group=acme"*"click:setup.fast.create-team.primary"*) true ;; *) false ;; esac'
FORGE=gitlab; TEAM_REMOTE=https://gitlab.com/acme/platform/widgets.git
model create; drive whole_run
check "create on GitLab: the GitLab segment and a nested group" \
  '[ "$rc" -eq 0 ] && [ "$(count "^pick:setup.fast.create-team.forge=GitLab$")" -eq 1 ] && [ "$(count "^set:setup.fast.create-team.group=acme/platform$")" -eq 1 ]'
FORGE=github; TEAM_REMOTE=https://github.com/acme/widgets.git

model solo; drive whole_run
check "solo: straight from the card to Connect" \
  '[ "$rc" -eq 0 ] && [ "$(screen_shots)" = "01-macos 02-path 05-connect 06-this-mac 07-running 08-ready " ] && [ "$(presses)" = "path.card.solo connect.primary this-mac.primary ready.primary " ]'

model restore; drive whole_run
check "restore: stops at the cards with its own code, pressing none" '[ "$rc" -eq 3 ] && [ "$(count "^click:setup.fast.path")" -eq 0 ]'

check "a two-option choice reads answered, and is never logged as a row with no answer" \
  '! grep -q "no answer for row settings.backup" "$AX_LOG"'

# Claude Code: Install, the spinner while it installs, then the sign-in.
model solo; drive whole_run
check "Claude: Install is pressed once, and its install is waited out" \
  'c=$(calls); case "$c" in *"click:setup.fast.row.claude.action"*claude-installed*"shot:claude-installed"*"click:setup.fast.connect.primary"*) true ;; *) false ;; esac'
CLAUDE_AFTER=code
model solo; CONNECT_WAIT_S=60; drive whole_run; CONNECT_WAIT_S=900
check "Claude waiting on its sign-in code: a finding, no install failure, and Connect runs out its own bound" \
  '[ "$rc" -ne 0 ] && [ "$(count "^click:setup.fast.row.claude.action$")" -eq 1 ] && grep -q "FINDING: Sign in to Claude waits on a browser sign-in" "$AX_LOG" && ! grep -q "Claude Code install did not finish" "$AX_LOG" && grep -q "setup.fast.connect.primary never enabled within 60s; rows: .*claude=todo" "$AX_LOG"'
CLAUDE_AFTER=signin
: > "$AX_LOG"
model solo; CONNECT_WAIT_S=60; drive whole_run; CONNECT_WAIT_S=900
check "Claude installed but signed out: Sign in is left for the operator, logged once" \
  '[ "$rc" -ne 0 ] && [ "$(count "^click:setup.fast.row.claude.action$")" -eq 1 ] && [ "$(grep -c "FINDING: Sign in to Claude" "$AX_LOG")" -eq 1 ]'
model solo; set_row claude signin connect; CONNECT_WAIT_S=60; drive whole_run; CONNECT_WAIT_S=900
check "Claude already installed: nothing is pressed on its row" '[ "$rc" -ne 0 ] && [ "$(count "click:setup.fast.row.claude")" -eq 0 ]'
CLAUDE_AFTER=done
CLAUDE_LAG=1
: > "$AX_LOG"
model solo; drive whole_run
check "Claude still offering Install just after the press is waited out as the install, not taken for the sign-in" \
  '[ "$rc" -eq 0 ] && [ "$(count "^click:setup.fast.row.claude.action$")" -eq 1 ] && ! grep -q "FINDING: Sign in to Claude" "$AX_LOG" && c=$(calls) && case "$c" in *claude-installed*"shot:claude-installed"*) true ;; *) false ;; esac'
CLAUDE_LAG=0

# Only a settings choice reads answered by its segment alone.
: > "$AX_LOG"
model solo; echo "this-mac repos.mode segment todo" >> "$M/rows"; drive whole_run
check "a segment that is not a settings choice is not taken as answered" \
  '[ "$rc" -ne 0 ] && [ "$(mget screen)" = this-mac ] && grep -q "this-mac: no answer for row repos.mode" "$AX_LOG" && ! grep -q "no answer for row settings.backup" "$AX_LOG"'

CLT_SLOW=1
model create; drive whole_run
check "a Command Line Tools install that takes a while is waited for before Create team" \
  'c=$(calls); [ "$rc" -eq 0 ] && case "$c" in *clt-landed*"shot:clt-installed"*"click:setup.fast.create-team.primary"*) true ;; *) false ;; esac'
CLT_SLOW=0

FDA_LIVE=1
model solo; drive whole_run
check "a Full Disk Access grant the app sees at once needs no relaunch" '[ "$rc" -eq 0 ] && [ "$(count "^relaunch$")" -eq 0 ]'
FDA_LIVE=0

model solo; set_row perm.fda done macos; set_row perm.notifications done macos; set_row mac.fancy-urls done macos
drive whole_run
check "a P1 already done goes straight on to the cards, driving none of its rows" \
  '[ "$rc" -eq 0 ] && [ "$(count "click:setup.fast.row.perm")" -eq 0 ] && [ "$(count "click:setup.fast.row.mac")" -eq 0 ] && [ "$(count "^shot:01-macos$")" -eq 0 ]'

# A required row the walkthrough has no answer for holds the button: the
# screen fails at its bound, naming the rows.
model solo; awk '$2 == "fast-browser" { $4 = "todo" } { print }' "$M/rows" > "$M/rows.new"; mv "$M/rows.new" "$M/rows"
CONNECT_WAIT_S=60; drive whole_run; CONNECT_WAIT_S=900
check "a row Continue waits on that never connects fails at Connect, naming the rows" \
  '[ "$rc" -ne 0 ] && [ "$(mget screen)" = connect ] && [ "$(count "connect.primary")" -eq 0 ] && grep -q "setup.fast.connect.primary never enabled within 60s; rows: .*fast-browser=todo" "$AX_LOG"'

model solo; echo "connect slack action todo" >> "$M/rows"
CONNECT_WAIT_S=60; drive whole_run; CONNECT_WAIT_S=900
check "a row with no answer is logged once and left" '[ "$rc" -ne 0 ] && [ "$(grep -c "connect: no answer for row slack" "$AX_LOG")" -eq 1 ]'

PAT=""
model join; drive whole_run
check "a token row with no token on the host fails before Join" \
  '[ "$rc" -ne 0 ] && [ "$(count "invite.primary")" -eq 0 ] && grep -q "forge.token asks for the forge token but" "$AX_LOG"'
model solo; echo "connect forge.token field todo" >> "$M/rows"; awk '!($2 == "forge.token" && $1 == "invite")' "$M/rows" > "$M/rows.new"; mv "$M/rows.new" "$M/rows"
drive screen_row_token forge.token
check "on solo a token row with no token is left" '[ "$rc" -eq 0 ] && [ "$(count "set:setup.fast.row.forge.token")" -eq 0 ]'
PAT=test-token

# The waiting screen and the host's answer.
HOST=failed
model join; drive whole_run
check "waiting: a host that could not approve fails the join, and Connect is never reached" \
  '[ "$rc" -ne 0 ] && [ "$(count "connect.primary")" -eq 0 ] && grep -q "the host could not approve the join" "$AX_LOG"'
HOST=manual; HAND_AFTER=5; JOIN_HAND_WAIT_S=600
model join; drive whole_run
check "waiting: with no mint HOME the screen waits for a hand approval, then goes on" \
  '[ "$rc" -eq 0 ] && grep -q "approve this join by hand" "$AX_LOG" && grep -q "rt team members sync, then rt team publish" "$AX_LOG"'
HAND_AFTER=-1; JOIN_HAND_WAIT_S=30
model join; drive whole_run
check "waiting: a hand approval that never comes fails within its bound" \
  '[ "$rc" -ne 0 ] && [ "$(count "connect.primary")" -eq 0 ] && grep -q "not approved by hand within 30s" "$AX_LOG"'
HOST=done; JOIN_HAND_WAIT_S=1800
STRAIGHT_IN=1
model join; drive whole_run
check "waiting: a join approved at once goes on, logged as a finding, with no request to the host" \
  '[ "$rc" -eq 0 ] && grep -q "FINDING: the join went straight to Connect" "$AX_LOG" && [ ! -e "$GUEST_RUN/in/join-approve.done" ]'
STRAIGHT_IN=0

# The running bar.
RUN_END=paused
model solo; drive whole_run
check "running: a paused run opens its log, then fails with nothing pressed after" \
  '[ "$rc" -ne 0 ] && [ "$(count "^click:setup.fast.paused.secondary$")" -eq 1 ] && [ "$(count "ready.primary")" -eq 0 ] && grep -q "FAIL: setup paused" "$AX_LOG"'
RUN_END=ready
ADMIN_IN_RUN=1
model solo; drive whole_run
check "running: an admin dialog on the bar is a finding, answered so the run ends" \
  '[ "$rc" -eq 0 ] && grep -q "FINDING: a macOS admin dialog came up on the running screen" "$AX_LOG"'
ADMIN_IN_RUN=0

model solo; set_row repos.root done this-mac; set_row "repos.place:github.com/acme/widgets" done this-mac; mset screen this-mac
ax_button() { note "held:$2"; return 1; }
drive screen_this_mac
check "Set up this Mac is never pressed when it does not read so" \
  '[ "$rc" -ne 0 ] && [ "$(mget screen)" = this-mac ] && grep -q "did not read Set up this Mac" "$AX_LOG"'

echo; [ "$fails" -eq 0 ] && echo "  all fast setup driver checks ok" || { echo "  $fails check(s) failed"; exit 1; }
