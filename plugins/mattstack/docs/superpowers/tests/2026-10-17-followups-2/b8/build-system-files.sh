#!/usr/bin/env bash
# Compile the describe-only reps' system files for stage-ship and stage-evidence.
#
#   build-system-files.sh <checkout> <out-dir>
#
# Copies <checkout>/plugins/mattstack as it stands on disk into <out-dir>/.build,
# rosters both stages as verbs in the copy, and compiles each under an isolated
# HOME and --mattstack-dir. Writes <out-dir>/stage-ship.md and
# <out-dir>/stage-evidence.md. <out-dir> must be outside the repo and new or empty.
set -euo pipefail

[ "$#" -eq 2 ] || { echo "usage: build-system-files.sh <checkout> <out-dir>" >&2; exit 64; }
src="$(cd "$1" && pwd -P)"
mkdir -p "$2"
out="$(cd "$2" && pwd -P)"
case "$out/" in "$src"/*) echo "refusing: $out is inside $src" >&2; exit 65 ;; esac
[ -z "$(ls -A "$out")" ] || { echo "refusing: $out is not empty" >&2; exit 65; }

scratch="$out/.build"
mkdir -p "$scratch/home" "$scratch/mattstack" "$scratch/tree"
cp -R "$src/plugins/mattstack" "$scratch/tree/mattstack"
pack="$scratch/tree/mattstack"

(cd "$src" && bun -e '
const [pack] = process.argv.slice(1);
const fs = require("fs");
const { parse } = require("jsonc-parser");
const p = pack + "/pack/stubs.jsonc";
const stubs = parse(fs.readFileSync(p, "utf8"));
for (const v of ["stage-ship", "stage-evidence"]) stubs.verbs[v] = { engine: v, description: "Test roster entry for " + v };
fs.writeFileSync(p, JSON.stringify(stubs, null, 2) + "\n");
' "$pack")

for verb in stage-ship stage-evidence; do
  (cd "$src" && env HOME="$scratch/home" bun cli.ts skills compile \
    --pack-dir "$pack" --mattstack-dir "$scratch/mattstack" \
    --verb "$verb" --preview) > "$out/$verb.md"
  [ -s "$out/$verb.md" ] || { echo "empty system file: $out/$verb.md" >&2; exit 1; }
done
wc -w "$out"/*.md
