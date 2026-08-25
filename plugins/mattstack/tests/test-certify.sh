#!/bin/sh
# test-certify.sh -- matrix for tests/certify.sh. Run bare; never tail-pipe.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CERTIFY="$HERE/certify.sh"
FIX="$HERE/fixtures/certify"
CANONICAL="$HERE/../attachments/parameterized-skills/scripts/resolve-args.sh"
PASS=0; FAIL=0

WORK=$(mktemp -d "${TMPDIR:-/tmp}/certify-test.XXXXXX") || exit 2
trap 'rm -rf "$WORK"' EXIT

# Banned tokens, assembled so this file greps clean.
T_DOMAIN=$(printf '%s%s' 'ass' 'ured')
T_NAME=$(printf '%s%s' 'Ma' 'tt')

check() { # $1=name $2=want-exit $3=needle expected in output ('' = none)
  if [ "$STATUS" -ne "$2" ]; then
    echo "FAIL $1: exit $STATUS, wanted $2"; echo "  out: $OUT"; FAIL=$((FAIL+1)); return
  fi
  if [ -n "$3" ] && ! printf '%s' "$OUT" | grep -q "$3"; then
    echo "FAIL $1: output lacks '$3'"; echo "  out: $OUT"; FAIL=$((FAIL+1)); return
  fi
  echo "ok   $1"; PASS=$((PASS+1))
}

# clean fixture (committed) passes
OUT=$("$CERTIFY" "$FIX/clean"); STATUS=$?
check clean 0 'ok   purity-domain'

# domain-word fixture fails purity-domain
mkdir -p "$WORK/impure"
printf -- '---\nname: fake:impure\ndescription: "Use when testing the %s gate."\n---\nbody mentions %s here\n' "$T_DOMAIN" "$T_DOMAIN" > "$WORK/impure/SKILL.md"
OUT=$("$CERTIFY" "$WORK/impure"); STATUS=$?
check impure 1 'FAIL purity-domain'

# personal-name fixture fails purity-personal
mkdir -p "$WORK/personal"
printf -- '---\nname: fake:personal\ndescription: "Use when testing the personal gate."\n---\nask %s about it\n' "$T_NAME" > "$WORK/personal/SKILL.md"
OUT=$("$CERTIFY" "$WORK/personal"); STATUS=$?
check personal 1 'FAIL purity-personal'

# --domain mode skips purity but keeps structure checks
OUT=$("$CERTIFY" "$WORK/impure" --domain); STATUS=$?
check domain_mode 0 'ok   fm-name'

# slots + provides together fails depth-cap
mkdir -p "$WORK/bothdecl"
printf -- '---\nname: fake:bothdecl\ndescription: "Use when testing depth."\nmetadata:\n  slots: "x"\n  slot-x: "required a@1 -- x"\n  provides: "b@1"\n---\nbody\n' > "$WORK/bothdecl/SKILL.md"
OUT=$("$CERTIFY" "$WORK/bothdecl"); STATUS=$?
check depth_cap 1 'FAIL depth-cap'

# drifted vendored resolver fails vendored-resolver
mkdir -p "$WORK/drifted/scripts"
cp "$FIX/clean/SKILL.md" "$WORK/drifted/SKILL.md"
cp "$CANONICAL" "$WORK/drifted/scripts/resolve-args.sh"
printf '\n# drift\n' >> "$WORK/drifted/scripts/resolve-args.sh"
OUT=$("$CERTIFY" "$WORK/drifted"); STATUS=$?
check drifted 1 'FAIL vendored-resolver'

# em dash in body fails no-em-dashes
mkdir -p "$WORK/dash"
printf -- '---\nname: fake:dash\ndescription: "Use when testing dashes."\n---\nbad \342\200\224 dash\n' > "$WORK/dash/SKILL.md"
OUT=$("$CERTIFY" "$WORK/dash"); STATUS=$?
check em_dash 1 'FAIL no-em-dashes'

# runtime-native skill with placeholders fails no-placeholders-in-runtime-native
mkdir -p "$WORK/placeholder"
printf -- '---\nname: fake:placeholder\ndescription: "Use when testing placeholders."\nmetadata:\n  slots: "x"\n---\nbad {{slot:x}} placeholder\n' > "$WORK/placeholder/SKILL.md"
OUT=$("$CERTIFY" "$WORK/placeholder"); STATUS=$?
check placeholder 1 'FAIL no-placeholders-in-runtime-native'

# stage decl incomplete: stage without consumes/produces fails stage-decl
mkdir -p "$WORK/stagebad"
printf -- '---\nname: fake:stagebad\ndescription: "Use when testing stages."\nmetadata:\n  stage: "ship"\n---\nbody\n' > "$WORK/stagebad/SKILL.md"
OUT=$("$CERTIFY" "$WORK/stagebad"); STATUS=$?
check stage_decl 1 'FAIL stage-decl'

# description over 500 chars fails fm-description
mkdir -p "$WORK/longdesc"
LONG=$(printf 'Use when x. %.0s' $(seq 1 60))
printf -- '---\nname: fake:longdesc\ndescription: "%s"\n---\nbody\n' "$LONG" > "$WORK/longdesc/SKILL.md"
OUT=$("$CERTIFY" "$WORK/longdesc"); STATUS=$?
check long_desc 1 'FAIL fm-description'

# usage: missing arg exits 2
OUT=$("$CERTIFY" 2>&1); STATUS=$?
check usage 2 'usage'

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
