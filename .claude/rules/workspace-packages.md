---
paths:
  - "packages/rt-client/**"
  - "packages/glance/**"
  - "packages/settings-kit/**"
  - "packages/tui-kit/**"
---

# Workspace packages

## `rt-client`, `settings-kit` and `tui-kit` are private workspace packages

`packages/rt-client`, `packages/settings-kit` and `packages/tui-kit` publish
nowhere; every consumer inside this monorepo (rt itself, board, console,
chat, boxscore, deck, gitq) links the workspace package directly, and the
root `postinstall` builds all three `dist/` directories. There is no npm
version to announce or renumber for any of the three.

`packages/glance` links the same way in-repo (rt-client, the VS Code
extension and root typecheck all resolve its `workspace:*` dist), but it is
not private: it publishes to npm on its own schedule via `bun publish`
(`packages/glance/docs/releasing.md`), never through the shared
`scripts/set-platform-version.ts` bump.

## `packages/rt-client/dist/` goes stale without warning

`dist/` is gitignored. Inside this monorepo, consumers link the workspace
package, and `dist/` is what their `import` condition resolves; the root
`postinstall` and turbo's `^build` rebuild it. So any change or merge that
touches rt-client's source leaves every in-workspace consumer, gitq
included, resolving the previous build until the next install or turbo run.
The source is right, the shipped artifact is not, and nothing about the
working tree looks wrong. Run `bun run build` in `packages/rt-client` after
touching it, and after any merge that does.

`packages/rt-client/test/dist-freshness.test.ts` is the guard and names the fix in its failure message. Treat that failure as a real instruction, not as a flaky artifact test. It caught this three separate times in one day across three sessions.

`packages/glance/dist/` is the same trap: root typecheck, rt-client's build
and the VS Code extension all resolve it through `workspace:*`, while bun
itself reads `src/` directly. Run `bun run build` in `packages/glance` after
touching its source, and after any merge that does.
