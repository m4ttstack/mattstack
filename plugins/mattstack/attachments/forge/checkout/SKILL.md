---
name: checkout
disable-model-invocation: true
description: "Use when someone else's branch needs a local worktree for review or testing -- given a branch name, an MR/PR link or number, or a ticket id -- without starting your own work on it. Does not open an editor (checkout-and-open does)."
allowed-tools:
  - Bash(git worktree list:*)
  - Bash(gh pr view:*)
  - Bash(gh pr list:*)
type: pipeline-step
slots: {}
---

# checkout

Get a teammate's branch into a local worktree so you can read or test it --
this is a review checkout, not the start of your own work.

## 1. Resolve the target

Detect what was given and resolve it to one remote branch. The GitLab
tools below take `repoName` = the current checkout's absolute path:

- A branch name: use it verbatim.
- An MR/PR link, `!iid`, or bare number: GitLab: the `mr_view` tool with
  `mrUrl` = the link, or `iid` = the number; GitHub: `gh pr view <ref>`.
  Read the source branch from the result.
- A ticket id: search open MRs/PRs whose source branch or title carries
  it. GitLab: the `mr_list` tool, then keep the rows whose `sourceBranch`
  or `title` carries the id; GitHub: `gh pr list --search <id>`. The
  GitLab tools read the daemon's open-MR cache, which may not hold every
  MR: an empty result there means ask, not "none exists".

If resolution is ambiguous or turns up nothing, gate `clarify`: one
sentence naming the candidates, then, under a run, run gate-protocol's
Runs integration with kind `clarify` and these questions: `branch`, one
option per candidate or their text, and `next`: **Proceed** (recommended)
/ **Hold** (the `run_field_set` tool with the run's `runDb`, `key` `gate`,
`value` `clarify`, `stage` `<run.current_stage>` before, and the
`run_decision` tool with `contract` `gate@1`, `scope` `clarify`,
`selection` `{"branch":"<picked>"}`, `decidedBy` `<the answer's by>`
after). Hold: record `hold:<run.current_stage>:<attempt>` (`run_decision`
with `contract` `gate@1`, `scope` `hold:<run.current_stage>:<attempt>`,
`selection` `{"reason":"<their words>"}`, `decidedBy` `<the answer's
by>`), then `run_field_set` with `key` `hold`, `value` `<their words>`,
`stage` `<run.current_stage>`, and end the turn.

{{include:spawned-no-run-guard}}

Never a guess.

## 2. Acquire the worktree

Before creating anything, check `git worktree list`: if the branch is
already checked out somewhere, point there instead of making a duplicate
and stop here.

Otherwise, call the `worktree_provision` tool with `repoName` = the
current checkout's absolute path and `branch` = the branch from step 1.
On success, report the `path` the result returns and that the branch is checked out
there. Do not enter the worktree, whatever the tool suggests: a review
checkout leaves the session where it is.

An error (the daemon is down, or the repo is unknown to rt) is the end of
this path: report the error text and stop. There is no plain-git
fallback; never create a worktree by hand.

## 3. Safety

- Never commit or push on the checked-out branch -- it belongs to someone
  else.
- State plainly whose branch this is when you report the result.

## Gate protocol

{{include:gate-protocol}}
