#!/bin/bash
# Rebuilds the console's blocks.<skill>.json fixtures from the mattstack engines.
# usage: blocks-fixtures.sh <repo-root> <scratch-dir> <skill>...
#   repo-root    the mattstack checkout whose plugins/mattstack is read and whose cli.ts runs
#   scratch-dir  an empty or throwaway directory; the only place besides the fixture dir that is written
#   skill        ship, stage-plan ... (a verb or stage the scratch pack's stubs and pipelines name)
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: blocks-fixtures.sh <repo-root> <scratch-dir> <skill>..." >&2
  exit 2
fi
ROOT="$(cd "$1" && pwd)"
mkdir -p "$2"
S="$(cd "$2" && pwd)/pack-scratch"
shift 2
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$ROOT/apps/console/src/server/fixtures/design"

# rt reads ~/.mattstack, so every run gets a throwaway HOME inside the scratch dir.
rm -rf "$S"
mkdir -p "$S/home" "$S/pack/pack" "$S/pack/.claude-plugin" "$S/mattstack-home/repos/my-repo" "$S/mattstack-home/plugins" "$S/out"
cp -R "$ROOT/plugins/mattstack" "$S/mattstack-home/plugins/mattstack"

echo '{"name":"widgets","version":"0.1.0"}' > "$S/pack/.claude-plugin/plugin.json"
echo '{"public":[]}' > "$S/pack/pack/surface.jsonc"
echo '{"verbs":{"ship":{"engine":"ship","description":"Ship the widget branch"},"work":{"engine":"work","description":"Run a widget through the pipeline"}}}' > "$S/pack/pack/stubs.jsonc"
mkdir -p "$S/pack/attachments/ship-lint"
printf -- '---\nname: ship-lint\ndescription: "Widget ship checks"\nmetadata:\n  provides: "ship-lint@1"\n---\n' > "$S/pack/attachments/ship-lint/SKILL.md"
printf 'Run bun run lint, then bun run typecheck.\nA lint error is fixed, never disabled.\n' > "$S/pack/attachments/ship-lint/fast-checks.md"
printf 'Stage the widget files by name.\n' > "$S/pack/attachments/ship-lint/commit.md"
printf 'Name the widget in the title.\n' > "$S/pack/attachments/ship-lint/title.md"
printf 'The plan names the widget evidence cases.\n' > "$S/pack/attachments/ship-lint/evidence-plan.md"
printf 'Every acme team runs the shared format check first.\n' > "$S/pack/attachments/ship-lint/base-checks.md"
printf 'Name the acme component in the subject.\n' > "$S/pack/attachments/ship-lint/base-commit.md"

cat > "$S/pack/pack/skills.jsonc" <<'JSON'
{
  "version": 2,
  "bindings": {
    "mattstack:ship/flow/domain-fast-checks": { "rules": "widgets:ship-lint/fast-checks" },
    "mattstack:ship/flow/commit-named-files": { "rules": "widgets:ship-lint/commit" },
    "mattstack:ship/flow/write-title-description": { "rules": "widgets:ship-lint/title" },
    "mattstack:stage-plan/run-field-set-evidence-plan": { "rules": "widgets:ship-lint/evidence-plan" }
  },
  "pipelines": { "feature": ["mattstack:stage-plan"] }
}
JSON

# The org layer comes from `layered`; place-blocks-fixture.py adds the base layer and its lines row
# that rt emits only when the pack extends a real org base.
cat > "$S/mattstack-home/repos/my-repo/skills.jsonc" <<'JSON'
{
  "version": 2,
  "skills": { "enabled": [] },
  "bindings": {
    "mattstack:ship/flow/domain-fast-checks": { "rules": "widgets:ship-lint/fast-checks" },
    "mattstack:ship/flow/commit-named-files": { "rules": "widgets:ship-lint/base-commit" },
    "mattstack:ship/flow/write-title-description": { "rules": "widgets:ship-lint/title" },
    "mattstack:stage-plan/run-field-set-evidence-plan": { "rules": "widgets:ship-lint/evidence-plan" }
  },
  "layered": {
    "mattstack:ship/flow/domain-fast-checks": { "rules": [
      { "layer": "base:acme-base", "value": "widgets:ship-lint/base-checks" },
      { "layer": "pack", "value": "widgets:ship-lint/fast-checks" }
    ] },
    "mattstack:ship/flow/commit-named-files": { "rules": [
      { "layer": "base:acme-base", "value": "widgets:ship-lint/base-commit" }
    ] }
  },
  "pipelines": { "feature": ["mattstack:stage-plan"] }
}
JSON

cd "$ROOT"
for skill in "$@"; do
  env -i HOME="$S/home" PATH="$PATH" bun cli.ts skills blocks \
    --pack-dir "$S/pack" --mattstack-dir "$S/mattstack-home" \
    --manifest "$S/mattstack-home/repos/my-repo/skills.jsonc" \
    --skill "$skill" --json > "$S/out/blocks.$skill.json" 2> "$S/out/blocks.$skill.err"
  python3 -I "$HERE/place-blocks-fixture.py" "$S" "$S/out/blocks.$skill.json" "$DEST/blocks.$skill.json"
done
