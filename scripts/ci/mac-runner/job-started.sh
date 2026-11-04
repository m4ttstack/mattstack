#!/bin/bash
# Runs before every job on the Mac runner; a non-zero exit fails the job before
# checkout. The cd keeps bun from loading a bunfig.toml or .env left in the job's
# working directory, which would run repo code before this decides.
cd /usr/local/mattstack-ci || exit 1
exec /usr/local/mattstack-ci/bun --no-env-file /usr/local/mattstack-ci/macos-runner.ts --hook
