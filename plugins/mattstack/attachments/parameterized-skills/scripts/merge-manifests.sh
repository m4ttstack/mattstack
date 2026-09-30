#!/usr/bin/env bash
# merge-manifests.sh [--repo <path>] -- writes the per-pack bindings files for
# one checkout. The merge itself lives in rt (rt skills materialize); this
# wrapper only keeps the old entry point alive.
set -euo pipefail
REPO=$PWD
if [ "${1:-}" = "--repo" ]; then REPO=$(cd "${2:?--repo needs a path}" && pwd); fi
command -v rt > /dev/null 2>&1 || { echo "merge-manifests: rt is not on PATH; install mattstack.app" >&2; exit 2; }
exec rt skills materialize --dir "$REPO"
