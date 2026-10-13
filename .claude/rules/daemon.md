---
paths:
  - "lib/daemon/**"
  - "lib/daemon.ts"
  - "lib/daemon-logger.ts"
  - "rt-tray/Sources/TrayLog.swift"
  - "rt-tray/Sources/TrayServer.swift"
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

## The relocation prompt parser reads a real capture, not a hand-drawn one

`lib/daemon/trust-dialog.ts` parses Claude Code's EnterWorktree
"permission-root relocation" prompt (RT-200, RT-257), the only relocation
dialog Claude Code paints (ExitWorktree paints none on 2.1.283). Three seams
drive it, all behind the machine setting `panes.relocationAutoAccept`
(default on) and all accepting only a path in rt's worktree registry: the
herd watchdog for herd worker panes, the reconciler for other unattended
panes, and `lib/daemon/relocation-announce.ts` for attended herdr panes. The
last two stand down on a herd pane and share `createPaneDriveGuard`, so no
two seams press keys on one pane at once. An attended pane is driven only
after a `pane:announce-relocation` naming its session, sent by the mattstack
plugin's `PreToolUse` hook on EnterWorktree (through the hidden
`rt worktree announce-relocation`) or by the WorktreeCreate hook once it
provisions a tree, and only inside the watcher's 8-second window and for the
announced path.

Claude Code 2.1.281 draws the dialog under a full-width rule with a
" Tool use" heading, an "   Entering worktree(<path>)" echo and a
" │ permission-root relocation to ..." gutter line; the parser matches those
markers by column, never rejoins a path the terminal split across rows, and
refuses a dialog whose rule is narrower than any other line (a fake painted by
a command). Every fixture in `lib/daemon/__tests__/trust-dialog.test.ts` that
claims to be the real dialog is pasted from a gate's captured screen; when a
Claude Code update changes the drawing, capture the new screen from a stalled
pane, add it as a fixture, and only then touch the regexes. A parser that
"fails closed" here reads as a pane that never starts, so RT-263 tracks the
residue and every change needs the Bash-spoof, MCP-spoof and painted-dialog
fixtures still passing.
