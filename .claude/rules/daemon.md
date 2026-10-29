---
paths:
  - "lib/daemon/**"
  - "lib/daemon.ts"
  - "lib/daemon-logger.ts"
  - "rt-tray/Sources/TrayLog.swift"
  - "rt-tray/Sources/TrayServer.swift"
  - "commands/worktree-hook.ts"
  - "plugins/mattstack/hooks/enter-worktree-check.ts"
---

# Daemon

## Logging architecture

Logging is structural, not per-feature. Outcomes are logged at central seams; feature code only logs domain events. When adding a feature, you almost never need to add logging. Check this list before writing any.

**The seams (do not log outcomes yourself):**

- **CLI commands**. `dispatch()` in `lib/command-tree.ts` logs every command's outcome, and `installCliLogging()` (wired in `cli.ts`) covers every `process.exit()` path and persists crash stacks. A new command gets usage + error + crash logging with zero code.
- **Daemon commands**. Every IPC/REST command funnels through `handleCommand` in `lib/daemon.ts`, which logs ok/rejected/threw with duration. A new handler in `lib/daemon/handlers/` inherits this; do not log request/response or wrap handlers in logging try/catches.
- **Daemon crashes**. `installCrashHandlers` + `redirectNativeStderr` (`lib/daemon-logger.ts`) capture uncaught exceptions, rejections, JS stderr, and native bun panics.
- **Tray**. `TrayLog` (`rt-tray/Sources/TrayLog.swift`) is the only logging API (never bare `NSLog`); spawn subprocesses via `TrayLog.runLogged`/`spawnLoggedDetached`; `TrayServer.sendResponse` logs all non-2xx replies.

**The file convention:** every surface appends JSON lines to `~/.mattstack/rt/logs/<surface>.YYYY-MM-DD[.N].log` (daemon, cli, tray today). `rt daemon logs` auto-discovers surfaces by that pattern. A new surface that follows it appears in the viewer with no registration.

**What feature code SHOULD log:** domain events only, things invisible at the seams (a sync fast-forwarded, a watcher rewired). Daemon modules use `(await getDaemonLogger()).childLogger("<module>")`; handlers use `ctx.log`. Noisy periodic events go at `debug` (default level is `info`; `RT_LOG_LEVEL=debug` to see them).

**The catch policy:** never swallow errors in a seam. Below a logged seam, an empty catch is acceptable only for genuinely expected conditions (socket already closed, file already gone). Anything else logs at `warn` with `{ err }`.

## EnterWorktree into an rt tree is allowed by the plugin, not the daemon

Claude Code asks before `EnterWorktree` moves a session into a tree outside
`.claude/worktrees`, as a safety check no allow rule or classic hook can
answer. The mattstack plugin's `tool.check` hooks module
(`plugins/mattstack/hooks/enter-worktree-check.ts`) answers it: it turns the
ask into an allow only when the hidden `rt worktree is-registered <path>`
prints `registered`, stops on `unregistered`, and on any other output tries
the next `rt`, then leaves the ask for the person. The exit code settles
nothing, since an rt without the verb, or one not set up, also exits
nonzero; a change to either word must change the mod with it. The daemon reads and presses nothing
on that dialog. Do not bring back a screen-reading accept for it: the last
one matched Claude Code 2.1.281's drawing, and 2.1.312's redraw left it
accepting nothing while every pane waited on a person.

`lib/daemon/trust-dialog.ts` still parses the folder-trust dialog for spawn
paths. Its fixtures that claim to be the real dialog are pasted from captured
screens; when Claude Code changes the drawing, capture the new screen first,
add it as a fixture, and only then touch the regexes.
