#!/bin/sh
# Exercises hooks/relocation-announce.sh with a PATH-stubbed rt: the hook
# must exit 0 and print nothing, forward the hook's stdin verbatim to
# `rt worktree announce-relocation`, stay silent and exit 0 when rt writes
# to both streams and fails, fall back to ~/.local/bin/rt when PATH has
# none, and still exit 0 with no rt anywhere.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/hooks/relocation-announce.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/noisy" "$TMP/home"
cat > "$TMP/bin/rt" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" > "$FAKE_ARGV"
cat > "$FAKE_STDIN"
FAKE
chmod +x "$TMP/bin/rt"

cat > "$TMP/noisy/rt" <<'FAKE'
#!/bin/sh
cat > /dev/null
echo "rt stdout noise"
echo "rt stderr noise" >&2
exit 1
FAKE
chmod +x "$TMP/noisy/rt"

PAYLOAD='{"hook_event_name":"PreToolUse","tool_name":"EnterWorktree","session_id":"sess-1","cwd":"/tmp/repo"}'

# `&& code=0 || code=$?` keeps set -e from aborting on a non-zero hook exit
# before the FAIL line can print.
out=$(printf '%s' "$PAYLOAD" | \
  PATH="$TMP/bin:$PATH" FAKE_ARGV="$TMP/argv" FAKE_STDIN="$TMP/stdin" \
  sh "$HOOK" 2>&1) && code=0 || code=$?
[ "$code" -eq 0 ] || { echo "FAIL: exit code $code"; exit 1; }
[ -z "$out" ] || { echo "FAIL: hook printed output: $out"; exit 1; }

argv="$(cat "$TMP/argv")"
[ "$argv" = "worktree announce-relocation" ] || {
  echo "FAIL: rt not called with worktree announce-relocation (got: $argv)"; exit 1;
}

stdin_seen="$(cat "$TMP/stdin")"
[ "$stdin_seen" = "$PAYLOAD" ] || {
  echo "FAIL: rt did not receive the hook stdin (got: $stdin_seen)"; exit 1;
}

out2=$(printf '%s' "$PAYLOAD" | PATH="$TMP/noisy:$PATH" sh "$HOOK" 2>&1) && code2=0 || code2=$?
[ "$code2" -eq 0 ] || { echo "FAIL: failing-rt case exit code $code2"; exit 1; }
[ -z "$out2" ] || { echo "FAIL: failing-rt case printed output: $out2"; exit 1; }

# No rt on PATH but one at ~/.local/bin/rt: the hook falls back to it.
mkdir -p "$TMP/fallhome/.local/bin"
cp "$TMP/bin/rt" "$TMP/fallhome/.local/bin/rt"
rm -f "$TMP/argv" "$TMP/stdin"
out4=$(printf '%s' "$PAYLOAD" | \
  PATH="/usr/bin:/bin" HOME="$TMP/fallhome" FAKE_ARGV="$TMP/argv" FAKE_STDIN="$TMP/stdin" \
  sh "$HOOK" 2>&1) && code4=0 || code4=$?
[ "$code4" -eq 0 ] || { echo "FAIL: fallback case exit code $code4"; exit 1; }
[ -z "$out4" ] || { echo "FAIL: fallback case printed output: $out4"; exit 1; }
[ -f "$TMP/argv" ] || { echo "FAIL: ~/.local/bin/rt fallback was not called"; exit 1; }
argv4="$(cat "$TMP/argv")"
[ "$argv4" = "worktree announce-relocation" ] || {
  echo "FAIL: fallback rt not called with worktree announce-relocation (got: $argv4)"; exit 1;
}
stdin4="$(cat "$TMP/stdin")"
[ "$stdin4" = "$PAYLOAD" ] || {
  echo "FAIL: fallback rt did not receive the hook stdin (got: $stdin4)"; exit 1;
}

# No rt on PATH and no ~/.local/bin/rt: the dialog falls to the human, not a
# blocked tool call.
out3=$(printf '%s' "$PAYLOAD" | PATH="/usr/bin:/bin" HOME="$TMP/home" sh "$HOOK" 2>&1) && code3=0 || code3=$?
[ "$code3" -eq 0 ] || { echo "FAIL: no-rt case exit code $code3"; exit 1; }
[ -z "$out3" ] || { echo "FAIL: no-rt case printed output: $out3"; exit 1; }

echo "ok"
