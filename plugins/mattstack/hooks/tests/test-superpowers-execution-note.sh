#!/usr/bin/env bash
# Offline test for superpowers-execution-note.sh: it names the execution mode
# superpowers.execution picks, only while superpowers@mattstack is installed
# and enabled, and falls back to Native with reviews when rt cannot answer.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$DIR/../superpowers-execution-note.sh"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
STUB_BIN="$SANDBOX/bin"
EMPTY_BIN="$SANDBOX/empty"
CFG="$SANDBOX/.claude"
mkdir -p "$STUB_BIN" "$EMPTY_BIN" "$CFG/plugins"

NWR="When a superpowers plan is ready to execute, use Native with reviews (superpowers:executing-plans, Native with reviews variant) without asking which execution approach; use subagent-driven instead when the user asks for it or the plan is long enough to compact mid-run."
SDD="When a superpowers plan is ready to execute, use subagent-driven (superpowers:subagent-driven-development) without asking which execution approach."
NATIVE="When a superpowers plan is ready to execute, use Native (superpowers:executing-plans) without asking which execution approach; use subagent-driven instead when the user asks for it or the plan is long enough to compact mid-run."

fails=0
check() { # name expected actual
  if [ "$3" = "$2" ]; then echo "ok   $1"
  else echo "FAIL $1"; echo "       want: $2"; echo "       got : $3"; fails=$((fails+1)); fi
}

stub_rt() { # mode | --fail
  if [ "$1" = "--fail" ]; then
    printf '#!/bin/sh\necho "rt broke" >&2\nexit 3\n' > "$STUB_BIN/rt"
  else
    printf '#!/bin/sh\necho "[needs you] rt is not set up yet" >&2\necho '"'"'{"ok":true,"key":"superpowers.execution","value":"%s","provenance":[{"scope":"default","file":null}]}'"'"'\n' "$1" > "$STUB_BIN/rt"
  fi
  chmod +x "$STUB_BIN/rt"
}

fork_state() { # installed(yes|no) enabled(true|false|absent)
  if [ "$1" = yes ]; then
    echo '{"version":2,"plugins":{"superpowers@mattstack":[{"scope":"user","version":"7.0.2-groups.1"}]}}' > "$CFG/plugins/installed_plugins.json"
  else
    echo '{"version":2,"plugins":{"superpowers@claude-plugins-official":[{"scope":"user","version":"5.0.0"}]}}' > "$CFG/plugins/installed_plugins.json"
  fi
  case "$2" in
    absent) echo '{"enabledPlugins":{"superpowers@claude-plugins-official":true}}' > "$CFG/settings.json" ;;
    *) echo '{"enabledPlugins":{"superpowers@mattstack":'"$2"'}}' > "$CFG/settings.json" ;;
  esac
}

run_hook() { # bin-dir
  echo '{"source":"startup"}' | env -i HOME="$SANDBOX" CLAUDE_CONFIG_DIR="$CFG" PATH="$1:/usr/bin:/bin" sh "$HOOK"
}

ctx_of() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["hookSpecificOutput"]["hookEventName"] + "|" + d["hookSpecificOutput"]["additionalContext"])' 2>/dev/null || echo "not-json: $1"; }

fork_state yes true
stub_rt native-with-reviews
out="$(run_hook "$STUB_BIN")"; code=$?
check "native-with-reviews: exits 0" "0" "$code"
check "native-with-reviews: names Native with reviews" "SessionStart|$NWR" "$(ctx_of "$out")"

stub_rt subagent-driven
check "subagent-driven: names subagent-driven, sentence ends after approach" "SessionStart|$SDD" "$(ctx_of "$(run_hook "$STUB_BIN")")"

stub_rt native
check "native: names Native" "SessionStart|$NATIVE" "$(ctx_of "$(run_hook "$STUB_BIN")")"

stub_rt ask
out="$(run_hook "$STUB_BIN")"; code=$?
check "ask: prints nothing" "" "$out"
check "ask: exits 0" "0" "$code"

stub_rt native-with-reviews
fork_state yes false
check "fork disabled: prints nothing" "" "$(run_hook "$STUB_BIN")"
fork_state yes absent
check "fork never enabled: prints nothing" "" "$(run_hook "$STUB_BIN")"
fork_state no true
check "fork not installed: prints nothing" "" "$(run_hook "$STUB_BIN")"
rm -f "$CFG/settings.json" "$CFG/plugins/installed_plugins.json"
out="$(run_hook "$STUB_BIN")"; code=$?
check "no plugin files: prints nothing" "" "$out"
check "no plugin files: exits 0" "0" "$code"

fork_state yes true
stub_rt --fail
check "rt fails: falls back to Native with reviews" "SessionStart|$NWR" "$(ctx_of "$(run_hook "$STUB_BIN")")"
check "rt absent: falls back to Native with reviews" "SessionStart|$NWR" "$(ctx_of "$(run_hook "$EMPTY_BIN")")"

[ "$fails" -eq 0 ] && echo "all superpowers-execution-note tests passed" || echo "$fails failure(s)"
exit $((fails > 0))
