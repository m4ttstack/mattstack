#!/bin/sh
# test-merge-manifests.sh -- fixture-world test matrix for merge-manifests.sh.
# Run bare from anywhere: plugin/tests/test-merge-manifests.sh
# Exit 0 = all cases pass. Never tail-pipe this gate.
# Every case builds its own fake HOME/MATTSTACK_HOME under mktemp -d and
# invokes the tool with those env vars -- never the real HOME/~/.mattstack.
set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TOOL="$HERE/../../attachments/parameterized-skills/scripts/merge-manifests.sh"

PASS=0
FAIL=0

CLEANUP=""
trap 'rm -rf $CLEANUP' EXIT

strip() { sed 's|^[[:space:]]*//.*$||' "$1"; }

ok()  { echo "ok   $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL $1: $2"; FAIL=$((FAIL + 1)); }

new_home() { # -> prints a fresh fake-home path, registers it for cleanup
  h=$(mktemp -d "${TMPDIR:-/tmp}/merge-manifests-test.XXXXXX") || exit 2
  CLEANUP="$CLEANUP $h"
  printf '%s' "$h"
}

mk_team_zone() { # $1=fake-home $2=team-slug $3=namespace $4=org $5=gitlabHost $6=projects-json-array $7=fragment-json
  zone="$1/.mattstack/teams/$2"
  mkdir -p "$zone/packs/$3/pack"
  cat > "$zone/mattstack.jsonc" <<EOF
{"role":"team","namespace":"$3","org":"$4"}
EOF
  cat > "$zone/team.jsonc" <<EOF
{"gitlabHost":"$5","projects":$6}
EOF
  printf '%s' "$7" > "$zone/packs/$3/pack/skills.jsonc"
}

mk_repo() { # $1=repo-dir $2=remote-url
  mkdir -p "$1"
  git init -q "$1"
  git -C "$1" remote add origin "$2"
}

run_tool() { # $1=fake-home $2=repo-dir; sets OUT and STATUS
  OUT=$(MATTSTACK_HOME="$1/.mattstack" HOME="$1" "$TOOL" --repo "$2" 2>&1)
  STATUS=$?
}

# --- case: single_fragment -- one fragment, one pipeline, two bindings ---
NAME=single_fragment
HOME1=$(new_home)
mk_team_zone "$HOME1" t1 acme acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"skills":{"enabled":["acme:foo"]},"pipelines":{"feature":["stage-a"]},"bindings":{"acme:wrapper":{"tiering":"acme:tiering","evidence":"acme:evidence"}}}'
REPO1="$HOME1/repo"
mk_repo "$REPO1" "https://gitlab.example.com/acme/widgets.git"
run_tool "$HOME1" "$REPO1"
OUT_FILE="$HOME1/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
REASON=""
[ "$STATUS" -eq 0 ] || REASON="exit $STATUS, wanted 0 ($OUT)"
[ -n "$REASON" ] || [ -f "$OUT_FILE" ] || REASON="no output file at $OUT_FILE"
if [ -z "$REASON" ] && ! strip "$OUT_FILE" | jq -e . > /dev/null 2>&1; then
  REASON="output is not valid JSONC after comment strip"
fi
if [ -z "$REASON" ] && ! strip "$OUT_FILE" | jq -e '
    .bindings["acme:wrapper"].tiering == "acme:tiering"
    and .bindings["acme:wrapper"].evidence == "acme:evidence"' > /dev/null 2>&1; then
  REASON="bindings mismatch"
fi
if [ -z "$REASON" ]; then
  TIER_PROV=$(grep -c 'acme:wrapper tiering <- ' "$OUT_FILE")
  EVID_PROV=$(grep -c 'acme:wrapper evidence <- ' "$OUT_FILE")
  [ "$TIER_PROV" -eq 1 ] && [ "$EVID_PROV" -eq 1 ] || REASON="provenance block missing a line per binding"
fi
if [ -z "$REASON" ]; then ok "$NAME"; else bad "$NAME" "$REASON"; fi

