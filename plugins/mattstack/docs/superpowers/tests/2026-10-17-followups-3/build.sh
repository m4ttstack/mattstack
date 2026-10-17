#!/usr/bin/env bash
# build.sh <tree-or-git-ref> <out-dir> <verb>... : compile verbs rostered in a scratch copy of plugins/mattstack
set -euo pipefail
src="$1"; out="$2"; shift 2
repo_root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
mkdir -p "$out"; out="$(cd "$out" && pwd -P)"
scratch="$out/.build"; rm -rf "$scratch"; mkdir -p "$scratch/home" "$scratch/mattstack" "$scratch/tree"
if [ -d "$src" ]; then cp -R "$src/plugins/mattstack" "$scratch/tree/mattstack"
else git -C "$repo_root" archive "$src" plugins/mattstack | tar -x -C "$scratch/tree"; mv "$scratch/tree/plugins/mattstack" "$scratch/tree/mattstack"; fi
pack="$scratch/tree/mattstack"
(cd "$repo_root" && bun -e '
const [p, ...verbs] = process.argv.slice(1);
const fs = require("fs"); const { parse } = require("jsonc-parser");
const s = parse(fs.readFileSync(p + "/pack/stubs.jsonc", "utf8"));
for (const v of verbs) if (!s.verbs[v]) s.verbs[v] = { engine: v, description: "Test roster entry for " + v };
fs.writeFileSync(p + "/pack/stubs.jsonc", JSON.stringify(s, null, 2));
' "$pack" "$@")
for v in "$@"; do
  (cd "$repo_root" && env HOME="$scratch/home" bun cli.ts skills compile --pack-dir "$pack" --mattstack-dir "$scratch/mattstack" --verb "$v" --preview) > "$out/$v.md"
  [ -s "$out/$v.md" ] || { echo "empty $v" >&2; exit 1; }
done
wc -w "$out"/*.md
