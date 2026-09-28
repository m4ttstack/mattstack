#!/bin/bash
# Shared helpers for rt-tray/vm scripts. Source, don't execute.
# bash 3.2 compatible (macOS stock /bin/bash): no associative arrays, no ${var,,}.

VM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${VM_ARTIFACTS:=$VM_ROOT/artifacts}"
: "${VM_CACHE:=$VM_ROOT/.cache}"
: "${VM_SSH_KEY:=$VM_CACHE/id_ed25519}"
: "${VM_ADMIN_USER:=admin}"
: "${VM_ADMIN_PASS:=admin}"
: "${VM_TESTER_USER:=tester}"
: "${VM_TESTER_PASS:=tester}"
: "${VM_APPCAST_PORT:=8765}"
# Seconds a phase may run before its guest commands are killed; a script raises
# its long phases with VM_PHASE_LIMIT_<PHASE> (dashes become underscores).
: "${VM_PHASE_LIMIT_DEFAULT:=1200}"

# Keepalives end a session whose peer vanished in about 30s. Without them a
# dropped connection leaves the host ssh waiting forever, since a quiet driver
# gives it nothing to fail a write on.
VM_SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5
  -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

vm_log()  { printf '  %s\n' "$*" >&2; }
vm_warn() { printf '  ! %s\n' "$*" >&2; }
vm_die()  { printf '  ✗ %s\n' "$*" >&2; exit 1; }
vm_now()  { date -u +%Y-%m-%dT%H:%M:%SZ; }

vm_require_cmd() {
  command -v "$1" >/dev/null 2>&1 || vm_die "missing command: $1${2:+ — $2}"
}

# vm_golden_name/vm_image_for take an optional flavour (default cleanroom); xcuitest
# is the Xcode-capable golden that verify-golden.sh's CLT/brew checks must not run against.
vm_golden_name() {
  local ver="$1" flavour="${2:-cleanroom}"
  case "$flavour" in
    cleanroom) printf 'mattstack-golden-%s' "$ver" ;;
    xcuitest)  printf 'mattstack-golden-%s-xcode' "$ver" ;;
    *)         vm_die "unknown golden flavour: $flavour (known: cleanroom xcuitest)" ;;
  esac
}

vm_image_for() {
  local ver="$1" flavour="${2:-cleanroom}" base
  case "$ver" in
    14) base='ghcr.io/cirruslabs/macos-sonoma' ;;
    15) base='ghcr.io/cirruslabs/macos-sequoia' ;;
    26) base='ghcr.io/cirruslabs/macos-tahoe' ;;
    *)  vm_die "no image mapping for macOS $ver (known: 14 15 26)" ;;
  esac
  case "$flavour" in
    cleanroom) printf '%s-vanilla:latest' "$base" ;;
    xcuitest)  printf '%s-xcode:latest' "$base" ;;
    *)         vm_die "unknown golden flavour: $flavour (known: cleanroom xcuitest)" ;;
  esac
}

# ── run directories + phase ledger ──────────────────────────────────────────

vm_run_init() {
  local label="$1"
  VM_RUN_ID="$(date +%Y%m%d-%H%M%S)-$label"
  VM_RUN_DIR="$VM_ARTIFACTS/$VM_RUN_ID"
  mkdir -p "$VM_RUN_DIR/screenshots" "$VM_RUN_DIR/logs" "$VM_RUN_DIR/in"
  # virtiofs maps host/guest uids numerically; admin and tester write into this
  # share from different guest uids, so it must be world-writable on the host.
  chmod -R a+rwX "$VM_RUN_DIR"
  printf '{\n  "id": "%s",\n  "label": "%s",\n  "startedAt": "%s",\n  "host": "%s"\n}\n' \
    "$VM_RUN_ID" "$label" "$(vm_now)" "$(sw_vers -productVersion 2>/dev/null || echo unknown)" > "$VM_RUN_DIR/run.json"
  export VM_RUN_ID VM_RUN_DIR
  vm_log "run $VM_RUN_ID → $VM_RUN_DIR"
}

