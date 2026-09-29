#!/bin/bash
# Clean-room walkthrough: clone golden → install DMG → five screens → assert → Sparkle update → teardown.
set -uo pipefail
source "$(cd "$(dirname "$0")/.." && pwd)/lib/common.sh"

usage() { sed -n '2p' "$0"; cat <<'EOF'
usage: walkthrough.sh --ver <14|15|26> (--dmg <path> | --app <mattstack.app>)
         [--scenario create|join|headless|solo] [--team-slug vmtest] [--pat-env MATTSTACK_VMTEST_PAT]
         [--invite-code-file <p>] [--team-remote <url> (solo scenario: runs the team-upgrade phase)] [--forge github|gitlab] [--update-dir <dir>] [--update-version <v>]
         [--fresh-team-repo] [--mint-rt <rt>] [--decline-trust] [--no-quarantine] [--no-graphics] [--keep] [--dry-run] [--verify-golden]
         [--golden <name>]
--fresh-team-repo mints an empty team repo; with --scenario join the host also
scaffolds the team there and mints the invite (under a throwaway HOME, with the
bundle's rt or --mint-rt), so no --invite-code-file is needed.
EOF
exit 2; }

VER=""; DMG=""; APP=""; SCENARIO=create; SLUG=vmtest; PAT_ENV=MATTSTACK_VMTEST_PAT; CODE_FILE=""; FORGE=""
# The create card's pasted-URL path (a fresh guest has no gh identity yet): the throwaway
# org's team repo, same naming as run/team-setup.sh.
TEAM_REMOTE="${TEAM_REMOTE:-https://github.com/${MATTSTACK_VMTEST_ORG:-mattstack-vmtest}/${MATTSTACK_VMTEST_TEAM_REPO:-mattstack-vmtest-team}.git}"
UPD=""; UPDV=""; QUAR=1; GRAPHICS=1; KEEP=0; DRY=0; VERIFY_GOLDEN=0; FRESH_REPO=0; DECLINE_TRUST=0; GOLDEN_OVERRIDE=""; MINT_RT=""
while [ $# -gt 0 ]; do case "$1" in
  --ver) VER="$2"; shift 2;; --dmg) DMG="$2"; shift 2;; --app) APP="$2"; shift 2;;
  --scenario) SCENARIO="$2"; shift 2;; --team-slug) SLUG="$2"; shift 2;; --pat-env) PAT_ENV="$2"; shift 2;;
  --invite-code-file) CODE_FILE="$2"; shift 2;; --team-remote) TEAM_REMOTE="$2"; shift 2;; --forge) FORGE="$2"; shift 2;;
  --update-dir) UPD="$2"; shift 2;; --update-version) UPDV="$2"; shift 2;;
  --golden) GOLDEN_OVERRIDE="$2"; shift 2;;
  --fresh-team-repo) FRESH_REPO=1; shift;; --mint-rt) MINT_RT="$2"; shift 2;;
  --decline-trust) DECLINE_TRUST=1; shift;;
  --no-quarantine) QUAR=0; shift;; --no-graphics) GRAPHICS=0; shift;; --keep) KEEP=1; shift;; --dry-run) DRY=1; shift;;
  --verify-golden) VERIFY_GOLDEN=1; shift;; -h|--help) usage;; *) vm_warn "unknown arg $1"; usage;; esac; done
[ -n "$VER" ] || usage
[ -n "$DMG" ] || [ -n "$APP" ] || usage
# `rt team create` refuses a remote with commits, so a freshly minted repo is
# consumed by exactly one creator: the guest (create) or the host's mint (join).
case "$SCENARIO" in create|join) ;; *) [ "$FRESH_REPO" = 1 ] && { vm_warn "--fresh-team-repo only applies to --scenario create or join"; usage; };; esac
[ "$SCENARIO" = join ] && [ "$FRESH_REPO" = 1 ] && [ -n "$CODE_FILE" ] && { vm_warn "--invite-code-file and --fresh-team-repo both name the invite; pass one"; usage; }
# Declining is answered in the SecurityAgent dialog the wizard raises, and the
# headless recipe drives no dialogs at all.
[ "$DECLINE_TRUST" = 1 ] && [ "$SCENARIO" = headless ] && { vm_warn "--decline-trust needs a driven scenario, not headless"; usage; }

