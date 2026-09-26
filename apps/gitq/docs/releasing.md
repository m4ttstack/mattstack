# Releasing gitq

Maintainer notes for cutting a version of `@mattstack/gitq`.

## The release script

```bash
bun run release patch          # or minor, major, or an explicit 1.2.3
bun run release patch --dry-run
```

The script verifies you are on a clean `main` in sync with origin, bumps the
version, runs the type check and the unit tests, publishes, then commits the
bump and pushes it with a `v<version>` tag. Publishing happens before tagging,
so a failed publish leaves the repo untouched and the command rerunnable.

Two details it handles that are easy to get wrong by hand:

- **It publishes with `bun publish`, not `npm publish`.** npm leaves this
  suite's `workspace:` and `catalog:` dependency protocols verbatim in the
  published manifest, which produces a package nobody can install.
- **It waits for the registry to serve the new version.** npm's metadata can
  lag the tarball on a fresh publish, leaving a version that exists but cannot
  be resolved by a range.

## The tag workflow

Pushing a `v*` tag runs `.github/workflows/release.yml`, which publishes a
GitHub Release carrying a bun-compiled `darwin-arm64` binary plus its sha256.
The workflow asserts three things agree before it publishes: the git tag, the
`package.json` version, and what the built binary prints for `gitq --version`.

The binary is unsigned on purpose. The mattstack app bundle pipeline pulls
these artifacts and owns code signing, shipping the result as
`Contents/Helpers/gitq` so `gitq board` can serve the page on a machine with
no checkout on it.

Build that binary locally with:

```bash
bun run build:binary
```

It bundles the board's client assets into a standalone `dist/gitq`.
