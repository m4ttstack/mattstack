# Linux unit shards: design

Date: 2026-11-03. Status: approved 2026-11-03.

## Why

The unit suite takes 1106s on macOS and 529s on ubuntu, and the org has about
5 macOS slots against about 20 Linux slots. macOS queue time is the largest
wait left in CI. The ubuntu probe showed only 28 of 1143 test files fail
there, and several of those fail on setup rather than on a Mac dependency.

## Goals

- PR and merge queue unit runs happen on ubuntu.
- Tests that truly need a Mac still gate every PR that reaches them, on macOS.
- A full macOS run happens every night.

## Non-goals

- Moving `e2e.yml`, `deck-macos`, or plugin jobs off macOS.
- Changing what `rt check` runs. It runs on the developer's Mac, so a changed
  file's tests keep macOS coverage at push time for free.
- A self-hosted runner.

## Decisions Matt made

- **Where the full macOS run lives:** nightly on a schedule. PRs and the
  merge queue both use ubuntu plus the Mac-only job. Accepted cost: a bug that
  only shows on a Mac, in a file not on the list, can reach main and is caught
  the next night.
- **Marking Mac-only tests:** fix the setup failures, then keep what is left
  in one committed list.

## Approaches considered

1. **Setup fixes plus a committed list** (chosen).
2. **List all 28 as they are.** Quicker, but keeps a larger macOS job for
   files that may only need a git identity.
3. **`skipIf(platform)` in each file.** The macOS job could not name its
   files without scanning, and ubuntu still pays to load skipped files.

## The how

**The list.** `scripts/ci/macos-only-tests.txt`, one repo-relative test path
per line. `scripts/ci/test-scope.ts` reads it. A test fails if an entry names
a file that does not exist, so the list cannot go stale. A new test that
needs a Mac fails on ubuntu on its own PR, and the author adds it there.

**`unit` moves to ubuntu.** `runs-on: ubuntu-latest`, with `zsh age zstd
git-lfs` and a git identity installed, as the probe does. It adds one
`--path-ignore-patterns` per list entry. `--changed`, the paired halves and
`--timeout 20000` stay. The read-by-path `extra` tests are split the same way.

**New `unit-macos` job.** Runs the list on `macos-latest`, one job, paired
halves as today. In `changed` mode scope emits only the listed files the diff
reaches (a new `macos` output), plus any listed `extra`, and the job is
skipped when that is empty. In `full` mode it runs the whole list. The
`checks` gate needs it, and a skip is a pass only when scope says nothing
reached it, as `unit` is treated today.

**Nightly macOS.** A new scheduled workflow runs the whole suite on macOS with
today's three-shard shape and `workflow_dispatch` for a manual run.

**Timings.** `timings.yml` moves to ubuntu, because the shards it balances
moved. Its Mac-only files drop out of the balance.

**Retire the probe.** `unit-linux-probe.yml` and its actionlint entry go, since
the `unit` job now gives the same answer on every PR.

**Docs.** `docs/ci.md`, `.claude/rules/ci-and-tests.md`, and the `AGENTS.md`
line on the macOS shards.

## Calls I made

- **A red nightly opens or updates one GitHub issue.** A scheduled run's
  failure otherwise only emails whoever last edited the workflow, and an
  unseen red defeats the point of the nightly.
- **Flake check before freezing the list.** The list comes from at least two
  ubuntu runs of the fixed suite, since one probe cannot tell a flake from a
  real failure. A flake gets fixed or reported, not listed.

## Left to the builder

- The fix for each setup failure, working from the probe's 28 files. Likely
  setup: `lib/team/__tests__/create.test.ts` (first commit),
  `could not lock config file /dev/null`, committer identity. Likely Mac-only:
  anything loading `/usr/lib/libSystem.B.dylib`, `fetch-deps.sh arm64` on an
  x86_64 host, `cc -dynamiclib`.
- Confirming `--path-ignore-patterns` composes with `--changed` and `--shard`
  on bun 1.4.4. If it does not, ubuntu runs named file lists instead.

## Follow-ups

- Whether e2e can follow the unit suite to ubuntu.
