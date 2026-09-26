# Testing gitq

## Running the suites

```bash
bun run test          # unit suite, then integration suite
bun run check-types   # tsc --noEmit
```

`bun run test` rather than a bare `bun test`: the unit files call
`mock.module`, and those mocks leak between files that share a run. `bun run
check-types` is the only other check, and there is no linter.

To run a single file:

```bash
bun test --timeout 30000 tests/integration/cascade-rebase.test.ts
```

`tests/preload.ts` (wired through `bunfig.toml`) repoints `HOME` and
`GITQ_CONFIG_DIR` at fresh temp directories before any module import, so a test
run never reads or writes your real `~/.mattstack`.

## The two forge-write tests

Two integration files write to a real forge. They skip unless you hand them
credentials, so an ordinary run reports them as skips:

```bash
# GitLab
GITLAB_TOKEN=... GITLAB_PROJECT_PATH=<namespace>/gitq-test-sandbox \
  bun test --timeout 180000 tests/integration/forge-write-gitlab.test.ts

# GitHub
GITHUB_TOKEN="$(gh auth token)" GITHUB_REPO=<owner>/gitq-test-sandbox \
  bun test --timeout 180000 tests/integration/forge-write-github.test.ts
```

Both open real branches and merge/pull requests on the project you name and
close them again in `afterAll`. Point them at a scratch project, never a live
one.

The GitHub file takes about 40 seconds because it waits out GitHub's search
index, which is eventually consistent and does not list a just-opened PR for
the first several seconds.
