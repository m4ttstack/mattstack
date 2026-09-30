#!/bin/sh
# test-merge-manifests-wrapper.sh -- offline cases for merge-manifests.sh,
# with a stub rt on PATH. Run bare from anywhere:
# plugin/tests/test-merge-manifests-wrapper.sh
# Exit 0 = all cases pass. Never tail-pipe this gate.
set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WRAPPER="$HERE/../../attachments/parameterized-skills/scripts/merge-manifests.sh"
BASH_BIN=$(command -v bash) || { echo "bash is required"; exit 2; }

PASS=0
FAIL=0

WORK=$(mktemp -d "${TMPDIR:-/tmp}/merge-wrapper-test.XXXXXX") || exit 2
trap 'rm -rf "$WORK"' EXIT
WORK=$(CDPATH= cd -- "$WORK" && pwd)
mkdir -p "$WORK/home" "$WORK/repo" "$WORK/other-home" "$WORK/empty-path"
REPO="$WORK/repo"

# The stub records one argv line per call. Under STUB_REENTER it calls the
# wrapper again the way an rt that ignores --dir would, capped so a missing
# guard shows up as a count rather than a hang.
mkdir -p "$WORK/stub-bin"
cat > "$WORK/stub-bin/rt" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$STUB_LOG"
if [ -n "${STUB_REENTER:-}" ]; then
  [ "$(wc -l < "$STUB_LOG")" -ge 5 ] && exit 0
  "$STUB_BASH" "$STUB_WRAPPER" --repo "$STUB_REPO"
  exit $?
fi
exit 0
STUB
chmod +x "$WORK/stub-bin/rt"

run() { # sets OUT and STATUS
  OUT=$("$@" 2>&1)
  STATUS=$?
}

check() { # $1=name $2=expected-exit $3=shell condition
  NAME=$1
  WANT=$2
  COND=$3
  if [ "$STATUS" -ne "$WANT" ]; then
    echo "FAIL $NAME: exit $STATUS, wanted $WANT"
    echo "  out: $OUT"
    FAIL=$((FAIL + 1))
    return
  fi
  if ! eval "$COND"; then
    echo "FAIL $NAME: condition failed: $COND"
    echo "  out: $OUT"
    FAIL=$((FAIL + 1))
    return
  fi
  echo "ok   $NAME"
  PASS=$((PASS + 1))
}

stub_env() {
  env -u MATTSTACK_HOME -u MATTSTACK_MERGE_WRAPPER -u STUB_REENTER \
    HOME="$WORK/home" PATH="$WORK/stub-bin:$PATH" STUB_LOG="$WORK/stub.log" \
    STUB_BASH="$BASH_BIN" STUB_WRAPPER="$WRAPPER" STUB_REPO="$REPO" "$@"
}

# --- case: passes-dir -- the wrapper hands rt the absolute checkout path ---
rm -f "$WORK/stub.log"
run stub_env "$BASH_BIN" "$WRAPPER" --repo "$REPO"
check passes_dir 0 '[ "$(cat "$WORK/stub.log")" = "skills materialize --dir $REPO" ]'

# --- case: reentry-refused -- an rt that re-runs the wrapper stops after one hop ---
rm -f "$WORK/stub.log"
run stub_env STUB_REENTER=1 "$BASH_BIN" "$WRAPPER" --repo "$REPO"
check reentry_refused 1 '
  printf "%s" "$OUT" | grep -q "re-entered the wrapper" &&
  [ "$(wc -l < "$WORK/stub.log" | tr -d " ")" = 1 ]'

# --- case: other-home -- a MATTSTACK_HOME outside $HOME/.mattstack is refused ---
rm -f "$WORK/stub.log"
run stub_env MATTSTACK_HOME="$WORK/other-home" "$BASH_BIN" "$WRAPPER" --repo "$REPO"
check other_home 1 '
  printf "%s" "$OUT" | grep -q "MATTSTACK_HOME is no longer honored" &&
  [ ! -e "$WORK/stub.log" ]'

# --- case: no-rt -- no rt on PATH exits 1 ---
run env -u MATTSTACK_HOME -u MATTSTACK_MERGE_WRAPPER HOME="$WORK/home" \
  PATH="$WORK/empty-path" "$BASH_BIN" "$WRAPPER" --repo "$REPO"
check no_rt 1 'printf "%s" "$OUT" | grep -q "rt is not on PATH"'

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
