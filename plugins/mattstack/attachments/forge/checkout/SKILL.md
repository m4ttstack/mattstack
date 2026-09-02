---
name: checkout
disable-model-invocation: true
description: "Use when someone else's branch needs a local worktree for review or testing -- given a branch name, an MR/PR link or number, or a ticket id -- without starting your own work on it. Does not open an editor (checkout-and-open does)."
allowed-tools:
  - Bash(rt worktree:*)
  - Bash(git fetch:*)
  - Bash(git worktree list:*)
  - Bash(git worktree add:*)
  - Bash(git remote get-url:*)
  - Bash(gh pr view:*)
  - Bash(gh pr list:*)
  - Bash(glab mr view:*)
  - Bash(glab mr list:*)
type: pipeline-step
slots: {}
---

# checkout

Get a teammate's branch into a local worktree so you can read or test it --
this is a review checkout, not the start of your own work.

## 1. Resolve the target

Detect what was given and resolve it to one remote branch:

- A branch name: use it verbatim.
- An MR/PR link, `!iid`, or bare number: `glab mr view <ref>` or
  `gh pr view <ref>`, then read the source branch from the result.
- A ticket id: search open MRs/PRs whose source branch or title carries it
  (`glab mr list --search <id>` / `gh pr list --search <id>`).

If resolution is ambiguous or turns up nothing, gate `clarify`: one
sentence naming the candidates, then the structured-question tool with one
option per candidate, their text, and **Hold** (under a run, `rt runs field
set gate clarify --stage <run.current_stage>` before and `rt runs decision
record --contract gate@1 --scope clarify --selection '{"branch":"<picked>"}'
--decided-by checkout` after). Never a guess.

## 2. Acquire the worktree

Before creating anything, check `git worktree list`: if the branch is
already checked out somewhere, point there instead of making a duplicate
and stop here.

Otherwise, prefer `rt` when it's available:

```
rt worktree provision --repo <repo> --branch <branch> --json
```

`<repo>` is discovered from the current checkout's origin remote (for
example `git remote get-url origin`), never hardcoded. Pass
`--title "<ticket title>"` when a title came out of the step 1 lookup
(the MR/PR view or ticket search) -- without it the branch gets no slug.
On `ok`, report the path `rt` returns and that the branch is checked out
there.

If the daemon is down or the repo is unknown to it, fall back to plain git:

```
git fetch origin <branch>
git worktree add <sibling-path> <branch>
```

`<sibling-path>` sits next to the main checkout, named after the branch.
Report what was created.

## 3. Safety

- Never commit or push on the checked-out branch -- it belongs to someone
  else.
- State plainly whose branch this is when you report the result.
