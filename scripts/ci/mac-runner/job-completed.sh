#!/bin/bash
# Runs after every job on the Mac runner, cancelled ones included. A cancelled
# test skips its finally, and a daemon started with a test's own env carries no
# runner tracking id, so the runner's orphan cleanup misses it and it holds its
# ports for later jobs. Matching only this runner's _work spares the other
# runners' jobs. The runner calls this with -e, and pkill exits 1 when nothing
# matches, which would fail every clean job without the || true.
[ -z "${MAC_RUNNER_DIR:-}" ] || pkill -f "^$MAC_RUNNER_DIR/_work/" || true
