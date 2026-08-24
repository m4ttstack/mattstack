#!/bin/bash
# Tests for ci-attendant.sh (BOARD-10 lease helper). Run directly:
#   ./ci-attendant.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/ci-attendant.sh"
export MATTSTACK_ATTENDANTS_DIR="$(mktemp -d)"
trap 'rm -rf "$MATTSTACK_ATTENDANTS_DIR"' EXIT

MR="https://gitlab.com/acme/widgets/-/merge_requests/4821"
IID=4821
pass=0; fail=0
ok()   { pass=$((pass+1)); }
bad()  { fail=$((fail+1)); echo "FAIL: $1"; }

# 1. claim on empty dir succeeds, exit 0
"$SUT" claim "$MR" "$IID" --branch feat-9999-test >/dev/null && ok || bad "fresh claim should succeed"

# 2. lease file exists, filename matches the TS module's slug convention
LEASE="$MATTSTACK_ATTENDANTS_DIR/acme-widgets-4821.json"
[ -f "$LEASE" ] && ok || bad "lease file at TS-compatible path (got: $(ls "$MATTSTACK_ATTENDANTS_DIR"))"

# 3. status reports the fresh lease, exit 0
"$SUT" status "$MR" "$IID" | grep -q '"watch-ci"' && ok || bad "status should print holder watch-ci"

# 4. second claim by watch-ci (same holder) succeeds (re-claim/adopt)
"$SUT" claim "$MR" "$IID" >/dev/null && ok || bad "same-holder re-claim should succeed"

# 5. a fresh doctor-held lease blocks the claim with exit 3 and names the holder
cat > "$LEASE" <<EOF
{"mr":"$MR","holder":"doctor","startedAt":$(($(date +%s)*1000)),"heartbeatAt":$(($(date +%s)*1000)),"ttlSeconds":600}
EOF
out="$("$SUT" claim "$MR" "$IID" 2>&1)"; rc=$?
[ "$rc" -eq 3 ] && echo "$out" | grep -q doctor && ok || bad "doctor-held claim should exit 3 and name holder (rc=$rc out=$out)"

# 6. a STALE doctor lease is replaced by a new claim
cat > "$LEASE" <<EOF
{"mr":"$MR","holder":"doctor","startedAt":0,"heartbeatAt":0,"ttlSeconds":600}
EOF
"$SUT" claim "$MR" "$IID" >/dev/null && grep -q '"watch-ci"' "$LEASE" && ok || bad "stale lease should be replaced"

# 7. heartbeat advances heartbeatAt
hb1=$(jq .heartbeatAt "$LEASE"); sleep 1; "$SUT" heartbeat "$MR" "$IID"
hb2=$(jq .heartbeatAt "$LEASE")
[ "$hb2" -gt "$hb1" ] && ok || bad "heartbeat should advance heartbeatAt ($hb1 -> $hb2)"

# 8. heartbeat does not touch a doctor-held lease
cat > "$LEASE" <<EOF
{"mr":"$MR","holder":"doctor","startedAt":5,"heartbeatAt":5,"ttlSeconds":600}
EOF
"$SUT" heartbeat "$MR" "$IID"
[ "$(jq .heartbeatAt "$LEASE")" = "5" ] && ok || bad "heartbeat must not refresh a foreign lease"

# 9. release removes only a watch-ci lease
"$SUT" release "$MR" "$IID"; [ -f "$LEASE" ] && ok || bad "release must not remove a doctor lease"
cat > "$LEASE" <<EOF
{"mr":"$MR","holder":"watch-ci","startedAt":5,"heartbeatAt":$(($(date +%s)*1000)),"ttlSeconds":600}
EOF
"$SUT" release "$MR" "$IID"; [ ! -f "$LEASE" ] && ok || bad "release should remove own lease"

# 10. status on missing/stale lease: exit 1, prints none
"$SUT" status "$MR" "$IID" | grep -q none && ok || bad "status without lease should print none"

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
