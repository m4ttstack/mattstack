---
name: rt:worktree
description: Use when work needs an isolated git worktree on a machine rt manages ... starting ticket or feature work outside a shared checkout, cleaning up a tree after a merge, recovering a disposed tree's branch or unpushed commits, listing or freshening trees ... or before hand-rolling a git worktree add in a repo that `rt worktree list` knows.
---

# rt worktree

rt owns the worktree lifecycle in registered repos: it names trees, places
them, registers them with the daemon, and cleans them up. In a repo that
`rt worktree list` knows, never hand-roll a git worktree add ... an
unregistered tree gets none of the guarded disposal, freshening, or
auto-cleanup.

`rt worktree --help` is the live reference: the bare usage lists every verb,
and `rt worktree <cmd> --help` carries the current flags. Trust that output
over anything remembered or written here.

## The lifecycle

- **Start work**: the `worktree_provision` tool (`{repoName, ticket,
  ticketTitle}` or `{repoName, branch}`) claims a tree and returns its path.
  Repos can opt into a warm pool ("on-deck" trees) that makes claiming
  instant; without one, provision creates fresh. `rt worktree create`
  pre-warms the pool; it is not the start-work verb. It returns as soon as
  the branch is checked out; any dependency steps the branch triggers
  (install, migrations) keep running in the background, reported as
  `readyPending` with the queued steps.
- **Finish**: trees claimed with the default `merge` disposal auto-dispose
  after their MR merges, so cleanup usually needs no command. The
  `worktree_dispose` tool (`{repoName, tree}`) is the manual path; it refuses
  dirty or unpushed trees, and it is soft ... the tree is retained in trash
  for a window.
- **Undo**: `rt worktree restore --list` shows what is recoverable; `restore
  <tree>` rebuilds the tree, its branch, and retained untracked files. Reach
  for this before git plumbing when a disposed tree is missed.

## Driving it as an agent

- `EnterWorktree` in name mode stays the preferred way to start work: when
  `rt worktree hook status` reports installed, calling it with a `name`
  provisions through rt and moves the session into the tree, promptless (the
  hook routes it; non-rt repos fall back to stock `.claude/worktrees`). When
  the hook is not installed, or a path is needed before entering, call
  `worktree_provision {repoName, ticket, ticketTitle}` (or `{repoName,
  branch}`) and enter its result's `path` with `EnterWorktree` in path mode,
  which always prompts. Disposal stays rt's either way; `ExitWorktree` never
  removes an rt tree.
- Pass explicit args. A kept-on-Bash form also takes `--json`; `rt_verb`
  adds `--json` itself, so leave it out of `args`. Omitted args open
  interactive pickers in a TTY and exit with usage otherwise.
- `rt_verb {args: ["worktree", "list", "--json"]}` is ground truth for what
  exists and where. Tree kinds: `main`, `claimed`, `on-deck`, `unmanaged`.
- **Never run the tree's install yourself.** A tree from the pool is warm for
  the default branch, so its `node_modules` genuinely can be wrong for your
  branch ... that is what the background step is already fixing, in that same
  directory. A hand-rolled `pnpm install` races it. Before the first command
  that needs dependencies (tests, typecheck, a dev server), call
  `rt_verb {args: ["worktree", "await-ready", "<tree>"], cwd: "<the tree's
  path>"}`: pass `cwd` because the server's own cwd is fixed at session
  start and won't resolve the right repo otherwise. It joins the running
  step, returns when it settles, and reports a degraded tree rather than
  hanging. Use it instead of polling list.
- If provision or list reports team `ready` steps held pending approval, a
  human must run `rt worktree ready-approve <repo>`; surface it to Matt
  rather than working around it.

## Crossing repos

`EnterWorktree` cannot leave the repo the session started in. When the
task's repo is not the session cwd, queue the cd and the next step into
your own pane, then end the turn:

```bash
rt pane send self --text "/cd /Users/matt/Documents/GitHub/chat" --then "Continue: EnterWorktree name chat-42 for CHAT-42"
```

End the turn right after; the `--then` line arrives as your next message,
in the right repo. Outside a herdr pane the command says so: ask Matt to
run the `/cd`. Rules and the other-pane form: `rt:herdr-inject`.