# --- case: two_fragments_compose -- two zones, disjoint binding keys ---
NAME=two_fragments_compose
HOME2=$(new_home)
mk_team_zone "$HOME2" t1 acme acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"bindings":{"acme:wrapper":{"tiering":"acme:tiering"}}}'
mk_team_zone "$HOME2" t2 beta acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"bindings":{"acme:wrapper":{"evidence":"beta:evidence"}}}'
REPO2="$HOME2/repo"
mk_repo "$REPO2" "https://gitlab.example.com/acme/widgets.git"
run_tool "$HOME2" "$REPO2"
OUT_FILE="$HOME2/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
REASON=""
[ "$STATUS" -eq 0 ] || REASON="exit $STATUS, wanted 0 ($OUT)"
if [ -z "$REASON" ] && ! strip "$OUT_FILE" | jq -e '
    .bindings["acme:wrapper"].tiering == "acme:tiering"
    and .bindings["acme:wrapper"].evidence == "beta:evidence"' > /dev/null 2>&1; then
  REASON="composed bindings mismatch"
fi
if [ -z "$REASON" ]; then
  grep -q 'acme:wrapper tiering <- acme@t1' "$OUT_FILE" || REASON="provenance missing acme@t1 for tiering"
fi
if [ -z "$REASON" ]; then
  grep -q 'acme:wrapper evidence <- beta@t2' "$OUT_FILE" || REASON="provenance missing beta@t2 for evidence"
fi
if [ -z "$REASON" ]; then ok "$NAME"; else bad "$NAME" "$REASON"; fi

# --- case: exclusive_conflict -- two zones bind the same key+slot differently ---
NAME=exclusive_conflict
HOME3=$(new_home)
mk_team_zone "$HOME3" t1 acme acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"bindings":{"acme:wrapper":{"tiering":"acme:tiering"}}}'
mk_team_zone "$HOME3" t2 beta acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"bindings":{"acme:wrapper":{"tiering":"beta:tiering"}}}'
REPO3="$HOME3/repo"
mk_repo "$REPO3" "https://gitlab.example.com/acme/widgets.git"
run_tool "$HOME3" "$REPO3"
OUT_FILE="$HOME3/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
REASON=""
[ "$STATUS" -eq 1 ] || REASON="exit $STATUS, wanted 1 ($OUT)"
if [ -z "$REASON" ]; then
  case "$OUT" in
    *acme:tiering*beta:tiering*|*beta:tiering*acme:tiering*) : ;;
    *) REASON="stderr does not name both values: $OUT" ;;
  esac
fi
if [ -z "$REASON" ]; then
  case "$OUT" in
    *acme@t1*beta@t2*|*beta@t2*acme@t1*) : ;;
    *) REASON="stderr does not name both sources: $OUT" ;;
  esac
fi
[ -n "$REASON" ] || [ ! -f "$OUT_FILE" ] || REASON="output file was written despite conflict"
if [ -z "$REASON" ]; then ok "$NAME"; else bad "$NAME" "$REASON"; fi

# --- case: override_wins -- user override rebinds a slot, no conflict raised ---
NAME=override_wins
HOME4=$(new_home)
mk_team_zone "$HOME4" t1 acme acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"bindings":{"acme:wrapper":{"tiering":"acme:tiering"}}}'
mkdir -p "$HOME4/.mattstack/user/skills"
cat > "$HOME4/.mattstack/user/skills/overrides.jsonc" <<'EOF'
{"bindings":{"acme:wrapper":{"tiering":"user:tiering"}}}
EOF
REPO4="$HOME4/repo"
mk_repo "$REPO4" "https://gitlab.example.com/acme/widgets.git"
run_tool "$HOME4" "$REPO4"
OUT_FILE="$HOME4/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
REASON=""
[ "$STATUS" -eq 0 ] || REASON="exit $STATUS, wanted 0 ($OUT)"
if [ -z "$REASON" ] && ! strip "$OUT_FILE" | jq -e '.bindings["acme:wrapper"].tiering == "user:tiering"' > /dev/null 2>&1; then
  REASON="merged value is not the override"
