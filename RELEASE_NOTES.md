A new on-by-default plugin, fresh-context, lets a Claude Code session clear or compact itself and pick up from a note it wrote, keeping its rt chat name across the clear. Herd workers reach their tools again after a reboot, and the console's run files answer only local requests.

### fresh-context

- new `fresh-context` plugin, installed with the others: a `fresh_context` tool and a `/fresh [clear|compact] [note]` command clear or compact the session after the turn ends, then hand the fresh context the ledger it wrote and an optional next step (#1228)
- a clear is refused while a subagent, background shell, monitor or workflow is running, and is dropped after an interrupted or failed turn (#1228, #1232)
- a session signed in to rt chat keeps its name, status, rooms and Slack chat across the clear, never shows offline, and gets its welcome without starting a turn; messages that arrived during the reset come in with the catch-up (#1228, #1233)
- the hidden `rt chat handoff begin|complete|cancel` verb carries the chat name; only the session itself, through the plugin, runs it (#1228, #1232)
- the `chat` plugin's sign-out at session end now passes why the session ended, so a clear handing its name on is not signed out (chat 0.6.1, #1232)

### Chat

- the mattstack chat tools and `whoami` act as the session Claude is on after a /clear, not the one the server started under (#1231)

### Herd and gates

- herd workers reach the herd tools again after a reboot (#1236)
- `rt gate list --open` includes parked gates (#1238)
- a `--dir` respawn clears the provisioned-tree marker (#1229)

### Board

- doctor rows stop reading "watching CI..." forever once the pane goes quiet (#1223)
- comment writes time out, and a slow refresh can't hold back a comment that landed (#1234)

### Console

- run files and API writes answer local requests only (#1235)

### Setup

- Fast Browser's setup skips its drift refusal on a Mac without Chrome (#1237)
- the Linear MCP step re-reads Claude's config right before it writes, so a change made in between is kept (#1230)
- worktree ready steps run rt's intercept shims, not a Homebrew copy (#1221)

### App

- window tabs load on a ready signal and recover on app health, not timers (#1224)
- update-machine builds each served app before the restart (#1227)
- `rt skills sync` checks and compiles the checkout it bumps and pushes (#1226)
- human-todos: a run item's Done button reads "Done without running" (#1225)
- the bundle check's socket guard follows the launch socket verdict (#1239)

### Tests and CI

- deck's vanishing-row modal test waits for focus to reach the page instead of checking once (#1222)

### Held pins

- bun stays at 1.4.4 (1.4.5 is out), and Sparkle at 2.10.0 (2.10.1 is out): a Sparkle bump gets its own tested release, and bun moves only with the artifacts it regenerates.

**Full Changelog**: https://github.com/m4ttstack/mattstack/compare/v2.35.2...v2.36.0