GOLDEN="${GOLDEN_OVERRIDE:-$(vm_golden_name "$VER")}"
vm_run_init "walk-$VER-$SCENARIO"
RUN_STARTED=$(date +%s)
vm_log "golden: $GOLDEN"
RUN_VM="mattstack-run-$VER-$(date +%H%M%S)-$$"
GUEST_RUN="/Volumes/My Shared Files/run"
GUEST_BIN="/Users/$VM_TESTER_USER/vmrun"
TART_PID=""; SHOT_PID=""; CLONED=0; MINT_HOME=""
APP_VERSION=""
FRESH_SLUG=""
# The longest passing screens phase on record ran 3353s, 23 minutes of it a
# CLT install, so screens gets the most room. Teardown's limit only bounds the
# guest log collection; the guest and repo are removed after it regardless.
: "${VM_PHASE_LIMIT_SCREENS:=5400}"
: "${VM_PHASE_LIMIT_TEAM_UPGRADE:=3600}"
: "${VM_PHASE_LIMIT_UPDATE:=1800}"
: "${VM_PHASE_LIMIT_TEARDOWN:=600}"
: "${VM_PHASE_LIMIT_INVITE:=600}"

cleanup() {
  trap 'vm_warn "teardown in progress; signal ignored"' INT TERM HUP
  vm_say_or_log "  ── cleanup"
  [ -n "$SHOT_PID" ] && kill "$SHOT_PID" 2>/dev/null
  mint_detach; drop_mint_home
  vm_phase_abandon "walkthrough exited mid-phase"
  if [ "$DRY" = 0 ]; then teardown; fi
  vm_render_report
  local f; f=$(vm_phases_failed)
  vm_log "done: $(grep -c '"status":"pass"' "$VM_RUN_DIR/phases.jsonl" || true) passed, $f failed, $(grep -c '"status":"skip"' "$VM_RUN_DIR/phases.jsonl" || true) skipped → $VM_RUN_DIR/report.md"
  exit "$([ "$f" -eq 0 ] && echo 0 || echo 1)"
}
trap cleanup EXIT
vm_trap_signals

# Ledgered as its own phase so the report says what, if anything, was left behind.
teardown() {
  vm_phase_begin teardown
  local status=pass notes="" repo
  if [ "$CLONED" = 1 ]; then collect_logs || true; fi
  if [ "$KEEP" = 1 ]; then
    [ "$CLONED" = 1 ] && vm_warn "keeping $RUN_VM running (--keep); stop with: tart stop $RUN_VM && tart delete $RUN_VM"
    notes="kept $RUN_VM${FRESH_SLUG:+ and $FRESH_SLUG} (--keep)"
  else
    if [ "$CLONED" = 1 ]; then
      tart stop "$RUN_VM" >>"$VM_RUN_DIR/logs/tart.log" 2>&1 || true
      [ -n "$TART_PID" ] && vm_reap "$TART_PID" 60
      tart delete "$RUN_VM" >>"$VM_RUN_DIR/logs/tart.log" 2>&1 || true
      if tart list 2>/dev/null | awk '{print $2}' | grep -cx "$RUN_VM" >/dev/null; then
        status=fail; notes="$RUN_VM is still listed by tart after delete"
      fi
    fi
    if [ -n "$FRESH_SLUG" ]; then
      repo=$(retire_fresh_repo) || status=fail
      notes="${notes:+$notes; }$repo"
    fi
  fi
  vm_phase_end teardown "$status" "$notes"
}

# The mint's HOME holds the throwaway team's age key; it never outlives the run.
drop_mint_home() {
  case "$MINT_HOME" in */vm-mint.*) rm -rf "$MINT_HOME";; esac
  MINT_HOME=""
}

# The rt that mints: --mint-rt, else the bundle under test (read from the
# DMG, which stays attached until mint_detach).
MINT_MOUNT=""; RT_FOR_MINT=""; MINT_REFUSAL=""
mint_resolve_rt() {
  if [ -n "$MINT_RT" ]; then RT_FOR_MINT="$MINT_RT"; return 0; fi
  if [ -n "$APP" ]; then
    # A dev bundle's rt runs the dev flavor, which is not what ships.
    if [ -e "$APP/Contents/Helpers/deck-pinned" ] \
      || [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null)" = com.mattstack.app.dev ]; then
      MINT_REFUSAL="$APP is a dev-flavor bundle; pass --mint-rt to mint with it"; return 1
    fi
    RT_FOR_MINT="$APP/Contents/MacOS/rt"; return 0
  fi
  MINT_MOUNT=$(mktemp -d "${TMPDIR:-/tmp}/vm-mint-dmg.XXXXXX")
  hdiutil attach "$DMG" -nobrowse -quiet -readonly -mountpoint "$MINT_MOUNT" >/dev/null 2>&1 \
    || { rmdir "$MINT_MOUNT"; MINT_MOUNT=""; MINT_REFUSAL="could not attach $DMG to read its rt; pass --mint-rt"; return 1; }
  RT_FOR_MINT="$MINT_MOUNT/mattstack.app/Contents/MacOS/rt"
}
mint_detach() {
  [ -n "$MINT_MOUNT" ] || return 0
  hdiutil detach "$MINT_MOUNT" -quiet >/dev/null 2>&1 || true
  rmdir "$MINT_MOUNT" 2>/dev/null || true
  MINT_MOUNT=""
}

