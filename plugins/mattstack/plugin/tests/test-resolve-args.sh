#!/bin/sh
# test-resolve-args.sh -- model-free unit-test matrix for resolve-args.sh.
# Run bare from anywhere: plugin/tests/test-resolve-args.sh
# Exit 0 = all cases pass. Never tail-pipe this gate.
set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FIX="$HERE/fixtures"
CANONICAL="$HERE/../../attachments/parameterized-skills/scripts/resolve-args.sh"

PASS=0
FAIL=0

# Scratch area: a wrapper whose scripts/resolve-args.sh IS the canonical file.
WORK=$(mktemp -d "${TMPDIR:-/tmp}/resolve-args-test.XXXXXX") || exit 2
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/wrapper/scripts"
cp "$FIX/wrapper/SKILL.md" "$WORK/wrapper/SKILL.md"
cp "$CANONICAL" "$WORK/wrapper/scripts/resolve-args.sh"
chmod +x "$WORK/wrapper/scripts/resolve-args.sh"
RESOLVE="$WORK/wrapper/scripts/resolve-args.sh"

# Fake plugin inventory rendered from the template (paths are runtime-absolute).
sed "s|@FIXTURES@|$FIX|g" "$FIX/plugin-list.json.in" > "$WORK/plugin-list.json"
PLUGIN_LIST="cat $WORK/plugin-list.json"

