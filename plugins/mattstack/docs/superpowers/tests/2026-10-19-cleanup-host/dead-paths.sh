#!/bin/sh
# usage (from the repo root): sh plugins/mattstack/docs/superpowers/tests/2026-10-19-cleanup-host/dead-paths.sh
# A watch-ci host that names a file under its own skill dir makes every pack
# compile warn "body references ... which is not an emitted file": with no
# forge binding nothing is vendored there. Exits 1 while any host names one.
hits=$(grep -nE '(\$\{CLAUDE_SKILL_DIR\}|\{\{stage\.dir\}\})/[A-Za-z0-9_./-]*\.[a-z]+' \
  plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md \
  plugins/mattstack/attachments/pipeline/stage-watch-ci/SKILL.md)
[ -z "$hits" ] && { echo "none"; exit 0; }
echo "$hits"; exit 1