# Deleting needs a token with delete rights, which the vmtest PAT may lack;
# archiving needs only the repo scope, so a run never leaves a live repo.
retire_fresh_repo() {
  local log="$VM_RUN_DIR/logs/teardown.log" token="${!PAT_ENV:-}"
  case "$FRESH_SLUG" in */mattstack-vmtest-team-*) ;; *) printf 'refused to delete %s: not a repo this run minted' "$FRESH_SLUG"; return 1 ;; esac
  if [ "$FORGE" = gitlab ]; then
    GITLAB_TOKEN="$token" glab repo delete "$FRESH_SLUG" --yes >>"$log" 2>&1 && { printf 'deleted %s' "$FRESH_SLUG"; return 0; }
    GITLAB_TOKEN="$token" glab api -X POST "projects/$(printf '%s' "$FRESH_SLUG" | sed 's|/|%2F|g')/archive" >>"$log" 2>&1 \
      && { printf '%s archived, not deleted (logs/teardown.log)' "$FRESH_SLUG"; return 0; }
  else
    GH_TOKEN="$token" gh repo delete "$FRESH_SLUG" --yes >>"$log" 2>&1 && { printf 'deleted %s' "$FRESH_SLUG"; return 0; }
    GH_TOKEN="$token" gh repo archive "$FRESH_SLUG" --yes >>"$log" 2>&1 \
      && { printf '%s archived, not deleted (logs/teardown.log)' "$FRESH_SLUG"; return 0; }
  fi
  printf 'could not delete or archive %s (logs/teardown.log)' "$FRESH_SLUG"
  return 1
}

collect_logs() {
  # Live-state snapshots first: an intermittent wedge (a held port, a zombie
  # process) is only attributable while the guest still runs; files survive,
  # process tables do not.
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" 'lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null' > "$VM_RUN_DIR/logs/guest-listeners.txt" 2>/dev/null || true
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" 'ps auxww 2>/dev/null' > "$VM_RUN_DIR/logs/guest-ps.txt" 2>/dev/null || true
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" 'tar -C "$HOME" -czf - .mattstack/rt/logs .mattstack/deck/logs Library/Logs/mattstack 2>/dev/null' > "$VM_RUN_DIR/logs/guest-home-logs.tgz" 2>/dev/null || true
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" 'log show --last 45m --predicate '"'"'process == "mattstack" OR process == "rt" OR subsystem CONTAINS "com.mattstack" OR process == "smd" OR process == "backgroundtaskmanagementd"'"'"' --style compact 2>/dev/null | tail -5000' > "$VM_RUN_DIR/logs/guest-unified.log" 2>/dev/null || true
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" 'launchctl print gui/$(id -u) 2>/dev/null | grep -iE "mattstack|com\.rt\." ' > "$VM_RUN_DIR/logs/guest-launchctl-grep.txt" 2>/dev/null || true
  # A dropped session shows the host nothing but silence; sshd's side of it is
  # only in the guest's log, and it may predate the last 45 minutes.
  vm_ssh_try "$VM_ADMIN_USER" "$RUN_VM" "log show --last $(( ($(date +%s) - RUN_STARTED) / 60 + 5 ))m --predicate 'process BEGINSWITH \"sshd\"' --style compact 2>/dev/null | tail -5000" > "$VM_RUN_DIR/logs/guest-sshd.log" 2>/dev/null || true
}

