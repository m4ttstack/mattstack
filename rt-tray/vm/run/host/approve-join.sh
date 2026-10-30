#!/bin/bash
# Owner side of the join scenario's approval, on the host: under the HOME
# mint-invite.sh scaffolded the team in, add the joiner's age key as a team
# recipient and publish it, so the joiner's Join page reads approved.
# Usage: approve-join.sh --rt <rt binary> --home <vm-mint.* dir> --slug <slug>
#          [--key <the joiner's age1 public key>] [--forge github|gitlab]
# The forge token comes from $VM_MINT_TOKEN, never argv. Exits non-zero unless
# the joiner's key (every key the sync added, without --key) is in the clone's
# .sops.yaml afterwards.
set -uo pipefail
source "$(cd "$(dirname "$0")/../.." && pwd)/lib/common.sh"

RT_BIN=""; MINT_HOME=""; SLUG=""; KEY=""; FORGE=github
while [ $# -gt 0 ]; do case "$1" in
  --rt) RT_BIN="$2"; shift 2;; --home) MINT_HOME="$2"; shift 2;; --slug) SLUG="$2"; shift 2;;
  --key) KEY="$2"; shift 2;; --forge) FORGE="$2"; shift 2;;
  *) vm_die "unknown arg $1";; esac; done
[ -n "$RT_BIN" ] && [ -n "$MINT_HOME" ] && [ -n "$SLUG" ] || { sed -n '5,6p' "$0" >&2; exit 2; }
case "$MINT_HOME" in */vm-mint.*) ;; *) vm_die "refusing --home $MINT_HOME: not a vm-mint.* directory";; esac
[ -x "$MINT_HOME/bin/security" ] || vm_die "no security shim in $MINT_HOME: mint-invite.sh has not run there"
[ -x "$RT_BIN" ] || vm_die "no executable rt at $RT_BIN"
vm_require_cmd jq
TOKEN="${VM_MINT_TOKEN:-}"
[ -n "$TOKEN" ] || vm_die "VM_MINT_TOKEN is empty: the publish needs the forge token"
case "$FORGE" in gitlab) GIT_USER=oauth2;; github) GIT_USER=x-access-token;; *) vm_die "unknown forge: $FORGE (want github|gitlab)";; esac

SYNC=$(vm_mint_rt team members sync --team "$SLUG" --json | tail -1) || vm_die "rt team members sync failed: $SYNC"
vm_log "members sync: $(printf '%s' "$SYNC" | jq -c '{addedHandles, pending}' 2>/dev/null || echo "$SYNC")"
SOPS="$MINT_HOME/.mattstack/orgs/$SLUG/.sops.yaml"
[ -f "$SOPS" ] || vm_die "no .sops.yaml at $SOPS after members sync"

if [ -n "$KEY" ]; then
  WANT="$KEY"
else
  [ "$(printf '%s' "$SYNC" | jq '.addedHandles | length' 2>/dev/null)" -gt 0 ] 2>/dev/null \
    || vm_die "members sync added no joiner (pending: $(printf '%s' "$SYNC" | jq -c '.pending' 2>/dev/null))"
  WANT=$(printf '%s' "$SYNC" | jq -r '.added[]')
fi
for k in $WANT; do
  grep -qF "$k" "$SOPS" || vm_die "the joiner's key $k is not a recipient in $SOPS after members sync"
done

PUB=$(vm_mint_rt team publish --team "$SLUG" --json | tail -1) || vm_die "rt team publish failed: $PUB"
vm_log "join approved: the joiner's key is a recipient of $SLUG and published"
