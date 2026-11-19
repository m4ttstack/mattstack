# VS Code agents menu: attach to a worktree's agents from the status bar

## Intent

The rt-context extension already lets Matt open a worktree from the status
bar. Once he is in that worktree, he wants a second menu that lists the
Claude agents tied to it, and picking one should put him back in its session
inside VS Code, the way `rt pane attach` does in a terminal. The point is to
pick up where an agent is, or was, without leaving the editor or hunting
for a herdr pane.

This is a wiring job. It uses verbs that already exist: `pane:list`,
`agent:list`, `runs:list`, `agent:resume` and `pane:attach-plan`.

## Goals

- A new status-bar item next to `Worktrees` that opens a quick pick of this
  worktree's agents.
- The list covers:
  - live Claude panes whose folder is in this worktree
  - `rt agent` sessions recorded for this worktree that have finished
  - sessions from work and review runs on this worktree's branch
- Picking a row opens a VS Code integrated terminal attached to that session.

## Non-goals

- Finished sessions started by hand, which neither an `rt agent` record nor a
  run knows about. Matt left these out. Covering them later needs a CLI verb
  over the daemon's existing `agent:adopt`.
- A run whose session has no `rt agent` record. It cannot be resumed through
  `agent:resume`, so it gets no row.
- Jumping to herdr or Ghostty instead of attaching in VS Code.
- Faces, previews or live refresh while the quick pick is open.

## Anti-goals

- New daemon behaviour or new REST routes. The only rt-side change is the
  rt-client transport below.
- Depending on `rt` being on the extension host's PATH.

## Approaches

1. **rt-client with a Node transport (chosen).** The extension already
   bundles `@mattstack/rt-client`, and it has typed `paneList`, `agentList`,
   `runsList`, `agentResume` and `paneAttachPlan` calls. But `rtCommand`
   (`packages/rt-client/src/transport.ts`) uses Bun's `fetch({ unix })`,
   which Node's fetch ignores, so the extension host cannot reach the daemon
   through it today. Adding a Node fallback fixes that for any Node consumer.
2. **Two daemon REST routes** (`/api/panes`, `/api/agents`) read with the
   extension's `daemonQuery`. Dropped: rt-client is the typed seam, and
   these would only add a second way in.
3. **Shell out to `rt ... --json`.** Dropped: the extension would have to
   find the binary, and every open would pay for a CLI startup.
4. **Open the Go attach picker in a terminal scoped to the worktree.**
   Dropped: it needs a new `--cwd` flag on `rt pane attach` and still shows
   no finished sessions.

## Design

**rt-client transport.** When `rtCommand` is not running under Bun (no
`globalThis.Bun`), it sends the same request (POST
`http://localhost/<cmd>`, the same headers and JSON body) with Node's
`http.request({ socketPath })`. Envelope parsing, the 413 message, timeouts,
the unreachable prefix and the test-isolation guard all stay the same.
Rebuild `packages/rt-client/dist` after the change.

**Which rows belong to this worktree.** The worktree is the extension's
`currentWorktreePath`, and the branch and repo identity are the ones the
extension already resolves.

- Live: `paneList()` panes whose `cwd` is the worktree path or inside it.
- Recorded: `agentList({ repo })` records whose `cwd` is the worktree path,
  minus any whose `sessionId` matches a live pane.
- Runs: `runsList({ repo })` runs whose `branch` is the current branch and
  whose `session` matches an agent record. The run labels that record's row
  (work type, stage, status) instead of adding a second row for the same
  session.

**Quick pick.** It has two groups, Running and Recent, and Recent is newest
first. Each row shows:

- the handle, or the agent's label
- its status (working, waiting on you, idle, done)
- what started it: the run's work type, the `rt agent` caller, or "by hand"
- how long ago it started or finished

The status-bar item reads `$(hubot) Agents`, with the live count when it is
above zero. It hides when the folder is not an rt-known repo, and stays
visible with an empty list otherwise.

**Picking a row.**

- A live pane: `paneAttachPlan({ paneId })` returns argv and env. Open a VS
  Code terminal whose shell is that argv, with that env, named after the
  handle or label.
- A recorded or run row: `agentResume({ id })` first. It focuses the
  session's pane if one is still open, otherwise it relaunches the session in
  herdr. Either way it returns the record's `paneId`. Then attach as above.
- Any failure becomes a VS Code error notification carrying the daemon's
  message.

## Constraints

- The extension host is Node. Only rt-client's Node path runs there.
- `packages/rt-client` is a workspace package with a gitignored `dist/`. Run
  `bun run build` there, and expect `test/dist-freshness.test.ts` to guard it.
- Verify in a real VS Code window (Cursor too, since `install-local`
  targets it): the menu lists the right rows for a worktree with a live
  agent and a finished one, and attaching works for a visible pane and a
  `bg:` pane.

## Left to the builder

- Exact row text, icons and the relative-time format.
- Whether the list refreshes on the daemon's `status` broadcast or loads
  only when opened.
- How the terminal behaves when herdr's attach exits (close or keep).