run() { # $1 = manifest path; sets OUT and STATUS
  OUT=$("$RESOLVE" --manifest "$1" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
  STATUS=$?
}

check() { # $1=name $2=expected-exit $3=jq-assertion
  NAME=$1
  WANT=$2
  ASSERT=$3
  if [ "$STATUS" -ne "$WANT" ]; then
    echo "FAIL $NAME: exit $STATUS, wanted $WANT"
    echo "  out: $OUT"
    FAIL=$((FAIL + 1))
    return
  fi
  if ! printf '%s' "$OUT" | jq -e "$ASSERT" > /dev/null; then
    echo "FAIL $NAME: assertion failed: $ASSERT"
    echo "  out: $OUT"
    FAIL=$((FAIL + 1))
    return
  fi
  echo "ok   $NAME"
  PASS=$((PASS + 1))
}

# --- case: bound -- required slot bound, optional slot unbound ---
run "$FIX/manifests/bound.jsonc"
check bound 0 '
  .ok == true
  and .skill == "fixture:wrapper"
  and .resolved.tiering.binding == "fake:tiering-good"
  and .resolved.tiering.contract == "tiering@1"
  and .resolved.tiering.source == "skills-dir"
  and (.resolved.tiering.path | endswith("skills-dir/fake:tiering-good"))
  and .resolved.evidence.binding == null'

# --- case: bound-both -- both slots bound and provides-matched ---
run "$FIX/manifests/bound-both.jsonc"
check bound_both 0 '
  .ok == true
  and .resolved.tiering.binding == "fake:tiering-good"
  and .resolved.evidence.binding == "fake:evidence"
  and .resolved.evidence.contract == "evidence-capture@2"'

# --- case: unbound -- required slot with no binding ---
run "$FIX/manifests/unbound.jsonc"
check unbound 1 '
  .ok == false
  and .skill == "fixture:wrapper"
  and (.errors | length) == 1
  and .errors[0].slot == "tiering"
  and .errors[0].code == "unbound"'

# --- case: malformed -- manifest is not valid JSONC ---
run "$FIX/manifests/malformed.jsonc"
check malformed 1 '
  .ok == false
  and .errors[0].slot == null
  and .errors[0].code == "manifest-invalid"'

# --- case: not-installed -- binding names an absent skill ---
run "$FIX/manifests/not-installed.jsonc"
check not_installed 1 '
  .ok == false
  and .errors[0].slot == "tiering"
  and .errors[0].code == "skill-not-installed"'

# --- case: mismatch -- provides has wrong contract major ---
run "$FIX/manifests/mismatch.jsonc"
check provides_mismatch 1 '
  .ok == false
  and .errors[0].code == "provides-mismatch"
  and (.errors[0].message | contains("tiering@1"))'

# --- case: no-provides -- bound skill declares nothing ---
run "$FIX/manifests/no-provides.jsonc"
check provides_missing 1 '
  .ok == false
  and .errors[0].code == "provides-missing"'

# --- case: plugin-bound -- inner skill lives in an enabled plugin ---
run "$FIX/manifests/plugin-bound.jsonc"
check plugin_bound 0 '
  .ok == true
  and .resolved.tiering.binding == "fakepack:tiering"
  and .resolved.tiering.source == "plugin"
  and (.resolved.tiering.path | endswith("plugins/fakepack/skills/tiering"))'

# --- case: plugin-categorized -- inner skill one category level below skills/ ---
run "$FIX/manifests/plugin-categorized.jsonc"
check plugin_categorized 0 '
  .ok == true
  and .resolved.tiering.binding == "fakepack:nested-tiering"
  and .resolved.tiering.source == "plugin"
  and (.resolved.tiering.path | endswith("plugins/fakepack/skills/somecat/nested-tiering"))'

# --- case: attachments-bound -- inner skill lives under the plugin's
# attachments/ root, not skills/ or a skills/<category>/ dir ---
run "$FIX/manifests/attachments-bound.jsonc"
check attachments_bound 0 '
  .ok == true
  and .resolved.tiering.binding == "fakepack:tiering-attach"
  and .resolved.tiering.source == "attachments"
  and (.resolved.tiering.path | endswith("plugins/fakepack/attachments/tiering-attach"))'

# --- case: attachments-categorized -- inner skill one category level below
# the plugin's attachments/ root ---
run "$FIX/manifests/attachments-categorized.jsonc"
check attachments_categorized 0 '
  .ok == true
  and .resolved.tiering.binding == "fakepack:nested-tiering-attach"
  and .resolved.tiering.source == "attachments"
  and (.resolved.tiering.path | endswith("plugins/fakepack/attachments/somecat/nested-tiering-attach"))'

# --- case: plugin-disabled -- disabled plugins do not count as installed ---
run "$FIX/manifests/plugin-disabled.jsonc"
check plugin_disabled 1 '
  .ok == false
  and .errors[0].code == "skill-not-installed"'

# --- case: no manifest anywhere -- explicit nonexistent path = empty bindings ---
run "$WORK/does-not-exist.jsonc"
check no_manifest 1 '
  .ok == false
  and .errors[0].code == "unbound"'

# --- case: home-fallback -- $HOME/.mattstack/skills.jsonc is found ---
mkdir -p "$WORK/fakehome/.mattstack"
cp "$FIX/manifests/bound.jsonc" "$WORK/fakehome/.mattstack/skills.jsonc"
OUT=$(cd "$WORK" && HOME="$WORK/fakehome" "$RESOLVE" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check home_fallback 0 '
  .ok == true
  and .resolved.tiering.binding == "fake:tiering-good"'

# --- case: slot-decl-invalid -- bad requirement keyword in the declaration ---
mkdir -p "$WORK/wrapper-baddecl/scripts"
cp "$FIX/wrapper-baddecl/SKILL.md" "$WORK/wrapper-baddecl/SKILL.md"
cp "$CANONICAL" "$WORK/wrapper-baddecl/scripts/resolve-args.sh"
chmod +x "$WORK/wrapper-baddecl/scripts/resolve-args.sh"
OUT=$("$WORK/wrapper-baddecl/scripts/resolve-args.sh" --manifest "$FIX/manifests/bound.jsonc" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check slot_decl_invalid 1 '
  .ok == false
  and .errors[0].code == "slot-decl-invalid"
  and (.errors[0].message | contains("sometimes"))'

# --- case: watch-ci's ci scripts stay identical to stage-watch-ci's ---
for f in ci-watch.sh ci-triage.sh ci-attendant.sh; do
  if cmp -s "$HERE/../../attachments/pipeline/stage-watch-ci/scripts/$f" "$HERE/../../attachments/pipeline/watch-ci/scripts/$f"; then
    echo "ok   watch_ci_${f%.sh}_identical"
    PASS=$((PASS + 1))
  else
    echo "FAIL watch_ci_${f%.sh}_identical: watch-ci's $f drifted from stage-watch-ci's"
    FAIL=$((FAIL + 1))
  fi
done

# --- case: per-repo manifest -- matching $HOME/.mattstack/repos/<slug>/skills.jsonc,
# no committed cwd-up file -> binding resolves from the per-repo file ---
mkdir -p "$WORK/repo-per-repo"
(cd "$WORK/repo-per-repo" && git init -q && git remote add origin "https://gitlab.example.com/acme/widgets.git")
mkdir -p "$WORK/fakehome-per-repo/.mattstack/repos/gitlab.example.com-acme-widgets"
cp "$FIX/manifests/bound.jsonc" "$WORK/fakehome-per-repo/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
OUT=$(cd "$WORK/repo-per-repo" && HOME="$WORK/fakehome-per-repo" "$RESOLVE" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check per_repo_manifest 0 '
  .ok == true
  and .resolved.tiering.binding == "fake:tiering-good"'

# --- case: cwd-up committed file beats the per-repo file when both exist,
# even with a different binding in the per-repo file ---
mkdir -p "$WORK/repo-cwd-wins/.mattstack"
(cd "$WORK/repo-cwd-wins" && git init -q && git remote add origin "https://gitlab.example.com/acme/widgets.git")
cp "$FIX/manifests/bound.jsonc" "$WORK/repo-cwd-wins/.mattstack/skills.jsonc"
mkdir -p "$WORK/fakehome-cwd-wins/.mattstack/repos/gitlab.example.com-acme-widgets"
cp "$FIX/manifests/mismatch.jsonc" "$WORK/fakehome-cwd-wins/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
OUT=$(cd "$WORK/repo-cwd-wins" && HOME="$WORK/fakehome-cwd-wins" "$RESOLVE" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check cwd_up_beats_per_repo 0 '
  .ok == true
  and .resolved.tiering.binding == "fake:tiering-good"'

# --- case: no origin remote -- per-repo lookup is skipped, falls back to
# $HOME/.mattstack/skills.jsonc ---
mkdir -p "$WORK/repo-no-remote"
(cd "$WORK/repo-no-remote" && git init -q)
mkdir -p "$WORK/fakehome-no-remote/.mattstack"
cp "$FIX/manifests/bound.jsonc" "$WORK/fakehome-no-remote/.mattstack/skills.jsonc"
OUT=$(cd "$WORK/repo-no-remote" && HOME="$WORK/fakehome-no-remote" "$RESOLVE" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check no_remote_falls_back_global 0 '
  .ok == true
  and .resolved.tiering.binding == "fake:tiering-good"'

# --- case: per-repo manifest wins even when the repo is checked out under
# $HOME -- regression: the cwd-up walk must stop before it reaches $HOME
# itself, or $HOME/.mattstack/skills.jsonc gets matched as a "committed"
# in-repo file and the per-repo lookup never runs ---
mkdir -p "$WORK/fakehome-under-home/.mattstack/repos/gitlab.example.com-acme-widgets"
cp "$FIX/manifests/mismatch.jsonc" "$WORK/fakehome-under-home/.mattstack/skills.jsonc"
cp "$FIX/manifests/bound.jsonc" "$WORK/fakehome-under-home/.mattstack/repos/gitlab.example.com-acme-widgets/skills.jsonc"
mkdir -p "$WORK/fakehome-under-home/src/repo"
(cd "$WORK/fakehome-under-home/src/repo" && git init -q && git remote add origin "https://gitlab.example.com/acme/widgets.git")
# Canonicalize: $WORK can carry a double slash when $TMPDIR itself ends in
# one (macOS default), and cd/dirname normalize that away as the walk goes
# up -- so a raw string concat here would never string-equal the walk's $d
# even though both name the same directory. Match what the walk sees.
FAKE_HOME_UNDER=$(CDPATH= cd -- "$WORK/fakehome-under-home" && pwd)
OUT=$(cd "$FAKE_HOME_UNDER/src/repo" && HOME="$FAKE_HOME_UNDER" "$RESOLVE" --skills-dir "$FIX/skills-dir" --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check per_repo_wins_under_home 0 '
  .ok == true
  and .resolved.tiering.binding == "fake:tiering-good"'

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
