# shepherdr herd session (invisible panes)

Load this file only when the user asks for the herd to stay out of sight
("invisible", "background", "headless", "don't clutter my UI").

By default agents land in the session the user is looking at. When the user
asks for the herd to stay out of sight -- "invisible", "background",
"headless", "don't clutter my UI" -- run it in a **herd session** instead: a
separate headless herdr server whose panes never appear in the attached UI.

Turn it on for the whole run by exporting one variable before anything else,
then start the session:

```bash
export SHEPHERDR_HERD_SESSION=herd
scripts/herd-session.sh start
```

Every script in this skill routes its herdr calls through `scripts/hrd`,
which reads that variable, so spawn, relay, and monitor need no other
changes. **You** must use `scripts/hrd` too for any herdr command you run by
hand against the herd (`hrd workspace create`, `hrd pane read`, `hrd tab
close`). Plain `herdr` from your pane always hits the visible session.

Never set `HERDR_SESSION` yourself and call `herdr` directly. herdr injects
`HERDR_SOCKET_PATH` into every pane and it silently outranks `HERDR_SESSION`,
so the call lands in the visible session with no error and the herd spawns
into the UI it was supposed to stay out of. `hrd` exists to prevent exactly
that.

What changes in this mode:

- **Workspaces** for the run must be created in the herd session
  (`hrd workspace create --cwd <repo> --no-focus`); `-w` on spawn-agent.sh
  takes a herd workspace id.
- **Panes cannot move between sessions.** To put an agent in front of the
  user, stream it: `scripts/attend.sh <herd-pane-id> -l <job>` opens a
  focused tab in the visible session showing that agent live and writable.
  The user detaches with `ctrl+b q`; you close the tab with
  `herdr tab close <tab-id>` (plain herdr -- the tab is visible-session).
- **Herd panes settle at `idle`.** Nothing is ever focused, so the
  seen/unseen distinction that produces `done` collapses -- herd-session
  panes settle at `idle` instead. In normal (bus) mode this doesn't matter:
  completion arrives as a report event over the bus, not from watching pane
  status, and the bridge only acts on `blocked`/`gone` transitions. In
  degraded mode, where completion is detected by polling the pane directly,
  the per-agent wait must list both settled states explicitly (`--until
  done --until idle --until blocked`); wait matching is exact with no
  implicit fallback, so a wait missing one of them will sit past a herd
  agent that already finished.
- **Wrap-up** ends with `scripts/herd-session.sh stop`, which kills the
  session and every pane in it. Offer it; never run it unprompted, and never
  before the user has taken what they want from the worktrees.