fi
if [ -z "$REASON" ]; then
  grep -q 'acme:wrapper tiering <- user-override' "$OUT_FILE" || REASON="provenance does not say user-override"
fi
case "$OUT" in *"binding conflicts"*) REASON="${REASON:-override incorrectly raised a conflict}" ;; esac
if [ -z "$REASON" ]; then ok "$NAME"; else bad "$NAME" "$REASON"; fi

# --- case: undeclared_repo -- remote points at a project no team.jsonc lists ---
NAME=undeclared_repo
HOME5=$(new_home)
mk_team_zone "$HOME5" t1 acme acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"skills":{"enabled":["acme:foo"]}}'
REPO5="$HOME5/repo"
mk_repo "$REPO5" "https://gitlab.example.com/acme/other.git"
run_tool "$HOME5" "$REPO5"
REASON=""
[ "$STATUS" -eq 2 ] || REASON="exit $STATUS, wanted 2 ($OUT)"
[ -n "$REASON" ] || [ ! -d "$HOME5/.mattstack/repos" ] || REASON="repos dir was created despite no declaring team"
if [ -z "$REASON" ]; then ok "$NAME"; else bad "$NAME" "$REASON"; fi

# --- case: ssh_https_same_slug -- ssh and https remotes normalize to one slug ---
NAME=ssh_https_same_slug
HOME6=$(new_home)
mk_team_zone "$HOME6" t1 acme acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"skills":{"enabled":["acme:foo"]}}'
REPO6A="$HOME6/repo-ssh"
mk_repo "$REPO6A" "git@gitlab.example.com:acme/widgets.git"
REPO6B="$HOME6/repo-https"
mk_repo "$REPO6B" "https://gitlab.example.com/acme/widgets"
run_tool "$HOME6" "$REPO6A"
STATUS_A=$STATUS
run_tool "$HOME6" "$REPO6B"
STATUS_B=$STATUS
OUT_FILE="$HOME6/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
REASON=""
[ "$STATUS_A" -eq 0 ] || REASON="ssh run: exit $STATUS_A, wanted 0"
[ -n "$REASON" ] || [ "$STATUS_B" -eq 0 ] || REASON="https run: exit $STATUS_B, wanted 0"
[ -n "$REASON" ] || [ -f "$OUT_FILE" ] || REASON="both runs did not converge on $OUT_FILE"
if [ -z "$REASON" ]; then ok "$NAME"; else bad "$NAME" "$REASON"; fi

# --- case: pipelines_merge_and_enabled_union -- disjoint pipeline keys, overlapping enabled ---
NAME=pipelines_merge_and_enabled_union
HOME7=$(new_home)
mk_team_zone "$HOME7" t1 acme acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"skills":{"enabled":["acme:a","shared:x"]},"pipelines":{"feature":["stage-a"]}}'
mk_team_zone "$HOME7" t2 beta acmeorg "https://gitlab.example.com" '["acme/widgets"]' \
  '{"skills":{"enabled":["beta:b","shared:x"]},"pipelines":{"bugfix":["stage-b"]}}'
REPO7="$HOME7/repo"
mk_repo "$REPO7" "https://gitlab.example.com/acme/widgets.git"
run_tool "$HOME7" "$REPO7"
OUT_FILE="$HOME7/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
REASON=""
[ "$STATUS" -eq 0 ] || REASON="exit $STATUS, wanted 0 ($OUT)"
if [ -z "$REASON" ] && ! strip "$OUT_FILE" | jq -e '
    .pipelines.feature == ["stage-a"] and .pipelines.bugfix == ["stage-b"]' > /dev/null 2>&1; then
  REASON="both pipeline keys are not present"
fi
if [ -z "$REASON" ] && ! strip "$OUT_FILE" | jq -e '
    (.skills.enabled | sort) == ["acme:a","beta:b","shared:x"]' > /dev/null 2>&1; then
  REASON="enabled list is not deduplicated"
fi
if [ -z "$REASON" ]; then ok "$NAME"; else bad "$NAME" "$REASON"; fi

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
