#!/usr/bin/env bash
# Compile the describe-only test reps' system files for the review skills.
#
#   build-system-files.sh <git-ref|tree-path> <out-dir> [--gate-protocol <dir>]
#
# <git-ref|tree-path> is a git ref (main, a sha) exported with git archive, or
# a path to a checkout whose plugins/mattstack is copied as it stands on disk.
# Writes review.md, self-review.md and receive-review.md to <out-dir>.
# --gate-protocol <dir> copies that directory over the scratch copy's
# attachments/gate-protocol/ before compiling (GREEN uses the rewritten
# include from the pipeline-skills lane until it merges).
# Only a scratch copy of the plugin is edited; the compile runs under an
# isolated HOME and --mattstack-dir, so nothing reads or writes ~/.mattstack.
set -euo pipefail

usage() {
  echo "usage: build-system-files.sh <git-ref|tree-path> <out-dir> [--gate-protocol <dir>]" >&2
  exit 64
}

[ "$#" -ge 2 ] || usage
src="$1"
out_arg="$2"
shift 2
gate_protocol=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --gate-protocol)
      [ "$#" -ge 2 ] || usage
      gate_protocol="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

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
  "$repo_real"/*)
    echo "refusing: <out-dir> $out is inside the repo $repo_real" >&2
    exit 65
    ;;
esac
mkdir -p "$out"

if [ -n "$gate_protocol" ]; then
  [ -f "$gate_protocol/SKILL.md" ] || {
    echo "refusing: --gate-protocol $gate_protocol has no SKILL.md" >&2
    exit 66
  }
  gate_protocol="$(cd "$gate_protocol" && pwd -P)"
fi

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

if [ -n "$gate_protocol" ]; then
  cp -R "$gate_protocol/." "$pack/attachments/gate-protocol/"
fi

# Roster the three engines in the copy only; the real stubs.jsonc is never
# touched. An engine is named by its directory under attachments/<group>/.
(cd "$repo_root" && bun -e '
const [stubs] = process.argv.slice(1);
const fs = require("fs");
const { parse } = require("jsonc-parser");
const s = parse(fs.readFileSync(stubs, "utf8"));
for (const v of ["review", "self-review", "receive-review"]) {
  s.verbs[v] = { engine: v, description: "Test roster entry for " + v };
}
fs.writeFileSync(stubs, JSON.stringify(s, null, 2) + "\n");
' "$pack/pack/stubs.jsonc")

for verb in review self-review receive-review; do
  (cd "$repo_root" && env -i HOME="$scratch/home" PATH="$PATH" bun cli.ts skills compile \
    --pack-dir "$pack" --mattstack-dir "$scratch/mattstack" \
    --verb "$verb" --preview) > "$out/$verb.md"
done

for verb in review self-review receive-review; do
  f="$out/$verb.md"
  [ -s "$f" ] || { echo "empty system file: $f" >&2; exit 1; }
  grep -q 'digraph' "$f" || { echo "no digraph in $f" >&2; exit 1; }
  grep -q '# Gate protocol' "$f" || { echo "no gate protocol include in $f" >&2; exit 1; }
done
wc -w "$out"/review.md "$out"/self-review.md "$out"/receive-review.md
