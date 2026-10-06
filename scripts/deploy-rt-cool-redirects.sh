#!/usr/bin/env bash
# Deploys only the redirect file to the rt-cool Pages project, which then
# answers every rt.cool request with a 301 into docs.mattstack.dev.
# `bunx --bun wrangler` silently uploads nothing; run wrangler on Node.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bunx wrangler pages deploy "$ROOT/website/redirects/rt-cool" --project-name rt-cool --branch main "$@"
