# Linux unit shards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR and merge queue unit tests run on ubuntu, tests that truly need a Mac run on a small macOS job, and a full macOS run happens nightly.

**Architecture:** Fix what the probe showed is not a Mac dependency, keep the rest in `scripts/ci/macos-only-tests.txt`, teach `test-scope.ts` to route that list, then move the jobs. CI on the PR is the Linux test; a throwaway container only shortens the loop.

**Tech Stack:** bun 1.4.4 (CI's pin), GitHub Actions, bash.

**Spec:** `docs/superpowers/specs/2026-11-03-linux-unit-shards-design.md`

## Global Constraints

- Required check names stay `checks`, `e2e`, `purity`.
- `--changed`, the paired halves and `--timeout 20000` stay on `unit`.
- `e2e.yml`, `deck-macos`, plugin jobs and `rt check` do not change.
- A flake gets fixed or reported, never listed. The list comes from at least two ubuntu runs of the fixed suite.
- A red nightly opens or updates one GitHub issue.
- Stay out of `scripts/ci/local-check.ts`, the `readTimings` export and the "Before you push" section of `docs/ci.md`.
- No employer host, ticket id or customer name anywhere.

## What the probe's log showed

27 files fail, not 28: `walkthrough-teardown.test.ts` had no failure of its own. The probe's awk pinned the summary's repeated `(fail)` lines on the last file.

| Root cause | Files | Fix |
|---|---|---|
| No git identity. `git config --global` went to the runner's real HOME and the preload repoints HOME, so the probe never had one. A Mac has an implicit identity; a runner has an empty GECOS name | `lib/team/__tests__/create`, `lib/setup/__tests__/steps-a`, `lib/__tests__/repo-reidentify-locate`, `lib/worktree/__tests__/git-async`, `packages/git-core/src/__tests__/tags-mutations`, `commands/git/__tests__/reset`, `commands/git/__tests__/rebase`, `scripts/__tests__/move-to-team-directory`, `lib/daemon/__tests__/home-snapshot` | `sudo git config --system`, the lowest precedence, so a test's own identity still wins |
| State leaked across files in one process | `commands/__tests__/member-upgrade` (`org-data-branch` leaves `HOME` and `GIT_CONFIG_GLOBAL=/dev/null`), `commands/__tests__/team-status` (`humanStream`), `lib/worktree/__tests__/config` (settings warn sink) | Restore or reset in the test |
| The test assumes a Mac detail, behaviour is portable | `lib/state/__tests__/barrel` (`.bun` is the Linux twin of `Library`), `lib/daemon/__tests__/pane-resolve-live` (`/private/tmp`), `lib/mcp/__tests__/gate-tools` (realpath of a mode-000 file) | Portable test |
| A real bug the Mac's SQLite hides | `lib/daemon/__tests__/mr-upload-scan`. A read-only open leaves an empty `-wal` under upstream SQLite, which flips `dbSignature` | Treat an empty WAL as no WAL |
| Real `clonefile(2)` where the test is about hydration | `lib/worktree/__tests__/hydrate`, `lib/daemon/__tests__/worktree-handlers`, `lib/daemon/reconciler/__tests__/replenish` | Shared clone seam, a copy off macOS |
| The host guard, where the test is about unpacking | `scripts/__tests__/fetch-deps-tree`, `-skills`, `-identity` | Stub `uname` |
| Genuinely needs a Mac | `lib/worktree/__tests__/clonefile`, `commands/__tests__/worktree-hydrate-clone`, `scripts/__tests__/render-launchagents`, `scripts/__tests__/fetch-deps-make-src`, `rt-tray/vm/run/helpers/__tests__/install-chrome` | The list |

**bun 1.4.4, checked in a scratch repo:** `--path-ignore-patterns` composes with `--changed` and `--shard`, and an empty shard exits 0. A `./`-prefixed pattern matches nothing and silently ignores nothing, so entries must be bare paths.

## Review Focus

1. An entry written `./lib/x.test.ts` ignores nothing, and ubuntu runs the Mac test. Task 5 pins bare paths.
2. A change in a workspace package reaches a listed test through a bare import the relative walk cannot follow. Task 5 runs the whole list for one.
3. `extra` names a listed test. Task 5 routes it to `macos` and never to ubuntu.
4. A skipped `unit-macos` must pass the gate only when scope said so. Task 6 pins it.
5. A scheduled red with an issue already open must comment, not open a second. Task 7 pins both paths.

---

### Task 1: Stop state leaking across test files

**Files:** `lib/team/__tests__/org-data-branch.test.ts`, `commands/__tests__/team-status.test.ts`, `lib/worktree/__tests__/config.test.ts`

- [ ] Reproduce each leak on a Mac by running a scratch file that leaves the state ahead of the victim in one process. Expected: the probe's failure.
- [ ] `org-data-branch`: `afterAll` restores `HOME` and `GIT_CONFIG_GLOBAL`.
- [ ] `team-status`: the human output test calls `io.reset()` before setting its gate.
- [ ] `config`: `setSettingsWarnSink(null)` before the warn test's call.
- [ ] Rerun the reproductions, expect pass, commit.

### Task 2: Portable expectations, and the WAL signature

**Files:** `lib/state/__tests__/barrel.test.ts`, `lib/daemon/__tests__/pane-resolve-live.test.ts`, `lib/mcp/__tests__/gate-tools.test.ts`, `lib/daemon/handlers/mr-upload.ts`, `lib/daemon/__tests__/mr-upload-scan.test.ts`

- [ ] Write the failing test in `mr-upload-scan`: an empty `-wal` appearing between two scans re-reads nothing. Watch it fail.
- [ ] `dbSignature`: an empty WAL signs as no WAL. Watch it pass.
- [ ] `barrel`: filter `.bun` beside `Library`, for the same reason.
- [ ] `pane-resolve-live`: the pane's cwd is `/private/tmp/wt` on macOS and `/tmp/wt` elsewhere.
- [ ] `gate-tools`: keep the exact message per platform and rename the test for what is portable, the refusal before anything opens.
- [ ] Run the touched files, commit.

### Task 3: A clone seam for the hydration suites

**Files:** Create `lib/worktree/__tests__/in-process-clone.ts`. Modify `lib/worktree/__tests__/hydrate.test.ts`, `lib/daemon/__tests__/worktree-handlers.test.ts`, `lib/daemon/reconciler/__tests__/replenish.test.ts`

**Produces:** `export const inProcessClone: CloneRunner`, real `clonefile(2)` on macOS and a recursive copy that refuses an existing destination elsewhere.

- [ ] Add the helper and replace the three local copies.
- [ ] Run all three on a Mac, expect pass, commit. Their Linux result comes from a container and CI.

### Task 4: A fake arm64 host for the unpack tests

**Files:** Create `scripts/__tests__/fake-arm64-host.ts`. Modify `scripts/__tests__/fetch-deps-{tree,skills,identity}.test.ts`

**Produces:** `fakeArm64Path(dir: string): string`, a PATH with a `uname` stub first.

- [ ] Add the helper and pass that PATH in each `runScript`.
- [ ] Run all three, commit.

### Task 5: The list, and scope routes it

**Files:** Create `scripts/ci/macos-only-tests.txt`. Modify `scripts/ci/test-scope.ts`, `scripts/ci/__tests__/test-scope.test.ts`

**Produces:** `macosOnlyTests(root?: string): string[]`, `macosTests(decision: Decision, changed: string[], selected: string[], list: string[]): string[]`, and a `macos=` output of `./`-prefixed paths.

- [ ] Write the failing tests: every entry exists, is a test file under a unit directory, is bare, is unique and sorted; `full` runs the list; `skip` runs nothing; `changed` runs only what it reaches, a listed `extra` included; a workspace package change runs the list; the `extra` output never names a listed test; shard sizing leaves listed tests out; `macos` is a written output.
- [ ] Implement, run the test file, commit.

### Task 6: Move `unit`, add `unit-macos`

**Files:** Create `scripts/ci/unit-halves.sh`. Modify `.github/workflows/checks.yml`, `scripts/ci/__tests__/test-scope.test.ts`

- [ ] Write the failing wiring test: `unit` runs on ubuntu with `--path-ignore-patterns` from the list, `unit-macos` runs on macOS when `macos` is not empty, and the gate passes a skip only when `macos` is empty.
- [ ] `unit`: `ubuntu-latest`, install `age zstd git-lfs zsh`, identity through `sudo git config --system`.
- [ ] Move the halves into `unit-halves.sh`, used by `unit`, `unit-macos` and the nightly.
- [ ] Run the wiring tests, commit.

### Task 7: Nightly macOS

**Files:** Create `.github/workflows/nightly-macos.yml`, `scripts/ci/__tests__/nightly-macos.test.ts`. Modify the actionlint list in `checks.yml`

- [ ] Write the failing tests: `schedule` and `workflow_dispatch`, three shards on `macos-latest`; with a stub `gh`, the report step creates an issue when none is open and comments when one is.
- [ ] Write the workflow. It also runs on a `pull_request` touching itself, as `timings.yml` does, since a schedule cannot run from a branch. Only a `schedule` run reports.
- [ ] Run the tests, commit.

### Task 8: Timings and the probe

**Files:** Modify `.github/workflows/timings.yml`, `checks.yml`. Delete `.github/workflows/unit-linux-probe.yml`

- [ ] `timings.yml` runs on ubuntu with the same setup and ignores the list.
- [ ] Delete the probe and its actionlint entry, commit.

### Task 9: Docs

**Files:** `docs/ci.md`, `.claude/rules/ci-and-tests.md`, `AGENTS.md`, the header comments in `checks.yml` and `test-scope.ts`

- [ ] Update every line naming macOS shards, including why each file is on the list. Leave "Before you push" to the other branch. Commit.

### Task 10: Prove it on ubuntu

- [ ] Run purity, push, open the PR.
- [ ] Read the `unit` and `unit-macos` results by root cause. A new failure gets `systematic-debugging`.
- [ ] Get two green ubuntu runs of the fixed suite with the same list. A test that fails once and passes once is reported, not listed.
- [ ] Commit the Timings artifact from ubuntu, then check the shards' spread.
- [ ] Write `.superpowers/linux-shards-report.md`.
