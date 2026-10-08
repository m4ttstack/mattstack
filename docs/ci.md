# CI jobs and what triggers them

Every push to `main` runs every job. On a pull request, a job runs only
when the diff touches a path it can be affected by. The `scope` job in
`checks.yml` and the `changes` job in `e2e.yml` both run
`scripts/ci/test-scope.ts`, which holds every rule below, and
`scripts/ci/__tests__/test-scope.test.ts` pins each one.

A PR's diff is `HEAD^1..HEAD` of its merge ref, so it is exactly the PR's
own changes.

## Jobs

| Workflow | Job | Runner | On a PR, runs when the diff touches |
|---|---|---|---|
| checks | `scope` | ubuntu | always |
| checks | `static` | ubuntu | always (turbo's `--affected` narrows the apps gates) |
| checks | `unit` (3 shards) | macOS | anything but the skip set below; `full` or `changed` mode |
| checks | `guards` | ubuntu | whenever `unit` is not `full`: runs the `no-*` guards |
| checks | `go` | ubuntu | `ui/`, `package.json`, `checks.yml`, the scope script |
| checks | `deck-macos` | macOS | `apps/deck/`, any non-docs file under `packages/` or at the repo root, `scripts/turbo.sh`, `checks.yml`, the scope script |
| checks | `website` | ubuntu | `website/`, the docs generators and checkers, `lib/command-tree-def.ts`, `checks.yml`, the scope script |
| checks | `plugin-<name>` | per plugin | `plugins/<name>/`, the rt paths in `RT_PLUGIN_TRIGGERS`, `checks.yml`, the scope script |
| e2e | `changes` | ubuntu | always |
| e2e | `e2e-tests` | macOS | anything but the e2e skip set below |
| e2e | `glitter-pty` | macOS | the paths in `GLITTER_TRIGGERS` (the board's inputs, `e2e.yml`, the scope script) |
| purity | `purity` | ubuntu | always |

## The unit shards' modes

- **full**: every unit test. Any push, any change to `checks.yml` or the
  scope script, and any file `--changed` cannot trace (a non-TypeScript
  file, a fixture, the preload or its imports, `packages/glance/`).
- **changed**: `--changed=HEAD^1`, for a TypeScript-only diff the import
  graph can see.
- **skip**: the diff is only docs (`docs/`, `.md` and `.mdx` outside
  `skills/`), the docs site (`website/`), Swift under `rt-tray/`, the apps
  trees, plugin trees or workflow files other than `checks.yml`, and no unit
  test reads one of them by path. Docs-site files are never checked that
  way: the tests that read the site are `no-*` guards, which `guards` runs.

## What e2e skips

`e2e-tests` compiles `cli.ts`, which imports nothing from these trees, and
builds no rt-ui, so a diff made only of them skips it: docs, `website/`,
the apps trees, `plugins/`, `rt-tray/`, Go source under `ui/`, and workflow
files other than `e2e.yml`. A `packages/*/package.json` change still runs
it, since `e2e/setup.ts` rebuilds the binary on one.

## Required checks

Branch protection requires `checks`, `e2e` and `purity`. `checks` and `e2e`
are aggregate jobs that run with `always()`: each fails when its scope job
fails, and passes a skipped job only when scope said that job did not
apply. A gated job that is skipped for any other reason fails the gate.
`glitter-pty` is not part of the `e2e` gate, so it stays advisory.
