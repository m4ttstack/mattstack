# rt Output Layer, Phase 6c (the daemon verb) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every line `rt daemon` prints (`install`, `uninstall`, `start`, `stop`, `restart`, `status`, `track`, `logs`, `log-level`) comes from the output layer: plain copy, states that are not failures drawn as what they are (a stopped daemon is `off`, a slow one `pending`, a flavor mix-up `warn`), coral only for a daemon that crashed or failed to boot. `--json`, exit codes, and the children `logs` hands the terminal stay as they are. `commands/daemon.ts` leaves the allowlist.

**Architecture:** Pure block builders (`statusBlocks`, `flavorInfoBlocks`, `flavorMismatchBlocks`, `trackListBlocks`, `logLevelBlocks`, ...) replace the string renderers, and each verb prints their result once. The polls that wait on the tray (`install`, `start`, `restart`) run under 5a's `withTransientStep`, so a person sees a spinner that leaves nothing, then one result line. The log viewer's seams take blocks instead of strings, so the tray's "first line of stderr" reader sees a failure title. The `--json` envelopes (`status`, `log-level`) are pinned before any edit.

**Tech Stack:** Bun + TypeScript, `bun:test` (the fake-socket pattern of `commands/__tests__/daemon-restart.test.ts`), the e2e suite (`e2e/tests/daemon.test.ts`), Fast Browser for renders.

**Spec:** `docs/superpowers/specs/2026-09-30-rt-output-layer-design.md` (RT-369): phase 6 ("Hidden verbs": `daemon` first), "Rules" 1 to 5, "Status set", "Copy style". **Scoping:** `docs/superpowers/plans/2026-10-02-rt-output-layer-phase-6-scoping.md`, 6c. House style: `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5f2-chat.md`. 5a's API (`withTransientStep`, `usageFailure`, `out.note`) is cited from `docs/superpowers/plans/2026-10-01-rt-output-layer-phase-5a-layer-additions.md`, "API for slices 5b to 5f".

**Size:** about 2,100 changed lines. One PR. **Second cut if it passes 2,500:** (i) Tasks 3 to 6 (`status`, `log-level`, `logs`), (ii) Tasks 7 to 9 (the lifecycle verbs and `track`), each with its own renders and ship task.

**What was run while writing this plan:** nothing was compiled. Written against `origin/main` at `658e704b9`.

## Global Constraints