_vm_phase_started=0
_vm_phase_name=""
_vm_phase_limit=0
_vm_phase_deadline=""
vm_phase_begin() {
  _vm_phase_started=$(date +%s)
  _vm_phase_name="$1"
  _vm_phase_limit=$(vm_phase_limit "$1")
  _vm_phase_deadline=$(( _vm_phase_started + _vm_phase_limit ))
  vm_log "── phase: $1"
}

vm_phase_limit() {
  local var; var="VM_PHASE_LIMIT_$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')"
  printf '%s' "${!var:-$VM_PHASE_LIMIT_DEFAULT}"
}

# vm_phase_end <name> <pass|fail|skip> [reason] [screenshot...]
vm_phase_end() {
  local name="$1" status="$2" reason="${3:-}"; shift 3 2>/dev/null || shift $#
  local shots="" s
  for s in "$@"; do shots="$shots${shots:+,}\"$s\""; done
  local secs=$(( $(date +%s) - _vm_phase_started ))
  local esc_reason; esc_reason=$(printf '%s' "$reason" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"phase":"%s","status":"%s","reason":"%s","at":"%s","seconds":%d,"screenshots":[%s]}\n' \
    "$name" "$status" "$esc_reason" "$(vm_now)" "$secs" "$shots" >> "$VM_RUN_DIR/phases.jsonl"
  _vm_phase_name=""; _vm_phase_deadline=""
  case "$status" in
    pass) vm_log "   ✓ $name" ;;
    skip) vm_warn "   – $name skipped: $reason" ;;
    fail) vm_warn "   ✗ $name FAILED: $reason" ;;
    *)    vm_die "vm_phase_end: bad status '$status'" ;;
  esac
}

vm_phases_failed() { grep -c '"status":"fail"' "$VM_RUN_DIR/phases.jsonl" 2>/dev/null || true; }

# Ledgers the open phase as failed; a run that dies mid-phase must not render a
# report that counts nothing failed.
vm_phase_abandon() {
  [ -n "$_vm_phase_name" ] || return 0
  vm_phase_end "$_vm_phase_name" fail "$1 after $(( $(date +%s) - _vm_phase_started ))s"
}

# The last lines of a log on one line, safe for the ledger's JSON and the
# report's table.
vm_log_tail() {
  tail -n "${2:-5}" "$1" 2>/dev/null | LC_ALL=C tr -d '\000-\010\013-\037' | tr '\t' ' ' | cut -c1-200 \
    | awk 'NR > 1 { printf " | " } { printf "%s", $0 }'
}

# vm_fail_reason <rc> <log> <reason>: the reason to ledger for a failed guest
# command. 124 (the phase ran out of time) and 255 (ssh itself failed, which
# includes a keepalive giving up) name the phase, the elapsed time and the
# log's last lines; any other status keeps the caller's own reason.
vm_fail_reason() {
  local rc="$1" log="$2" secs=$(( $(date +%s) - _vm_phase_started ))
  case "$rc" in
    124) printf '%s timed out after %ss (limit %ss)' "$_vm_phase_name" "$secs" "$_vm_phase_limit" ;;
    255) printf 'ssh to the guest failed or dropped after %ss in %s (exit 255)' "$secs" "$_vm_phase_name" ;;
    *)   printf '%s' "$3"; return 0 ;;
  esac
  if [ -s "$log" ]; then printf '; last lines of %s: %s' "${log#"$VM_RUN_DIR"/}" "$(vm_log_tail "$log")"; fi
  return 0
}

vm_render_report() {
  local f="$VM_RUN_DIR/phases.jsonl" out="$VM_RUN_DIR/report.md"
  local total pass fail skip
  total=$(wc -l < "$f" | tr -d ' '); pass=$(grep -c '"status":"pass"' "$f" || true)
  fail=$(grep -c '"status":"fail"' "$f" || true); skip=$(grep -c '"status":"skip"' "$f" || true)
  {
    echo "# clean-room run $VM_RUN_ID"
    echo
    echo "$total phases: $pass passed, $fail failed, $skip skipped."
    [ "$skip" -gt 0 ] && echo "**Skipped phases are not green** — see reasons below."
    echo
    echo "| phase | status | seconds | reason | screenshots |"
    echo "|---|---|---|---|---|"
    sed 's/|/\\|/g' "$f" \
      | sed -E 's/^\{"phase":"([^"]*)","status":"([^"]*)","reason":"((\\.|[^"\\])*)","at":"[^"]*","seconds":([0-9]+),"screenshots":\[([^]]*)\]\}$/| \1 | \2 | \5 | \3 | \6 |/' \
      | sed -E 's/\\"/"/g; s/\\\\/\\/g'
    echo
    echo "Logs: \`logs/\` · Screenshots: \`screenshots/\` · Ledger: \`phases.jsonl\`"
  } > "$out"
  vm_log "report → $out"
}