shot_watcher() {  # host loop: in/shot-<name>.req → screenshots/<name>.png
  while :; do
    for req in "$VM_RUN_DIR"/in/shot-*.req; do
      [ -e "$req" ] || continue
      name=$(basename "$req" .req); name=${name#shot-}
      "$VM_ROOT/run/host/capture.sh" "$RUN_VM" "$VM_RUN_DIR/screenshots/$name.png" >>"$VM_RUN_DIR/logs/capture.log" 2>&1 || true
      rm -f "$req"; : > "$VM_RUN_DIR/in/shot-$name.done"
    done
    sleep 0.5
  done
}

skip_if_dry() { [ "$DRY" = 1 ] && { vm_phase_end "$1" skip "dry-run"; return 0; }; return 1; }

# ── preflight ────────────────────────────────────────────────────────────────
vm_phase_begin preflight
if [ "$DRY" = 0 ]; then
  vm_require_cmd tart "brew install openai/tools/tart"
  tart list 2>/dev/null | awk '{print $2}' | grep -cx "$GOLDEN" >/dev/null || { vm_phase_end preflight fail "golden $GOLDEN missing — run golden/build-golden.sh $VER"; exit 1; }
  [ -f "$VM_SSH_KEY" ] || { vm_phase_end preflight fail "no ssh key at $VM_SSH_KEY (built by build-golden.sh)"; exit 1; }
fi
if [ -z "$DMG" ]; then
  DMG="$VM_RUN_DIR/in/mattstack.dmg"
  [ "$DRY" = 1 ] || "$VM_ROOT/run/make-dmg.sh" "$APP" "$DMG" || { vm_phase_end preflight fail "make-dmg failed"; exit 1; }
fi
[ "$DRY" = 1 ] || [ -f "$DMG" ] || { vm_phase_end preflight fail "no dmg at $DMG"; exit 1; }
if [ "$DRY" = 0 ]; then
  cp "$DMG" "$VM_RUN_DIR/in/mattstack.dmg" 2>/dev/null || true
  T=$(mktemp -d); hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$T/m" && APP_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$T/m/mattstack.app/Contents/Info.plist" 2>/dev/null); hdiutil detach "$T/m" -quiet 2>/dev/null; rm -rf "$T"
fi
if [ -n "$UPD" ]; then
  if [ ! -f "$UPD/appcast.xml" ] || ! ls "$UPD"/mattstack-*.zip >/dev/null 2>&1 || [ -z "$UPDV" ]; then
    vm_phase_end preflight fail "--update-dir needs appcast.xml + mattstack-<v>.zip and --update-version"; exit 1; fi
  if [ "$DRY" = 0 ]; then
    mkdir -p "$VM_RUN_DIR/in/update"; cp "$UPD"/appcast.xml "$UPD"/mattstack-*.zip "$VM_RUN_DIR/in/update/"
    bun build --compile "$VM_ROOT/run/helpers/appcast-server.ts" --outfile "$VM_RUN_DIR/in/update/appcast-server" >/dev/null 2>&1 || { vm_phase_end preflight fail "bun build --compile appcast-server failed"; exit 1; }
  fi
fi
[ "$SCENARIO" = join ] && [ "$FRESH_REPO" = 0 ] && [ ! -f "${CODE_FILE:-/nonexistent}" ] && { vm_phase_end preflight fail "join needs --invite-code-file or --fresh-team-repo"; exit 1; }
if [ "$FRESH_REPO" = 1 ] && [ "$DRY" = 0 ]; then
  [ -n "${!PAT_ENV:-}" ] || { vm_phase_end preflight fail "--fresh-team-repo needs \$$PAT_ENV set — an empty token can fall back to the operator's own stored forge credentials"; exit 1; }
  FRESH_NAME="mattstack-vmtest-team-$(date +%Y%m%d-%H%M%S)-$$"
  case "$FORGE" in
    gitlab)
      vm_require_cmd glab "brew install glab"
      FRESH_GROUP="${MATTSTACK_VMTEST_GITLAB_GROUP:-}"
      [ -n "$FRESH_GROUP" ] || { vm_phase_end preflight fail "--fresh-team-repo with --forge gitlab needs MATTSTACK_VMTEST_GITLAB_GROUP"; exit 1; }
      # Set before the create: a signal that lands during it must still delete the repo.
      FRESH_SLUG="$FRESH_GROUP/$FRESH_NAME"
      GITLAB_TOKEN="${!PAT_ENV}" glab repo create "$FRESH_NAME" --group "$FRESH_GROUP" --private >/dev/null 2>&1 \
        || { FRESH_SLUG=""; vm_phase_end preflight fail "glab repo create $FRESH_GROUP/$FRESH_NAME failed"; exit 1; }
      TEAM_REMOTE="https://gitlab.com/$FRESH_SLUG.git";;
    ""|github)
      vm_require_cmd gh "brew install gh"
      FRESH_ORG="${MATTSTACK_VMTEST_ORG:-mattstack-vmtest}"
      # Same throwaway-org guard as team-setup.sh reset: a repo is only minted in
      # an org that is visibly a vmtest org, or one the operator confirmed by name.
      case "$FRESH_ORG" in
        *vmtest*) ;;
        *) [ "${MATTSTACK_VMTEST_ORG_CONFIRM:-}" = "$FRESH_ORG" ] || { vm_phase_end preflight fail "org $FRESH_ORG lacks 'vmtest'; set MATTSTACK_VMTEST_ORG_CONFIRM=$FRESH_ORG to confirm"; exit 1; };;
      esac
      FRESH_SLUG="$FRESH_ORG/$FRESH_NAME"
      GH_TOKEN="${!PAT_ENV}" gh repo create "$FRESH_SLUG" --private >/dev/null 2>&1 \
        || { FRESH_SLUG=""; vm_phase_end preflight fail "gh repo create $FRESH_ORG/$FRESH_NAME failed"; exit 1; }
      TEAM_REMOTE="https://github.com/$FRESH_SLUG.git";;
    *)
      vm_phase_end preflight fail "--fresh-team-repo: unknown --forge '$FORGE' (github|gitlab)"; exit 1;;
  esac
  echo "$TEAM_REMOTE" > "$VM_RUN_DIR/in/team-repo.txt"
  vm_log "fresh team repo: $TEAM_REMOTE"
