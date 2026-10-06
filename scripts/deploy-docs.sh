#!/usr/bin/env bash
# Build the mattstack docs site and deploy it to the Cloudflare Worker
# mattstack-docs, which serves build/ as static assets. The Worker's name and
# settings live in website/wrangler.jsonc.
#
# One-time setup (maintainer, outside this script):
#   1. Authenticate wrangler: `wrangler login`, or set CLOUDFLARE_API_TOKEN.
#   2. Run this script once. The first `wrangler deploy` creates the
#      mattstack-docs Worker from website/wrangler.jsonc.
#   3. Add docs.mattstack.dev as a Custom Domain on that Worker in the
#      Cloudflare dashboard (Workers & Pages, mattstack-docs, Settings,
#      Domains & Routes).
#
# Usage:
#   bash scripts/deploy-docs.sh            # build + deploy to production
#   bash scripts/deploy-docs.sh --check    # build only, verify wrangler is present, no deploy
set -euo pipefail

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

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
if ! command -v wrangler >/dev/null 2>&1 && ! $WRANGLER --version >/dev/null 2>&1; then
  echo "error: wrangler not found. Install it (bun add -g wrangler) or run via bunx." >&2
  exit 1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  echo "==> --check: build OK, wrangler available, worker=mattstack-docs. Not deploying."
  exit 0
fi

echo "==> Deploying build/ to the Cloudflare Worker mattstack-docs"
$WRANGLER deploy
echo "==> Deployed. Run bun run docs:smoke to confirm docs.mattstack.dev is live."