# ── tart / ssh ──────────────────────────────────────────────────────────────

vm_ip() {
  local vm="$1" tries="${2:-60}" ip=""
  while [ "$tries" -gt 0 ]; do
    ip=$(tart ip "$vm" 2>/dev/null </dev/null || true)
    [ -n "$ip" ] && { printf '%s' "$ip"; return 0; }
    sleep 2; tries=$((tries-1))
  done
  return 1
}

vm_tree_pids() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null || true); do vm_tree_pids "$c"; done
  printf '%s\n' "$1"
}

_vm_bounded_pid=""
# vm_bounded <seconds> <cmd...>: the command's status, or 124 once the limit
# passes (its whole process tree gets TERM, then KILL 5s on). The command runs
# in the background and is reaped with the wait builtin, because bash defers a
# trapped signal until a foreground child exits, which a hung ssh never does.
vm_bounded() {
  local limit="$1"; shift
  [ "$limit" -gt 0 ] 2>/dev/null || return 124
  local start pid dog rc=0
  start=$(date +%s)
  "$@" <&0 &
  pid=$!
  _vm_bounded_pid=$pid
  ( sleep "$limit"; pids=$(vm_tree_pids "$pid"); kill -TERM $pids || true; sleep 5; kill -KILL $pids || true ) </dev/null >/dev/null 2>&1 &
  dog=$!
  wait "$pid" 2>/dev/null || rc=$?
  while kill -0 "$pid" 2>/dev/null; do rc=0; wait "$pid" 2>/dev/null || rc=$?; done
  _vm_bounded_pid=""
  kill -TERM $(vm_tree_pids "$dog") 2>/dev/null || true
  wait "$dog" 2>/dev/null || true
  if [ "$rc" -ne 0 ] && [ $(( $(date +%s) - start )) -ge "$limit" ]; then return 124; fi
  return "$rc"
}

# Host-to-guest commands spend the open phase's remaining budget; between
# phases they run unbounded, as before.
vm_guest_cmd() {
  if [ -z "$_vm_phase_deadline" ]; then "$@"; return; fi
  vm_bounded "$(( _vm_phase_deadline - $(date +%s) ))" "$@"
}

# INT/TERM/HUP handler: stops the guest command in flight, ledgers the open
# phase, and exits so the caller's EXIT trap tears down.
vm_on_signal() {
  local sig="$1"
  vm_warn "caught SIG$sig; tearing down"
  if [ -n "$_vm_bounded_pid" ]; then kill -TERM $(vm_tree_pids "$_vm_bounded_pid") 2>/dev/null || true; fi
  vm_phase_abandon "interrupted by SIG$sig"
  case "$sig" in INT) exit 130 ;; HUP) exit 129 ;; *) exit 143 ;; esac
}

vm_trap_signals() {
  trap 'vm_on_signal INT' INT
  trap 'vm_on_signal TERM' TERM
  trap 'vm_on_signal HUP' HUP
}

# vm_reap <pid> <seconds>: waits for a background job, TERMs it past the limit.
vm_reap() {
  local n=0
  while kill -0 "$1" 2>/dev/null && [ "$n" -lt $(( $2 * 2 )) ]; do sleep 0.5; n=$((n+1)); done
  kill -TERM "$1" 2>/dev/null || true
  wait "$1" 2>/dev/null || true
}

