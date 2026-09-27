mattstack.app can now be set up for one person with no team, rt can move a repo's stored state to a new name ahead of the repo's rename to mattstack, and every chat session gets a hidden identity behind its handle.

### Just me setup (RT-328)

- a Just me card on the Team screen installs mattstack.app for one person: no team repo, no access rows, and team-only apps such as board stay off (#523, #520)
- Settings > Apps lists every app with a toggle and a "Needs a team" caption on a solo install; `rt apps list`, `rt apps enable` and `rt apps disable` are the same switches from the CLI (#523, #520)
- Settings > Team on a solo install offers Create a team and Join a team, which re-enter setup at the Team step and turn team apps back on (#523)
- `rt team status` reports `mode: "solo"` when no team clone exists (#520)
- deck reads `requiresTeam` from each app's manifest and can idle any app: a disabled app leaves the launcher and its launch agent is uninstalled until it is re-enabled (#517)

### Repo rename groundwork

- `rt repos reidentify <old> <new>` moves every store rt keys by repo identity (the repo index, worktree registry and data dir, tracking, the events cursor, state.db tables, herds, editor prefs and `repos.<id>` settings sections) from one remote identity to another. Each store reports moved, already, none or refused; a refusal in one store never stops the others; `--dry-run` shows the counts first (#524)
- the daemon runs the same move on its own when a tracked repo's remote now derives a new GitHub identity and GitHub confirms the old name redirects to it (#524)
- the shared checkout resolves `~/Documents/GitHub/mattstack` first and falls back to `~/Documents/GitHub/repo-tools`, so a machine keeps working before and after the folder moves (#524)

### Chat

- every session gets a hidden identity id behind its display name, so a recycled name never inherits another agent's rooms, DMs, unread or history; existing handles keep their rows (#521)
- `rt chat sign-in --as <name or id>` continues an identity and `--name <name>` starts a fresh one; the agent name pool grows to 1,000 (#521)

### Settings

- eleven per-repo keys (`rt.roles`, `rt.worktrees`, `rt.hooks`, `rt.sync` and others) refuse a global value instead of applying it to every repo; `rt settings check` reports a stray one (#518)
- the VS Code extension now reads repo sections for the open repo, and console's effective-inputs panel reads the run's own repo (#518)

### Glance and gitq

- the group dashboard rides one shared cable instead of a watcher per MR, a late MR joins the group's push, and a single MR dashboard follows the cable's connection state (#519)
- `GitHubEventsPoller` commits its tick state only after a full tick (#519)
- `gitq undo` moves refs by compare-and-swap, never by checkout, checks for holding worktrees first, and resumes a partial undo (#519)

### Also

- MCP git tools accept a hand-made git worktree of a registered repo, such as `<checkout>/.worktrees/<name>`, and still refuse its subdirectories (#522)
- the VS Code extension bundle is load-checked in the release (#519)
- glitter's hovered tab button has symmetric padding (#514)
- `@mattstack/glance-react` is private; it no longer publishes to npm (#516)
- the marketplace catalog ships the current `mattstack` plugin (RT-338 wave 1, 0.26.1) and fast-browser plugin

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.14.0...v2.15.0
