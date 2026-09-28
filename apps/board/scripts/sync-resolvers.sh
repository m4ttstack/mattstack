#!/bin/sh
# sync-resolvers.sh -- resync every vendored resolve-args.sh under skills-src/
# with the canonical copy in the monorepo's plugins/mattstack, and report
# what was synced.
#
# The three wrapper skills (review, respond, doctor) each vendor a copy of
# parameterized-skills' resolve-args.sh because a skill can't reach outside
# its own directory at runtime. The copies live under skills-src/ and must
# be byte-identical to the canonical (src/__tests__/skills-resolve.test.ts).
# Run this after the canonical resolver changes, then run
# `bun run skills:expand:board` at the repo root to regenerate skills/.
#
# Canonical source: $MATTSTACK_SKILLS_REPO (default <monorepo>/plugins/mattstack)
# /attachments/parameterized-skills/scripts/resolve-args.sh
# Requires: sh, find, jq.
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
monorepo_root=$(cd "$(dirname "$0")/../../.." && pwd)
canonical_repo="${MATTSTACK_SKILLS_REPO:-$monorepo_root/plugins/mattstack}"
canonical="$canonical_repo/attachments/parameterized-skills/scripts/resolve-args.sh"
plugin_json="$canonical_repo/.claude-plugin/plugin.json"

if [ ! -f "$canonical" ]; then
  echo "sync-resolvers: canonical resolver not found at $canonical" >&2
  exit 1
fi
if [ ! -f "$plugin_json" ]; then
  echo "sync-resolvers: plugin.json not found at $plugin_json" >&2
  exit 1
fi

version=$(jq -r '.version' "$plugin_json")

find "$repo_root/skills-src" -type f -name "resolve-args.sh" | while IFS= read -r target; do
  cp "$canonical" "$target"
  chmod +x "$target"
  echo "synced $target from mattstack $version"
done
