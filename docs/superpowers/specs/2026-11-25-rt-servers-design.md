# rt servers: see and stop this repo's intercepted dev servers

Size: a small change. One new command, its modules, and one addition to the
shared picker. No daemon change.

Boards: `docs/design/servers/servers.pen` (`S1 Grouped by ticket`, `S3 Just
opened, before ticket data`, `S4 Filter, then mark all`, `S5 Stopping and
results`, `S6 Nothing to show`, `S7 Piped, list only`).

## Intent

rt starts dev servers for a repo through its intercept shims, in as many
worktrees as are active, often from agent sessions. Nothing in the CLI shows
which of them are running, so a teammate who wants a clean machine asks "is
there an rt command to clear all running instances?" and is sent to the menu
bar's Processes window. `rt servers` answers that from inside the repo, in terms
of the work each server belongs to.

## Goals

- Inside a repo, list every running server rt intercepted there: each role, in
  every worktree.
- Group them by ticket, with the ticket and MR data `rt cd` shows.
- At a terminal, pick any of them to stop. Ctrl-a then enter stops all.
- Off a terminal or with `--json`, list only. Nothing is ever stopped without a
  pick.

## Non-goals

- Every repo at once, or processes rt did not intercept. That is `rt port` and
  the Processes window.
- Changing `rt port`, the port claims, or the daemon.
- A non-interactive stop. Selecting a heading to mark its whole group.

## Anti-goals

- Killing an agent session, a shell or a process of another repo.
- Reading "nothing running" while a server from this repo still holds its port.
- A stop that a respawning watcher undoes on the next file save.
- Waiting on a ticket or MR lookup before the picker opens.

## Constraints

- Everything printed goes through `lib/ui/out.ts`; the picker is
  `filterableMultiselect`. No sync spawns, no UI code in TypeScript.
- The leaf picker gates on a TTY, no `--json` and no `RT_BATCH`.
- `lib/module-registry.ts` and `bun run docs:gen` move with the command tree.
- Ticket and MR data comes from `enrichBranches` (`lib/enrich.ts`), the source
  `rt cd` uses, in the same words (`!412 open`, `checks passed`).

## Approaches

Finding and placing the command:

1. **A new verb, `rt servers`, found by process (picked).** Only intercepted
   servers, only this repo, so select-all is safe, and a server with no port
   yet still shows. Costs one more top-level verb.
2. **Grow `rt port`.** No new verb, but it is keyed on listening ports across
   every repo: agent sessions and served apps share the list, booting and
   crashed servers are missing, and two different lists would share one command.
3. **Under `rt intercept`.** Same behavior, but `intercept` is in the default
   `rt.picker.hidden` set, so a person would not come across it.

Port claims were ruled out as the source. A `fixedPort` role never gets a claim
row. A role that `needs` another writes the needed role's claim under its own
pid (`resolveRoleAndNeeds`), so a claim can read live with no server behind it,
and stopping that pid stops the wrong one.

Grouping:

1. **By ticket (picked).** The work is what a person recognizes, and each
   ticket's data shows once. Needs the shared picker to draw a heading from
   segments.
2. **By role.** No picker change and it matches "clear all backends", but
   repeats each ticket's data once per role.
3. **By worktree.** Pool names are picked before a tree has a branch and say
   nothing about the work, and one ticket can span several trees.
4. **Flat.** Titles clip at 120 columns and every MR repeats.

## Design

### What it looks like

