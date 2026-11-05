# Local pre-push check: design

Date: 2026-11-03. Status: approved 2026-11-03.

## Intent

A push should carry its own test verdict. Today a worker pushes, CI boots
runners, and the first word on "is this push green" arrives five to ten
minutes later, most of it fixed cost (runner boot, checkout, install, a
second runner hop for the shards) and macOS queue time. The tests the push
actually needs run in well under a minute on the worker's own Mac.

`rt check` runs the repo's own scoped check in the worker's tree before a
push. `git_push` runs it first and refuses a red push. After the push, rt
posts the verdict on the pushed sha as a commit status, so the PR shows it
beside CI. CI keeps running on PRs for now; the merge queue stays the
authoritative full run. The point is instant feedback on the push and a PR
that visibly says the tests ran.

## Goals

- A worker learns a push is red before the push, in the time the scoped
  tests take, and never waits on a runner to find out.
- The PR shows that the local run happened and what it covered, keyed to the
  exact sha, so a later push drops it by itself.
- Any repo can opt in by naming its own check command. rt holds no knowledge
  of how a given repo picks its tests.
- mattstack's command picks the same tests CI would for the diff, through
  the scope script, so local and CI agree on what "scoped" means.

## Non-goals

- Replacing CI on pull requests. That is a later decision once the status has
  earned trust.
- Running the full suite locally. The scoped run is the product; a full run
  is a flag.
- A GitHub App or check-runs API. Commit statuses through the user's `gh`
  token are enough.
- Teaching `evidence_attach` GitHub. The status description is the whole
  human-readable summary.

## Anti-goals

- rt writing into the target repo (a hook, a config file). rt never does.
- A status that reads green when nothing ran. A repo with no check command
  gets no status, not a green one.
- Blocking a deliberate WIP push with no way through.
- A secret in a setting.

## Constraints

- The settings contract: one declared key, read through `getSetting`,
  `repoOnly`, with schema, examples, console group and lock.
- The output layer: every line a person reads goes through `out`; a refusal
  is a `UserActionableError` with a `next` command; `--json` is frozen.
- The TypeScript CLI is UI-free.
- Repo identity: the repo section keys on the raw `host/path` form.
- Two forges eventually: GitHub (this repo, through `gh`) now, GitLab
  later through the client rt already has in `lib/ci/gitlab-forge.ts`. The
  backend seam is designed for both; only GitHub is built here.
- Purity: nothing in this repo names an employer host or ticket.
- The macOS and Linux shells differ; the command runs through the tree's
  own shell with the subprocess helpers rt already uses (`childEnv`).

## Approaches considered

1. **A verb with a seam** (chosen). `rt check` is a CLI verb over a library
   function in `lib/check/`. `git_push` calls that same function before the
   push and again to post the status after. One path, one output, usable by
   a person, by skills and by the push.
2. **Inside `git_push` only.** The check and the status posting live behind
   deps in the MCP tool with no verb. Smaller, but invisible at a terminal,
   and the work skill could not run it apart from a push, which rt's
   discoverable-verbs rule argues against.
3. **A git pre-push hook rt installs in the repo.** Rejected: rt never writes
   into target repos.

Matt picked 1. The cost over 2 is one command-tree entry and its description.

## Decisions Matt made

- **Scope:** any repo, through a configured command. mattstack's command
  wraps `scripts/ci/test-scope.ts`.
- **On red:** `git_push` refuses the push and names the failing files, as the
  CI lease refuses today. A flag pushes anyway for a deliberate WIP push, and
  the red result is still posted.
- **Human summary:** the status description alone. No PR comment, no
  evidence attachment.
- **Build:** a verb with a seam (above).
- **Full-suite diffs:** when the repo's command decides the diff needs the
  whole suite, the push runs it and blocks on it like a scoped run. The
  status says `full`.
- **GitLab:** deferred. GitHub only in this plan; the forge seam takes a
  second backend later, once a test project shows what a commit status does
  to an MR's head pipeline (it attaches to or creates a pipeline for the
  sha, which `ci_watch` and the merge check read).

