#!/bin/sh
# SessionStart hook: restore the disable-model-invocation lines an outside plugin update
# removed and remove those the setting no longer names, through
# `rt skills disable-model-invocation reapply`. Every path exits 0 and
# prints nothing, since hook stdout becomes session context; an rt too old for
# the verb exits 2 and is swallowed the same way.
set -u
: "${HOME:=}"

RT="$(command -v rt 2>/dev/null || true)"
[ -n "$RT" ] && [ -x "$RT" ] || RT="$HOME/.local/bin/rt"
[ -x "$RT" ] || exit 0

# A compiled rt autoloads a bunfig from its cwd.
cd "$HOME" 2>/dev/null || exit 0
"$RT" skills disable-model-invocation reapply >/dev/null 2>&1
exit 0
