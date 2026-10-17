#!/usr/bin/env bash
# Compile the describe-only test reps' system file for stage-evidence.
#
#   build-system-file.sh <git-ref-or-tree-path> <out-dir>
#
# <git-ref-or-tree-path> is a git ref (main, a sha) exported with git archive,
# or a path to a checkout whose plugins/mattstack is copied as it stands on
# disk. Writes <out-dir>/stage-evidence.md. Only a scratch copy of the plugin
# is edited; the compile runs under an isolated HOME and --mattstack-dir, so
# nothing reads or writes ~/.mattstack. <out-dir> must be new or empty.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: build-system-file.sh <git-ref-or-tree-path> <out-dir>" >&2
  exit 64
fi

src="$1"
out_arg="$2"
repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
repo_real="$(cd "$repo_root" && pwd -P)"

# The real path of a directory that may not exist yet: the nearest existing
# ancestor resolved with pwd -P, plus the missing tail.
real_path() {
  local p="$1" tail=""
  while [ ! -d "$p" ]; do
    case "$(basename "$p")" in
      ..|.) echo "refusing: <out-dir> $1 has a . or .. in a missing part" >&2; exit 65 ;;
    esac
    tail="/$(basename "$p")$tail"
    p="$(dirname "$p")"
  done
  echo "$(cd "$p" && pwd -P)$tail"
}

out="$(real_path "$out_arg")"
case "$out/" in
  "$repo_real"/*)
    echo "refusing: <out-dir> $out is inside the repo $repo_real" >&2
    exit 65
    ;;
esac
if [ -e "$out" ] && { [ ! -d "$out" ] || [ -n "$(ls -A "$out")" ]; }; then
  echo "refusing: <out-dir> $out must be new or empty; nothing was deleted" >&2
  exit 65
fi
mkdir -p "$out"

scratch="$out/.build"
mkdir -p "$scratch/home" "$scratch/mattstack" "$scratch/tree"

if [ -d "$src" ]; then
  cp -R "$src/plugins/mattstack" "$scratch/tree/mattstack"
else
  git -C "$repo_root" archive "$src" plugins/mattstack | tar -x -C "$scratch/tree"
  mv "$scratch/tree/plugins/mattstack" "$scratch/tree/mattstack"
  rmdir "$scratch/tree/plugins"
fi
pack="$scratch/tree/mattstack"

(cd "$repo_root" && bun -e '
const [pack] = process.argv.slice(1);
const fs = require("fs");
const { parse } = require("jsonc-parser");
const p = pack + "/pack/stubs.jsonc";
const stubs = parse(fs.readFileSync(p, "utf8"));
stubs.verbs["stage-evidence"] = { engine: "stage-evidence", description: "Test roster entry for stage-evidence" };
fs.writeFileSync(p, JSON.stringify(stubs, null, 2) + "\n");
' "$pack")

(cd "$repo_root" && env HOME="$scratch/home" bun cli.ts skills compile \
  --pack-dir "$pack" --mattstack-dir "$scratch/mattstack" \
  --verb stage-evidence --preview) > "$out/stage-evidence.md"

[ -s "$out/stage-evidence.md" ] || { echo "empty system file: $out/stage-evidence.md" >&2; exit 1; }
wc -w "$out/stage-evidence.md"
