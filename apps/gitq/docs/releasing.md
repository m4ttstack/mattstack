# Releasing gitq

Maintainer notes for cutting a version of `@mattstack/gitq`.

## The release script

```bash
bun run release patch          # or minor, major, or an explicit 1.2.3
bun run release patch --dry-run
```

The script verifies you are on a clean `main` in sync with origin, bumps the
version, runs the type check and the unit tests, publishes, then commits the
bump and pushes it with a `gitq-v<version>` tag. Publishing happens before
tagging, so a failed publish leaves the repo untouched and the command
rerunnable. Run it from `apps/gitq`.

Three details it handles that are easy to get wrong by hand:

- **It publishes with `bun publish`, not `npm publish`.** npm leaves this
  suite's `workspace:` and `catalog:` dependency protocols verbatim in the
  published manifest, which produces a package nobody can install.
- **It refuses to publish while `@mattstack/glance` is not yet on npm at the
  version this tree has.** `bun publish` rewrites `workspace:*` to that
  package's own version, so an installer needs it to already resolve.
- **It waits for the registry to serve the new version.** npm's metadata can
  lag the tarball on a fresh publish, leaving a version that exists but cannot
  be resolved by a range.

## The tag workflow

The `gitq-v*` tag records the npm publish; it triggers nothing on its own (a
bare `v*` tag is what runs rt's mattstack.app release, which is why gitq's
own tag carries the `gitq-` prefix).

The darwin-arm64 binary that ships inside the mattstack app bundle is built
separately, from this tree, at the mattstack.app release tag: rt's
`scripts/build-apps.ts` runs gitq's own `bundle.build`
(`apps/gitq/mattstack.deck.json`), and the `build-apps` job in rt's
`.github/workflows/release.yml` does this for every release. The binary is
unsigned on purpose; the mattstack app bundle pipeline owns code signing,
shipping the result as `Contents/Helpers/gitq` so `gitq board` can serve the
page on a machine with no checkout on it.

Build that binary locally with:

```bash
bun run build:binary
```

It bundles the board's client assets into a standalone `dist/gitq`.