fi
if [ "$SCENARIO" != headless ] && [ -z "${!PAT_ENV:-}" ]; then vm_warn "\$$PAT_ENV empty — the forge account row cannot be connected; the screens phase will fail there if the app shows it"; fi
if [ "$SCENARIO" = solo ] && [ -n "$TEAM_REMOTE" ] && [ -z "${!PAT_ENV:-}" ]; then vm_warn "\$$PAT_ENV empty; the team-upgrade phase needs the token to connect the forge row"; fi
cp -R "$VM_ROOT/run/guest" "$VM_RUN_DIR/in/guest"; cp "$VM_ROOT/../../scripts/e2e-cleanroom.sh" "$VM_RUN_DIR/in/guest/" 2>/dev/null || true
# The headless recipe's check-bundle step parses deps.lock with bun; CI gets
# bun from setup-bun, but a clean-room guest has none, so the harness hands it
# over — at $HOME/.bun/bin, the path the recipe's PATH already searches.
if [ "$SCENARIO" = headless ]; then
  cp "$(command -v bun)" "$VM_RUN_DIR/in/guest/bun" || vm_die "headless needs bun on the host to stage into the guest"
fi
printf '{"ver":"%s","scenario":"%s","dmg":"%s","appVersion":"%s","updateVersion":"%s","quarantine":%s,"graphics":%s}\n' \
  "$VER" "$SCENARIO" "$DMG" "$APP_VERSION" "$UPDV" "$QUAR" "$GRAPHICS" > "$VM_RUN_DIR/in/params.json"
vm_phase_end preflight pass

# ── invite (join --fresh-team-repo) ─────────────────────────────────────────
if [ "$SCENARIO" = join ] && [ "$FRESH_REPO" = 1 ]; then
  vm_phase_begin invite
  if ! skip_if_dry invite; then
    CODE_FILE="$VM_RUN_DIR/mint/invite-code.txt"
    MINT_HOME=$(mktemp -d "${TMPDIR:-/tmp}/vm-mint.XXXXXX")
    if ! mint_resolve_rt; then
      vm_phase_end invite fail "$MINT_REFUSAL"; exit 1
    fi
    VM_MINT_TOKEN="${!PAT_ENV:-}" vm_guest_cmd bash "$VM_ROOT/run/host/mint-invite.sh" --rt "$RT_FOR_MINT" --home "$MINT_HOME" \
      --remote "$TEAM_REMOTE" --out "$CODE_FILE" --slug "$SLUG" ${FORGE:+--forge "$FORGE"} >>"$VM_RUN_DIR/logs/mint.log" 2>&1
    rc=$?
    mint_detach; drop_mint_home
    if [ "$rc" -eq 0 ] && [ -s "$CODE_FILE" ]; then vm_phase_end invite pass "team $SLUG scaffolded on $TEAM_REMOTE; invite minted on the host"
    else vm_phase_end invite fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/mint.log" "host mint failed: $(tail -1 "$VM_RUN_DIR/logs/mint.log" 2>/dev/null || echo 'see logs/mint.log')")"; exit 1; fi
  fi
fi
if [ "$DRY" = 1 ]; then
  vm_log "[dry-run] would: tart clone $GOLDEN $RUN_VM; tart run $RUN_VM --dir=run:$VM_RUN_DIR $([ $GRAPHICS = 0 ] && echo --no-graphics); wait ssh; stage; install; $([ $SCENARIO = headless ] && echo e2e-cleanroom || echo 'five screens'); assert; $([ -n "$UPD" ] && echo update || echo 'update(skip)'); teardown"
  for p in clone boot stage install launch screens assert update teardown; do vm_phase_begin $p; skip_if_dry $p; done
  exit 0
