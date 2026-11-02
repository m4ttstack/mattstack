#!/bin/sh
# SessionStart hook: restore the direct-only lines an outside plugin update
# removed, through `rt skills direct-only reapply`. Every path exits 0 and
# prints nothing, since hook stdout becomes session context; an rt too old for
# the verb exits 2 and is swallowed the same way.
set -u
: "${HOME:=}"

RT="$(command -v rt 2>/dev/null || true)"
[ -n "$RT" ] && [ -x "$RT" ] || RT="$HOME/.local/bin/rt"
[ -x "$RT" ] || exit 0

# A compiled rt autoloads a bunfig from its cwd.
cd "$HOME" 2>/dev/null || exit 0
"$RT" skills direct-only reapply >/dev/null 2>&1
exit 0
