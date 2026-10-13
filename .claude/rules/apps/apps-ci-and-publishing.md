---
paths:
  - ".github/workflows/checks.yml"
  - "turbo.json"
  - "scripts/turbo.sh"
  - "scripts/set-platform-version.ts"
  - "packages/*/package.json"
  - "apps/*/package.json"
---

# Apps: CI shape and publishing

## CI shape

Every gate runs through Turborepo (`turbo.json`, entry point
`scripts/turbo.sh`), invoked from the rt monorepo's own
`.github/workflows/checks.yml`, not a `ci.yml` in this directory: the
`static` job calls `scripts/turbo.sh check --affected` on PRs and `check`
on main; `deck-macos` runs `scripts/turbo.sh test --filter=deck` because
deck shells to `plutil`/`launchd`, both macOS-only, and `scripts/turbo.sh`
drops deck off macOS.

`check` is three turbo invocations in order: the two codegen gates
(`@mattstack/tui-kit#gates`, `//#tokens:fresh`) alone and serially, since
they rewrite files the package tests read; the package gates (`typecheck`,
`lint`, `test`, `serve-check`); then the root gates (`lint:root`,
`format:check`, `build-storybook`, `treeshake`, `purity`, `typecheck`,
`docs:check`, `picker:check`, `turbo:test`, `test`) plus
`@mattstack/tokens#test`. `//#turbo:test` covers the turbo config's own
tests
(`scripts/__tests__/turbo-*.test.ts`). The first and last groups run on
every PR whatever changed, because `--affected` walks the package graph
and those tasks read trees the graph does not connect them to; their
declared `inputs` decide the cache hit. The tui-kit visual and parity
oracles are not in `check`; `bun run tui-kit:oracles` runs them locally.

The cache is `<common git dir>/turbo-cache`, shared by every worktree of
the checkout; CI restores the same path from the Actions cache. `--force`
bypasses it. Nothing prunes it locally; delete the directory to reclaim
space. A test that reads files outside its own package must declare
them as `$TURBO_ROOT$` inputs on its package's `test` task
(`scripts/__tests__/turbo-inputs.test.ts` fails otherwise), and every
`$TURBO_ROOT$` glob carries the `node_modules`/`.turbo`/`dist`/`dist-bin`
negations because those globs ignore `.gitignore`.

`setup-bun` is pinned to `1.4.2` in every job. The pin exists because
CI byte-compares generated/committed artifacts (deck's
`core/generated-fresh.test.ts`, tui-kit's codegen gate) against a live
rebuild, and bun's bundler/minifier output is not stable across bun
versions. Bump the pin only together with the local bun upgrade that
regenerates those committed files -- never on its own.

`packages/tui-kit` exports `dist/`, not source. Its `build` runs before any
board or deck task through turbo's `^build` dependency, so nothing has to
be built by hand first.

## Publishing

`packages/glance` publishes to npm on demand
(`packages/glance/docs/releasing.md`; glance-react is private and its npm
versions are deprecated), and `apps/gitq` publishes
`@mattstack/gitq` to npm on demand too (`bun run release`, per
`apps/gitq/docs/releasing.md`); nothing else in this repo publishes.
`@mattstack/app-kit`,
`@mattstack/app-server`, `@mattstack/mantine-tokyo`, and
`@mattstack/tui-kit` each carry a version (bumped together via
`scripts/set-platform-version.ts`), but that version is a tree-internal
identity only. Per the fold-in decision none of them publishes
(`mantine-tokyo` 0.3.0, from before the fold-in, is the last version on
npm), and every one is marked `private`. `packages/tokens` and
`packages/gate-kit` stay private and unpublished. Every app
under `apps/` consumes the four platform packages workspace-only
(`workspace:*`); `@mattstack/rt-client` and `@mattstack/settings-kit` are
likewise private workspace packages linked with `workspace:*`, not
registry pulls. `@mattstack/glance` is a workspace member now
(`workspace:*`, no longer in the catalog); `invadrs` remains a real npm
registry dep. A future app that has not yet folded in as a
workspace member follows `docs/release-and-distribution.md`'s "Adding a
served app" list, not a packed-tarball workflow; do not propose or wire one
up here.
