#!/bin/sh
# tests/test-lsp-registration.sh: .lsp.json registers `rt skills lsp` for the skill block files.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FILE="$HERE/../.lsp.json"
fail() { echo "FAIL lsp-registration: $1"; exit 1; }
[ -f "$FILE" ] || fail ".lsp.json is missing"
want() { grep -q "$1" "$FILE" || fail "$2"; }
want '"command": *"rt"' 'command is not rt'
want '"args": *\[ *"skills", *"lsp" *\]' 'args are not ["skills", "lsp"]'
want '"\.block\.md"' 'no .block.md extension'
want '"\.jsonc"' 'no .jsonc extension'
echo "ok   lsp-registration"