`S1 Grouped by ticket` is the contract. A heading per ticket: state tag in
Linear's own color, title, and pinned right the MR, its checks and the ticket
id. Its servers sit under it: role, port, anything odd ("Claude session", "not
listening", "left behind"), and uptime pinned right.

- **Group key:** the ticket id, else the branch, else the worktree.
- **Heading text:** the ticket's title, else the MR's title, else the branch,
  else the worktree's name with "detached".
- **A ticket on several branches** is one group. Its MR data moves to the rows,
  each led by its branch, since there is no one MR for the heading.
- **Order:** groups by their oldest server, so the stalest work is first. Inside
  a group, by branch, then role.
- **The label** the picker's selected strip prints is role and port, so two
  rows never read the same.
- **The header** says "ctrl-a marks all", because the picker hides that key
  until ctrl is held. Enter reads "stop".
- **The filter** matches role, port, ticket id, state, title, branch, MR title
  and MR state, so typing "done" or "merged" then ctrl-a marks finished work.

The picker opens at once with the ticket id or branch as each heading (`S3`),
and the titles and MR data land in place, as `rt cd` does. Marks, filter and
cursor survive, since they are keyed by row value. A failed lookup leaves the
first headings standing.

Off a terminal the same groups print as a list (`S7`), waiting at most three
seconds for the data. Nothing running prints "No dev servers are running here".
A repo with no intercept rules says so instead, because that empty list means
something else (`S6`).

### The picker addition

A request and an update may carry headings keyed by `PickRow.group`: left
segments, and right segments pinned to the edge and never clipped. A group with
no heading keeps today's plain uppercase line, so no other picker changes.
Headings stay render-only: the cursor never lands on one.

### Finding them

`lib/endpoint/servers.ts` takes one snapshot (process table with start times,
cwds, TCP listeners, this repo's worktrees) and a pure function turns it into
rows:

1. A candidate is a process whose command line is
   `intercept run <command> -- <args>`. The shell or agent that typed that line
   holds the same text, so shells, agents and multiplexers are never candidates.
2. Its cwd must be inside one of this repo's worktrees, and
   `matchInvocation` must match it to a rule. The match gives the role. A
   one-off run of the same tool (`doppler secrets`) matches no rule and is left
   out.
3. Its tree is that process and everything under it.
4. Its port is the one its tree listens on: the port claimed for that
   (worktree, role) or the role's `fixedPort` when the tree holds it, otherwise
   the lowest port the tree listens on. When the tree listens on nothing, the
   claimed port shows with "not listening", which covers both booting and
   crashed under a watcher.
5. **Left behind:** a listener on a port this repo has claimed or fixed, with a
   cwd inside the claiming worktree (any of this repo's worktrees for a fixed
   port) and in no tree from step 3, is a server whose rt process was killed
   out from under it. Its tree starts at its topmost ancestor in the same folder
   that is not a shell, agent or multiplexer, so it never climbs into the
   process that started other servers. A fixed port counts only from its role's
   folder.

A row under a live agent process shows "Claude session" (or that agent's name),
so select-all does not silently pull a server out from under working agents.

Claims are read from `state.db` and rules from the saved rules, as the shim
does, so the command works with the daemon down. A read that fails or times out
fails the command; it never reads as nothing running.

### Stopping

- After the pick the snapshot is taken again, and a picked row is stopped only
  if its root pid still has the same start time. The picker can sit open for
  minutes and a pid can be reused.
- Every process in the tree gets SIGTERM; whatever is left after 5 seconds gets
  SIGKILL. Whole-tree is the point: stopping only the port holder leaves a
  respawning watcher that brings the server back.
- An agent found inside a tree is spared with everything under it. rt's own
  process and its ancestors are never signalled.
- Each row reports its own result, named by port and heading text: stopped,
  already gone, or could not stop and why (`S5`).
- Claims stay, as after Ctrl-C, so the worktree gets the same port next time.

### `--json`

`{ ok, repo, servers: [{ role, port, listening, worktree: { path, name },
branch, pid, pids, startedAt, leftBehind, agent }] }`, with `repo` the
serialized identity, `port` null when unknown and `agent` null when there is
none. It carries no ticket or MR data and waits on no lookup.

### Tests

- The pure finder: role match, one-off run left out, shell holding the same
  text, fixed-port role, needed role's claim not read as a server, bypassed run
  with no claim, not listening, left behind, agent above, another repo's tree.
- Grouping: one ticket on two branches, ticket from the MR title, no ticket,
  detached, order, and the data before and after enrichment.
- Stop: whole tree signalled, escalation after 5 seconds, reused pid skipped,
  agent inside a tree spared, per-row results.
- The command: list off a TTY, frozen `--json`, empty states, a failed read.
- The picker heading: the wire fixtures in both languages, and a group with no
  heading unchanged.

## Left to the builder

Exact copy and column widths beyond the boards, and how `formatUptime` and the
stop reporting are shared with `commands/port.ts`.
