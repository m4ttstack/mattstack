#!/bin/sh
# certify.sh -- certification gate for ONE skill directory.
# Usage: tests/certify.sh <skill-dir> [--domain]
#   --domain  domain-pack mode: skip the two purity greps (a domain pack is
#             allowed to be domain-specific); all structural checks still run.
# Exit 0 = certified. Exit 1 = at least one FAIL line. Exit 2 = usage.
# The written rule this enforces lives in CERTIFICATION.md at the repo root.
set -u

DIR=${1:-}
if [ -z "$DIR" ]; then echo "usage: certify.sh <skill-dir> [--domain]"; exit 2; fi
MODE=stack
[ "${2:-}" = "--domain" ] && MODE=domain
if [ ! -f "$DIR/SKILL.md" ]; then echo "FAIL skill-md: no SKILL.md in $DIR"; exit 1; fi

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CANONICAL="$HERE/../attachments/parameterized-skills/scripts/resolve-args.sh"
FAILED=0
ok()   { echo "ok   $1"; }
fail() { echo "FAIL $1: $2"; FAILED=1; }

# Banned-token patterns are assembled from fragments so this repo greps clean
# for its own banned words. Domain terms: the hardline rule. Personal terms:
# the "someone else could pick it up" rule.
A1=$(printf '%s%s' 'ass' 'ured')
A2=$(printf '%s%s' 'claim' 'view')
A3=$(printf '%s%s' 'cv-' '[0-9]')
A4=$(printf '%s%s' 'strong' 'dm')
A5=$(printf '%s%s' 'launch' 'darkly')
A6=$(printf '%s%s' 'parking' '-lot')
P1=$(printf '%s%s' 'Ma' 'tt')
P2=$(printf '%s%s' 'm4' 'tthew')
P3=$(printf '%s%s' '/Users/' 'matt')
P4=$(printf '%s%s' 'bouncer' '.mx')

if [ "$MODE" = stack ]; then
  HITS=$(grep -rniE "$A1|$A2|$A3|$A4|$A5|$A6" "$DIR" 2>/dev/null | grep -v '/\.git/' || true)
  if [ -z "$HITS" ]; then ok purity-domain; else fail purity-domain "$HITS"; fi
  HITS=$(grep -rnE "\\b$P1\\b|$P2|$P3|$P4" "$DIR" 2>/dev/null | grep -v '/\.git/' || true)
  if [ -z "$HITS" ]; then ok purity-personal; else fail purity-personal "$HITS"; fi
fi

EMDASH=$(printf '\342\200\224'); ENDASH=$(printf '\342\200\223')
HITS=$(grep -rn "$EMDASH\|$ENDASH" "$DIR" 2>/dev/null | grep -v '/\.git/' || true)
if [ -z "$HITS" ]; then ok no-em-dashes; else fail no-em-dashes "$HITS"; fi

if [ "$(sed -n 1p "$DIR/SKILL.md")" = "---" ]; then ok fm-open; else fail fm-open "line 1 of SKILL.md is not ---"; fi

fm_top() { # $1=key -> value from $DIR/SKILL.md frontmatter (single-line)
  awk -v key="$1" '
    NR == 1 { if ($0 == "---") { fm = 1; next } else exit }
    fm && $0 == "---" { exit }
    fm && index($0, key ":") == 1 {
      val = substr($0, length(key) + 2)
      sub(/^[[:space:]]*/, "", val); sub(/^"/, "", val); sub(/"$/, "", val)
      print val; exit
    }
  ' "$DIR/SKILL.md"
}
fm_meta() { # $1=key -> value under metadata:
  awk -v key="$1" '
    NR == 1 { if ($0 == "---") { fm = 1; next } else exit }
    fm && $0 == "---" { exit }
    fm && $0 == "metadata:" { meta = 1; next }
    meta && $0 !~ /^[[:space:]]/ { meta = 0 }
    meta {
      line = $0; sub(/^[[:space:]]+/, "", line)
      if (index(line, key ":") == 1) {
        val = substr(line, length(key) + 2)
        sub(/^[[:space:]]*/, "", val); sub(/^"/, "", val); sub(/"$/, "", val)
        print val; exit
      }
    }
  ' "$DIR/SKILL.md"
}

