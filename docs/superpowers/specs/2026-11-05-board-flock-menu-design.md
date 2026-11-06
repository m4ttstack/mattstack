# Board flock menu: open an MR's worktree in flock

Status: built, 2026-11-05.
Spans two repos Matt owns: this one (`apps/board`) and `flock`
(`~/Documents/GitHub/flock`). Either side may change.

## Why

When one of Matt's own MRs needs a hands-on step (an `rt` command, a
Claude session in its tree), he opens a terminal and finds the MR's
worktree by hand. The board already knows the MR, its branch and repo.
One click on the MR should land him in a focused flock tab, in that MR's
worktree, with the thing he wanted already running.

## Goals

- A "flock" flyout (Flock's app icon) in the right-click menu of each of
  Matt's own MRs lists the actions. Never a button on the card.
- Picking an action opens a new flock tab in the MR's worktree, runs the
  action, focuses the tab, and brings flock's window forward.
- The tab lands in the repo's pinned flock workspace when one exists;
  otherwise in a Board-owned "MRs" workspace.

## Non-goals

- Teammates' MRs. Only MRs `isOwnMr` (`apps/board/src/view.ts`) accepts.
- Changing review, respond or doctor launches. They keep `launchInWorkspace`.
- Any non-flock terminal target.

## Anti-goals (failure even if it works)

- Two copies of one Claude session running at once.
- A worktree created without Matt being told beforehand.
- Pin state copied into the board or another store. Pins stay flock's.

## Menu

Rows, in order:

| Row | Shown when | Does |
|---|---|---|
| Empty shell | always | a login shell in the worktree |
| Claude | always | `claude` in the worktree |
| Resume work session | a work run linked to this MR recorded a session | see below |
| Saved commands, one row each | the setting has entries | runs that command in the worktree |

Each row carries its own icon: a terminal for shell, the agent mark for
Claude, a history clock for resume, and for a saved command the icon it
names, else a prompt chevron.

**No worktree yet.** When no local tree is checked out on the MR's branch,
the menu shows a note above the rows: "No worktree yet. Picking an action
creates one." Picking any row provisions the tree through rt's worktree
provisioning, then hands off as soon as the tree exists. It does not wait
for ready steps (install and the like), which run async and can be held
for approval; the menu says setup is still running in the background. The
menu shows a pending state only while the tree is being created; a failure
shows in the menu, not a toast elsewhere.

**Resume work session.** Sources are work pipeline runs that recorded
this MR in their `mr` field, open or closed. Respond and doctor runs do not
count. Today's `RunMrLinks` (`src/gates/run-mr.ts`) only covers runs with a
live human gate, so this needs a new rt-client lookup over runs by `mr`,
filtered to work runs, cached on the board like the existing resolver.
Several matches: the most recent one with a recorded session wins.

- **Live session.** If any agent pane is running that session, whatever its
  status (working, idle, blocked), the row focuses that pane through the
  board's existing `focusPane`. `workingSessionPane` in
  `lib/runs/liveness.ts` matches only `working`, so this needs a sibling
  lookup that ignores status.
- **Not live.** Opens a tab running `claude --resume <session>` in the
  run's own recorded `worktree`, not the MR's current tree: `--resume` finds
  sessions by cwd. If that tree no longer exists, the row shows disabled
  with "Session's worktree is gone".

**Saved commands.** A new board setting, `board.flockCommands`: an array of
`{ label, command, icon? }`, registered through the settings resolver (see
the `rt:settings` skill), user scope. Empty or unset shows no rows. `icon`
is one of `rt` (rt's plain monospace monogram), `cd`, `folder`, `branch`,
`play`, `pulse` (flock's rt menu icons), `shell`, `agent`, `refresh`,
`file`, `note`.

## Handoff: board to flock

The board server owns everything that needs the MR: resolving or
provisioning the worktree, picking the session, expanding the action into
a command. Flock owns everything about placement.

The board opens one URL:

```
flock://open?folder=<abs worktree path>&repo=<abs repo path>&label=<tab label>&run=<command>&kind=<shell|claude|resume|command>
```

- `folder`: the MR's worktree. The tab's cwd.
- `repo`: any path inside the repo; flock reads its git common dir to match
  pins.
- `label`: the tab label, `mrTabLabel(iid)` style (`!123`).
- `run`: the command line for the pane. Absent for an empty shell.
- `kind`: lets flock apply the pin's Claude account to `claude` and
  `resume` runs and leave other commands alone.

- `token`: the shared secret (below).

Values are percent-encoded with `encodeURIComponent`: URLSearchParams'
`+` for a space reaches Foundation as a literal plus.

The board launches it with `open -a <running Flock.app> <url>`, finding the
app launchd started (`pgrep -x -P 1`, Flock Dev first). Every build folder
holds a copy with the same bundle id, so `open -b` or the default handler
can start a second instance; plain `open <url>` is only for when no Flock
runs.

**Link guard.** A `flock://open` link runs a command in Matt's shell, so
any page or app could otherwise run anything. Flock creates a random token
file under `~/.mattstack` (mode 0600) on first launch if missing; the board
reads it and adds `token=` to every link. Flock refuses, with a visible
notice, any link whose token is missing or wrong. No confirmation click.

## Flock's side

On `flock://open`:

1. **Find a pin for the repo.** A pin belongs to the repo when its
   folder's git common dir equals `repo`'s. Several pins match: the first
   in rail order.
2. **Pinned.** Open the tab in the pin's workspace. A closed pin (no live
   workspace) is reopened the way flock reopens a pin today, then gets the
   tab. Claude kinds run under the pin's `claudeAccount`.
3. **Not pinned.** Open the tab in the Board MRs workspace, created on
   first use. It joins the Board rail section beside reviews, responses
   and doctors: a new `mrs` role on `BoardWorkspaceNames` and on the
   board's `board.workspaces` setting, default label `mrs`.
4. Create the tab with `label` and cwd `folder`, run `run` in its pane,
   focus the tab, and bring the window forward.

No dedup by label: each pick opens a new tab (Matt wants a fresh place
to work). Resume dedup happens on the board side, via the live-pane check.

## Constraints

- Flock and Flock Dev share Info.plist keys and never run at the same
  time; both claim `flock://`. The board picks the running app by path
  (above).
- Every rt-dependent flock feature renders only when `rt` resolves on
  flock's startup PATH. This handler does not need rt; it must still work
  without it.
- Board server runs under a minimal launchd env: absolute binaries, as
  `src/herdr.ts` does.
- Board UI follows `docs/apps/ui-authoring.md` and the kit contract; the
  flock icon comes through the kit icon registry. The UI is rendered and
  checked in a browser, both colour schemes, before it counts as done.
- Visual board changes regenerate capture baselines only when intended.

## Approaches considered

- **A. Flock decides (picked).** A `flock://open` link; the board hands off
  the folder and the command, and flock picks pin vs Board MRs workspace.
  Pins stay private, the pin's Claude account applies naturally, and
  raising the window is free. Costs work in both repos and a new URL
  handler.
- **B. Board decides through herdr.** Flock publishes pins for the board
  to read; the board reuses `launchInWorkspace` and raises flock.
  Duplicates pin state and the closed-pin reopen logic.
- **C. Board only, label match.** Treat a herdr workspace whose label
  matches the repo as pinned. No flock change, but breaks on a rename and
  cannot see closed pins.

Matt picked A.

## Decided by Matt

- Own MRs only; menu behind the flock app icon.
- No worktree: provision, and say so before he picks.
- Placement: pinned workspace for the repo when one exists, else a Board
  workspace for MRs like the review and respond ones.
- Rows: empty shell, Claude, saved commands, resume the work session when
  one is known.
- Approach A.
- Resume draws on work runs only, open or closed.
- `flock://open` is guarded by a shared token file.

## My calls (Matt to check)

- Resume focuses a live pane, at any agent status, instead of opening a
  second copy.
- Resume runs in the run's recorded worktree; a gone tree disables the row.
- Provisioning hands off once the tree exists, without waiting for ready
  steps.
- Without rt, flock can't read `board.workspaces`, so the MRs workspace sits
  among ordinary workspaces under the default `mrs` label. Accepted.
- Saved commands live in `board.flockCommands`, user scope.
- The Board MRs workspace label defaults to `mrs`.
- Pin match by git common dir, so a pin on the main checkout or any
  worktree counts.
- Every pick opens a new tab; no label dedup.

## Left to the builder

- Where the button sits on the MR row and the menu's exact look, against
  the board's pen.dev mocks.
- The rt-client or daemon call the board uses to find and provision the
  MR's worktree.
- URL escaping, and rejecting a `flock://open` whose folder is not a
  directory.