vm_ssh_try() {
  local user="$1" vm="$2"; shift 2
  local ip; ip=$(vm_ip "$vm" 1) || return 1
  vm_guest_cmd ssh "${VM_SSH_OPTS[@]}" -i "$VM_SSH_KEY" "$user@$ip" "$@"
}

# vm_ssh/vm_scp/vm_ssh_pw exit the whole script on failure — preconditions only.
# Inside a wait loop or ledgered phase, use the _try variants: the dying variants
# make an until-loop impossible (the first no-lease boot kills the script).
vm_ssh() {
  vm_ssh_try "$@" || vm_die "ssh failed for $1@$2"
}

vm_scp() {
  local user="$1" vm="$2" src="$3" dest="$4"
  local ip; ip=$(vm_ip "$vm" 1) || vm_die "no ip for $vm"
  vm_guest_cmd scp -r "${VM_SSH_OPTS[@]}" -i "$VM_SSH_KEY" "$src" "$user@$ip:$dest"
}

# Guest → host copy; the mirror of vm_scp.
vm_scp_from() {
  local user="$1" vm="$2" src="$3" dest="$4"
  local ip; ip=$(vm_ip "$vm" 1) || vm_die "no ip for $vm"
  vm_guest_cmd scp "${VM_SSH_OPTS[@]}" -i "$VM_SSH_KEY" "$user@$ip:$src" "$dest"
}

vm_ssh_pw() {
  vm_require_cmd sshpass "brew install cirruslabs/cli/sshpass"
  vm_ssh_pw_try "$@" || vm_die "ssh failed for $1@$3"
}

# Password only, explicitly. Without these the client still offers every key
# in ~/.ssh and the agent first, and each refusal counts against the guest's
# MaxAuthTries (6 by default), so the password is never reached and the guest
# answers "Too many authentication failures". That reads as an unreachable or
# broken VM when the guest is perfectly healthy, and it depends on how many
# keys the HOST happens to have, so it fails on one machine and not another.
vm_ssh_pw_try() {
  local user="$1" pass="$2" vm="$3"; shift 3
  local ip; ip=$(vm_ip "$vm" 1) || return 1
  vm_guest_cmd sshpass -p "$pass" ssh "${VM_SSH_OPTS[@]}" \
    -o PubkeyAuthentication=no -o PreferredAuthentications=password -o IdentitiesOnly=yes \
    "$user@$ip" "$@"
}

# Re-trusts this host's key in a booted CLONE, so key auth can work at all.
#
# The tester key baked into a golden drifts from .cache whenever a rebuilt
# cache regenerates the pair, and goldens are never re-provisioned. The admin
# password is the same bootstrap credential build-golden used, so the clone
# can be told the current key. Goldens stay unbooted and immutable.
#
# Returns non-zero rather than dying, and the caller says so in its own
# failure detail: a silent best-effort here is what makes `vm_wait_ssh` time
# out afterwards and report "guest never answered ssh" for an auth problem,
# which is the misdiagnosis this whole function exists to remove.
vm_trust_key() {
  local vm="$1" pub="$VM_SSH_KEY.pub"
  # Asserted, not assumed. An unreadable or empty pub file writes an empty
  # authorized_keys, which fails later as a boot timeout: the same
  # misdiagnosis, produced by the cure.
  [ -s "$pub" ] || { vm_warn "no usable public key at $pub"; return 1; }
  vm_ip "$vm" 90 >/dev/null || return 1
  local key; key=$(cat "$pub")
  # Kept, not discarded: without it a wrong admin password and an unreachable
  # guest produce the same silent non-zero, and the message that would name
  # which one is the message this function exists to provide.
  local log="${VM_RUN_DIR:-}/logs/trust.log"
  [ -n "${VM_RUN_DIR:-}" ] || log=/dev/null
  local keyuser rc=0
  for keyuser in "$VM_TESTER_USER" "$VM_ADMIN_USER"; do
    printf '== trust %s @ %s\n' "$keyuser" "$(vm_now)" >>"$log" 2>/dev/null
    vm_ssh_pw_try "$VM_ADMIN_USER" "$VM_ADMIN_PASS" "$vm" \
      "sudo install -d -m 700 -o $keyuser -g staff /Users/$keyuser/.ssh && echo '$key' | sudo tee /Users/$keyuser/.ssh/authorized_keys >/dev/null && sudo chown $keyuser:staff /Users/$keyuser/.ssh/authorized_keys && sudo chmod 600 /Users/$keyuser/.ssh/authorized_keys" \
      >>"$log" 2>&1 || rc=1
  done
  return "$rc"
}