## Calls I made after the builder check

- **Dirty tree.** The check runs on the tree as it stands and still gates
  the push, but no status is posted when tracked files are modified or
  non-ignored files are untracked: the status attests to HEAD, and a dirty
  tree is not HEAD. The verb and the push result both say the result was
  not posted and why. rt reads the tree again after the run: a tree the run
  changed, or a `git status` that failed, counts as dirty. A HEAD rt cannot
  read is an error that runs nothing.
- **Two flags, not one.** `allowRed: true` runs the check, pushes whatever
  the verdict, and posts it, for a WIP push that should still be seen.
  `skipCheck: true` runs nothing and posts nothing, for a push that must
  not wait. Both are named in the refusal's `why`.
- **Coverage.** mattstack's command runs the unit selection only. The
  description says "tests", never "checks", so a green beside a typecheck
  failure claims nothing it did not do. Typecheck can join the command
  later without touching rt.
- **Timeout is an error state.** A command past `timeoutSeconds` posts
  `error` and refuses the push like a red; the override applies.
- **Result shape follows the lease.** A red check is an `ok` result with
  `pushed: false`, `refusal: "check-red"` (or `"check-error"`), `check:
  {...summary}` and `next: "rt check"`. The CLI verb's own refusal is a
  `UserActionableError`. The mcp-tools reference is regenerated, and the
  skills that document `git_push`'s refusals name the new one.
- **No double run.** A green result is kept in rt state keyed by tree root,
  HEAD sha, the command string and a clean tree, for sixty minutes. A push
  after `rt check` at the same HEAD reuses it, posts it, and says so.
- **`rt check` is agent-safe in `rt_verb`** with a timeout above the
  command's, since the work skill will call it apart from a push.

## The how, as decided and as I filled in

### The setting (my call on name and shape)

`rt.check`, `repoScoped` and `repoOnly`, scopes `user` and `machine` (Matt's
ruling), merge `deep`, default `{}`. `git_push` and `rt_verb` run the command
with no prompt, so a team or org store could otherwise run a shell command on
every member's Mac. A shared rollout needs a hash approval first and is a
later decision.

```jsonc
"rt.check": {
  "command": "bun scripts/ci/local-check.ts",   // run in the tree root
  "timeoutSeconds": 600                           // optional; default 600
}
```

An empty object means no check is configured: `rt check` says so with a
`refused` note and exits 0, `git_push` pushes with no check and posts no
status. The command is a string the tree's shell runs from the tree root,
so a repo can point at a script or a `bun run` target. Path variables
(`${repoRoot}`, `${org}`) expand as for any setting.

### The command contract (my call)

rt runs the command with these in its environment:

| Variable | Value |
|---|---|
| `RT_CHECK_BASE` | the merge base of HEAD and `origin/<default branch>` |
| `RT_CHECK_HEAD` | HEAD's sha |
| `RT_CHECK_TREE` | the tree root |
| `RT_CHECK_FULL` | `1` when `--full` was passed, else unset |

The exit code is the verdict: zero is green, anything else red. The last
line of stdout may be one JSON object; rt reads it when it parses:

```json
{"mode":"changed","selected":95,"passed":95,"failed":0,"durationMs":41200,
 "failures":["lib/__tests__/x.test.ts"]}
```

`mode` is the command's own word for what it ran (`changed`, `full`,
`skip`). Without a parseable last line rt reports the exit code and the
wall time it measured, and on red shows the command's last twenty lines
as a `verbatim` block. A `mode` of `skip` with exit zero is a green
"nothing to run".

### The verb

```
rt check [--full] [--no-status] [--base <ref>] [--json]
```

Runs the configured command in the current tree (or `--tree`, as the MCP
tools take it) and prints one step while it runs, then a result line:
`changed: 95 tests in 41s` or `red: 2 of 95 failed`, with the failing files
as a `verbatim` block. `--no-status` skips posting. `--base` overrides the
merge base, for a stacked branch; a ref that is not a commit is an error
that runs nothing and posts nothing. `--json` prints the summary object plus
`{status: {posted, context, url?}}`, frozen.

