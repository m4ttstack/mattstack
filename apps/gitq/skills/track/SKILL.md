---
name: gitq:track
description: >-
  Use when branches in a repo should become a tracked gitq stack: adopting a
  chain someone built by hand, adopting branches that already have open
  MRs/PRs, or starting a new stack from scratch. Also use when a stack is
  already tracked but has the wrong root or the wrong parents. Invoked by
  hand as "/gitq:track [repoPath]"; the board has no track action, so this
  is the only way in.
---

# gitq track

Turn a set of branches into a tracked gitq stack. `gitq track` and `gitq add`
write gitq's state and nothing else: no branch is created, moved, checked
out, or rebased, and `gitq add` accepts a branch that does not exist in git
yet. So adopting an existing chain and setting up a new one run the *same*
commands. The commands are trivial. The assessment in front of them is the
whole job, and getting it wrong is what opens duplicate MRs.

| argument | meaning |
|----------|---------|
| `[repoPath]` (positional, optional) | repo checkout to work in; default the cwd |

Run every `gitq` call as `gitq -C <repoPath> ...`.

## Step 1: assess

Fill in all four slots below. Slot 3 is the one that gets skipped, and
skipping it is what duplicates MRs.

```
Root:      <trunk branch the stack sits on>
Members:   <branch> <- <parent>   (one line per branch, parents first)
Published: <per branch: open MR/PR iid, or "none", or "unknown">
Tracking:  <stacks already tracked in this repo, or "none">
```

Reproduce that block verbatim in your step 5 handback, as a block. Prose
covering the same facts is not a substitute: the human scans it to catch a
wrong root or a wrong parent, and they cannot scan what is scattered through
a paragraph.

If two branches could each plausibly be the other's parent, show the block
and get confirmation **before** running any `gitq` command. An `unknown` in
slot 3 does not need a pre-gate: track and add are reversible with `untrack`,
and step 5b is where that one bites.

**Root.** `--root` names the trunk the stack sits *on*, and the root is not a
member. `gitq track s --root <first feature branch>` is the common misread:
it succeeds, and leaves a stack with no branches in it. For a chain off
`main`, the root is `main` and every feature branch is a node.

**Members and parents.** A branch's parent is the *nearest* branch whose
history contains that branch's fork point:
`git merge-base <branch> <candidate>`. Do not reach for
`git branch --contains <parent>`: a child cut before its parent's latest
commit is not listed by it, and that child is a normal stale child, not a
sibling. Leave out branches that merely share the trunk (spikes, unrelated
work); say which ones you excluded.

**Published.** Ask the forge, per branch, whether an open MR/PR already
exists: `gh pr list --head <branch>` or `glab mr list --source-branch
<branch>`. A branch pushed to a remote is not evidence either way. If you
cannot reach the forge, say so and write "unknown", do not write "none".

**Tracking.** `gitq -C <repoPath> stacks`. This decides whether `import` is
usable, because import is not scoped to one stack.

## Step 2: pick the path

| Published | Repo already tracks other stacks | Path |
|-----------|----------------------------------|------|
| none | either | Step 3 (track + add) |
| all of them | no | Step 4 (import) |
| all of them | yes | Step 3, then **stop at step 5b** |
| some, or unknown | either | Step 3, then **stop at step 5b** |

## Step 3: track and add

1. `gitq -C <repoPath> track <stackName> --root <root>`
2. `gitq -C <repoPath> add <branch> --parent <parent>` once per member, in
   parent-before-child order. Adding a child before its parent fails.
3. `gitq -C <repoPath> stacks` and check the printed chain matches slot 2.

The stack name is a local label. There is no rename-stack command
(`gitq rename` renames a *branch*), so a name you regret costs an `untrack`
plus the `add`s again. Ask the human for the name, or take it from the shared
branch prefix and say that you did.

## Step 4: import (fully published, nothing else tracked)

`gitq -C <repoPath> import` rebuilds the store from the forge's open MRs,
reading each branch's parent from its MR target, and links every MR to its
node. It needs a forge token and a forge host in the remote.

It rebuilds the **whole store for the repo** and re-mints stack ids. If it
refuses because stacks exist, `--replace` discards *every* tracked stack in
that repo, not only the one you are adopting. Only run `--replace` when slot
4 said "none", or when the human tells you to after you have named what it
will destroy.

Then `gitq -C <repoPath> stacks` and confirm the chain, and that no branch
you meant to exclude came along.

## Step 5: hand back

Open with the step 1 block, then:

**5a. Clean case.** Report the tracked chain, the branches you excluded and
why, and stop.

**5b. Published branches that import did not link.** Every node added in step
3 carries `mrIid: null`. `gitq publish` decides create-versus-update on that
field alone and never looks an MR up by source branch, so publishing one of
these branches opens a **second** MR alongside the one that is already open.

Say exactly that, name the affected branches, and stop. Do not publish, and
do not guess iids into the state file. The ways out are the human's call:
`gitq import --replace` (naming what it discards first), or hand-editing
`mrIid`/`mrUrl`/`status` in `$GITQ_CONFIG_DIR/stacks/<hash>.json`, default
`~/.config/gitq/stacks/`, keyed by the realpath of the repo's git common dir.

## Rules

- **Tracking is read-only on git. Do not run `sync`, `push`, or `publish` as
  part of it**, even when `diagnose` reports a branch behind its parent, even
  when `preflight` predicts no conflicts, and even to "verify tracking
  worked". `gitq stacks` is the verification. Sync rewrites branches that are
  already pushed and may already be under review; that is a separate decision
  the human makes with the facts you just gave them.
- A branch reported behind its parent is a finding for the report, not a task
  to fix.
- Never run `import --replace` without first naming the stacks it discards.
- If `gitq` is not on PATH, stop and tell the human to run `bun link` in the
  gitq checkout.

## Red flags

- About to run `gitq sync` -> stop, that is step 5's report, not your job.
- Writing "Published: none" without having asked the forge -> that is
  "unknown", and it routes to 5b.
- Reaching for `--replace` to get past import's refusal -> read slot 4 again.
- A tracked stack that came out empty -> `--root` was a member branch.