NAME=$(fm_top name)
if [ -n "$NAME" ]; then ok fm-name; else fail fm-name "no name: in frontmatter"; fi

# description: single-line or folded (>-); must exist and be <= 500 chars.
DESC=$(fm_top description)
case "$DESC" in '>-'|'>'|'|') DESC="" ;; esac  # folded marker, not content
if [ -z "$DESC" ]; then
  DESC=$(awk '
    NR == 1 { if ($0 == "---") { fm = 1; next } else exit }
    fm && $0 == "---" { exit }
    fm && $0 ~ /^description:[[:space:]]*>-?[[:space:]]*$/ { folded = 1; next }
    folded && $0 !~ /^[[:space:]]/ { folded = 0 }
    folded { sub(/^[[:space:]]+/, ""); printf "%s ", $0 }
  ' "$DIR/SKILL.md")
fi
DLEN=$(printf '%s' "$DESC" | wc -c | tr -d ' ')
if [ -z "$DESC" ]; then fail fm-description "no description: in frontmatter"
elif [ "$DLEN" -gt 500 ]; then fail fm-description "description is $DLEN chars (max 500)"
else ok fm-description; fi

fm_typed_slots() { # -> "1" when a non-empty top-level slots: block is declared
  awk '
    NR == 1 { if ($0 == "---") { fm = 1; next } else exit }
    fm && $0 == "---" { exit }
    fm && index($0, "slots:") == 1 {
      val = substr($0, 7); sub(/^[[:space:]]*/, "", val)
      if (val != "" && val !~ /^\{[[:space:]]*\}$/) { print "1"; exit }
      slots = 1; next
    }
    slots && $0 ~ /^[[:space:]]/ { print "1"; exit }
    slots { exit }
  ' "$DIR/SKILL.md"
}

SLOTS=$(fm_meta slots); PROVIDES=$(fm_meta provides)
[ -n "$SLOTS" ] || SLOTS=$(fm_typed_slots)
if [ -n "$SLOTS" ] && [ -n "$PROVIDES" ]; then
  fail depth-cap "declares both slots and metadata.provides (composition depth is capped at 1)"
else ok depth-cap; fi

if [ -f "$DIR/scripts/resolve-args.sh" ]; then
  if cmp -s "$CANONICAL" "$DIR/scripts/resolve-args.sh"; then ok vendored-resolver
  else fail vendored-resolver "scripts/resolve-args.sh drifted from the canonical copy"; fi
else ok vendored-resolver
fi

# A skill that resolves slots at run time (metadata.slots + resolve-args.sh)
# must never carry a compile-time placeholder: the two modes do not mix.
if grep -q '^  slots:' "$DIR/SKILL.md" 2>/dev/null && grep -q '{{' "$DIR/SKILL.md"; then
  fail no-placeholders-in-runtime-native "metadata.slots skill contains {{"
else
  ok no-placeholders-in-runtime-native
fi

STAGE=$(fm_meta stage)
if [ -n "$STAGE" ]; then
  SC=$(fm_meta stage-consumes); SP=$(fm_meta stage-produces)
  if [ -n "$SC" ] && [ -n "$SP" ]; then ok stage-decl
  else fail stage-decl "metadata.stage set but stage-consumes/stage-produces missing"; fi
else ok stage-decl
fi

# Informational only: a provides-bearing skill that stays model-visible is
# legal (independently useful); binding-only skills should disable.
DMI=$(fm_top disable-model-invocation)
if [ -n "$PROVIDES" ] && [ "$DMI" != "true" ]; then
  echo "note binding-visibility: provides declared with model invocation enabled; confirm this skill is independently useful"
fi

[ "$FAILED" -eq 0 ] || exit 1
exit 0