# What an on-screen dialog means for a first launch, from its wording:
#   block   Gatekeeper refused the app
#   prompt  the "downloaded from the Internet" confirmation a notarized app
#           is expected to raise on a machine that has never seen it
#   none    nothing on screen that bears on the launch
#
# Wording, not the owning process, because the two outcomes share an owner: a
# probe keyed on the owner cannot tell an expected prompt from a refusal, and
# would fail every correct run. Order matters... a refusal is decided before
# anything is clicked, so approving the prompt can never mask a block.
#
# Lifted here so the run script and its gate classify with the same code; two
# copies of the pattern list is a test that passes while the script drifts.
#
# The wording moved: older releases say "cannot be opened because the developer
# cannot be verified", macOS 15 and 26 say "Apple could not verify <app> is
# free of malware". A pattern list written from memory of the old phrasing
# matches neither of the two a current guest actually shows, which is why
# gatekeeper-check proves this list against a deliberately unsigned app in the
# same run rather than trusting it.
vm_dialog_verdict() {
  # macOS writes dialogs with typographic punctuation: U+2019 for apostrophes,
  # U+201C/U+201D for quotes. ASCII patterns silently miss them, and this one
  # missed the only dialog it was written for... "GatekeeperControl" is
  # damaged and can’t be opened" went unclassified over a single curly
  # apostrophe, while a unit test written in ASCII passed. Normalised first,
  # so every pattern below can stay in plain ASCII.
  local t
  t=$(printf '%s' "$1" | LC_ALL=en_US.UTF-8 sed "s/[‘’]/'/g; s/[“”]/\"/g")
  case "$t" in
    *"cannot be opened"*|*"can't be opened"*|*"damaged and"*|*"developer cannot be verified"*|*"could not verify"*|*"free of malware"*|*"will damage your computer"*|*"unidentified developer"*|*"Malware Blocked"*|*"contains malware"*)
      printf block; return ;;
  esac
  case "$t" in
    *"downloaded from the Internet"*) printf prompt; return ;;
  esac
  printf none
}

# A freshly created user meets Setup Assistant on first login: Apple Account
# sign-in, the licence text, the rest. It sits over the desktop, takes
# frontmost, and appears in every window dump, so a run that probes for
# dialogs reads it as noise at best and clicks into it at worst.
#
# Suppressed per-run rather than only in provisioning, because provisioning's
# version only reaches goldens built after it, and a golden is rebuilt about
# as often as never. Best effort throughout: a guest that never showed it is
# the normal case, and none of this is worth failing a run over.
vm_dismiss_setup_assistant() {
  local vm="$1" u="${2:-$VM_TESTER_USER}"
  vm_ssh_try "$u" "$vm" '
    for k in DidSeeCloudSetup DidSeeSiriSetup DidSeePrivacy DidSeeAppearanceSetup \
             DidSeeAccessibility DidSeeActivationLock DidSeeSyncSetup2; do
      defaults write com.apple.SetupAssistant "$k" -bool true 2>/dev/null
    done
    defaults write com.apple.SetupAssistant LastSeenCloudProductVersion -string "$(sw_vers -productVersion)" 2>/dev/null
    defaults write com.apple.SetupAssistant LastSeenBuddyBuildVersion -string "$(sw_vers -buildVersion)" 2>/dev/null
    killall "Setup Assistant" 2>/dev/null
    true' >/dev/null 2>&1 || true
}

vm_wait_ssh() {
  local user="$1" vm="$2" timeout="${3:-300}" start; start=$(date +%s)
  while :; do
    if vm_ssh_try "$user" "$vm" true 2>/dev/null; then return 0; fi
    [ $(( $(date +%s) - start )) -ge "$timeout" ] && return 1
    sleep 3
  done
}
