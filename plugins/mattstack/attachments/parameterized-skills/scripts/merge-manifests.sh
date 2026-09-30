#!/usr/bin/env bash
# merge-manifests.sh [--repo <path>] -- writes the per-pack bindings files for
# one checkout. The merge itself lives in rt (rt skills materialize); this
# wrapper only keeps the old entry point alive. Exit 0 written, 2 no team
# declares the checkout, 1 anything else.
set -euo pipefail
if [ -n "${MATTSTACK_HOME:-}" ] && [ "$MATTSTACK_HOME" != "$HOME/.mattstack" ]; then
  echo "merge-manifests: MATTSTACK_HOME is no longer honored; rt skills materialize writes under \$HOME/.mattstack" >&2
  exit 1
fi
REPO=$PWD
if [ "${1:-}" = "--repo" ]; then REPO=$(cd "${2:?--repo needs a path}" && pwd); fi
command -v rt > /dev/null 2>&1 || { echo "merge-manifests: rt is not on PATH; install mattstack.app" >&2; exit 1; }
# An rt older than this plugin ignores --dir and runs this wrapper again for
# every registered repo, so a second entry is refused rather than recursed.
if [ -n "${MATTSTACK_MERGE_WRAPPER:-}" ]; then
  echo "merge-manifests: rt on PATH is older than this plugin and re-entered the wrapper; update mattstack.app" >&2
  exit 1
fi
export MATTSTACK_MERGE_WRAPPER=1
exec rt skills materialize --dir "$REPO"
