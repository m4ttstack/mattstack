# gitq

gitq is a deterministic stacked branch engine and CLI for git. it tracks a tree of branches (a "stack"), rebases the whole tree in one shot, and does surgery on it (absorb, split, fold, reparent, rename, reset) without asking you to remember the graph yourself. it also talks to GitLab to publish and import MRs for a stack. this repo is the engine and CLI only, meant to be driven by agents as much as by hand. the skills that drive this CLI from agent panes live in `skills/`, and the board (server + web client) that launches them lives in `src/server/` + `src/client/`.

## install

```bash
bun install
bun link
```

`bun link` puts a `gitq` binary on your PATH pointed at this checkout.

## commands

Every command accepts `-C <path>` (run as if invoked from `<path>`, default cwd) and `--json` (emit machine readable JSON on stdout instead of the human summary). Commands that operate on more than one tracked stack take `--stack <name>` to disambiguate; it's optional when the repo has exactly one stack.

Read only:

- `gitq stacks`: list tracked stacks and each one's branch chain (root to tip).
- `gitq diagnose`: per branch situation report for every tracked stack (merged, needs rebase, conflicted, etc).
- `gitq preflight`: predict rebase conflicts and check for a dirty worktree before you run `sync`.
- `gitq log`: show the operation log (global across all repos, not scoped to the current one).

Tracking (which branches gitq knows about; none of these touch git refs):

- `gitq track <stackName> --root <branch>`: start tracking a new stack rooted at `<branch>`.
- `gitq untrack <stackName>`: stop tracking a stack.
- `gitq add <branch> --parent <branch> [--stack <name>]`: add a branch node to a stack under a parent.
- `gitq remove <branch> [--stack <name>]`: remove a leaf branch node from a stack (refuses if it has children; reparent or remove them first).

Cascade rebase:

- `gitq sync [--stack <name>]`: rebase every branch in the stack onto its parent's new head, in order. Exits `2` and leaves git mid rebase on a conflict (see below).
- `gitq continue`: resume a paused cascade after you've resolved the conflict and staged it. May exit `2` again on the next conflict.
- `gitq abort`: abort the in progress rebase and clear the pause file.

Surgery:

- `gitq absorb [--stack <name>] [--preview]`: distribute uncommitted changes to the branches whose commits touched those files, then restack. `--preview` shows the attribution without committing anything. If the restack after absorbing hits a conflict, absorb aborts that rebase (the absorbed commits stay on their branches) and exits `1` with a message telling you to run `gitq sync`, which restacks with full conflict handling.
- `gitq split <branch> --at <sha> --name <newBranch> [--stack <name>]`: tail split: move everything from `<sha>` onward on `<branch>` into a new child branch.
- `gitq split <branch> --files <glob[,glob...]> --name <newBranch> [--stack <name>]`: split by file: move files matching the glob(s) off `<branch>` into a new branch.
- `gitq fold <branch> [--stack <name>]`: fold a branch's commits into its parent, delete it, and reparent its children onto the parent.
- `gitq reparent <branch> --onto <newParent> [--stack <name>]`: move a branch (and cascade rebase its descendants) onto a different parent. Can pause on a conflict exactly like `sync` does; resolve the same way.
- `gitq rename <old> <new> [--stack <name>]`: rename a branch, in git and in the stack tree.
- `gitq reset <branch> [--stack <name>]`: reset a local branch to match `origin/<branch>` (for when it diverged, e.g. someone force pushed).

GitLab:

- `gitq publish [--stack <name>] [--mr-meta <path>]`: open or update an MR per local only branch in the stack. `--mr-meta` points at a JSON file of `{"<branch>": {"title": "...", "description": "..."}}` to set MR titles/descriptions; branches not listed get defaults.
- `gitq import [--replace]`: pull stacks for the current repo's remote back from GitLab into local tracking. This rebuilds the whole local store and re-mints stack ids, so it refuses when the repo already has tracked stacks unless you pass `--replace` (the store check runs before the token check, so the refusal works offline). Meant for recovery, not routine use.

Other:

- `gitq undo`: undo the last reversible operation from the operation log, restoring the branches it touched to their pre operation state.

## the conflict protocol

`gitq sync` (and `gitq reparent`, when its cascade hits a conflict) rebases branches one at a time. When a rebase step conflicts, gitq leaves git in a normal mid rebase state (same as running `git rebase` by hand would) and writes `<gitdir>/gitq-pause.json` recording which branch and commit it stopped on. The command exits `2`, not `1`, so a caller can tell "we paused on purpose" apart from a real failure.

To get unstuck: resolve the conflict with raw git (edit files, `git add`), then run `gitq continue`. It picks up the rebase from where it paused and keeps walking the rest of the stack; it can exit `2` again immediately if the next branch also conflicts, same protocol. If you'd rather bail out, `gitq abort` aborts the rebase in progress and clears the pause file.

