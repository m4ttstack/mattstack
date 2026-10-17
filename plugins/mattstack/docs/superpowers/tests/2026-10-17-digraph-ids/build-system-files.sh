#!/usr/bin/env bash
# Compile the five skills the digraph-ids measurement counts.
#
#   build-system-files.sh <git-ref|tree-path> <out-dir>
#
# <git-ref|tree-path> is a git ref (main, a sha) exported with git archive, or
# a path to a checkout whose plugins/mattstack is copied as it stands on disk.
# Writes ship.md, watch-ci.md, receive-review.md, stage-provision.md (each
# compiled with no fills) and gate-protocol.md (the include's body alone) to
# <out-dir>. Only a scratch copy of the plugin is edited; the compile runs
# under an isolated HOME and --mattstack-dir, so nothing reads or writes
# ~/.mattstack.
set -euo pipefail

[ "$#" -eq 2 ] || { echo "usage: build-system-files.sh <git-ref|tree-path> <out-dir>" >&2; exit 64; }
src="$1"
out_arg="$2"

repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
repo_real="$(cd "$repo_root" && pwd -P)"

# Resolve <out-dir> through its nearest existing ancestor, so the refusal
# fires before anything is created inside the repo.
probe="$out_arg"
rest=""
while [ ! -d "$probe" ]; do
  rest="/$(basename "$probe")$rest"
  probe="$(dirname "$probe")"
done
out="$(cd "$probe" && pwd -P)$rest"
case "$out/" in
  "$repo_real"/*) echo "refusing: <out-dir> $out is inside the repo $repo_real" >&2; exit 65 ;;
esac
mkdir -p "$out"

scratch="$out/.build"
rm -rf "$scratch"
mkdir -p "$scratch/home" "$scratch/mattstack" "$scratch/tree"

if [ -d "$src" ]; then
  cp -R "$src/plugins/mattstack" "$scratch/tree/mattstack"
else
  git -C "$repo_root" archive "$src" plugins/mattstack | tar -x -C "$scratch/tree"
  mv "$scratch/tree/plugins/mattstack" "$scratch/tree/mattstack"
  rmdir "$scratch/tree/plugins"
fi
pack="$scratch/tree/mattstack"

verbs=(ship watch-ci receive-review stage-provision)

# Roster the engines in the copy only; the real stubs.jsonc is never touched.
(cd "$repo_root" && bun -e '
const [stubs, ...verbs] = process.argv.slice(1);
const fs = require("fs");
const { parse } = require("jsonc-parser");
const s = parse(fs.readFileSync(stubs, "utf8"));
for (const v of verbs) s.verbs[v] = { engine: v, description: "Test roster entry for " + v };
fs.writeFileSync(stubs, JSON.stringify(s, null, 2) + "\n");
' "$pack/pack/stubs.jsonc" "${verbs[@]}")

for verb in "${verbs[@]}"; do
  (cd "$repo_root" && env -i HOME="$scratch/home" PATH="$PATH" bun cli.ts skills compile \
    --pack-dir "$pack" --mattstack-dir "$scratch/mattstack" \
    --verb "$verb" --preview) > "$out/$verb.md"
done

awk 'BEGIN{fm=0} fm<2 && /^---$/ {fm++; next} fm>=2 {print}' \
  "$pack/attachments/gate-protocol/SKILL.md" > "$out/gate-protocol.md"

for f in "${verbs[@]}" gate-protocol; do
  [ -s "$out/$f.md" ] || { echo "empty system file: $out/$f.md" >&2; exit 1; }
  grep -q 'digraph' "$out/$f.md" || { echo "no digraph in $out/$f.md" >&2; exit 1; }
done
wc -w "$out"/*.md