fi

# ── clone + boot ─────────────────────────────────────────────────────────────
vm_phase_begin clone
if tart clone "$GOLDEN" "$RUN_VM" >>"$VM_RUN_DIR/logs/tart.log" 2>&1; then CLONED=1; vm_phase_end clone pass
else vm_phase_end clone fail "tart clone failed (see logs/tart.log)"; exit 1; fi

vm_phase_begin boot
RUN_ARGS=(--no-audio "--dir=run:$VM_RUN_DIR"); [ "$GRAPHICS" = 0 ] && RUN_ARGS+=(--no-graphics)
# Its own process group: a terminal's Ctrl-C reaches the whole foreground
# group, and tart stops the guest on SIGINT, cutting teardown's log collection
# short and defeating --keep. Under --keep it also outlives the script, so it
# drops vm_trap_signals' saved fds.
set -m
tart run "$RUN_VM" "${RUN_ARGS[@]}" </dev/null >>"$VM_RUN_DIR/logs/tart.log" 2>&1 7>&- 8>&- &
TART_PID=$!
set +m
TRUSTED=1; vm_trust_key "$RUN_VM" || TRUSTED=0
if vm_wait_ssh "$VM_TESTER_USER" "$RUN_VM" 420; then
  [ "$GRAPHICS" = 1 ] && { shot_watcher & SHOT_PID=$!; }
  if [ "$VERIFY_GOLDEN" = 1 ]; then "$VM_ROOT/golden/verify-golden.sh" "$VER" "$RUN_VM" >>"$VM_RUN_DIR/logs/verify-golden.log" 2>&1 || { vm_phase_end boot fail "golden verification failed in the clone"; exit 1; }; fi
  # A frontmost Setup Assistant swallows the driver's keystrokes: fields stay empty and Continue never enables.
  vm_dismiss_setup_assistant "$RUN_VM"
  vm_phase_end boot pass
else vm_phase_end boot fail "ssh as tester never came up$([ "$TRUSTED" = 0 ] && echo "; the key re-trust step failed first, so this is auth, not boot")"; exit 1; fi

# ── stage ────────────────────────────────────────────────────────────────────
vm_phase_begin stage
vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "mkdir -p $GUEST_BIN && cp -R '$GUEST_RUN/in/guest/.' $GUEST_BIN/ && chmod +x $GUEST_BIN/*.sh && if [ -f $GUEST_BIN/bun ]; then mkdir -p \$HOME/.bun/bin && mv $GUEST_BIN/bun \$HOME/.bun/bin/bun && chmod +x \$HOME/.bun/bin/bun; fi && test -f '$GUEST_RUN/in/mattstack.dmg' && touch '$GUEST_RUN/logs/.write-probe' && rm -f '$GUEST_RUN/logs/.write-probe'"
rc=$?
if [ "$rc" -eq 0 ]; then vm_phase_end stage pass
else vm_phase_end stage fail "$(vm_fail_reason "$rc" "" "virtiofs share not readable/writable by tester in guest")"; exit 1; fi

# ── install (admin copies) + launch (tester) ─────────────────────────────────
vm_phase_begin install
QFLAG=--quarantine; [ "$QUAR" = 0 ] && QFLAG=--no-quarantine
vm_ssh_try "$VM_ADMIN_USER" "$RUN_VM" "GUEST_RUN='$GUEST_RUN' bash '$GUEST_RUN/in/guest/install-app.sh' copy '$GUEST_RUN/in/mattstack.dmg' $QFLAG" >>"$VM_RUN_DIR/logs/install.log" 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then vm_phase_end install pass
else vm_phase_end install fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/install.log" "copy failed (logs/install.log)")"; exit 1; fi

vm_phase_begin launch
# Prod builds honour MATTSTACK_APPCAST_URL only with --allow-appcast-override; the same env/arg is
# replayed by drive-setup.sh on any driver-initiated relaunch (DRIVER_LAUNCH_ARGS).
LAUNCH_ARGS=""; [ -n "$UPD" ] && LAUNCH_ARGS="--env MATTSTACK_APPCAST_URL=http://127.0.0.1:$VM_APPCAST_PORT/appcast.xml --arg --allow-appcast-override"
vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "GUEST_RUN='$GUEST_RUN' bash $GUEST_BIN/install-app.sh launch $LAUNCH_ARGS" >>"$VM_RUN_DIR/logs/install.log" 2>&1
rc=$?
SHOT00=""
if [ "$GRAPHICS" = 1 ]; then
  : > "$VM_RUN_DIR/in/shot-00-first-launch.req"
  t=0; while [ ! -e "$VM_RUN_DIR/in/shot-00-first-launch.done" ] && [ "$t" -lt 30 ]; do sleep 0.5; t=$((t+1)); done
  [ -e "$VM_RUN_DIR/screenshots/00-first-launch.png" ] && SHOT00=screenshots/00-first-launch.png