Posting a status from the verb only happens when HEAD is already on the
remote: the status attaches to a sha the forge knows. The verb says when it
skipped posting for that reason.

### `git_push`

Before the push, after the lease check: run the check unless `skipCheck:
true`. Red or error refuses with `pushed: false`, `refusal: "check-red"`,
`check: {...summary}` and `next: "rt check"`; the refusal's text names
`allowRed` and `skipCheck`. `allowRed: true` pushes regardless and posts
the result. Green pushes, then posts. A repo with no `rt.check` configured
pushes as today and the result carries `check: null`.

When a check ran and HEAD has not moved, the push sends that exact sha, not
`HEAD`, so a HEAD that moves after the last read cannot send an unchecked
commit. With no check the refspec stays `HEAD:refs/heads/<branch>`.

Posting never fails a push: a forge that refuses the status is a `warn`
with the reason, shown once, and `check.status.posted` is false.

### The status (my call on wording)

Context `rt/local-check`. State `success`, `failure`, or `error` when the
command could not run (timeout, missing command). Description, capped at
140 characters by GitHub:

```
changed: 95 tests in 41s on hilbert
full: 22236 tests in 6m12s on hilbert
skip: nothing to run for this diff
red: 2 of 95 failed, lib/__tests__/x.test.ts +1
error: timed out after 600s
error: the check could not run
```

The machine name is the Mac's short hostname. No `target_url`. An error's
description is rt's own sentence: the command's raw output stays in the local
`reason`, because a commit status is readable by anyone who can read the repo.
Credentials are redacted from the whole description before the cap.

GitHub: `gh api repos/<owner>/<repo>/statuses/<sha>` with the user's `gh`
auth, as `lib/release/verify.ts` already shells out. The backend is picked
from the repo identity's host; a GitLab host gets no backend in this plan,
so the verb and the push say the status was not posted and why.

### mattstack's command (my call on the split)

`scripts/ci/local-check.ts`, in this repo, reuses the scope script:
`decide()` on the diff `RT_CHECK_BASE..RT_CHECK_HEAD`, `selectedTests` for
the files, then `bun test <dirs> --changed=<base>` plus the `extra` tests,
split across `cores / 2` processes with the committed timings file, as the
CI halves do. The `no-*` guards are left out of the default run (CI's
`guards` job owns them; they are what the ubuntu probe timed at a minute)
and included with `RT_CHECK_FULL`. A full run builds `packages/rt-client`
first (Matt's ruling), since the suite checks that `dist/` is fresh; the build
writes only ignored files, and a failed build is a `mode: "error"` summary. It
prints the JSON summary line last, with
`selected` as `passed` plus `failed`, so the counts are all tests.

### Trust

The status is the pusher's attestation that this sha ran its scoped tests
on their machine. Anyone who can push can post it. The merge queue's full,
hosted run is still what lands a tree, so a wrong local status cannot break
main. The description names the mode so a reader can tell `changed` from
`full`.

## Left to the builder

- Module layout under `lib/check/` (core, forge backends, summary
  parsing) and the tests: a fake command for green, red, no-JSON, timeout
  and unconfigured; a fake forge for posted and refused; an MCP tool test
  for `git_push` refusing and overriding.
- The command-tree entry and its plain-language description, by the
  command-tree rule.
- Exact copy of the refusal, the result lines and the warning, by the
  output-layer rule.
- The console group for `rt.check`, the schema examples and the lock.
- Which `childEnv` shape runs the command, and how the login shell is chosen.
- Settings delivery: rt-client rebuild now; deck and gitq pick the key up at
  their next release build.
- The `--json` envelope's exact keys, then frozen by a byte-identity test.

## Follow-ups, not in scope

- The ubuntu shard migration (28 of 1143 files are Mac-only).
- Requiring `rt/local-check` in branch protection or the queue.
- A self-hosted warm runner for the queue run itself.
- The GitLab status backend, after the head-pipeline side effect is checked
  on the test project.
- Typecheck in mattstack's check command.