In the paused JSON (`--json`), `pauseInfo.conflictFiles` is always present (the list of conflicted file paths), while `pauseInfo.conflictTypes` is added when git can classify them, pairing each file with its two-letter porcelain status code (e.g. `UU` both modified, `AA` both added, `UD` modified/deleted). Read `conflictFiles` for the plain list; read `conflictTypes` when you want the codes.

Every state-mutating command (`add`, `remove`, `untrack`, the surgery commands, `publish`, `import`, `undo`, and starting a fresh `sync`) refuses while a pause file is present for the repo; finish or abort the paused cascade first. The read-only commands and `continue`/`abort` are exempt.

## errors

Hard failures (bad usage, unknown command, no such stack, missing GitLab token, refusing to run while a cascade is paused, refusing to overwrite a non-empty store on `import` without `--replace`, and so on) go to stderr as plain text, prefixed `gitq:`, with exit code `1`, whether or not you passed `--json`. Don't try to parse stderr as JSON; nothing gets written to stdout for these.

A command can also exit `1` after emitting its normal stdout JSON: `sync`/`continue`, `absorb`, and `publish` report structured per branch (or per MR) results, and the process exits `1` if any individual result failed even though the command itself ran to completion. Check the JSON's per item `success` fields for that case, not just the exit code.

`undo` doesn't fit that pattern: it reports one top level `success` for the whole restore, not a result per branch. Branches that git no longer has (deleted externally after the operation being undone) get skipped rather than failing the restore; `undo` still exits `0` on a partial restore, even one where every snapshotted branch ended up skipped, so check the JSON's `skippedBranches` array (informational, not pass/fail) to see what got left out. It exits `1` only when the log entry had no branch snapshots to restore in the first place, or on a hard failure per above.

## where state lives

- `~/.config/gitq/`: stack stores (one JSON file per repo, keyed by a hash of the repo path, under `stacks/`), plus `settings.json`, `repos.json`, and the global `operation-log.json`. Override the base directory with `GITQ_CONFIG_DIR`.
- `<gitdir>/gitq-pause.json`: present only while a cascade is paused on a conflict, per repo (worktree safe, since it's keyed off the git dir, not the worktree root).

## GitLab token

`publish` and `import` need a token. gitq looks at `GITLAB_TOKEN` in the environment first, then falls back to the `gitlabToken` field in `~/.rt/secrets.json`. gitlab.com only for now, no self hosted instances.

## skills

`skills/` holds four agent skills that drive this CLI from a Claude pane, one per board action: `gitq:sync` (cascade rebase with judgment-based conflict resolution), `gitq:publish` (push + MR chain, with a human gate before anything leaves the machine), `gitq:absorb` (distribute uncommitted changes, preview first), and `gitq:restructure` (split/fold/reparent/rename surgery from a plain language instruction, gated on a plan). Install them as symlinks into `~/.claude/skills`:

```bash
bun run scripts/install-skills.ts
```

Each skill takes `<repoPath> <stackName>` positionals plus optional `--state <path> --status-bin <path>` flags. The board injects those two so the pane can emit lifecycle status (`starting | working | conflict | done | error`) to a JSON state file under `state/jobs/`; invoked by hand without them, the skills skip status writes and just talk to you. The status writer is `bin/gitq-status.ts` (`bun run bin/gitq-status.ts <statePath> <status> [detail]`); the state file helpers live in `src/server/job-state.ts`.

## board

a local web board showing every configured repo's stacks: per branch status badges (from `gitq diagnose`'s engine, plus a "conflict predicted" hint from preflight), MR and pipeline state when a GitLab token is available, live job chips while a pane works, and an activity feed from the operation log. right-clicking a stack offers the four actions; each one spawns a herdr tab running `claude` with the matching `gitq:*` skill and the `--state`/`--status-bin` contract, so the badge updates live while the agent works. relaunching a live action refocuses its tab instead of double-spawning.

```bash
cp config.example.json config.json   # edit: repos to show, port (default 11008), herdrWorkspace
bun run serve                        # http://localhost:11008
```

endpoints: `/` (the board), `/data.json` (snapshot; `?fresh=1` forces a refetch), `POST /action` `{ repoPath, stack, action }`, `/healthz`. the action route only answers requests whose Host is local (`localhost`, `127.0.0.1`, `*.localhost`); through a tunnel the board is read only, and the client hides the action menu items. repo data is cached in memory for 60s with stale-while-revalidate; job state files under `state/jobs/` are read fresh on every request and pruned once terminal and older than 24h. MR enrichment needs the same token as `publish` (`GITLAB_TOKEN` or `~/.rt/secrets.json`); without one the board still renders from the store's last known MR fields. the client bundle is built in memory at startup (restart to pick up client changes; `style.css` edits are live). config changes need a restart.