fi
case $rc in
  0) vm_phase_end launch pass "" ${SHOT00:+"$SHOT00"} ;;
  2) vm_phase_end launch fail "Gatekeeper blocked the app (unnotarised build? rerun with --no-quarantine)" ${SHOT00:+"$SHOT00"}; exit 1 ;;
  *) vm_phase_end launch fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/install.log" "app did not start (logs/install.log)")" ${SHOT00:+"$SHOT00"}; exit 1 ;;
esac

# ── screens / headless ───────────────────────────────────────────────────────
vm_phase_begin screens
if [ "$SCENARIO" = headless ]; then
  # The golden is gitless by design, so post-install blocks on tool.clt.
  # Drive the headless CLT install first, as admin — softwareupdate needs
  # an admin user; ~2 min, idempotent when CLT is already present.
  vm_ssh_try "$VM_ADMIN_USER" "$RUN_VM" "/Applications/mattstack.app/Contents/MacOS/rt tools install apple-clt" >>"$VM_RUN_DIR/logs/clt.log" 2>&1
  rc=$?
  [ "$rc" -eq 0 ] || { vm_phase_end screens fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/clt.log" "headless CLT install failed (logs/clt.log)")"; exit 1; }
  # Quit the app for the recipe: app-needs ride the app's own stdout pipe
  # when the app drives setup, so a standalone rt with the app RUNNING waits
  # on services.register until it times out — with the app absent the step
  # degrades and `rt daemon install` covers registration (CI's proven path).
  # Relaunched below before the assert phase, which expects the tray up.
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "osascript -e 'tell application \"mattstack\" to quit' 2>/dev/null; sleep 2; pkill -x mattstack 2>/dev/null; true" >>"$VM_RUN_DIR/logs/screens.log" 2>&1
  # An ssh session's login keychain is locked, unlike the GUI session a real
  # install runs in — home.init's age-key store needs it open.
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "security unlock-keychain -p '$VM_TESTER_PASS' ~/Library/Keychains/login.keychain-db && GUEST_RUN='$GUEST_RUN' bash $GUEST_BIN/e2e-cleanroom.sh --app /Applications/mattstack.app --allow-existing-install --artifacts-dir '$GUEST_RUN/logs/cleanroom'" >>"$VM_RUN_DIR/logs/screens.log" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then vm_phase_end screens pass "headless: scripts/e2e-cleanroom.sh in guest"
  else vm_phase_end screens fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/screens.log" "headless recipe failed (logs/screens.log)")"; fi
  # The assert phase expects the tray up; relaunch what the recipe quit.
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "open -a /Applications/mattstack.app; sleep 8" >>"$VM_RUN_DIR/logs/screens.log" 2>&1 || true
else
  CODE_ARG=""; [ -n "$CODE_FILE" ] && { cp "$CODE_FILE" "$VM_RUN_DIR/in/invite-code.txt"; CODE_ARG="--invite-code-file '$GUEST_RUN/in/invite-code.txt'"; }
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "GUEST_RUN='$GUEST_RUN' VM_ADMIN_USER='$VM_ADMIN_USER' VM_ADMIN_PASS='$VM_ADMIN_PASS' AX_TRUST_DECLINE='$DECLINE_TRUST' DRIVER_LAUNCH_ARGS='$LAUNCH_ARGS' $PAT_ENV='${!PAT_ENV:-}' TEAM_REMOTE='$TEAM_REMOTE' FORGE='$FORGE' bash $GUEST_BIN/drive-setup.sh $SCENARIO --team-slug $SLUG --pat-env $PAT_ENV $CODE_ARG" >>"$VM_RUN_DIR/logs/screens.log" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    vm_phase_end screens pass "" $(cd "$VM_RUN_DIR" && ls screenshots/0[1-5]-*.png 2>/dev/null)
  else
    # drive.log is written through the share, so it stays current after the
    # ssh channel that carries screens.log has gone quiet.
    vm_phase_end screens fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/drive.log" "$(tail -1 "$VM_RUN_DIR/logs/drive.log" 2>/dev/null || echo 'see logs/screens.log')")" $(cd "$VM_RUN_DIR" && ls screenshots/*.png 2>/dev/null)
  fi
fi

# ── assert ───────────────────────────────────────────────────────────────────
vm_phase_begin assert
HFLAG=""; [ "$SCENARIO" = headless ] && HFLAG=--headless
EXPECT_ARG=""; [ -n "$APP_VERSION" ] && EXPECT_ARG="--expect-version '$APP_VERSION'"
# The declined run asserts the untrusted state and then drives the trust verb's
# own dialogs, so this phase needs the admin credentials too.
UNTRUSTED_ARG=""; [ "$DECLINE_TRUST" = 1 ] && UNTRUSTED_ARG=--expect-untrusted
MODE_ARG=""; [ "$SCENARIO" = solo ] && MODE_ARG="--solo"
[ "$SCENARIO" = join ] && MODE_ARG="--join '$SLUG'"
vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "security unlock-keychain -p '$VM_TESTER_PASS' ~/Library/Keychains/login.keychain-db && GUEST_RUN='$GUEST_RUN' VM_ADMIN_USER='$VM_ADMIN_USER' VM_ADMIN_PASS='$VM_ADMIN_PASS' bash $GUEST_BIN/assert-installed.sh $EXPECT_ARG $HFLAG $UNTRUSTED_ARG $MODE_ARG" >"$VM_RUN_DIR/logs/assert.log" 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then
  vm_phase_end assert pass
else
  n=$(grep -c 'ASSERT FAIL' "$VM_RUN_DIR/logs/assert.log")
  if [ "$n" -gt 0 ]; then reason="$n assertion(s) failed (logs/assert.log)"
  else reason="script exited $rc (logs/assert.log)"; fi
  vm_phase_end assert fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/assert.log" "$reason")"
fi

# ── team-upgrade ─────────────────────────────────────────────────────────────
vm_phase_begin team-upgrade
if [ "$SCENARIO" != solo ]; then
  vm_phase_end team-upgrade skip "scenario is $SCENARIO, not solo"
elif [ -z "$TEAM_REMOTE" ]; then
  vm_phase_end team-upgrade skip "no --team-remote given"
else
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "GUEST_RUN='$GUEST_RUN' VM_ADMIN_USER='$VM_ADMIN_USER' VM_ADMIN_PASS='$VM_ADMIN_PASS' AX_TRUST_DECLINE='$DECLINE_TRUST' DRIVER_LAUNCH_ARGS='$LAUNCH_ARGS' $PAT_ENV='${!PAT_ENV:-}' TEAM_REMOTE='$TEAM_REMOTE' FORGE='$FORGE' bash $GUEST_BIN/upgrade-to-team.sh --team-slug $SLUG --pat-env $PAT_ENV --team-remote '$TEAM_REMOTE' --forge '$FORGE'" >>"$VM_RUN_DIR/logs/upgrade.log" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    vm_phase_end team-upgrade pass
  else
    vm_phase_end team-upgrade fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/drive.log" "upgrade-to-team.sh failed (logs/upgrade.log)")"
  fi
fi

# ── update ───────────────────────────────────────────────────────────────────
vm_phase_begin update
if [ -z "$UPD" ]; then vm_phase_end update skip "no --update-dir (L4 artifacts + L3 MATTSTACK_APPCAST_URL hook required)"
elif [ "$(vm_phases_failed)" -gt 0 ]; then vm_phase_end update skip "earlier phase failed"
else
  UPD_HFLAG=""; [ "$SCENARIO" = headless ] && UPD_HFLAG=--headless
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "GUEST_RUN='$GUEST_RUN' VM_APPCAST_PORT='$VM_APPCAST_PORT' bash $GUEST_BIN/trigger-update.sh '$GUEST_RUN/in/update' '$UPDV' $UPD_HFLAG" >"$VM_RUN_DIR/logs/update.log" 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    vm_phase_end update pass "" $(cd "$VM_RUN_DIR" && ls screenshots/06-*.png 2>/dev/null)
  else
    n=$(grep -c 'ASSERT FAIL' "$VM_RUN_DIR/logs/update.log")
    if [ "$n" -gt 0 ]; then reason="$n assertion(s) failed (logs/update.log)"
    else reason="script exited $rc (logs/update.log)"; fi
    vm_phase_end update fail "$(vm_fail_reason "$rc" "$VM_RUN_DIR/logs/update.log" "$reason")" $(cd "$VM_RUN_DIR" && ls screenshots/06-*.png 2>/dev/null)
  fi
fi