- Never use em dashes or en dashes in any file, comment, test name, commit message or PR body. Today's source holds several (`—` in `stillShuttingDownLine`, the install summary, the uninstall and stop notes); every one of them is in a line this plan replaces, and no new code carries one.
- Never write the phrase banned under the second heading of `~/.claude/rules/no-em-dashes.md`.
- Comments state only a constraint the code cannot show.
- `--json` keeps its shape: `rt daemon status --json` (`{ ok: true, state: "not-installed" }` and `{ ok: true, ...verdict }`) and `rt daemon log-level --json` (the daemon's reply) are byte-identical, pinned in Task 3.
- Exit codes do not change. Today every lifecycle failure, every `track` refusal and `log-level`'s unreachable daemon return 0; they still do. Only the log viewer exits non-zero, as today.
- Rule 1: the children `rt daemon logs` gives the terminal (`lnav`, `tail | pino-pretty`, `logdy`) keep inherited stdio. Rule 3: failures go to stderr through `out.fail`; a policy refusal (a live daemon `uninstall` will not orphan, a non-GitLab repo `track live` will not watch) is a `refused` note.
- Coral only for failures: `crash-looping`, `boot-failed`, a daemon missing from the app, a tray that failed the op. `not-running` and `not installed` are `off`.
- Copy speaks to "you" and "this Mac", with no paths, store names (`rt.sock`, `daemon.json`, `repos.json`, `rt.repoTracking`) or launchd internals in sentences; the command to run goes in a `next` callout. A command may carry a path (`open <app path>`).
- Run `bun test` only from the repo root. Never run a built `rt` outside an isolated HOME. Never restart, stop or uninstall the real daemon on this machine: every test fakes the sockets under a temp HOME.
- Git commands are run plain and alone from the worktree root. Never `git add -A`, `.` or `-u`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files this slice must not edit: every file another phase 6 slice owns; `lib/ui/**`; `lib/daemon-status.ts`, `lib/daemon-config.ts`, `lib/daemon-client.ts`, `lib/daemon/**`; `lib/repo-tracking.ts`; `rt-tray/**`; every skill.
- UI validation is mandatory (Task 10).

## Review Focus

1. **The tray's View Logs when logdy is missing.** `LogViewerLaunch.reason` shows the first non-empty line of stderr. It must be a plain title ("rt could not find logdy"), with no `[failed]` tag, no escape and no leading blank line. Pinned in Task 6 (`the first stderr line of a missing logdy is the failure title alone`).
2. **`rt_verb {args: ["daemon", "status"]}`.** Four skills read `"state":"running"` and `sourceRev` from it. Its stdout must be one JSON value. Pinned in Task 3 (the `status --json` fixture entries) and by `e2e/tests/daemon.test.ts`, untouched.
3. **`rt daemon restart` when the tray drops the op.** The 2026-09-21 incident: the old pid kept answering and restart claimed success. The result line must never say restarted unless the pid turned over. Pinned by `commands/__tests__/daemon-restart.test.ts`'s existing cases, moved to the new copy in Task 8.
4. **A repo label or a daemon health reason carrying an escape sequence.** Drawn as text in its cell. Pinned in Task 4 (`a hostile health reason cannot repaint the screen`).
5. **`rt daemon status` while another flavor's daemon answers.** It must read as a warning with the app to open, never as a failure. Pinned in Task 4 (`another flavor answering is a warning that names the app to open`).

## Readers

| Reader | Reads | After |
|---|---|---|
| `skills/rt-build-dev-app/SKILL.md:300,334`, `skills/rt-release/publish-and-finish.md:237`, `plugins/mattstack/plugin/skills/creating-a-pack/SKILL.md:148,298` | `rt_verb {args: ["daemon", "status"]}` (appends `--json`) | unchanged envelope |
| `skills/rt-build-dev-app/SKILL.md` | `rt daemon restart` by exit code | unchanged |
| `rt-tray/Sources-core/Rt/LogViewerLaunch.swift:44-55` | `rt daemon logs --no-open`: first non-empty stderr line, else stdout, when rt exits before logdy answers | a failure title alone (Task 6) |
| `e2e/tests/daemon.test.ts:190,209` | `rt daemon status` plain text ("installed", "not installed") | updated in Task 4 to the new words |
| `lib/__tests__/no-wire-in-ui.test.ts:40` | `formatFreshnessParts` | kept, unchanged |

## Copy table

Today's text quotes `<...>` for values; `--` stands for a long dash. "note" means `out.note` (stderr), "print" `out.print` (stdout), "fail" `out.fail` (stderr).

### status (`showStatus`, `statusLines`, `printFlavorInfo`)

| Today | After |
|---|---|
| `○ not installed (run rt daemon install)` | print `line("off", "The daemon is not installed")`, `callout("next", cmd("rt daemon install"))` |
| `● running (SMAppService · pid <p> · uptime <u>)` + `watching: <n> repos`, `cache: <n> entries` | print `line("running", "The daemon is running", "pid <p>, up <u>")`, then a `kv` run: `watching` `<n> repo(s)`, `cache` `<n> entries` |
| `events: <label> <state> (<age>) · ...` | `kv("events", formatFreshnessParts(...).join(" · "))` |
| `health: <level>` + `- <reason>` lines | `line(level === "unhealthy" ? "failed" : "warn", \`The daemon reports it is ${level}\`)`, then `verbatim(reasons, "why")` |
| `event loop: maxLag <n>ms` | `kv("event loop", "slowest pause <n> ms")` |
| `● running, but not reporting status` + pid + reason line + `check: rt daemon logs` | `line("warn", "The daemon is running but did not report its status", "pid <p>")`, `callout("why", <reason sentence below>)`, `callout("next", cmd("rt daemon logs"))`. Reason: `error` gives "Its status command failed: <detail>"; an event loop gives "It answered a ping, but status timed out; its slowest pause was <n> ms<, in <cmd>>"; otherwise "It answered a ping, but status timed out, probably while it syncs." |
| `◐ parked (pid <p>, another flavor owns rt.sock)` + `held by: <f>` | `line("off", "This daemon is waiting", "the <f> daemon is running instead")` (or "another daemon is running instead" with no flavor), `callout("next", cmd("rt daemon logs"))` |
| `● process <p> is running but not answering rt.sock` + detail | `line("warn", "The daemon is running but not answering", "pid <p>")`, `callout("why", <detail>)`, `callout("next", cmd("rt daemon logs -t"))`. Details: booting "It is still starting up."; wedged "It started, then stopped answering; it may be stuck."; quarantined "It reset a damaged database and has not answered since."; stalled "It has not checked in for <n> seconds." |
| `● crash-looping (<n> failures recently)` + `last reason: <r>` | fail `{ title: "The daemon keeps crashing", hint: "<n> failures recently", why: <r>, next: cmd("rt daemon logs -t") }` |
| `● boot failed (phase: <ph>)` + `reason: <r>` | fail `{ title: "The daemon failed to start", hint: "while <ph>", why: <r>, next: cmd("rt daemon start") }` |
| `● installed but not running` + `last pid: <p>` | print `line("off", "The daemon is installed but not running", "last pid <p>")`, `callout("next", cmd("rt daemon start"))` |
| `<flavor> · <version> (<rev>)` | `kv("version", "<flavor>, <version><, rev>")` |
| `⚠ a <f> daemon (pid <p>) answers this <cli> CLI. Fix: open <path> (quit it first if it is running)` | `line("warn", "A <f> daemon is answering this <cli> rt", "pid <p>")`, `callout("next", cmd("open <path>"))`, `callout("note", "Quit it first if it is running.")` |
| the pool message (`worktreePool.message`) | `callout("note", <message>)` |
| `config: ~/.mattstack/rt/daemon.json`, `logs: ~/.mattstack/rt/logs/ (view with: rt daemon logs)` | removed: paths in sentences; every problem state above carries its own `next` |

The failure states print through `out.fail` to stderr, which is why `showStatus` prints the non-failure blocks with `out.print` and the two failure states with `out.fail`.

### install, uninstall

| Today | After |
|---|---|
| `registering the <flavor> daemon` | removed (the result lines say what happened) |
| `✓ saved config to ~/.mattstack/rt/daemon.json` | `line("done", "Turned the daemon on for this Mac")` |
| `✓ removed legacy launchd plist` | `line("done", "Removed a launch agent an older rt left behind")` |
| `✓ tray app is registering daemon` | `line("done", "<app> is starting the daemon")` |
| `⚠ <app> not reachable -- open it to finish setup` + `open <path>` | `line("needs-you", "<app> is not open", "open it to finish")`, `callout("next", cmd("open <path>"))` |
| the 12 x 250 ms wait | `withTransientStep("Waiting for the daemon to answer", ...)` |
| `✓ daemon is running` + `✓ installed -- managed by <app> · launchd-supervised · TCC inherits from <bundle>` | `line("done", "Installed the daemon", "<app> keeps it running")` |
| `⚠ daemon not yet responding` | `line("warn", "The daemon is not answering yet")` |
| `requiresApproval`: three lines and System Settings opens | then `line("needs-you", "macOS needs your approval to run it in the background", "System Settings is open at Login Items: allow <app>")`, `callout("next", cmd("rt daemon start"))`; System Settings still opens |
| `notFound`: `✗ daemon binary not found inside <bundle>` + `Re-run: rt --post-install ...` | fail `{ title: "The daemon is missing from <app>", why: "The app install looks incomplete.", next: cmd("rt --post-install") }` |
| `enabled`: keeps exiting + `Check logs` | fail `{ title: "The daemon stops right after it starts", next: cmd("rt daemon logs") }` |
| otherwise: `check logs: rt daemon logs` | `callout("next", cmd("rt daemon logs"))` under the warn line |
| uninstall `✓ daemon unregistered via tray` | `line("done", "Turned the daemon off in <app>")` |
| `· tray not reachable -- daemon may still be registered` | `line("warn", "<app> is not open", "the daemon may still be turned on")` |
| `⚠ daemon is still running, leaving rt.sock/rt.pid/daemon.json in place` + `Fix: launchctl bootout ...` | note `line("refused", "Left the daemon's files alone", "it is still running")`, `callout("next", cmd("launchctl bootout gui/$UID/<label>"))` |
| `✓ cleared install flag` + `daemon fully uninstalled` | `line("done", "Uninstalled the daemon")` |

### start, stop, restart

| Today | After |
|---|---|
| start, not installed: `daemon is not installed` + `run: rt daemon install` | `line("off", "The daemon is not installed")`, `callout("next", cmd("rt daemon install"))` |
| `daemon is already running` | `line("skipped", "The daemon is already running")` |
| `⚠ start failed in the tray` + `check the tray log: rt daemon logs` | fail `{ title: "<app> could not start the daemon", next: cmd("rt daemon logs") }` |
| `<app> is not running` + `open it: open <path>` (start, restart) | `line("needs-you", "<app> is not open")`, `callout("next", cmd("open <path>"))` |
| `starting <flavor> daemon via tray…` and the poll | `withTransientStep("Starting the <flavor> daemon", ...)` |
| `not up yet, escalating to restart (kickstart)…` and the second poll | `withTransientStep("It has not answered yet; restarting it", ...)` |
| `✓ daemon started` | `line("done", "The daemon started")` |
| `daemon starting… check logs: rt daemon logs` | `line("pending", "The daemon has not answered yet")`, `callout("next", cmd("rt daemon logs"))` |
| `⚠ stop failed in the tray -- the daemon may still be registered` + logs | fail `{ title: "<app> could not stop the daemon", why: "It may still be turned on.", next: cmd("rt daemon logs") }` |
| `⚠ still shutting down -- give it a moment (pid <p>)` | `line("pending", "The daemon is still shutting down", "pid <p>")` |
| `✓ <flavor> daemon stopped` | `line("done", "Stopped the <flavor> daemon")` |
| `<app> is not running -- nothing to stop` | `line("skipped", "<app> is not open, so nothing is running to stop")` |
| `⚠ a <f> daemon still holds rt.sock (pid <p>), not <flavor>` + `Fix: open <path> (quit it first if it is running)` (stop) | `line("warn", "A <f> daemon is still running", "pid <p>; you stopped the <flavor> one")`, `callout("next", cmd("open <path>"))`, `callout("note", "Quit it first if it is running.")` |
| `⚠ a <f> daemon answered on rt.sock (pid <p>), not <flavor>` (start, restart) | `line("warn", "A <f> daemon answered instead of the <flavor> one", "pid <p>")`, the same two callouts |
| `⚠ restart failed in the tray` + logs | fail `{ title: "<app> could not restart the daemon", next: cmd("rt daemon logs") }` |
| `restarting <flavor> daemon via tray…` and the pid poll | `withTransientStep("Restarting the <flavor> daemon", ...)` |
| `⚠ a daemon answers as pid <p>, but the pre-restart pid could not be read -- restart unverified` + logs | `line("warn", "A daemon is answering, but rt could not tell whether it restarted", "pid <p>")`, `callout("next", cmd("rt daemon logs"))` |
| `✓ daemon restarted (pid <a> → <b>)` | `line("done", "The daemon restarted", "pid <a> to <b>")` (`<a>` is `down` when there was none) |
| `⚠ restart did not happen -- the daemon still answers as pid <p>` + logs | fail `{ title: "The daemon did not restart", why: "It still answers as pid <p>.", next: cmd("rt daemon logs") }` |
| `daemon restarting… check logs: rt daemon logs` | `line("pending", "The daemon has not answered yet")`, `callout("next", cmd("rt daemon logs"))` |

### track

| Today | After |
|---|---|
| header `repo tracking (opt-in · rt.repoTracking · unlisted = off)` and one row per repo | `section("Repo tracking", "what rt watches in the background", table(rows))`; a row is `[{ text: mode word, role }, strong(label) or dim(label) when off, dim(detail)]`; modes: live `live` (`running`), poll `every 5 minutes` (`running`), off `off` (`off`); detail: live `watcher <state>` or `watcher starting`, then `caches <a, b>`, `window <w>` |
| `! <label> (tracked but not in ~/.mattstack/rt/repos.json)` | `line("warn", "<label> is tracked, but rt does not know where it is")`, `callout("next", cmd("rt repos locate <new-path> --repo <label>"))` |
| footer `set: rt daemon track <repo> live\|poll\|off [caches] caches: ... (default branches)` | `callout("next", cmd("rt daemon track <repo> live\|poll\|off"))` |
| editor header `<repo> window <w>` + `demands (read-only):` rows | `section(<repo>, "window <w>", ...)` holding `kv` rows `<client>` `<n> author(s): <names>, last seen <age>` under a `demands` caption line `line("skipped", "Read only: rt records these, you do not set them")` |
| `✗ repo "<arg>" not registered in ~/.mattstack/rt/repos.json` (two sites) | fail `{ title: "rt does not know a repo called <arg>", next: cmd("rt repos locate <path> --repo <arg>") }` |
| `✗ at least one cache is required (use off to stop tracking)` | fail `{ title: "Pick at least one cache", why: "To stop tracking, choose off." }` |
| `✗ enter a positive integer, or leave empty to clear` (re-prompt) | print `line("warn", "Enter a whole number of days, or leave it empty for the default")` |
| usage, three lines | fail `usageFailure("Which tracking mode?", "rt daemon track [<repo>] [live\|poll\|off [caches...]]", "Name a repo alone to choose in a menu.")` |
| `✗ unknown cache name in "<x>" (valid: ...)` | fail `{ title: "\"<x>\" has a cache rt does not know", why: "The caches are <a>, <b> and <c>." }` |
| `✗ <repo> has no GitLab remote (<url>); live watching is GitLab-only (use poll)` | note `line("refused", "rt cannot watch <repo> live", "live watching needs a GitLab remote")`, `callout("next", cmd("rt daemon track <repo> poll"))` |
| `✓ <repo> tracking: <level> [<caches>] window <w>` | `line("done", "Tracking <repo>: <level word>", "caches <a, b>, window <w>")`; `off`: `line("done", "Stopped tracking <repo>")` |
| `<repo> is still team-tracked -- recorded as a local opt-out (...)` | `callout("note", "Your team still tracks it, so this is saved as your own opt-out.")`, `callout("next", cmd("rt daemon track <repo> live"))` |
| `note: caches reset to [branches] (was [...]) -- pass a caches list to keep grants` | `callout("note", "Its caches went back to branches only; they were <a, b>.")`, `callout("next", cmd("rt daemon track <repo> <level> <a> <b>"))` |
| `live watchers: <labels>` | `kv("live watchers", <labels> or "none")` |
| `daemon not reachable; applies when it next starts or refreshes` | `line("pending", "The daemon is not running", "this applies when it next starts")` |

### logs, log-level

| Today | After |
|---|---|
| `no daemon logs yet... start the daemon first` and `no log files in <dir>... start the daemon first` | `line("skipped", "No daemon logs yet")`, `callout("next", cmd("rt daemon start"))` |
| native stderr: red header, `(<path>)`, 20 red lines | `line("warn", "The daemon crashed since it last started", "captured <time>")`, `verbatim(<the last 20 lines>, "what it printed")`; not coral: it is a record of a past crash |
| `no crash since this daemon started` | `line("skipped", "No crash since this daemon started")` |
| `tailing <paths> via pino-pretty (Ctrl-C to stop)` + `brew install lnav` | `line("running", "Following the daemon's logs", "Ctrl-C to stop")`, `callout("tip", ["For a richer view, install lnav: ", cmd("brew install lnav")])` |
| `logdy not found (checked ...)` + `install: brew install logdy, or use rt daemon logs --terminal` | fail `{ title: "rt could not find logdy", why: "It ships with the app, and it was not there or on your PATH.", next: [cmd("brew install logdy"), ", or ", cmd("rt daemon logs --terminal")] }` |
| `● starting logdy on <url>` + `tailing: <paths>` | `line("running", "Starting the log viewer", <url>)`; the paths go to the CLI log at `debug` |
| `logdy exited <code> before answering on :5544` | fail `{ title: "The log viewer stopped before it opened", why: "logdy exited <code>." }` |
| `logdy did not answer on :5544 within 5s` | fail `{ title: "The log viewer did not start in time", why: "Nothing answered on port 5544 within 5 seconds." }` |
| `✓ viewer running on <url> ... Ctrl-C to stop` | `line("running", "The log viewer is open", "<url>, Ctrl-C to stop")` |
| log-level `● daemon not reachable` | fail `{ title: "The daemon is not running", next: cmd("rt daemon start") }` |
| `● <error>` | fail `{ title: <error> }` |
| `● daemon log level set to <l>` / `is <l>` | `line("done", "Set the daemon's log level to <l>")` / `kv("log level", <l>)` |

Every command named above exists in `lib/command-tree-def.ts` (`rt daemon install|start|logs|track`, `rt repos locate`, `rt --post-install`); `open`, `launchctl`, `brew` are system commands.

## File Structure

| File | Responsibility |
|---|---|
| `commands/daemon.ts` (modify) | builders, every verb on the layer |
| `commands/__tests__/daemon-json.test.ts` (create) | the `--json` pins |
| `commands/__tests__/daemon-status-render.test.ts`, `status-lines.test.ts`, `daemon-flavor-output.test.ts`, `log-level.test.ts`, `daemon-logs-web-viewer.test.ts`, `daemon-restart.test.ts`, `daemon-uninstall-start.test.ts`, `daemon-tracking.test.ts` (modify) | read blocks and the capture, not console text |
| `e2e/tests/daemon.test.ts` (modify) | two plain-text assertions |
| `lib/__tests__/raw-output-allowlist.json` (modify) | one line |
| `AGENTS.md`, `docs/design/output-layer/` (modify) | a paragraph; two renders |

---

### Task 1: Confirm the base

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`.
- [ ] **Step 2:** Run each alone: `grep -n "export async function withTransientStep" lib/ui/transient-step.ts`; `grep -n "export function usageFailure" lib/ui/usage.ts`; `grep -n "export function note" lib/ui/out.ts`; `grep -n "commands/daemon.ts" lib/__tests__/raw-output-allowlist.json`. Expected: one line each. Any empty: **stop** and report which.
- [ ] **Step 3:** Run `bun test commands/__tests__/daemon-flavor-output.test.ts commands/__tests__/daemon-logdy-config.test.ts commands/__tests__/daemon-logs-render.test.ts commands/__tests__/daemon-logs-web-viewer.test.ts commands/__tests__/daemon-restart.test.ts commands/__tests__/daemon-status-render.test.ts commands/__tests__/daemon-tracking.test.ts commands/__tests__/daemon-uninstall-start.test.ts commands/__tests__/status-lines.test.ts commands/__tests__/log-level.test.ts lib/__tests__/no-wire-in-ui.test.ts`. Expected: PASS (`daemon-logdy-config` is a known rotating flake under load; rerun it alone if it fails). Otherwise stop and report.

---

### Task 2: Move the console harnesses onto the capture

No change to `commands/daemon.ts`. Four test files replace `console.log` by hand; they move onto `captureOut({ console: true })` so the same tests read the old file and, from Task 4 on, the new one.

**Files:** `commands/__tests__/daemon-restart.test.ts`, `daemon-uninstall-start.test.ts`, `daemon-tracking.test.ts`.

- [ ] **Step 1:** In each, replace the hand-rolled `console.log = ...` capture with:

```ts
import * as ui from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";

let io: CapturedOut;
beforeEach(() => {
  io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
});
afterEach(() => io.restore());

function output(): string {
  return io.stdout() + io.stderr();
}
```

and keep each file's other `beforeEach`/`afterEach` work. Where a file collected `logs` or `lines`, its assertions read `output()`.

- [ ] **Step 2:** Run the three files. Expected: PASS with `commands/daemon.ts` untouched.
- [ ] **Step 3:** Commit.

```bash
git add commands/__tests__/daemon-restart.test.ts commands/__tests__/daemon-uninstall-start.test.ts commands/__tests__/daemon-tracking.test.ts
```

```bash
git commit -m "daemon tests: read output through the capture helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pin the `--json` envelopes before converting

**Files:** Create `commands/__tests__/daemon-json.test.ts`.

**Interfaces:**
- Consumes: `showStatus`, `setLogLevel` from `commands/daemon.ts`; `markDaemonInstalled`, `DAEMON_SOCK_PATH` from `lib/daemon-config.ts`.
- Produces: three tests Tasks 4 and 6 re-run unchanged.

- [ ] **Step 1: Write the tests**

```ts
/**
 * rt daemon status --json and log-level --json are read by skills through
 * rt_verb; their bytes must not move.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";

import * as ui from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { DAEMON_SOCK_PATH, markDaemonInstalled, markDaemonUninstalled } from "../../lib/daemon-config.ts";
import { setLogLevel, showStatus } from "../daemon.ts";

let io: CapturedOut;
let server: ReturnType<typeof Bun.serve> | undefined;
let replies: Record<string, unknown> = {};
const realArgv = process.argv;

beforeEach(() => {
  io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
  process.argv = [...realArgv, "--json"];
});

afterEach(() => {
  server?.stop(true);
  server = undefined;
  rmSync(DAEMON_SOCK_PATH, { force: true });
  markDaemonUninstalled();
  process.argv = realArgv;
  io.restore();
});

function fakeDaemon(): void {
  mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
  server = Bun.serve({
    unix: DAEMON_SOCK_PATH,
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      return Response.json(replies[cmd] ?? { ok: false, error: `unknown command: ${cmd}` });
    },
  });
}

test("status --json, not installed, is the bare not-installed envelope", async () => {
  markDaemonUninstalled();
  await showStatus(["--json"]);
  expect(io.stdout()).toBe('{"ok":true,"state":"not-installed"}\n');
  expect(io.stderr()).toBe("");
});

test("status --json, running, is the verdict spread into one line", async () => {
  markDaemonInstalled();
  replies = { status: { ok: true, data: { pid: 42, uptime: 60_000, watchedRepos: 1, cacheEntries: 2 } } };
  fakeDaemon();
  await showStatus(["--json"]);
  const line = io.stdout();
  expect(line.endsWith("\n")).toBe(true);
  expect(line.split("\n")).toHaveLength(2);
  const parsed = JSON.parse(line);
  expect(parsed.ok).toBe(true);
  expect(parsed.state).toBe("running");
  expect(parsed.data.pid).toBe(42);
});

test("log-level --json passes the daemon's reply through", async () => {
  replies = { "daemon:log-level": { ok: true, level: "debug" } };
  fakeDaemon();
  await setLogLevel(["debug", "--json"]);
  expect(JSON.parse(io.stdout())).toMatchObject({ ok: true, level: "debug" });
  expect(io.stdout().split("\n")).toHaveLength(2);
});
```

`daemonQuery` sends `GET` (or `POST` with a body) to `http://localhost/<cmd>` over `DAEMON_SOCK_PATH` and returns the parsed JSON body as it is (`lib/daemon-client.ts`, `trySocketQuery`), so each reply above is exactly what the verb receives. `DAEMON_SOCK_PATH` sits under the test HOME, as `commands/__tests__/daemon-restart.test.ts` relies on.

- [ ] **Step 2:** Run it: PASS on the unconverted file. Run it twice more: PASS.
- [ ] **Step 3:** Commit.

```bash
git add commands/__tests__/daemon-json.test.ts
```

```bash
git commit -m "daemon: pin status and log-level --json before the output layer touches them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `rt daemon status` on blocks

**Files:** `commands/daemon.ts` (`statusLines`, `showStatus`, `printFlavorInfo`, `tupleWarning`), `commands/__tests__/daemon-status-render.test.ts`, `status-lines.test.ts`, `daemon-flavor-output.test.ts` (the `tupleWarning` cases), `e2e/tests/daemon.test.ts`.

**Interfaces:**
- Produces: `statusBlocks(verdict: DaemonStatusVerdict, now: number): { print: Block[]; failure?: out.FailureInput }`; `flavorInfoBlocks(daemon: { flavor: string; pid: number | null; version?: string; sourceRev?: string | null } | null, cliFlavor: Flavor): Block[]`; `tupleWarningBlocks(t: FlavorTuple): Block[]` (empty when coherent). `statusLines` and `tupleWarning` are deleted.

- [ ] **Step 1: Write the failing tests**

Replace `commands/__tests__/status-lines.test.ts` and the `statusLines` cases of `daemon-status-render.test.ts` with tests on `statusBlocks` through `renderPlain` (import `renderPlain` from `../../lib/ui/out-plain.ts`). The cases, one test each, with these expectations:

```ts
import { expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { flavorInfoBlocks, statusBlocks, tupleWarningBlocks } from "../daemon.ts";

const plain = (v: unknown, now = 0) => {
  const r = statusBlocks(v as never, now);
  return renderPlain([...r.print, ...(r.failure ? [out.failure(r.failure)] : [])]);
};

test("running: a line, then what it watches", () => {
  const text = plain({ state: "running", data: { pid: 42, uptime: 3_720_000, watchedRepos: 3, cacheEntries: 10 } });
  expect(text).toStartWith("[running] The daemon is running  pid 42, up 1h 2m\n");
  expect(text).toContain("watching: 3 repos");
  expect(text).toContain("cache: 10 entries");
});

test("running prints the health level and reasons when present", () => {
  const text = plain({ state: "running", data: { pid: 42, uptime: 60_000, watchedRepos: 3, cacheEntries: 10, health: { level: "degraded", reasons: ["refresh: 3 repos failing (auth?)"] } } });
  expect(text).toContain("[warning] The daemon reports it is degraded");
  expect(text).toContain("refresh: 3 repos failing (auth?)");
});

test("a hostile health reason cannot repaint the screen", () => {
  const text = plain({ state: "running", data: { pid: 1, uptime: 1, watchedRepos: 0, cacheEntries: 0, health: { level: "unhealthy", reasons: ["x\x1b[2Jy"] } } });
  expect(text).not.toContain("\x1b");
});

test("degraded/unresponsive names the slowest pause, never 'probably mid-sync'", () => {
  const text = plain({ state: "degraded", reason: "unresponsive", pid: 42, eventLoop: { maxLagMs: 1400, lastStallAt: 1, lastStallCmd: "mr:action", stalls: 2 } });
  expect(text).toContain("[warning] The daemon is running but did not report its status  pid 42");
  expect(text).toContain("1400 ms, in mr:action");
  expect(text).not.toContain("mid-sync");
  expect(text).toContain("next: rt daemon logs");
});

test("alive-not-serving 'stalled' says how long it has been quiet", () => {
  expect(plain({ state: "alive-not-serving", pid: 42, detail: "stalled", stalledForMs: 8000 })).toContain("It has not checked in for 8 seconds.");
});

test("crash-looping and boot-failed are the only failures", () => {
  expect(statusBlocks({ state: "crash-looping", failures: 4, reason: "segfault" } as never, 0).failure).toEqual({ title: "The daemon keeps crashing", hint: "4 failures recently", why: "segfault", next: out.cmd("rt daemon logs -t") });
  expect(statusBlocks({ state: "boot-failed", reason: "port in use", phase: "api" } as never, 0).failure?.title).toBe("The daemon failed to start");
  for (const v of [{ state: "not-running", pid: 7 }, { state: "parked", pid: 7 }, { state: "degraded", reason: "error", pid: 7 }]) {
    expect(statusBlocks(v as never, 0).failure).toBeUndefined();
  }
});

test("not running is off, with the start command", () => {
  expect(plain({ state: "not-running", pid: 7 })).toBe("[off] The daemon is installed but not running  last pid 7\n  next: rt daemon start\n");
});

test("another flavor answering is a warning that names the app to open", () => {
  const text = renderPlain(tupleWarningBlocks({ cliFlavor: "dev", daemon: { flavor: "prod", pid: 99 } }));
  expect(text).toStartWith("[warning] A prod daemon is answering this dev rt  pid 99\n");
  expect(text).toContain("next: open ");
  expect(text).toContain("mattstack-dev.app");
  expect(text).toContain("note: Quit it first if it is running.");
  expect(tupleWarningBlocks({ cliFlavor: "dev", daemon: { flavor: "dev", pid: 1 } })).toEqual([]);
  expect(tupleWarningBlocks({ cliFlavor: "dev", daemon: null })).toEqual([]);
});

test("flavor info is a version row", () => {
  expect(renderPlain(flavorInfoBlocks({ flavor: "dev", pid: 1, version: "2.20.0", sourceRev: "abc1234" }, "dev"))).toBe("version: dev, 2.20.0, abc1234\n");
});
```

In `daemon-flavor-output.test.ts`, delete the three `tupleWarning` cases (moved above) and keep the `flavorHintPath` case.

In `e2e/tests/daemon.test.ts`, change the `rt daemon status after install shows installed state` and `rt daemon status shows not installed` assertions to the new words: `The daemon is` (any installed state prints a line starting so) and `The daemon is not installed`. Read both tests first; keep every other assertion.

- [ ] **Step 2:** Run the two unit files: FAIL, `statusBlocks is not a function`.

- [ ] **Step 3: Implement**

In `commands/daemon.ts`, replace the `lib/tui.ts` import with:

```ts
import * as out from "../lib/ui/out.ts";
import type { Block } from "../lib/ui/protocol.ts";
import { usageFailure } from "../lib/ui/usage.ts";
import { withTransientStep } from "../lib/ui/transient-step.ts";
import { logCliEvent } from "../lib/cli-logger.ts";
```

(`bold`, `dim`, `green`, `yellow`, `red`, `reset` go; Tasks 5 to 9 remove their last uses. Until then `bun run typecheck` reports the remaining uses: finish this task's functions, and leave the rest to their tasks, keeping the import of `lib/tui.ts` until Task 9 removes it.)

Add, replacing `tupleWarning`, `printFlavorInfo` and `statusLines`:

```ts
export function tupleWarningBlocks(t: FlavorTuple): Block[] {
  if (!t.daemon || t.daemon.flavor === t.cliFlavor) return [];
  return [
    out.line("warn", `A ${t.daemon.flavor} daemon is answering this ${t.cliFlavor} rt`, t.daemon.pid ? `pid ${t.daemon.pid}` : undefined),
    out.callout("next", out.cmd(`open ${flavorHintPath(t.cliFlavor)}`)),
    out.callout("note", "Quit it first if it is running."),
  ];
}

export function flavorInfoBlocks(daemon: { flavor: string; pid: number | null; version?: string; sourceRev?: string | null } | null, cliFlavor: Flavor): Block[] {
  if (!daemon) return [];
  const rev = daemon.flavor === "dev" && daemon.sourceRev ? `, ${daemon.sourceRev}` : "";
  const version = daemon.version ? `, ${daemon.version}${rev}` : "";
  return [out.kv("version", `${daemon.flavor}${version}`), ...tupleWarningBlocks({ cliFlavor, daemon: { flavor: daemon.flavor, pid: daemon.pid } })];
}

const NOT_SERVING: Record<"booting" | "wedged" | "quarantined", string> = {
  booting: "It is still starting up.",
  wedged: "It started, then stopped answering; it may be stuck.",
  quarantined: "It reset a damaged database and has not answered since.",
};

export function statusBlocks(verdict: DaemonStatusVerdict, now: number): { print: Block[]; failure?: out.FailureInput } {
  switch (verdict.state) {
    case "running": {
      const { pid, uptime, watchedRepos, cacheEntries } = verdict.data;
      const blocks: Block[] = [
        out.line("running", "The daemon is running", `pid ${pid}, up ${formatUptime(uptime)}`),
        out.kv("watching", `${watchedRepos} repo${watchedRepos !== 1 ? "s" : ""}`),
        out.kv("cache", `${cacheEntries} entries`),
      ];
      const freshness = verdict.data.freshness as Record<string, { state: string; lastSyncedAt: string | null }> | undefined;
      if (freshness && Object.keys(freshness).length > 0) blocks.push(out.kv("events", formatFreshnessParts(freshness, now).join(" · ")));
      const el = verdict.data.eventLoop as { maxLagMs: number } | undefined;
      if (el && el.maxLagMs >= 500) blocks.push(out.kv("event loop", `slowest pause ${el.maxLagMs} ms`));
      const health = verdict.data.health as { level: string; reasons: string[] } | undefined;
      if (health && health.level !== "ok") {
        blocks.push(out.line(health.level === "unhealthy" ? "failed" : "warn", `The daemon reports it is ${health.level}`));
        if (health.reasons.length > 0) blocks.push(out.verbatim(health.reasons, "why"));
      }
      return { print: blocks };
    }
    case "degraded": {
      const why =
        verdict.reason === "error"
          ? `Its status command failed: ${verdict.detail ?? "unknown error"}`
          : verdict.eventLoop && verdict.eventLoop.maxLagMs > 0
            ? `It answered a ping, but status timed out; its slowest pause was ${verdict.eventLoop.maxLagMs} ms${verdict.eventLoop.lastStallCmd ? `, in ${verdict.eventLoop.lastStallCmd}` : ""}.`
            : "It answered a ping, but status timed out, probably while it syncs.";
      return {
        print: [
          out.line("warn", "The daemon is running but did not report its status", verdict.pid ? `pid ${verdict.pid}` : undefined),
          out.callout("why", why),
          out.callout("next", out.cmd("rt daemon logs")),
        ],
      };
    }
    case "parked":
      return {
        print: [
          out.line("off", "This daemon is waiting", verdict.holderFlavor ? `the ${verdict.holderFlavor} daemon is running instead` : "another daemon is running instead"),
          out.callout("next", out.cmd("rt daemon logs")),
        ],
      };
    case "alive-not-serving": {
      const why = verdict.detail === "stalled" ? `It has not checked in for ${Math.round((verdict.stalledForMs ?? 0) / 1000)} seconds.` : NOT_SERVING[verdict.detail];
      return { print: [out.line("warn", "The daemon is running but not answering", `pid ${verdict.pid}`), out.callout("why", why), out.callout("next", out.cmd("rt daemon logs -t"))] };
    }
    case "crash-looping":
      return { print: [], failure: { title: "The daemon keeps crashing", hint: `${verdict.failures} failures recently`, why: verdict.reason, next: out.cmd("rt daemon logs -t") } };
    case "boot-failed":
      return { print: [], failure: { title: "The daemon failed to start", hint: `while ${verdict.phase}`, why: verdict.reason, next: out.cmd("rt daemon start") } };
    case "not-running":
      return { print: [out.line("off", "The daemon is installed but not running", verdict.pid ? `last pid ${verdict.pid}` : undefined), out.callout("next", out.cmd("rt daemon start"))] };
    case "not-installed":
      return { print: [out.line("off", "The daemon is not installed"), out.callout("next", out.cmd("rt daemon install"))] };
  }
}
```

Rewrite the tail of `showStatus`:

```ts
  if (!isDaemonInstalled()) {
    if (json) return void out.json({ ok: true, state: "not-installed" });
    out.print(...statusBlocks({ state: "not-installed" }, Date.now()).print);
    return;
  }
  // ... the probing above is unchanged ...
  if (json) return void out.json({ ok: true, ...verdict });

  const shown = statusBlocks(verdict, Date.now());
  const extra: Block[] = [];
  if (verdict.state === "running") {
    const identity = verdict.data.identity as { flavor: "dev" | "prod"; version: string; sourceRev: string | null } | undefined;
    if (identity) extra.push(...flavorInfoBlocks({ flavor: identity.flavor, version: identity.version, sourceRev: identity.sourceRev, pid: verdict.data.pid ?? null }, processFlavor()));
    const worktreePool = verdict.data.worktreePool as { dormant: boolean; message?: string } | undefined;
    if (worktreePool?.dormant && worktreePool.message) extra.push(out.callout("note", worktreePool.message));
  } else if (verdict.state === "degraded") {
    extra.push(...flavorInfoBlocks(await probeSocketHolder(), processFlavor()));
  }
  if (shown.print.length + extra.length > 0) out.print(...shown.print, ...extra);
  if (shown.failure) out.fail(shown.failure);
```

The two footer `console.log` lines (config and logs paths) and the trailing blank line are deleted.

- [ ] **Step 4:** Run `bun test commands/__tests__/status-lines.test.ts commands/__tests__/daemon-status-render.test.ts commands/__tests__/daemon-flavor-output.test.ts commands/__tests__/daemon-json.test.ts lib/__tests__/no-wire-in-ui.test.ts`. Expected: PASS (the `flavorMismatchLines` and `stillShuttingDownLine` cases in `daemon-flavor-output.test.ts` still pass: Task 8 moves them).
- [ ] **Step 5:** Commit.

```bash
git add commands/daemon.ts commands/__tests__/status-lines.test.ts commands/__tests__/daemon-status-render.test.ts commands/__tests__/daemon-flavor-output.test.ts e2e/tests/daemon.test.ts
```

```bash
git commit -m "daemon status: blocks, a stopped daemon reads as off, only a crash or a failed boot is a failure

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `rt daemon log-level`

**Files:** `commands/daemon.ts` (`formatLogLevelResult`, `setLogLevel`), `commands/__tests__/log-level.test.ts`.

**Interfaces:**
- Produces: `logLevelBlocks(res: { ok: boolean; level?: string; error?: string }, wasSet: boolean): { print: Block[]; failure?: out.FailureInput }`. `formatLogLevelResult` is deleted.

- [ ] **Step 1: Failing test** (replace the file's body):

```ts
import { expect, test } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { logLevelBlocks } from "../daemon.ts";

test("set names the new level; show is a row", () => {
  expect(renderPlain(logLevelBlocks({ ok: true, level: "debug" }, true).print)).toBe("[ok] Set the daemon's log level to debug\n");
  expect(renderPlain(logLevelBlocks({ ok: true, level: "info" }, false).print)).toBe("log level: info\n");
});

test("a daemon error is a failure titled in its words", () => {
  expect(logLevelBlocks({ ok: false, error: "bad level: loud" }, true).failure).toEqual({ title: "bad level: loud" });
});
```

- [ ] **Step 2:** Run: FAIL (`logLevelBlocks is not a function`).
- [ ] **Step 3: Implement**

```ts
export function logLevelBlocks(res: { ok: boolean; level?: string; error?: string }, wasSet: boolean): { print: Block[]; failure?: out.FailureInput } {
  if (!res.ok) return { print: [], failure: { title: res.error ?? "The daemon did not change its log level" } };
  return { print: [wasSet ? out.line("done", `Set the daemon's log level to ${res.level}`) : out.kv("log level", res.level)] };
}

export async function setLogLevel(args: string[] = []): Promise<void> {
  const json = args.includes("--json");
  const level = args.find((a) => !a.startsWith("--"));
  const res = await daemonQuery("daemon:log-level", level ? { level } : {});
  if (!res) {
    out.fail({ title: "The daemon is not running", next: out.cmd("rt daemon start") });
    return;
  }
  if (json) {
    out.json(res);
    return;
  }
  const shown = logLevelBlocks(res as { ok: boolean; level?: string; error?: string }, Boolean(level));
  if (shown.failure) out.fail(shown.failure);
  else out.print(...shown.print);
}
```

- [ ] **Step 4:** Run `bun test commands/__tests__/log-level.test.ts commands/__tests__/daemon-json.test.ts`. PASS.
- [ ] **Step 5:** Commit (`commands/daemon.ts`, `commands/__tests__/log-level.test.ts`), message `daemon log-level: blocks, an unreachable daemon is a failure with the start command`.

---

### Task 6: `rt daemon logs` and the viewer seams

**Files:** `commands/daemon.ts` (`showLogs`, `runTerminalViewer`, `WebViewerSeams`, `REAL_WEB_VIEWER_SEAMS`, `runWebViewer`), `commands/__tests__/daemon-logs-web-viewer.test.ts`.

**Interfaces:**
- Changes: `WebViewerSeams.log` becomes `print(...blocks: Block[]): void`; `WebViewerSeams.error` becomes `fail(f: out.FailureInput): void`. The real seams call `out.print` and `out.fail`.

- [ ] **Step 1: Failing tests**

In `daemon-logs-web-viewer.test.ts`, change `fakeSeams` to collect `print: (...blocks) => calls.printed.push(...blocks)` and `fail: (f) => calls.failures.push(f)`, and every assertion on `calls.errors` to `calls.failures.map((f) => f.title)`. Add:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";

test("the first stderr line of a missing logdy is the failure title alone", async () => {
  const { seams, calls } = fakeSeams({ findLogdy: () => null });
  await expect(runWebViewer(["/logs/daemon.log"], { open: true }, seams)).rejects.toThrow("exit 1");
  const first = renderPlain([out.failure(calls.failures[0]!)]).split("\n")[0];
  expect(first).toBe("rt could not find logdy");
});

test("an early logdy exit and a slow logdy are failures the tray can show", async () => {
  const early = fakeSeams({ spawnLogdy: (_b, _a) => ({ kill: () => {}, onExit: (cb) => cb(3) }), waitForPort: async () => false });
  await expect(runWebViewer([], { open: false }, early.seams)).rejects.toThrow();
  expect(early.calls.failures[0]?.title).toBe("The log viewer stopped before it opened");
  const slow = fakeSeams({ waitForPort: async () => false });
  await expect(runWebViewer([], { open: false }, slow.seams)).rejects.toThrow("exit 1");
  expect(slow.calls.failures.at(-1)?.title).toBe("The log viewer did not start in time");
});
```

- [ ] **Step 2:** Run: FAIL (the seam names differ).
- [ ] **Step 3: Implement**

```ts
export interface WebViewerSeams {
  findLogdy(): string | null;
  materializeConfig(): string;
  spawnLogdy(bin: string, args: string[]): { kill(): void; onExit(cb: (code: number | null) => void): void };
  waitForPort(port: number, timeoutMs: number): Promise<boolean>;
  openUrl(url: string): void;
  onSignal(signal: "SIGINT" | "SIGTERM", cb: () => void): void;
  exit(code: number): never;
  print(...blocks: Block[]): void;
  fail(f: out.FailureInput): void;
}
```

`REAL_WEB_VIEWER_SEAMS`: `print: (...blocks) => out.print(...blocks)`, `fail: (f) => out.fail(f)`.

In `runWebViewer`:

```ts
  if (!bin) {
    seams.fail({ title: "rt could not find logdy", why: "It ships with the app, and it was not there or on your PATH.", next: [out.cmd("brew install logdy"), ", or ", out.cmd("rt daemon logs --terminal")] });
    return seams.exit(1);
  }
  const configPath = seams.materializeConfig();
  const url = `http://localhost:${LOGDY_PORT}`;
  seams.print(out.line("running", "Starting the log viewer", url));
  logCliEvent("debug", "daemon", "logdy follows", { paths: logPaths });
```

`onExit`: `if (!answered) seams.fail({ title: "The log viewer stopped before it opened", why: \`logdy exited ${code ?? "on a signal"}.\` });`. Timeout: `seams.fail({ title: "The log viewer did not start in time", why: \`Nothing answered on port ${LOGDY_PORT} within ${LOGDY_ANSWER_TIMEOUT_MS / 1000} seconds.\` });`. Success: `seams.print(out.line("running", "The log viewer is open", \`${url}, Ctrl-C to stop\`));`.

`showLogs`: the two "no logs" sites print `out.line("skipped", "No daemon logs yet")` and `out.callout("next", out.cmd("rt daemon start"))`. The native-stderr block:

```ts
      if (show) {
        out.print(out.line("warn", "The daemon crashed since it last started", `captured ${new Date(mtimeMs).toLocaleString()}`), out.verbatim(content.split("\n").slice(-20), "what it printed"));
      } else {
        out.print(out.line("skipped", "No crash since this daemon started"));
      }
```

`nativeStderrDisplay` keeps its signature and its tests (`daemon-logs-render.test.ts`); only its `header` is no longer printed, so its first branch's header text is unused by `showLogs`: keep it, its test pins the gate logic.

`runTerminalViewer`'s no-lnav branch:

```ts
    out.print(out.line("running", "Following the daemon's logs", "Ctrl-C to stop"), out.callout("tip", ["For a richer view, install lnav: ", out.cmd("brew install lnav")]));
```

The `spawn` calls (`lnav`, `sh -c tail | pino-pretty`, `logdy`) keep inherited stdio.

- [ ] **Step 4:** Run `bun test commands/__tests__/daemon-logs-web-viewer.test.ts commands/__tests__/daemon-logs-render.test.ts commands/__tests__/daemon-logdy-config.test.ts`. PASS.
- [ ] **Step 5:** Commit (`commands/daemon.ts`, `commands/__tests__/daemon-logs-web-viewer.test.ts`), message `daemon logs: the viewer's failures are failure blocks whose first line the tray can show`.

---

### Task 7: `install` and `uninstall`

**Files:** `commands/daemon.ts`, `commands/__tests__/daemon-uninstall-start.test.ts`.

- [ ] **Step 1: Failing tests.** In `daemon-uninstall-start.test.ts`, change the three `uninstall` assertions: `toContain("launchctl bootout")` stays (now from the `next` callout on stderr, which `output()` includes); `toContain("daemon fully uninstalled")` becomes `toContain("[ok] Uninstalled the daemon")`; add to the still-alive cases `expect(io.stderr()).toContain("[refused] Left the daemon's files alone  it is still running")` and `expect(io.stdout()).not.toContain("refused")`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** `install` and `uninstall` by the copy table. `install`'s wait:

```ts
  const connected = await withTransientStep("Waiting for the daemon to answer", async () => {
    for (let i = 0; i < 12; i++) {
      await Bun.sleep(250);
      if (await isDaemonRunning()) return true;
    }
    return false;
  });
```

The not-responding branch prints `out.line("warn", "The daemon is not answering yet")` and then, per `smStatus`, the copy table's blocks (`requiresApproval` still runs the `open 'x-apple.systempreferences:...'` `execSync` after printing; that fixed string is not this slice's shell-string item). `uninstall`'s still-alive case is `out.note(out.line("refused", "Left the daemon's files alone", "it is still running"), out.callout("next", out.cmd(\`launchctl bootout gui/$UID/${activeLaunchdLabel()}\`)))`.

- [ ] **Step 4:** Run `bun test commands/__tests__/daemon-uninstall-start.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `daemon install, uninstall: result lines; a live daemon uninstall will not orphan is a refusal`.

---

### Task 8: `start`, `stop`, `restart` and the flavor mismatch

**Files:** `commands/daemon.ts` (`flavorMismatchLines`, `stillShuttingDownLine`, `printFlavorMismatch`, `warnIfWrongFlavor`, `start`, `pollForDaemonUp`, `stop`, `restart`), `commands/__tests__/daemon-flavor-output.test.ts`, `daemon-restart.test.ts`, `daemon-uninstall-start.test.ts` (the two start cases).

**Interfaces:**
- Produces: `flavorMismatchBlocks(op: "stop" | "start" | "restart", holder: { flavor: string; pid: number | null }, flavor: Flavor): Block[]`; `stillShuttingDownBlock(holder: { pid: number | null }): Block`. `flavorMismatchLines`, `stillShuttingDownLine`, `printFlavorMismatch` are deleted. `pollForDaemonUp(): Promise<boolean>` no longer prints.

- [ ] **Step 1: Failing tests.** Replace the mismatch and shutting-down cases in `daemon-flavor-output.test.ts`:

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { flavorHintPath, flavorMismatchBlocks, stillShuttingDownBlock } from "../daemon.ts";

test("stop's mismatch says the other daemon is still running and which app to open", () => {
  const text = renderPlain(flavorMismatchBlocks("stop", { flavor: "prod", pid: 42 }, "dev"));
  expect(text).toStartWith("[warning] A prod daemon is still running  pid 42; you stopped the dev one\n");
  expect(text).toContain(`next: open ${flavorHintPath("dev")}`);
  expect(text).toContain("note: Quit it first if it is running.");
});

test("start and restart's mismatch says the other daemon answered", () => {
  for (const op of ["start", "restart"] as const) {
    expect(renderPlain(flavorMismatchBlocks(op, { flavor: "prod", pid: 7 }, "dev"))).toStartWith("[warning] A prod daemon answered instead of the dev one  pid 7\n");
  }
  expect(renderPlain(flavorMismatchBlocks("start", { flavor: "unknown flavor", pid: null }, "dev"))).not.toContain("pid");
});

test("still shutting down is pending, with the pid when known", () => {
  expect(renderPlain([stillShuttingDownBlock({ pid: 123 })])).toBe("[not yet] The daemon is still shutting down  pid 123\n");
  expect(renderPlain([stillShuttingDownBlock({ pid: null })])).toBe("[not yet] The daemon is still shutting down\n");
});
```

In `daemon-restart.test.ts`, change the asserted strings to the copy table's: `not.toContain("✓ daemon restarted")` becomes `not.toContain("The daemon restarted")`; a success expects `toContain("[ok] The daemon restarted  pid 111 to 222")`; the dropped op expects `toContain("The daemon did not restart")` in `io.stderr()`; the unverified case `toContain("rt could not tell whether it restarted")`. In `daemon-uninstall-start.test.ts`, `toContain("daemon started")` becomes `toContain("[ok] The daemon started")`. Read each test's scenario before editing and keep what it proves.

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement**

```ts
export function flavorMismatchBlocks(op: "stop" | "start" | "restart", holder: { flavor: string; pid: number | null }, flavor: Flavor): Block[] {
  const pid = holder.pid ? `pid ${holder.pid}` : undefined;
  const line =
    op === "stop"
      ? out.line("warn", `A ${holder.flavor} daemon is still running`, [pid, `you stopped the ${flavor} one`].filter(Boolean).join("; "))
      : out.line("warn", `A ${holder.flavor} daemon answered instead of the ${flavor} one`, pid);
  return [line, out.callout("next", out.cmd(`open ${flavorHintPath(flavor)}`)), out.callout("note", "Quit it first if it is running.")];
}

export function stillShuttingDownBlock(holder: { pid: number | null }): Block {
  return out.line("pending", "The daemon is still shutting down", holder.pid ? `pid ${holder.pid}` : undefined);
}

async function warnIfWrongFlavor(op: "start" | "restart", flavor: Flavor): Promise<boolean> {
  const holder = await probeSocketHolder();
  if (!holder || holder.flavor === flavor) return false;
  out.print(...flavorMismatchBlocks(op, holder, flavor));
  return true;
}

async function pollForDaemonUp(): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    await Bun.sleep(250);
    if (await isDaemonRunning()) return true;
  }
  return false;
}
```

`start` after the tray ack:

```ts
  const up = (await withTransientStep(`Starting the ${flavor} daemon`, pollForDaemonUp)) || (await withTransientStep("It has not answered yet; restarting it", async () => {
    const restartResult = await trayQuery("/daemon/restart", "POST");
    return Boolean(restartResult?.ok) && (await pollForDaemonUp());
  }));
  if (up) {
    if (!(await warnIfWrongFlavor("start", flavor))) out.print(out.line("done", "The daemon started"));
    return;
  }
  out.print(out.line("pending", "The daemon has not answered yet"), out.callout("next", out.cmd("rt daemon logs")));
```

`stop` and `restart` by the copy table, with `restart`'s pid poll inside `withTransientStep(\`Restarting the ${flavor} daemon\`, ...)` returning `{ now }` or `{ unverified: pid }` or `null`, and the result printed after the step ends. The restart truth rules (pid turnover, unknown baseline, a socket file meaning the tray is there) are unchanged; only where the words print moves.

- [ ] **Step 4:** Run `bun test commands/__tests__/daemon-flavor-output.test.ts commands/__tests__/daemon-restart.test.ts commands/__tests__/daemon-uninstall-start.test.ts`. PASS.
- [ ] **Step 5:** Commit, message `daemon start, stop, restart: one result line after a spinner; a flavor mix-up is a warning naming the app`.

---

### Task 9: `rt daemon track`, and the file leaves the allowlist

**Files:** `commands/daemon.ts` (`manageTracking`), `commands/__tests__/daemon-tracking.test.ts`, `lib/__tests__/raw-output-allowlist.json`.

**Interfaces:**
- Produces: `trackListBlocks(repos: Record<string, string>, tracking: Record<string, RepoTrackingEntry>, freshness: Record<string, { state: string }>): Block[]`, exported.

- [ ] **Step 1: Failing tests** (append to `daemon-tracking.test.ts`):

```ts
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { trackListBlocks } from "../daemon.ts";

test("the tracking list is one table, off repos quiet, unknown tracked repos flagged", () => {
  const id = (n: string) => `remote:gitlab.example.com/acme/${n}`;
  const text = renderPlain(
    trackListBlocks(
      { [id("alpha")]: "/code/alpha", [id("beta")]: "/code/beta" },
      { [id("alpha")]: { mode: "live", caches: ["branches", "project-mrs"] }, [id("gone")]: { mode: "poll", caches: ["branches"] } } as never,
      { [id("alpha")]: { state: "connected" } },
    ),
  );
  expect(text).toContain("Repo tracking");
  expect(text).toMatch(/live +alpha +watcher connected · caches branches, project-mrs · window \(default 30\)/);
  expect(text).toMatch(/off +beta/);
  expect(text).toContain("[warning] gone is tracked, but rt does not know where it is");
  expect(text).toContain("next: rt daemon track <repo> live|poll|off");
});
```

(Use whatever wire form `parseIdentity` accepts for a remote identity; check `lib/settings/identity.ts` and adjust `id()` before running. The label is the last path segment, as `trackingLabel` computes it.)

Change the file's existing assertions that read today's `✓ <repo> tracking:` and `team-tracked` text to the copy table's words (`[ok] Tracking`, `Your team still tracks it`).

- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3: Implement** `trackListBlocks` and every `manageTracking` site by the copy table:

```ts
export function trackListBlocks(repos: Record<string, string>, tracking: Record<string, RepoTrackingEntry>, freshness: Record<string, { state: string }>): Block[] {
  const rows: out.CellInput[][] = [];
  for (const identity of Object.keys(repos).sort()) {
    const g = grants(tracking, identity);
    const label = trackingLabel(identity);
    if (g.mode === "off") {
      rows.push([{ text: "off", role: "off" }, out.dim(label), ""]);
      continue;
    }
    const watcher = g.mode === "live" ? [freshness[identity] ? `watcher ${freshness[identity]!.state}` : "watcher starting"] : [];
    const detail = [...watcher, `caches ${[...g.caches].join(", ")}`, `window ${formatWindowLabel(tracking[identity]?.projectMrsWindowDays)}`].join(" · ");
    rows.push([{ text: g.mode === "live" ? "live" : "every 5 minutes", role: "running" }, out.strong(label), out.dim(detail)]);
  }
  const blocks: Block[] = [out.section("Repo tracking", "what rt watches in the background", out.table(rows))];
  for (const identity of Object.keys(tracking).filter((n) => !repos[n])) {
    blocks.push(out.line("warn", `${trackingLabel(identity)} is tracked, but rt does not know where it is`), out.callout("next", out.cmd(`rt repos locate <new-path> --repo ${trackingLabel(identity)}`)));
  }
  blocks.push(out.callout("next", out.cmd("rt daemon track <repo> live|poll|off")));
  return blocks;
}
```

The `git config --get remote.origin.url` `execSync` in `manageTracking` is a fixed string; it stays (not this slice's shell-string item). Delete the `lib/tui.ts` import, then `"commands/daemon.ts",` from the allowlist.

- [ ] **Step 4:** Run:
  - `bun test commands/__tests__/daemon-tracking.test.ts commands/__tests__/daemon-json.test.ts lib/__tests__/no-raw-output.test.ts`: PASS.
  - `grep -n "console\.\|process\.std\(out\|err\)\.write\|lib/tui" commands/daemon.ts`: no output.
  - `rg -n "[\x{2013}\x{2014}]" commands/daemon.ts`: no hits on lines this slice wrote (`git diff origin/main -- commands/daemon.ts` to check any hit; comments already there may keep theirs).
  - `bun run typecheck`: no errors.
  - `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/daemon.test.ts`: PASS.
- [ ] **Step 5:** Commit (`commands/daemon.ts`, `commands/__tests__/daemon-tracking.test.ts`, `lib/__tests__/raw-output-allowlist.json`), message `daemon track: a tracking table and plain refusals; commands/daemon.ts leaves the raw-output allowlist`.

---

### Task 10: Renders, AGENTS.md and every gate

**Files:** `AGENTS.md`, `docs/design/output-layer/README.md`, `docs/design/output-layer/6c-daemon-dark.png`, `6c-daemon-light.png`.

- [ ] **Step 1:** `bun run ui:build`. In the scratchpad write `blocks-6c.ts` importing `statusBlocks`, `flavorInfoBlocks`, `tupleWarningBlocks`, `flavorMismatchBlocks`, `stillShuttingDownBlock`, `trackListBlocks`, `logLevelBlocks` from `<repo>/commands/daemon.ts`, and emitting, through `encodeLine` after a `hello` line: `statusBlocks` for running (with health degraded and two reasons), degraded, parked, alive-not-serving (stalled), not-running, not-installed (the `print` blocks), the crash-looping and boot-failed failures (as `out.failure(...)`), `flavorInfoBlocks` with a dev version, a tuple warning, a stop mismatch, still shutting down, a three-repo tracking list with one unknown tracked repo, a set log level, and the copy table's install lines for the `requiresApproval` case and the uninstall refusal (`out.line("refused", ...)` plus its `next`). Copy 5f2's `ansi-page.ts`.
- [ ] **Step 2:** Render at width 100, dark (`RT_UI_BACKGROUND=dark`) and light (`RT_UI_BACKGROUND=light`), into `6c-dark.html` and `6c-light.html`, as 6a's Task 8 Step 2 does.
- [ ] **Step 3:** Screenshot both with Fast Browser into the two PNGs. Write down plainly what reads wrong, checking: only the crash-looping and boot-failed blocks are coral; `off` lines read as stopped, not broken; the flavor warning's `next` command is not wrapped; the tracking table's off rows are quieter than live ones; the health reasons sit under their line with the thin rail. Fix in the owning task's code and re-render.
- [ ] **Step 4:** README row:

```markdown
| `6c-daemon-dark.png`, `6c-daemon-light.png` | `rt daemon` at 100 columns: every status state (running with health reasons, degraded, parked, not answering, not running, not installed, and the two failures), the version row and a flavor warning, the stop mismatch, still shutting down, the tracking table, a log level, the login-items approval and the uninstall refusal |
```

- [ ] **Step 5:** AGENTS.md (append to "Output layer"):

```markdown
`rt daemon` draws a stopped or uninstalled daemon as `off` and a slow one as
`pending`; only `crash-looping` and `boot-failed` are failures. Its waits on
the tray run under `withTransientStep` and print one result line after.
The log viewer's seams take blocks (`print`, `fail`), so the tray, which
shows the first stderr line when `rt daemon logs --no-open` exits early,
reads a failure title.
```

- [ ] **Step 6:** Gates, one at a time: `bun run ui:build`, `bun run typecheck`, `bun run test`, `bun run test:e2e`, `bun run test:pty`, `bun run picker:check`, `bun run format:check`, `bun run check`. All pass (known flakes as in 6a).
- [ ] **Step 7:** Commit the four files, message `docs: daemon renders and the output layer rule for its states`.

---

### Task 11: Ship

- [ ] **Step 1:** `git fetch origin`; `git rebase origin/main`; merge the allowlist, `AGENTS.md` and the README by hand.
- [ ] **Step 2:** Re-run the eight gates.
- [ ] **Step 3:** `git diff --shortstat origin/main...HEAD`; about 2,100 lines. If it passes 2,500, split along the second cut in the header before opening a PR, and say so in the report.
- [ ] **Step 4:** Push with `git_push`; PR body in `<scratchpad>/pr-body-6c.md` (framing paragraph; **Status**, **Lifecycle**, **Track**, **Logs** bullet groups; the renders; gate results; last line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`); `gh pr create --repo m4ttstack/mattstack --title "RT-369: output layer phase 6c, daemon" --body-file <scratchpad>/pr-body-6c.md`.
- [ ] **Step 5:** Report URL, gates, size, what the renders showed. Do not merge.

---

## Decisions this plan made

1. **Lifecycle failures keep exit 0.** They print through `out.fail` on stderr now, but no exit code changes (standing rule). A follow-up can give them exit 1 with Matt's yes.
2. **`status` drops its two footer lines** (config and logs paths): they are paths in sentences, and every state that needs the logs now names `rt daemon logs` in its own `next`.
3. **A past crash in `rt daemon logs` is a warning, not coral:** it is a record, and the daemon may be healthy now.
4. **The viewer seams change shape** (`print`, `fail` in place of `log`, `error`); they are module-internal and only their own test constructs them.

## Self-Review

**Spec coverage.** Phase 6 names `daemon` first: Tasks 4 to 9. Rule 1 (children untouched): Task 6. Rule 3 (failures and refusals): copy table, Tasks 4 to 9. Status set (off, pending, warn, coral only for failures): Tasks 4, 7, 8. `--json` frozen: Task 3. Readers: Task 6 (tray), Task 3 (rt_verb). One allowlist line: Task 9.

**Placeholders.** None beyond the implementer's own paths. Task 3 and Task 9 each name one lookup in the source (the reply envelope, the identity wire form) and what to do with the answer.

**Type consistency.** `statusBlocks` returns `{ print, failure? }` and `logLevelBlocks` the same shape; `flavorMismatchBlocks`, `stillShuttingDownBlock`, `tupleWarningBlocks`, `flavorInfoBlocks`, `trackListBlocks` are spelled the same in tests, code and renders.

**Review Focus.** Five lines, each pinned by a named test.
