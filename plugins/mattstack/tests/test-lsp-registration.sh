#!/bin/sh
# tests/test-lsp-registration.sh: .lsp.json registers `rt skills lsp` for the skill block files.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FILE="$HERE/../.lsp.json"
fail() { echo "FAIL lsp-registration: $1"; exit 1; }
[ -f "$FILE" ] || fail ".lsp.json is missing"
# One invalid entry makes Claude Code skip the whole file, and claude plugin validate does not read it.
command -v python3 >/dev/null 2>&1 || { echo "skip lsp-registration: no python3 on PATH"; exit 0; }
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$FILE" || fail ".lsp.json is not valid JSON"
python3 - "$FILE" <<'PY' || fail "an entry carries a key outside the documented set"
import json, sys
allowed = {"command", "extensionToLanguage", "args", "transport", "env", "initializationOptions", "settings",
           "workspaceFolder", "startupTimeout", "shutdownTimeout", "requestTimeout", "restartOnCrash",
           "maxRestarts", "diagnostics"}
for name, entry in json.load(open(sys.argv[1])).items():
    extra = set(entry) - allowed
    if extra:
        print(name, sorted(extra))
        sys.exit(1)
PY
want() { grep -q "$1" "$FILE" || fail "$2"; }
want '"command": *"rt"' 'command is not rt'
want '"args": *\[ *"skills", *"lsp" *\]' 'args are not ["skills", "lsp"]'
want '"\.md"' 'no .md extension'
want '"\.jsonc"' 'no .jsonc extension'
echo "ok   lsp-registration"
