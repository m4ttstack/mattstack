#!/bin/sh
# test-resolve-pipeline.sh -- model-free matrix for resolve-pipeline.sh.
# Run bare from anywhere. Exit 0 = all pass. Never tail-pipe this gate.
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FIX="$HERE/fixtures"
CANONICAL="$HERE/../../attachments/pipeline/work/scripts/resolve-pipeline.sh"
PASS=0; FAIL=0

WORK=$(mktemp -d "${TMPDIR:-/tmp}/resolve-pipeline-test.XXXXXX") || exit 2
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/wrapper/scripts"
cp "$FIX/orchestrator/SKILL.md" "$WORK/wrapper/SKILL.md"
cp "$CANONICAL" "$WORK/wrapper/scripts/resolve-pipeline.sh"
chmod +x "$WORK/wrapper/scripts/resolve-pipeline.sh"
RESOLVE="$WORK/wrapper/scripts/resolve-pipeline.sh"
PLUGIN_LIST="printf []"

run() { # $1=manifest $2=work-type; sets OUT and STATUS
  OUT=$("$RESOLVE" --work-type "$2" --manifest "$1" \
    --skills-dir "$FIX/stages-dir" --plugin-list-cmd "$PLUGIN_LIST")
  STATUS=$?
}
check() { # $1=name $2=expected-exit $3=jq-assertion
  if [ "$STATUS" -ne "$2" ]; then
    echo "FAIL $1: exit $STATUS, wanted $2"; echo "  out: $OUT"; FAIL=$((FAIL+1)); return
  fi
  if ! printf '%s' "$OUT" | jq -e "$3" > /dev/null; then
    echo "FAIL $1: assertion failed: $3"; echo "  out: $OUT"; FAIL=$((FAIL+1)); return
  fi
  echo "ok   $1"; PASS=$((PASS+1))
}

# --- happy: three stages resolve, chain closes, order preserved ---
run "$FIX/manifests/pipe-happy.jsonc" feature
check happy 0 '
  .ok == true and .skill == "fixture:work" and .workType == "feature"
  and (.pipeline | length) == 3
  and .pipeline[0].name == "fake:stage-grab" and .pipeline[0].stage == "provision"
  and .pipeline[0].consumes == ["ticket","repo"]
  and .pipeline[1].produces == ["commits"]
  and .pipeline[2].slots == null
  and (.pipeline[0].path | endswith("stages-dir/fake:stage-grab"))'

# --- no-pipeline: work type absent from pipelines map ---
run "$FIX/manifests/pipe-missing-type.jsonc" feature
check no_pipeline 1 '
  .ok == false and .errors[0].stage == null and .errors[0].code == "no-pipeline"'

# --- no-manifest: nonexistent path and no fallback ---
OUT=$(cd "$WORK" && HOME="$WORK/nohome" "$RESOLVE" --work-type feature \
  --manifest "$WORK/absent.jsonc" --skills-dir "$FIX/stages-dir" \
  --plugin-list-cmd "$PLUGIN_LIST")
STATUS=$?
check no_manifest 1 '
  .ok == false and .errors[0].code == "no-manifest"'

# --- pipeline-invalid: entry is not an array of strings ---
run "$FIX/manifests/pipe-invalid.jsonc" feature
check pipeline_invalid 1 '
  .ok == false and .errors[0].code == "pipeline-invalid"'

# --- chain-broken: consumer ordered before its producer, exactly one error ---
run "$FIX/manifests/pipe-broken-chain.jsonc" feature
check chain_broken 1 '
  .ok == false and (.errors | length) == 1
  and .errors[0].stage == "fake:stage-build"
  and .errors[0].code == "chain-broken"
  and (.errors[0].message | contains("branch"))'

# --- stage-not-installed ---
run "$FIX/manifests/pipe-not-installed.jsonc" feature
check stage_not_installed 1 '
  .ok == false and .errors[0].code == "stage-not-installed"
  and .errors[0].stage == "fake:stage-ghost"'

# --- not-a-stage ---
run "$FIX/manifests/pipe-notastage.jsonc" feature
check not_a_stage 1 '
  .ok == false and .errors[0].code == "not-a-stage"'

# --- needy stage, bound: per-stage slot resolution feeds .slots ---
run "$FIX/manifests/pipe-needy-bound.jsonc" feature
check needy_bound 0 '
  .ok == true
  and .pipeline[0].slots.domain.binding == "fake:tiering-good"
  and .pipeline[0].slots.domain.contract == "tiering@1"'

# --- needy stage, unbound: stage-unresolved with inner errors in detail ---
run "$FIX/manifests/pipe-needy-unbound.jsonc" feature
check needy_unbound 1 '
  .ok == false and .errors[0].code == "stage-unresolved"
  and .errors[0].detail[0].code == "unbound"'

# --- plugin stage in a category dir: resolves with source plugin ---
sed "s|@FIXTURES@|$FIX|g" "$FIX/plugin-list.json.in" > "$WORK/plugin-list.json"
OUT=$("$RESOLVE" --work-type feature --manifest "$FIX/manifests/pipe-plugin-stage.jsonc" \
  --skills-dir "$FIX/stages-dir" --plugin-list-cmd "cat $WORK/plugin-list.json")
STATUS=$?
check plugin_stage_categorized 0 '
  .ok == true
  and .pipeline[0].name == "fakepack:stage-nested"
  and .pipeline[0].source == "plugin"
  and (.pipeline[0].path | endswith("plugins/fakepack/skills/stagecat/stage-nested"))'

# --- plugin stage moved to attachments/, one category level: source attachments ---
OUT=$("$RESOLVE" --work-type feature --manifest "$FIX/manifests/pipe-plugin-stage-attachments.jsonc" \
  --skills-dir "$FIX/stages-dir" --plugin-list-cmd "cat $WORK/plugin-list.json")
STATUS=$?
check plugin_stage_attachments_categorized 0 '
  .ok == true
  and .pipeline[0].name == "fakepack:stage-unregistered"
  and .pipeline[0].source == "attachments"
  and (.pipeline[0].path | endswith("plugins/fakepack/attachments/pipelinecat/stage-unregistered"))'

# --- seed override: custom seed satisfies build-first order ---
OUT=$("$RESOLVE" --work-type feature --manifest "$FIX/manifests/pipe-broken-chain.jsonc" \
  --skills-dir "$FIX/stages-dir" --plugin-list-cmd "$PLUGIN_LIST" \
  --seed "work-type ticket repo mode branch")
STATUS=$?
check seed_override 0 '
  .ok == true and (.seed | index("branch")) != null'

# --- vendored needy resolver identity guard ---
if cmp -s "$HERE/../../attachments/parameterized-skills/scripts/resolve-args.sh" \
          "$FIX/stages-dir/fake:stage-needy/scripts/resolve-args.sh"; then
  echo "ok   needy_vendored_identical"; PASS=$((PASS+1))
else
  echo "FAIL needy_vendored_identical: fixture resolver drifted from canonical"; FAIL=$((FAIL+1))
fi

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
