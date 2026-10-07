#!/usr/bin/env bash
# Offline tests for session-start.sh (SessionStart, matcher resume|compact|fork).
#
# Every case asserts stdout, stderr, and exit code together: a hook that
# leaks a diagnostic to stderr is as much a bug here as one that injects the
# wrong context.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../session-start.sh"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
mkdir -p "$SANDBOX/bin" "$SANDBOX/home/.mattstack/rt/chat/sessions"
SESSIONS_DIR="$SANDBOX/home/.mattstack/rt/chat/sessions"
ERRFILE="$SANDBOX/stderr"

# `rt` is stubbed on PATH: it records its arguments and prints to both streams,
# which the hook must never pass on.
cat > "$SANDBOX/bin/rt" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RT_STUB_CALLS"
echo "rt stdout"; echo "rt stderr" >&2
STUB
chmod +x "$SANDBOX/bin/rt"
export PATH="$SANDBOX/bin:$PATH"
export RT_STUB_CALLS="$SANDBOX/rt-calls"
: > "$RT_STUB_CALLS"

# Reads, then clears, the calls the stub recorded; the wait covers a slow stub write.
calls_after() {
  local want="$1" i
  for i in $(seq 1 40); do
    [ -n "$want" ] && [ "$(cat "$RT_STUB_CALLS")" = "$want" ] && break
    sleep 0.05
  done
  cat "$RT_STUB_CALLS"
  : > "$RT_STUB_CALLS"
}

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

# run PAYLOAD -- sets $out/$err/$rc from the hook's stdout/stderr/exit code
run() {
  out="$(printf '%s' "$1" | env HOME="$SANDBOX/home" "$HOOK" 2>"$ERRFILE")"
  rc=$?
  err="$(cat "$ERRFILE" 2>/dev/null)"
}

# ── no session file: silent ──────────────────────────────────────────────────
run '{"session_id":"never-signed-in","source":"resume"}'
check "no session file: no stdout" "" "$out"
check "no session file: no stderr" "" "$err"
check "no session file: exits 0" "0" "$rc"
check "no session file: rt never called" "" "$(calls_after "")"

# ── signed in, with a room: injects handle + room ───────────────────────────
echo '{"sessionId":"sess-a","handle":"rt-chat-wt-2","baseHandle":"rt-chat-wt","room":"repo-tools"}' \
  > "$SESSIONS_DIR/sess-a.json"
run '{"session_id":"sess-a","source":"resume"}'
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as rt-chat-wt-2 (room #repo-tools); chat messages arrive in your context automatically."}}'
check "signed in with room" "$want" "$out"
check "signed in with room: no stderr" "" "$err"
check "signed in with room: exits 0" "0" "$rc"
check "an unmarked session's resume makes no rt call" "" "$(calls_after "")"

# ── signed in, no room ───────────────────────────────────────────────────────
echo '{"sessionId":"sess-b","handle":"deck-main","baseHandle":"deck-main"}' \
  > "$SESSIONS_DIR/sess-b.json"
run '{"session_id":"sess-b","source":"fork"}'
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as deck-main; chat messages arrive in your context automatically."}}'
check "signed in without room" "$want" "$out"
check "signed in without room: no stderr" "" "$err"
check "signed in without room: exits 0" "0" "$rc"
check "a fork is not reported to rt" "" "$(calls_after "")"

# ── signed in with a display name: shows the name, never the id ─────────────
echo '{"sessionId":"sess-d","handle":"remy.k3f9","baseHandle":"remy","name":"remy","room":"repo-tools"}' \
  > "$SESSIONS_DIR/sess-d.json"
run '{"session_id":"sess-d","source":"resume"}'
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as remy (room #repo-tools); chat messages arrive in your context automatically."}}'
check "signed in with a name" "$want" "$out"
check "signed in with a name: no stderr" "" "$err"
check "signed in with a name: exits 0" "0" "$rc"
check "an unmarked session makes no rt call" "" "$(calls_after "")"

# ── a suffixed display name, no room ────────────────────────────────────────
echo '{"sessionId":"sess-e","handle":"remy.x9y8","baseHandle":"remy","name":"remy-2"}' \
  > "$SESSIONS_DIR/sess-e.json"
run '{"session_id":"sess-e","source":"compact"}'
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as remy-2; chat messages arrive in your context automatically."}}'
check "signed in with a suffixed name" "$want" "$out"
check "signed in with a suffixed name: no stderr" "" "$err"
check "signed in with a suffixed name: exits 0" "0" "$rc"
check "an unmarked session's compaction makes no rt call" "" "$(calls_after "")"

# ── a session file marked bound: the same output, and rt hears resume/compact ─
echo '{"sessionId":"sess-f","handle":"remy.k3f9","baseHandle":"remy","name":"remy","room":"repo-tools","bound":true}' \
  > "$SESSIONS_DIR/sess-f.json"
want='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as remy (room #repo-tools); chat messages arrive in your context automatically."}}'
run '{"session_id":"sess-f","source":"resume"}'
check "bound session: same reminder" "$want" "$out"
check "bound session: no stderr" "" "$err"
check "bound session: exits 0" "0" "$rc"
check "bound session: resume reported to rt, in the foreground" "chat lifecycle resume --session sess-f" "$(cat "$RT_STUB_CALLS")"
: > "$RT_STUB_CALLS"
run '{"session_id":"sess-f","source":"compact"}'
check "bound session: compaction reported to rt" "chat lifecycle compact --session sess-f" "$(cat "$RT_STUB_CALLS")"
: > "$RT_STUB_CALLS"
run '{"session_id":"sess-f","source":"fork"}'
check "bound session: same reminder on fork" "$want" "$out"
check "bound session: a fork is not reported" "" "$(calls_after "")"
echo '{"sessionId":"sess-g","handle":"deck-main","baseHandle":"deck-main","bound":true}' > "$SESSIONS_DIR/sess-g.json"
run '{"session_id":"sess-g","source":"resume"}'
check "bound session without room: same reminder" '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"rt chat: you are signed in as deck-main; chat messages arrive in your context automatically."}}' "$out"
check "bound session without room: reported" "chat lifecycle resume --session sess-g" "$(cat "$RT_STUB_CALLS")"
: > "$RT_STUB_CALLS"

# ── no session_id: silent ────────────────────────────────────────────────────
run '{"source":"resume"}'
check "no session_id: no stdout" "" "$out"
check "no session_id: no stderr" "" "$err"
check "no session_id: exits 0" "0" "$rc"

# ── malformed payload: silent, never crashes ─────────────────────────────────
run 'not json at all'
check "malformed payload: no stdout" "" "$out"
check "malformed payload: no stderr" "" "$err"
check "malformed payload: exits 0" "0" "$rc"

run ''
check "empty payload: no stdout" "" "$out"
check "empty payload: no stderr" "" "$err"
check "empty payload: exits 0" "0" "$rc"

# ── a session file whose own handle field is missing/invalid: silent ────────
echo '{"sessionId":"sess-c"}' > "$SESSIONS_DIR/sess-c.json"
run '{"session_id":"sess-c","source":"resume"}'
check "session file with no handle: no stdout" "" "$out"
check "session file with no handle: no stderr" "" "$err"
check "session file with no handle: exits 0" "0" "$rc"

[ "$fails" -eq 0 ] && echo "all session-start tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
