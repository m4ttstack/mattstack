#!/usr/bin/env bash
# Build the mattstack docs site and deploy it to the Cloudflare Worker
# mattstack-docs, which serves build/ as static assets on docs.mattstack.dev.
# The Worker's name, assets, routing and custom domain live in
# website/wrangler.jsonc, and wrangler is pinned in website/package.json.
#
# One-time setup (maintainer, outside this script):
#   Authenticate wrangler: `wrangler login`, or set CLOUDFLARE_API_TOKEN.
#   The first deploy creates the Worker and attaches docs.mattstack.dev.
#
# Usage:
#   bash scripts/deploy-docs.sh            # build + deploy to production
#   bash scripts/deploy-docs.sh --check    # build + wrangler dry run, nothing uploaded
set -euo pipefail

USAGE="usage: bash scripts/deploy-docs.sh [--check]"
CHECK_ONLY=0
case "$#:${1:-}" in
  0:) ;;
  1:--check) CHECK_ONLY=1 ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/website"

echo "==> Building site"
bun install --frozen-lockfile
bun run build

if [ ! -f build/index.html ]; then
  echo "error: build/ missing index.html; aborting" >&2
  exit 1
fi

# Run wrangler on the Node runtime, not Bun's: under `bunx --bun`, a wrangler
# deploy has been seen to upload nothing, silently.
WRANGLER="bunx wrangler"
WORKER="$(bun -e 'console.log((await import("./wrangler.jsonc")).default.name)')"

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "==> --check: wrangler dry run for the Worker $WORKER"
  $WRANGLER deploy --dry-run
  echo "==> --check: build OK, wrangler config valid, worker=$WORKER. Not deploying."
  exit 0
fi

echo "==> Deploying build/ to the Cloudflare Worker $WORKER"
$WRANGLER deploy
echo "==> Deployed. Run bun run docs:smoke to confirm docs.mattstack.dev is live."
