#!/bin/bash
# Owner side of the join scenario, on the host: scaffold a team on an empty
# remote, push it, and mint an invite for the joiner, all under a throwaway
# HOME so nothing reads or writes the operator's own ~/.mattstack or keychain.
# Usage: mint-invite.sh --rt <rt binary> --home <empty vm-mint.* dir> --remote <url> --out <file>
#          [--slug vmtest] [--handle <forge user>] [--forge github|gitlab]
# The forge token comes from $VM_MINT_TOKEN, never argv. The code lands in
# --out (0600) and is never echoed.
set -uo pipefail
source "$(cd "$(dirname "$0")/../.." && pwd)/lib/common.sh"

RT_BIN=""; MINT_HOME=""; REMOTE=""; OUT=""; SLUG=vmtest; HANDLE=""; FORGE=""
while [ $# -gt 0 ]; do case "$1" in
  --rt) RT_BIN="$2"; shift 2;; --home) MINT_HOME="$2"; shift 2;; --remote) REMOTE="$2"; shift 2;;
  --out) OUT="$2"; shift 2;; --slug) SLUG="$2"; shift 2;; --handle) HANDLE="$2"; shift 2;; --forge) FORGE="$2"; shift 2;;
  *) vm_die "unknown arg $1";; esac; done
[ -n "$RT_BIN" ] && [ -n "$MINT_HOME" ] && [ -n "$REMOTE" ] && [ -n "$OUT" ] || { sed -n '5,6p' "$0" >&2; exit 2; }
[ -x "$RT_BIN" ] || vm_die "no executable rt at $RT_BIN"
vm_require_cmd jq
TOKEN="${VM_MINT_TOKEN:-}"
[ -n "$TOKEN" ] || vm_die "VM_MINT_TOKEN is empty: the push and the handle lookup need the forge token"
# The HOME every verb runs under must be one this harness made: a real HOME
# here would scaffold a team into the operator's own ~/.mattstack.
case "$MINT_HOME" in */vm-mint.*) ;; *) vm_die "refusing --home $MINT_HOME: not a vm-mint.* directory";; esac
[ -d "$MINT_HOME" ] || vm_die "no directory at $MINT_HOME"
[ -z "$(ls -A "$MINT_HOME")" ] || vm_die "refusing --home $MINT_HOME: not empty"
if [ -z "$FORGE" ]; then case "$REMOTE" in *gitlab*) FORGE=gitlab;; *) FORGE=github;; esac; fi

if [ -z "$HANDLE" ]; then
  case "$FORGE" in
    github) HANDLE=$(GH_TOKEN="$TOKEN" gh api user --jq .login 2>/dev/null);;
    gitlab) HANDLE=$(GITLAB_TOKEN="$TOKEN" glab api user 2>/dev/null | jq -r '.username // empty');;
    *) vm_die "unknown forge: $FORGE (want github|gitlab)";;
  esac
  [ -n "$HANDLE" ] || vm_die "could not read the token's $FORGE username; pass --handle"
fi

# rt's age key lives in the login keychain. This `security` answers only the
# two calls rt makes for it, from a file inside the throwaway HOME, and
# refuses everything else, so the real keychain is never consulted.
mkdir -p "$MINT_HOME/bin"
cat > "$MINT_HOME/bin/security" <<'SHIM'
#!/bin/bash
store="$HOME/.vm-keychain/mattstack-age-key"
verb="$1"; shift
service=""; key=""
while [ $# -gt 0 ]; do case "$1" in -s) service="${2:-}"; shift 2;; -w) key="${2:-}"; [ $# -ge 2 ] && shift 2 || shift;; *) shift;; esac; done
[ "$service" = mattstack-age-key ] || { echo "vm-mint security shim: refusing $verb for service '${service:-none}'" >&2; exit 44; }
case "$verb" in
  find-generic-password)
    [ -f "$store" ] || { echo "security: The specified item could not be found in the keychain." >&2; exit 44; }
    cat "$store";;
  add-generic-password)
    [ -n "$key" ] || exit 1
    mkdir -p "$(dirname "$store")"; (umask 077; printf '%s' "$key" > "$store");;
  *) echo "vm-mint security shim: refusing '$verb'" >&2; exit 1;;
esac
SHIM
chmod +x "$MINT_HOME/bin/security"

case "$FORGE" in gitlab) GIT_USER=oauth2;; *) GIT_USER=x-access-token;; esac
LOG="${VM_RUN_DIR:-$MINT_HOME}/logs/mint.log"; mkdir -p "$(dirname "$LOG")"

# env -i: nothing of the operator's environment reaches rt, git or gh. The
# credential helper reads the token from the environment, so it is never
# written into a git config file or an argv. The empty helper first clears
# every helper configured before it (an osxkeychain helper from an Xcode or
# system config would otherwise answer with the operator's own login).
mint_rt() {
  ( cd "$MINT_HOME" && env -i HOME="$MINT_HOME" USER="${USER:-vmtest}" LOGNAME="${USER:-vmtest}" TMPDIR="${TMPDIR:-/tmp}" \
      PATH="$MINT_HOME/bin:/usr/bin:/bin:/usr/sbin:/sbin" RT_BATCH=1 \
      GH_TOKEN="$TOKEN" GITLAB_TOKEN="$TOKEN" VM_MINT_TOKEN="$TOKEN" VM_MINT_GIT_USER="$GIT_USER" \
      GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_COUNT=4 \
      GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= \
      GIT_CONFIG_KEY_1=credential.helper \
      GIT_CONFIG_VALUE_1='!f() { echo "username=$VM_MINT_GIT_USER"; echo "password=$VM_MINT_TOKEN"; }; f' \
      GIT_CONFIG_KEY_2=user.name GIT_CONFIG_VALUE_2="mattstack vmtest owner" \
      GIT_CONFIG_KEY_3=user.email GIT_CONFIG_VALUE_3="vmtest-owner@mattstack.invalid" \
      "$RT_BIN" "$@" )
}

# The verb's last stdout line, its stderr and a redacted copy of that line in
# the log. The code, the link and the paste block all carry the invite.
step() {  # <label> <rt args...>
  local label="$1" out rc; shift
  printf '== rt %s\n' "$*" >> "$LOG"
  out=$(mint_rt "$@" 2>>"$LOG"); rc=$?
  out=$(printf '%s\n' "$out" | tail -1)
  printf '%s\n' "$out" | jq -c 'del(.code, .link, .pasteBlock)' >> "$LOG" 2>/dev/null || echo "(unparseable stdout)" >> "$LOG"
  [ "$rc" -eq 0 ] || vm_die "$label failed (exit $rc): $(printf '%s' "$out" | jq -r '.message // .error.message // empty' 2>/dev/null) (logs/mint.log)"
  printf '%s' "$out"
}

step "rt team create" team create "$SLUG" --remote "$REMOTE" --others --json >/dev/null
step "rt team publish" team publish --team "$SLUG" --json >/dev/null
INVITE=$(step "rt team invite" team invite --handle "$HANDLE" --team "$SLUG" --json) || exit 1
CODE=$(printf '%s' "$INVITE" | jq -r '.code // empty')
[ -n "$CODE" ] || vm_die "rt team invite returned no code (logs/mint.log)"
mkdir -p "$(dirname "$OUT")"
(umask 077; printf '%s\n' "$CODE" > "$OUT")
# The joiner's token is the owner's here, so a skipped grant still clones.
vm_log "invite minted for $HANDLE on $REMOTE (forge access: $(printf '%s' "$INVITE" | jq -r '.forgeAccess // "unreported"'))"
