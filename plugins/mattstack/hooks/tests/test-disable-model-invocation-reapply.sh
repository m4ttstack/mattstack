#!/usr/bin/env bash
# Offline tests for disable-model-invocation-reapply.sh.
#
# `rt` is a stub that records its argv and cwd. HOME is sandboxed so the hook
# never reaches the real rt or the real settings stores.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../disable-model-invocation-reapply.sh"

SANDBOX="$(mktemp -d)"; trap 'rm -rf "$SANDBOX"' EXIT
SANDBOX="$(cd "$SANDBOX" && pwd -P)"
mkdir -p "$SANDBOX/bin" "$SANDBOX/home" "$SANDBOX/elsewhere"
CALLS="$SANDBOX/calls"
cat > "$SANDBOX/bin/rt" <<'STUB'
#!/usr/bin/env bash
{ echo "argv=$*"; echo "cwd=$(pwd -P)"; } >> "$RT_STUB_CALLS"
echo "stub stdout"
echo "stub stderr" >&2
exit "${RT_STUB_EXIT:-0}"
STUB
chmod +x "$SANDBOX/bin/rt"

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

run() { # path [stub exit] -> "exit=<code> out=<stdout+stderr>"
  local out code
  out="$(cd "$SANDBOX/elsewhere" && env -i HOME="$SANDBOX/home" PATH="$1" \
      RT_STUB_CALLS="$CALLS" RT_STUB_EXIT="${2:-0}" sh "$HOOK" </dev/null 2>&1)"
  code=$?
  printf 'exit=%s out=%s' "$code" "$out"
}

check "no rt on PATH: exits 0, prints nothing" "exit=0 out=" "$(run /usr/bin:/bin)"
check "no rt: nothing was called" "no" "$([ -f "$CALLS" ] && echo yes || echo no)"

check "rt exits 2: exits 0, prints nothing" "exit=0 out=" "$(run "$SANDBOX/bin:/usr/bin:/bin" 2)"
rm -f "$CALLS"

check "rt succeeds: prints nothing" "exit=0 out=" "$(run "$SANDBOX/bin:/usr/bin:/bin")"
check "rt gets exactly skills disable-model-invocation reapply" "argv=skills disable-model-invocation reapply" "$(sed -n 1p "$CALLS")"
check "rt runs with cwd HOME" "cwd=$SANDBOX/home" "$(sed -n 2p "$CALLS")"
check "rt is called once" "2" "$(wc -l < "$CALLS" | tr -d ' ')"
rm -f "$CALLS"

mkdir -p "$SANDBOX/home/.local/bin"
cp "$SANDBOX/bin/rt" "$SANDBOX/home/.local/bin/rt"
check "rt off PATH: falls back to ~/.local/bin/rt" "exit=0 out=" "$(run /usr/bin:/bin)"
check "fallback rt got the verb" "argv=skills disable-model-invocation reapply" "$(sed -n 1p "$CALLS")"

[ "$fails" -eq 0 ] && echo "all disable-model-invocation-reapply tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
