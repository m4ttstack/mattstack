#!/usr/bin/env bash
# Compile the describe-only test reps' system files for the pipeline skills.
#
#   build-system-files.sh <tree-or-git-ref> <out-dir>
#
# <tree-or-git-ref> is a git ref (main, a sha) exported with git archive, or a
# path to a checkout whose plugins/mattstack is copied as it stands on disk.
# Writes work.md, stage-provision.md, stage-plan.md, stage-self-review.md and
# board-gate.md to <out-dir>. Only a scratch copy of the plugin is edited; the
# compile runs under an isolated HOME and --mattstack-dir, so nothing reads or
# writes ~/.mattstack.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: build-system-files.sh <tree-or-git-ref> <out-dir>" >&2
  exit 64
fi

src="$1"
out_arg="$2"
repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
repo_real="$(cd "$repo_root" && pwd -P)"

mkdir -p "$out_arg"
out="$(cd "$out_arg" && pwd -P)"
case "$out/" in
  "$repo_real"/*)
    echo "refusing: <out-dir> $out is inside the repo $repo_real" >&2
    exit 65
    ;;
esac

scratch="$out/.build"
case "$scratch" in
  "$out"/.build) ;;
  *) echo "refusing: unexpected scratch path $scratch" >&2; exit 65 ;;
esac
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
# A name is either a roster verb or a pipeline stage, never both, so the work
# verb compiles from one copy (feature pipeline bound) and the stage verbs from
# a second copy (stages rostered, no pipeline). A work verb's pipeline must
# start with provision, end with watch-ci and include implement and ship.
# The work manifest sits at repos/queue/ so the compiled flags read
# --repo queue, matching the scenarios' fixture repo.
stage_pack="$scratch/tree/mattstack-stages"
cp -R "$pack" "$stage_pack"

(cd "$repo_root" && bun -e '
const [workPack, stagePack, repoDir] = process.argv.slice(1);
const fs = require("fs");
const { parse } = require("jsonc-parser");
const read = (p) => parse(fs.readFileSync(p, "utf8"));
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const ws = read(workPack + "/pack/stubs.jsonc");
ws.verbs.work = { engine: "work", description: "Run a unit of work end to end" };
write(workPack + "/pack/stubs.jsonc", ws);
const wk = read(workPack + "/pack/skills.jsonc");
wk.pipelines = { feature: ["provision", "plan", "gates", "implement", "self-review", "ship", "watch-ci"].map((s) => "mattstack:stage-" + s) };
fs.mkdirSync(repoDir, { recursive: true });
write(repoDir + "/skills.jsonc", wk);
const ss = read(stagePack + "/pack/stubs.jsonc");
for (const v of ["stage-provision", "stage-plan", "stage-self-review"]) {
  ss.verbs[v] = { engine: v, description: "Test roster entry for " + v };
}
write(stagePack + "/pack/stubs.jsonc", ss);
' "$pack" "$stage_pack" "$scratch/mattstack/repos/queue")

compile() {
  local pack_dir="$1" verb="$2"
  shift 2
  (cd "$repo_root" && env HOME="$scratch/home" bun cli.ts skills compile \
    --pack-dir "$pack_dir" --mattstack-dir "$scratch/mattstack" \
    --verb "$verb" --preview "$@") > "$out/$verb.md"
}
compile "$pack" work --manifest "$scratch/mattstack/repos/queue/skills.jsonc"
for verb in stage-provision stage-plan stage-self-review; do
  compile "$stage_pack" "$verb"
done

# gate-protocol's body alone stands in for a board pane gating with no run.
awk 'BEGIN{fm=0} fm<2 && /^---$/ {fm++; next} fm>=2 {print}' \
  "$pack/attachments/gate-protocol/SKILL.md" > "$out/board-gate.md"

for f in work stage-provision stage-plan stage-self-review board-gate; do
  [ -s "$out/$f.md" ] || { echo "empty system file: $out/$f.md" >&2; exit 1; }
done
wc -w "$out"/*.md
