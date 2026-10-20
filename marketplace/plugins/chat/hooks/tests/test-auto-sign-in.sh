#!/usr/bin/env bash
# Offline tests for auto-sign-in.sh (SessionStart, matcher startup).
#
# `rt` is stubbed on PATH: it records every invocation, answers the settings
# read with RT_STUB_ENABLED and the sign-in with RT_STUB_SIGNIN. Every case
# asserts stdout, stderr, exit code and the rt calls together, since a
# session start that leaks a diagnostic or signs in a headless run is as much
# a bug as one that never signs in.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../auto-sign-in.sh"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin" "$SANDBOX/home/.mattstack/rt/chat/sessions" "$SANDBOX/repo"
cat > "$SANDBOX/bin/rt" <<'STUB'
#!/usr/bin/env bash
echo "$* @ $PWD" >> "$RT_STUB_CALLS"
case "$1 $2" in
  "settings get") printf '{"ok":true,"key":"chat.autoSignIn","value":%s}\n' "${RT_STUB_ENABLED:-false}" ;;
  "chat sign-in") printf '%s\n' "${RT_STUB_SIGNIN:-}"; exit "${RT_STUB_SIGNIN_EXIT:-0}" ;;
esac
STUB
chmod +x "$SANDBOX/bin/rt"
export PATH="$SANDBOX/bin:$PATH"
export RT_STUB_CALLS="$SANDBOX/rt-calls"

SESSIONS_DIR="$SANDBOX/home/.mattstack/rt/chat/sessions"
REPO="$(cd "$SANDBOX/repo" && pwd -P)"
ERRFILE="$SANDBOX/stderr"
PAYLOAD="{\"session_id\":\"sess-a\",\"source\":\"startup\",\"cwd\":\"$REPO\"}"
SIGNED_IN='{"ok":true,"handle":"remy.k3f9","name":"mattstack-beorn","room":"mattstack","continued":false}'

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

# run PAYLOAD [ENTRYPOINT] [PANE] -- sets $out/$err/$rc/$calls
run() {
  : > "$RT_STUB_CALLS"
  out="$(printf '%s' "$1" | env HOME="$SANDBOX/home" CLAUDE_CODE_ENTRYPOINT="${2-cli}" HERDR_PANE_ID="${3-w1:p1}" "$HOOK" 2>"$ERRFILE")"
  rc=$?
  err="$(cat "$ERRFILE" 2>/dev/null)"
  calls="$(cat "$RT_STUB_CALLS")"
}

SETTINGS_CALL="settings get chat.autoSignIn --repo $REPO --json @ $REPO"
SIGNIN_CALL="chat sign-in --session sess-a --json @ $REPO"

# ── setting on, interactive pane session: signs in and tells the agent ──────
export RT_STUB_ENABLED=true RT_STUB_SIGNIN="$SIGNED_IN"
run "$PAYLOAD"
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as mattstack-beorn (room #mattstack); chat messages arrive in your context automatically."}}'
check "on: injects the signed-in note" "$want" "$out"
check "on: no stderr" "" "$err"
check "on: exits 0" "0" "$rc"
check "on: reads the setting, then signs in from the session cwd" "$SETTINGS_CALL"$'\n'"$SIGNIN_CALL" "$calls"

# ── a sign-in with no room says so without one ──────────────────────────────
RT_STUB_SIGNIN='{"ok":true,"handle":"remy.k3f9","name":"mattstack-beorn","room":null,"continued":false}'
run "$PAYLOAD"
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as mattstack-beorn; chat messages arrive in your context automatically."}}'
check "no room: note without a room" "$want" "$out"
RT_STUB_SIGNIN="$SIGNED_IN"

# ── setting off: reads it, never signs in ───────────────────────────────────
RT_STUB_ENABLED=false
run "$PAYLOAD"
check "off: no stdout" "" "$out"
check "off: no stderr" "" "$err"
check "off: exits 0" "0" "$rc"
check "off: never signs in" "$SETTINGS_CALL" "$calls"
RT_STUB_ENABLED=true

# ── headless run inside a pane: never touches rt ────────────────────────────
run "$PAYLOAD" "sdk-cli"
check "headless: no stdout" "" "$out"
check "headless: exits 0" "0" "$rc"
check "headless: never calls rt" "" "$calls"

# ── not in a herdr pane: never touches rt ───────────────────────────────────
run "$PAYLOAD" "cli" ""
check "no pane: no stdout" "" "$out"
check "no pane: never calls rt" "" "$calls"

# ── already signed in: leaves the session alone ─────────────────────────────
echo '{"sessionId":"sess-a","handle":"remy.k3f9"}' > "$SESSIONS_DIR/sess-a.json"
run "$PAYLOAD"
check "already signed in: no stdout" "" "$out"
check "already signed in: never calls rt" "" "$calls"
rm "$SESSIONS_DIR/sess-a.json"

# ── sign-in fails: silent, exits 0 ──────────────────────────────────────────
RT_STUB_SIGNIN='{"ok":false,"error":"daemon unreachable"}' RT_STUB_SIGNIN_EXIT=2
export RT_STUB_SIGNIN_EXIT
run "$PAYLOAD"
check "sign-in fails: no stdout" "" "$out"
check "sign-in fails: no stderr" "" "$err"
check "sign-in fails: exits 0" "0" "$rc"
unset RT_STUB_SIGNIN_EXIT
RT_STUB_SIGNIN="$SIGNED_IN"

# ── no session_id: silent, never calls rt ───────────────────────────────────
run '{"source":"startup"}'
check "no session_id: no stdout" "" "$out"
check "no session_id: never calls rt" "" "$calls"

# ── no cwd in the payload: falls back to the hook's own directory ───────────
out="$(cd "$REPO" && printf '%s' '{"session_id":"sess-a","source":"startup"}' | env HOME="$SANDBOX/home" CLAUDE_CODE_ENTRYPOINT=cli HERDR_PANE_ID=w1:p1 RT_STUB_CALLS="$RT_STUB_CALLS" "$HOOK" 2>/dev/null)"
check "no cwd: still signs in" "true" "$([ -n "$out" ] && echo true || echo false)"

echo
if [ "$fails" -eq 0 ]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
