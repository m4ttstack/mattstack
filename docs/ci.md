# CI jobs and what triggers them

A merge-queue run (`merge_group`) runs every job in full on the exact tree
about to land. On a pull request, a job runs only when the diff touches a
path it can be affected by. A push to `main` runs only `purity`: the queue
already tested that tree, and the org's five macOS slots were spending two
thirds of their minutes on post-merge reruns. The `scope` job in
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
| checks | `unit` (1-3 shards) | ubuntu | anything left after the drop-outs below; `full` or `changed` mode |
| checks | `unit-macos` | macOS | a `full` run, or a `changed` run that reaches a test on the Mac-only list (below) |
| checks | `guards` | ubuntu | whenever `unit` is not `full`: runs the `no-*` guards |
| checks | `go` | ubuntu | `ui/`, `package.json`, `checks.yml`, the scope script |
| checks | `deck-macos` | macOS | `apps/deck/`, any non-docs file under `packages/` or at the repo root, `scripts/turbo.sh`, `checks.yml`, the scope script |
| checks | `website` | ubuntu | `website/`, the docs generators and checkers, `lib/command-tree-def.ts`, `checks.yml`, the scope script |
| checks | `plugin-<name>` | per plugin | `plugins/<name>/`, the rt paths in `RT_PLUGIN_TRIGGERS`, `checks.yml`, the scope script |
| e2e | `changes` | ubuntu | always |
| e2e | `e2e-tests` | macOS | anything the compiled binary or the e2e run can reach (below) |
| e2e | `glitter-pty` | macOS | the paths in `GLITTER_TRIGGERS` (the board's inputs, `e2e.yml`, the scope script) |
| purity | `purity` | ubuntu | always |
| timings | `timings` | ubuntu | its own workflow file, or by hand; never a required check |
| nightly-macos | `unit` (3 shards), `report` | macOS, ubuntu | every night, by hand, or its own workflow file; never a required check |

## The unit shards' modes

First, files in trees the shards never run drop out of the diff when no
unit test reads them by path: docs (`docs/`, `.md` and `.mdx` outside
`skills/`), the docs site (`website/`), `rt-tray/` outside the two unit
directories, the apps and plugin trees, workflow files other than
`checks.yml`, repo metadata (`.gitignore` and the like), and `e2e/` files no
unit test imports. A snapshot (`__snapshots__/x.test.ts.snap`) drops out
too, and its own test is added to the run. So does a file in those trees
that a unit test does read by path (`plugin.json`, `rt-tray/deps.lock`,
a Swift file a parity test checks): the tests reading it are added to the
run whole, since `--changed` cannot see a read that is not an import. When
the reader is not a test, the tests importing the reader are added
instead; a reader no test imports forces full. Then:

- **skip**: nothing is left.
- **full**: every unit test, in three shards. Any push, any change to
  `checks.yml`, `e2e.yml` (the scope test pins both gates) or the scope
  script, and any remaining file `--changed` cannot trace (a non-TypeScript
  file such as `bun.lock`, a fixture, the preload or its imports,
  `packages/glance/`).
- **changed**: `--changed=HEAD^1` over what is left, which is all
  TypeScript. Scope sizes the run from `test-timings.json`: the selected
  tests' recorded time against a full shard's, so a small change takes one
  runner and a wide one up to three. The estimate only sets wall time;
  bun's `--changed` still picks the tests.

"Read by path" means a unit test or one of its imports names the file:
its full repo path quoted (also after `../` or `${ROOT}/`), the same path
spelled as `join()` segments (`"apps", "board", "server.ts"`), or its name
as a whole quoted segment (`join(ROOT, "rt-tray", "build.sh")`). Prose that
mentions a file does not count. Plugin files, apps files and generic names
(`README.md`, `package.json`) count only by full path. A file a unit test
imports never drops out. A `no-*` guard never counts as a reader, since
`guards` runs every one whenever the shards are not full. Docs-site files
are never checked: the tests that read the site are guards, and `static`'s
`docs:check` covers the generated reference.

## Tests that need a Mac

`scripts/ci/macos-only-tests.txt` lists the unit tests that cannot run on
ubuntu, one bare repo-relative path per line. `unit` passes each one to
`--path-ignore-patterns`, where a `./` prefix matches nothing and would leave
the test on ubuntu, so the scope test refuses one. It also refuses an entry
whose file is gone.

| Test | Needs |
|---|---|
| `commands/__tests__/worktree-hydrate-clone.test.ts` | `clonefile(2)` |
| `lib/__tests__/daemon-logger.test.ts` | native stderr redirect, a no-op elsewhere |
| `lib/release/__tests__/dev-app-cache.test.ts` | `codesign` |
| `lib/worktree/__tests__/clonefile.test.ts` | `clonefile(2)` |
| `rt-tray/vm/run/helpers/__tests__/install-chrome.test.ts` | `plutil`, `ditto` |
| `scripts/__tests__/fetch-deps-make-src.test.ts` | `otool`, `lipo`, `cc -dynamiclib` |
| `scripts/__tests__/render-launchagents.test.ts` | `PlistBuddy`, `plutil` |

`unit-macos` runs the whole list on a `full` run. On a `changed` run it takes
the listed tests the diff reaches, by import or by a path a test reads, or the
whole list when the diff touches a workspace package, since the import walk
stops at a bare import. Nothing reached skips it.

A new test that needs a Mac fails on ubuntu on its own PR, and the author adds
it there. One gated with `process.platform !== "darwin"` would pass on ubuntu
without running, so the scope test requires it on the list. A test that only
names a Mac path, identity or tool gets made portable instead, and a flake
gets fixed, never listed.

`nightly-macos.yml` runs the whole suite on macOS every night, so a bug only a
Mac shows, in a file not on the list, can reach main and is caught the next
night. `rt check` still runs a changed file's tests on the developer's Mac. A
red night opens one issue, and a later red comments on it.

## What e2e skips

`e2e-tests` compiles `cli.ts` and runs `e2e/` under the bunfig preload, so
it runs only when the diff can reach those. A diff made only of these skips
it: docs, `website/`, the apps trees, `plugins/`, `rt-tray/`, Go source
under `ui/`, workflow files other than `e2e.yml`, and rt TypeScript outside
`packages/` that neither `cli.ts`, `e2e/` nor the preload imports (a unit
test, a script). Workspace packages always count, since `cli.ts` reaches
them through bare imports, and so does a `packages/*/package.json` change,
since `e2e/setup.ts` rebuilds the binary on one.

## Jobs left ungated

`static` and `purity` run on every PR. Both are ubuntu and short, `static`
already narrows its turbo gates with `--affected`, and both check things no
path rule can rule out (the lockfile, workflow lint, the PR text).

## Required checks

Branch protection requires `checks`, `e2e` and `purity`, and a ruleset puts
every merge through the merge queue (squash, batches of up to five). The
queue waits for the same three checks on its `merge_group` run before
landing the batch. `checks` and `e2e` are aggregate jobs that run with
`always()`: each fails when its scope job fails, and passes a skipped job
only when scope said that job did not apply. A gated job that is skipped
for any other reason fails the gate. `glitter-pty` is not part of the `e2e`
gate, so it stays advisory.
