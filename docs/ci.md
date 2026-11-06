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
| checks | `unit-macos` | macOS (see [The Mac runner](#the-mac-runner)) | a `full` run, or a `changed` run that reaches a test on the Mac-only list (below) |
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
the test on ubuntu, so the scope test refuses one. The
`no-macos-list-drift` guard refuses an entry whose file is gone.

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
without running, so the same guard requires it on the list. A test that only
names a Mac path, identity or tool gets made portable instead, and a flake
gets fixed, never listed.

`nightly-macos.yml` runs the whole suite on macOS every night, so a bug only a
Mac shows, in a file not on the list, can reach main and is caught the next
night. `rt check` still runs a changed file's tests on the developer's Mac. A
red night opens one issue, and a later red comments on it.

## The Mac runner

Matt's PRs and queue runs can use self-hosted runners on his Intel Mac mini
(2018, 6 cores, 12 threads) instead of GitHub's macOS pool, so a GitHub macOS
outage does not stop them landing. Everything else stays on `macos-latest`:
another author's PR, a queue batch holding one, and the nightly. Only the macOS
legs run there: `unit-macos`, `deck-macos`, `plugin-herdr-chat`, `e2e-tests`
and `glitter-pty`. A typecheck takes about three times as long as on Apple
silicon, while light tests run about the same.

The `scope` and `changes` jobs run `scripts/ci/macos-runner.ts`, and the macOS
jobs read `runs-on` from its output. It picks the Mac only when the
`MAC_RUNNER` repo variable is `on`. A PR can edit that routing, so it is not the
protection: a job-started hook on the Mac runs the same rule from a root-owned
copy and fails any job it refuses before checkout. Change the rule, then rerun
the installer, or the Mac keeps the old copy.

The hook stops jobs it refuses, not a job it admits. An admitted job, including
a compromised dependency in one of Matt's PRs, runs as the same user as the
runner and can disable the hook for later jobs. It still cannot read Matt's home.

Every runner shares the Mac's localhost, so a process a job leaves behind can
hold a port against every later job. A job-completed hook stops any process
still running a binary from that runner's own `_work` folder, such as
`dist/rt --daemon`, including after a cancelled job. It does not catch `bun`
or `node` running a script from there, and it does not run if the runner itself
dies, so a test must still take a free port, never a fixed one.

- **Set up:** `scripts/ci/mac-runner/install.sh 3`, then
  `gh variable set MAC_RUNNER --body on`. The runners are launchd daemons under
  a separate `mattstack-ci` user that cannot read your home. The argument is
  the runner count (five when left out); the mini runs three, since more
  parallel jobs than its threads can carry fail full checks. The installer
  picks the runner build for the Mac's CPU, Intel or Apple silicon. It needs
  `gh` signed in, a home folder at `chmod 700`, and a bun: the one on PATH, or
  the mattstack app's. A rerun with a smaller count removes the runners above it.
- **Back to GitHub's runners:** `gh variable delete MAC_RUNNER`. A run picks the
  variable up when it starts.
- **Remove:** clear the variable, then `scripts/ci/mac-runner/uninstall.sh`.

### Changing the runners

The runners run from copies outside the repo: the hooks, the routing rule and
bun in `/usr/local/mattstack-ci/`, and one plist per runner in
`/Library/LaunchDaemons/dev.mattstack.ci-runner-<n>.plist`. A merge changes
neither, so a change to a hook or a plist setting does nothing until the
installer runs. The workflows run the repo's `macos-runner.ts`, so a merged
routing change applies at once while the hook keeps enforcing the old rule, and
it can refuse jobs the new rule sends to the Mac until the installer runs.

- **Who runs it:** Matt, in a real terminal. It needs sudo's password, which
  an agent cannot give, and a shell started with `!` has no TTY.
- **From where:** a new clone of `main` each time, since a shared checkout or
  an older clone can lag it:

  ```bash
  dir=$(mktemp -d /tmp/mattstack-install.XXXXXX)
  gh repo clone m4ttstack/mattstack "$dir" -- --depth 1
  cd "$dir"
  scripts/ci/mac-runner/install.sh 3
  ```

- **When:** with every runner idle and the merge queue empty. It restarts all
  the runners, which kills their jobs and drops any PR in the queue. A PR can
  enter the queue at any moment, so check right before running it.
- **A partial run:** rerun the installer once the runners are idle. It rewrites
  every plist and restarts every runner.
- **Check it:** `launchctl print system/dev.mattstack.ci-runner-<n>` lists a
  runner's environment, and
  `gh api repos/m4ttstack/mattstack/actions/runners --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"'`
  shows whether GitHub sees it. A restarted runner reads offline for up to a
  minute.

### Moving the runners to another Mac

With the merge queue empty and every runner idle, install on the new Mac first,
then uninstall on the old one, so a queue run never finds no runner:

1. On the new Mac, in a real terminal: install `gh` and run `gh auth login`,
   run `chmod 700 ~`, then run the installer from a new clone of `main` as above,
   with the count that Mac can carry.
2. On the old Mac, in a real terminal: `scripts/ci/mac-runner/uninstall.sh`
   from a clone of `main`. Leave `MAC_RUNNER` on, since the new Mac's runners
   carry the same label.
3. Check that GitHub lists only the new Mac's runners, all online:
   `gh api repos/m4ttstack/mattstack/actions/runners --jq '.runners[] | "\(.name) \(.status) \(.os)"'`.

Each Mac names its runners after itself, `mattstack-<LocalHostName>-<n>`
(`mattstack-mac-mini-1` on the mini), and the uninstall removes only the
registrations in its own runner folders, so neither Mac touches the other's
runners. Runners installed before per-Mac names read `mattstack-mac-<n>`.

A PR stuck on an old route needs a new push, since a rerun reuses the workflow
the run started with. Queue runs use the merged tree, so they switch at once.

### A process left on a runner

To find what holds a port, use `nc -z -G 2 127.0.0.1 <port>` and
`ps -axo pid,ppid,user,lstart,command | grep mattstack-ci`. `lsof` shows nothing
here, since the process belongs to another user. Killing one needs Matt's
`sudo kill <pid>` in a real terminal.

## What e2e skips

`e2e-tests` compiles `cli.ts` and runs `e2e/` under the bunfig preload, so
it runs only when the diff can reach those. A diff made only of these skips
it: docs, `website/`, the apps trees, `plugins/`, `rt-tray/`, Go source
under `ui/`, workflow files other than `e2e.yml`, and rt TypeScript outside
`packages/` that neither `cli.ts`, `e2e/` nor the preload imports (a unit
test, a script). Workspace packages always count, since `cli.ts` reaches
them through bare imports, and so does a `packages/*/package.json` change,
since `e2e/setup.ts` rebuilds the binary on one.

## Before you push

`rt check` runs the repo's check command from the tree root, and `git_push`
runs it first and refuses a red push. `rt.check` is a user or machine scope
setting, per repo, because `git_push` runs the command with no prompt: nothing
in a team or org store can run on your Mac. For this repo set it to
`{"command": "bun scripts/ci/local-check.ts", "timeoutSeconds": 1500}`; a full
run takes 11 to 15 minutes, past the 600s default. The script takes
`RT_CHECK_BASE` and `RT_CHECK_HEAD`, asks `test-scope.ts` what a PR with that
diff would run, and runs the same unit selection the shards use:
`bun test <dirs> --changed=<base>` split across half the cores (at most six
processes) with `test-timings.json`, then the tests CI reads by path in their
own call. A diff the scope script would skip runs nothing, and a diff it would
make full runs the whole suite. The `no-*` guards are left to the `guards` job
unless the run is full, which `RT_CHECK_FULL=1` forces. A full run builds
`packages/rt-client` first, as CI's postinstall does, since the suite checks
that `dist/` is fresh; a scoped run does not. This runs on your Mac, so it
takes every selected test, the Mac-only list included. The exit code is the
verdict, and the last stdout line is a JSON summary (`mode`, `selected`,
`passed`, `failed`, `durationMs`, `failures`), printed on red too, where
`failedTests` adds the failing tests' names, 20 at most. `selected` counts the
tests that ran, and a run that ran none reports `skip`. A failure
before any test runs (a bad ref, a syntax error in the scope script) prints
`mode: "error"` and exits 1; a SIGTERM or SIGINT stops the test processes. It
runs unit tests only: no typecheck, e2e or path-gated job.

A run posts the `rt/local-check` commit status for its verdict: green as
success, red as failure, and an error (a timeout, a command that could not
run) as error. Nothing is posted for a dirty tree, a HEAD that moved during the
run, a commit not yet on the remote, `--no-status`, a host other than github.com, a `--base`
ref that is not a commit, or a HEAD rt cannot read. That status is the pusher's attestation that this sha ran its scoped tests on
their machine, and anyone who can push can post it. The merge queue's full, hosted run is
still what lands a tree, so a wrong local status cannot break `main`.

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

Enter the queue with `mr_merge`, or with `rt pr enqueue <number>` by hand. Here, `gh pr merge` has failed
with "Auto merge is not allowed for this repository" while another PR was
queued.
