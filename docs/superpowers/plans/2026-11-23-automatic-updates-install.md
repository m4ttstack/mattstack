# Automatic Updates: Org Setting, Busy Check, Prod and Dev Installs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mattstack Mac, prod and dev, installs the release Matt ships without anyone being asked, unless its org turned that off.

**Architecture:** One org-only setting, `mattstack.autoUpdate` (default true), gates both flavors. The daemon gains a `daemon:busy` verb backed by its own count of long commands and background installs. On prod the tray sets Sparkle to download and install silently, holds only for a running setup or a busy daemon, and reopens the windows that were open. On dev the daemon runs an hourly sweep that starts a detached `rt dev update --auto`, which checks the clone, fast-forwards it, rebuilds it, then swaps the app and restarts the daemon last.

**Tech Stack:** Bun, TypeScript, `bun:test`; Swift (rt-tray, Sparkle 2), `mattstack-checks`.

**Spec:** `docs/superpowers/specs/2026-11-23-automatic-updates-design.md`: "Busy check" (in Part 1), "The org setting", "Part 2", "Part 3". Part 1's restart continuity is already built (branch `automatic-updates`); this plan stacks on it.

## Global Constraints

- The setting key is `mattstack.autoUpdate`: `type: "boolean"`, `scopes: ["org"]`, `default: true`, `merge: "replace"`. Read it with `getSetting<boolean>("mattstack.autoUpdate").value`, never cached at module load and never with a `?? fallback`.
- A reader that cannot read the setting (the tray's `rt settings get` fails, an older rt exits 1) uses **on**.
- Hold reason strings, exactly, shared by the tray, the daemon, the ping and the telemetry page: `setupRunning`, `windowsOpen`, `daemonBusy`, `orgOff`, `notOnMain`, `localCommits`, `dirtyTree`, `mergeInProgress`, `fetchFailed`, `updateFailed`. Each fits the ping's 128-character field cap.
- A daemon that does not answer `daemon:busy` counts as **not busy**. A restart done by hand never asks.
- A busy hold is retried each minute and has no time limit.
- `SUScheduledCheckInterval` is 3600 in all three places it is written (`rt-tray/Info.plist`, `rt-tray/project.yml`, `rt-tray/build.sh`) and in `rt-tray/check-bundle.sh`.
- The dev update is all or nothing up to the pull: every guard is checked before anything changes. A locally built dev app (`MSDevReleaseBuild` not `true`) is skipped without a notification, as today.
- Never use `@{u}`; compare against `refs/remotes/origin/main` after a fetch through `runGitOrigin`.
- Never rebuild, re-sign or reinstall `/Applications/mattstack.app` or `rt-tray/mattstack-dev.app`. Swift is verified with `swift run mattstack-checks` from `rt-tray`; a bundle is built only in a scratch directory.
- Run `bun test` from the repo root, targeted files only. After any change under `packages/rt-client/src`, run `bun run build` in `packages/rt-client`.
- No `console.*` or raw stream writes under `lib/` or `commands/`. Daemon code logs through its logger. Comments state only a constraint the code cannot show.
- `daemon:busy` is a daemon verb only: it is not added to the MCP tool roster.

## Review Focus

1. A Mac whose person turned off "Check for updates automatically" before this ships: Sparkle persisted that in UserDefaults, so the plist alone does not switch it back. It must be checking again after the first launch of the new app. Check in Task 5.
2. An update that is held (setup running, daemon busy) must stay offered and install once the hold clears; a held update that is dropped stalls Sparkle's next check for about a week. Checks in Task 4.
3. The dev sweep's update kills its own daemon: the app swap makes the relaunched app kickstart the daemon. The update must not depend on the daemon that started it, and nothing after the swap may be required for a correct tree. Tests in Tasks 8 and 9.
4. A clone with an untracked or modified file, a branch other than `main`, a local commit, or a rebase in progress must be left byte for byte as it was, and the person told once per waiting version, including across the daemon restarts in between. Tests in Tasks 7 and 8.
5. An org that sets `mattstack.autoUpdate` to false: no silent install on prod (today's prompt returns), no dev sweep, and the telemetry page shows the Mac as off rather than as silently behind. Tests in Tasks 3, 4 and 9.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/rt-client/src/settings/registry-defs.ts`, `registry-schemas.ts`, `schema.lock.json` | The `mattstack.autoUpdate` key |
| `lib/daemon/busy.ts` (new) | What counts as busy; the tracker of long commands |
| `lib/daemon/handlers/busy.ts` (new) | The `daemon:busy` verb |
| `lib/worktree/ready-async.ts` | `pendingReadyCount()` |
| `apps/board/switchboard/telemetry-page.ts` | Hold reason wording, the off state, dev rows |
| `rt-tray/Sources-core/Updates/*` | Hold policy, silent mode, status, notice copy |
| `rt-tray/Sources-core/Updates/AutoUpdateSetting.swift` (new) | Reads the setting through rt |
| `rt-tray/Sources-core/Updates/WindowRestore.swift` (new) | Records and returns the windows to reopen |
| `rt-tray/Sources/Updates/UpdaterController.swift`, `AppDelegate.swift`, `Settings/GeneralPane.swift` | Wiring |
| `lib/dev/clone-guards.ts` (new) | The clone checks |
| `lib/dev/auto-update.ts` (new) | The guarded update flow and its status record |
| `lib/dev/update.ts`, `commands/dev.ts` | `--auto`; app swap last; manual run reports a clone it will not pull |
| `lib/daemon/dev-update-sweep.ts` (new) | The hourly sweep |

---

### Task 1: The org setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (the `mattstack` block, beside `mattstack.directory`), `packages/rt-client/src/settings/registry-schemas.ts`, `packages/rt-client/src/settings/__tests__/schema-examples.ts`, `packages/rt-client/src/settings/schema.lock.json`, `packages/rt-client/src/settings/__tests__/registry.test.ts`
- Test: `packages/rt-client/src/settings/__tests__/registry.test.ts`, `schema-examples.test.ts`, `registry-console-ready.test.ts`, `schema-lock.test.ts`, `apps/console/src/app/settings/groups.test.ts`

**Interfaces:**
- Produces: the registered key `mattstack.autoUpdate`; `getSetting<boolean>("mattstack.autoUpdate").value` is `true` on a Mac in no org and in an org that never set it.

- [ ] **Step 1: Write the failing tests** in `registry.test.ts`: add `"mattstack.autoUpdate"` to `suiteKeys` and raise the length assertion by one, and add:

```ts
test("mattstack.autoUpdate is an org-only boolean that defaults to on", () => {
  const def = getDef("mattstack.autoUpdate");
  expect(def).toMatchObject({ type: "boolean", scopes: ["org"], default: true, merge: "replace" });
});
```

(use the file's own accessor for a def). In `schema-examples.ts` add `"mattstack.autoUpdate": { good: [true, false], bad: [{ value: "yes", path: [] }] }`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts`
Expected: FAIL (unknown key).

- [ ] **Step 3: Add the row and the schema.** Row: `key: "mattstack.autoUpdate"`, the values above, no `migrated`, description exactly: `Install mattstack updates on every Mac in this org as soon as they are ready, with no prompt. When off, each person installs updates themselves.` Schema: `"mattstack.autoUpdate": z.boolean()`. Do not add it to `NO_SCHEMA_YET`.

- [ ] **Step 4: Regenerate the lock and rebuild**

Run: `bun run cli.ts settings schema lock` then `(cd packages/rt-client && bun run build)`

- [ ] **Step 5: Run to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__ packages/rt-client/test/dist-freshness.test.ts apps/console/src/app/settings/groups.test.ts`
Expected: PASS. (If `groups.test.ts` is a vitest file, run `bun run console:test` instead.)

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client
git commit -m "settings: mattstack.autoUpdate, an org-only switch for automatic updates"
```

---

### Task 2: The daemon says whether it is busy

**Files:**
- Create: `lib/daemon/busy.ts`, `lib/daemon/handlers/busy.ts`
- Modify: `lib/worktree/ready-async.ts`, `lib/daemon.ts` (`createHandleCommand`, the handlers unit), `lib/daemon/command-router.ts`, `packages/rt-client/src/commands.ts`, `packages/rt-client/src/command-schemas.ts`
- Test: `lib/daemon/__tests__/busy.test.ts` (new), `lib/daemon/__tests__/rt-client-commands.test.ts`, `lib/worktree/__tests__/ready-async.test.ts` (or the existing ready-async test file)

**Interfaces:**
- Produces:

```ts
// lib/daemon/busy.ts
/** Commands a restart would cut off for longer than the 5s drain. */
export const LONG_COMMANDS: ReadonlySet<string>; // worktree:provision, worktree:create, worktree:stop-holders,
                                                 // mr:action, mr:fetch-job-trace, mr:upload,
                                                 // mr:describe-with-attachments, mr:attach-upload
export interface BusyTracker {
  /** Called for every command; returns the function to call when it ends. A command not in LONG_COMMANDS is not counted. */
  begin(cmd: string): () => void;
  running(): string[]; // long commands in flight, sorted, de-duplicated
}
export function createBusyTracker(): BusyTracker;
export interface BusyProbes { tracker: BusyTracker; pendingReady(): number; creating(): boolean }
/** Reason strings: "command:<name>", "worktree-install", "worktree-create". */
export function busyReasons(p: BusyProbes): string[];

// lib/worktree/ready-async.ts
export function pendingReadyCount(): number;

// verb
"daemon:busy": { payload: {}; data: { busy: boolean; reasons: string[] } }
```

- [ ] **Step 1: Write the failing tests** in `busy.test.ts`:

```ts
test("a long command counts from begin until its end function runs", () => {});
test("a command outside LONG_COMMANDS is never counted", () => { /* chat:post, events:wait, daemon:busy */ });
test("two runs of the same command report it once and clear only when both end", () => {});
test("the end function is safe to call twice", () => {});
test("busyReasons lists commands, then worktree-install, then worktree-create", () => {
  expect(busyReasons({ tracker, pendingReady: () => 2, creating: () => true }))
    .toEqual(["command:mr:action", "worktree-install", "worktree-create"]);
});
test("nothing running gives no reasons", () => {});
```

In the ready-async tests: `pendingReadyCount()` is 0, 1 while a ready task runs, 0 after it settles. In `rt-client-commands.test.ts` no change is needed beyond the verb existing (it fails if `COMMAND_NAMES` has an entry with no handler).

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/busy.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `busy.ts` and `pendingReadyCount`.**

- [ ] **Step 4: Wire it.** `createHandleCommand` gains a `busy: BusyTracker` dep: `const end = busy.begin(cmd)` beside where `currentCmd` is set, `end()` in the same `finally`. The handler `createBusyHandlers(probes: BusyProbes)` returns `{ ok: true, data: { busy: reasons.length > 0, reasons } }`. `creating` is true when the reconciler reports a creation in flight for any repo (add an accessor on the reconciler if only the per-repo one exists). Add the verb to `Commands`, `COMMAND_NAMES` and the schemas; do not add an MCP tool.

- [ ] **Step 5: Run to verify they pass**

Run: `(cd packages/rt-client && bun run build)` then `bun test lib/daemon/__tests__/busy.test.ts lib/daemon/__tests__/rt-client-commands.test.ts lib/daemon/__tests__/router-no-db-key.test.ts lib/mcp/__tests__/tools.test.ts packages/rt-client/test/dist-freshness.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib packages/rt-client
git commit -m "daemon: daemon:busy says whether a restart would cut off work"
```

---

### Task 3: The telemetry page names every hold

**Files:**
- Modify: `apps/board/switchboard/telemetry-page.ts`
- Test: `apps/board/switchboard/__tests__/telemetry-server.test.ts` (or the page's own test file)

**Interfaces:**
- Consumes: the hold reason strings in Global Constraints. The ping's `appUpdate` shape does not change (`lastCheckAt`, `offeredVersion`, `heldVersion`, `hold`).

- [ ] **Step 1: Write the failing tests:** `HOLD_REASONS` wording, exactly:

```ts
{ windowsOpen: "window open", setupRunning: "setup running", daemonBusy: "daemon busy",
  orgOff: "turned off by the org", notOnMain: "clone not on main", localCommits: "clone has local commits",
  dirtyTree: "clone has uncommitted changes", mergeInProgress: "merge or rebase in progress",
  fetchFailed: "could not fetch", updateFailed: "update failed" }
```

- `updateCell` for `{ heldVersion: "2.37.0", hold: "daemonBusy" }` renders `2.37.0 held (daemon busy)`.
- `updateCell` for `{ heldVersion: null, hold: "orgOff" }` renders `off (turned off by the org)`.
- A dev-flavor Mac whose `appUpdate.heldVersion` is set appears in the behind table even when its app version is not behind the newest prod version.

- [ ] **Step 2: Run to verify they fail.** Run the page's test file. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/board/switchboard
git commit -m "telemetry page: name every update hold, the off state, and held dev Macs"
```

---

### Task 4: The tray's update policy (Swift core)

**Files:**
- Create: `rt-tray/Sources-core/Updates/AutoUpdateSetting.swift`
- Modify: `rt-tray/Sources-core/Updates/UpdatePolicy.swift`, `HeldUpdateInstaller.swift`, `UpdateStatus.swift`, `UpdateNotice.swift`, `rt-tray/Tests/MattstackCoreChecks/UpdatePolicyChecks.swift`, `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`
- Test: `swift run mattstack-checks UpdatePolicy` and `swift run mattstack-checks AutoUpdateSetting`, from `rt-tray`

**Interfaces:**
- Produces:

```swift
public enum UpdateHold: Equatable, Sendable { case setupRunning; case windowsOpen; case daemonBusy }

extension UpdatePolicy {
  /// `silent` is the org setting. Silent: setup, then a busy daemon, hold; open windows do not.
  /// Not silent: today's rule (setup, then open windows); the daemon is not asked.
  public static func hold(silent: Bool, setupRunning: Bool, windowsOpen: Int, daemonBusy: Bool) -> UpdateHold?
  /// A scheduled check opens Sparkle's window only when not silent.
  public static func opensUpdateWindow(silent: Bool, handledBySparkle: Bool, userInitiated: Bool, setupRunning: Bool) -> Bool
  public static let checkInterval: TimeInterval // 3600
}

public final class HeldUpdateInstaller {
  public init(silent: @escaping () -> Bool, setupRunning: @escaping () -> Bool,
              windowsOpen: @escaping () -> Int, daemonBusy: @escaping () -> Bool)
  // offer, retry, installNow, heldVersion unchanged in shape.
  // installNow: ignores open windows; setup and a busy daemon still block.
}

extension UpdateStatus {
  public static func holdName(_ hold: UpdateHold?) -> String?   // adds "daemonBusy"
  public static let orgOff = "orgOff"
}

public struct AutoUpdateSetting: Sendable {
  public static let key = "mattstack.autoUpdate"
  /// `rt settings get mattstack.autoUpdate --json`; any failure answers true.
  public static func read(_ rt: RtRunning) async -> Bool
}
```

`UpdateNotice.waiting(version:hold:)` copy for `.daemonBusy`: title unchanged from the other cases, body `Installs when the daemon finishes what it is doing`.

- [ ] **Step 1: Write the failing checks** in `UpdatePolicyChecks.swift` (replace the checks that pin the old signatures) and a new `AutoUpdateSettingChecks.swift`, appended to `allChecks`:

```swift
Check("silent: open windows do not hold") { c in
  c.expectEqual(UpdatePolicy.hold(silent: true, setupRunning: false, windowsOpen: 3, daemonBusy: false), nil) }
Check("silent: setup holds before a busy daemon") { c in
  c.expectEqual(UpdatePolicy.hold(silent: true, setupRunning: true, windowsOpen: 0, daemonBusy: true), .setupRunning) }
Check("silent: a busy daemon holds") { c in
  c.expectEqual(UpdatePolicy.hold(silent: true, setupRunning: false, windowsOpen: 0, daemonBusy: true), .daemonBusy) }
Check("not silent: windows hold and a busy daemon does not") { c in
  c.expectEqual(UpdatePolicy.hold(silent: false, setupRunning: false, windowsOpen: 1, daemonBusy: true), .windowsOpen)
  c.expectEqual(UpdatePolicy.hold(silent: false, setupRunning: false, windowsOpen: 0, daemonBusy: true), nil) }
Check("silent: a scheduled check opens no window; not silent: it does") { c in /* opensUpdateWindow */ }
Check("installer: a held update installs on the first retry after the daemon stops being busy") { c in /* offer → .daemonBusy, retry false, flip, retry true, install ran once */ }
Check("installer: silent with windows open installs at the offer") { c in /* offer → nil, install ran */ }
Check("installer: installNow does not install while the daemon is busy") { c in }
Check("status: holdName covers daemonBusy") { c in c.expectEqual(UpdateStatus.holdName(.daemonBusy), "daemonBusy") }
Check("check interval is one hour") { c in c.expectEqual(UpdatePolicy.checkInterval, 3600) }
// AutoUpdateSettingChecks, with ScriptedRt:
Check("reads true") { /* answers["settings get mattstack.autoUpdate"] = (0, #"{"ok":true,"key":"mattstack.autoUpdate","value":true,"provenance":{}}"#) */ }
Check("reads false") { }
Check("a failed read answers true") { /* (1, "") */ }
Check("undecodable output answers true") { /* (0, "nope") */ }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd rt-tray && swift run mattstack-checks UpdatePolicy`
Expected: build failure on the new signatures.

- [ ] **Step 3: Implement.** Keep `windowHoldsUpdate`, `setupBusy`, `shouldStartUpdater`, `feedOverride` as they are. Fix the exact-JSON `UpdateStatus` check only if the encoding changes (it should not).

- [ ] **Step 4: Run to verify they pass**

Run: `cd rt-tray && swift run mattstack-checks UpdatePolicy && swift run mattstack-checks AutoUpdateSetting`
Expected: `checks: N passed, 0 failed`. The app target will not compile until Task 5; that is expected.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/Sources-core rt-tray/Tests
git commit -m "tray: update policy for silent installs: setup and a busy daemon hold, windows do not"
```

---

### Task 5: The tray installs silently (app wiring)

**Files:**
- Modify: `rt-tray/Sources/Updates/UpdaterController.swift`, `rt-tray/Sources/AppDelegate.swift` (the lazy `updater`, `setupAutoUpdate`), `rt-tray/Sources/Settings/GeneralPane.swift`, `rt-tray/Sources/AccessibilityIDs.swift`, `rt-tray/Sources/DaemonClient.swift`, `rt-tray/Info.plist`, `rt-tray/project.yml`, `rt-tray/build.sh`, `rt-tray/check-bundle.sh`, `rt-tray/vm/run/guest/trigger-update.sh` (stale comment)
- Test: `cd rt-tray && swift build` (the whole package compiles) and `swift run mattstack-checks all`

**Interfaces:**
- Consumes: Task 4's types; `daemon:busy` from Task 2.
- Produces:

```swift
// DaemonClient
struct DaemonBusyReply: Decodable { let ok: Bool; let data: Payload?; struct Payload: Decodable { let busy: Bool } }
/// false when the daemon does not answer.
func isBusy() async -> Bool

// UpdaterController
init(isDevBuild: Bool, isBusy: @escaping () -> Bool,
     readAutoUpdate: @escaping () async -> Bool, daemonBusy: @escaping () async -> Bool)
/// Re-reads the setting and the daemon's busy state, then applies them to Sparkle. Called at start,
/// before each retry of a held update, and from a repeating timer every 10 minutes.
func refreshPolicy() async
```

- [ ] **Step 1: Wire `UpdaterController`.**
  - Two cached main-thread values, `silent` (starts true) and `daemonBusy` (starts false), refreshed by `refreshPolicy()`. `HeldUpdateInstaller` and `opensUpdateWindow` read them through closures.
  - `refreshPolicy()` sets, when enabled: `updater.automaticallyChecksForUpdates = true` (this is what switches a Mac back on), `updater.automaticallyDownloadsUpdates = silent`, `updater.updateCheckInterval = UpdatePolicy.checkInterval`.
  - The retry timer's tick awaits `refreshPolicy()` and then calls `installer.retry()`.
  - `writeStatus` writes `hold: "orgOff"` with no `heldVersion` when `silent` is false and nothing is held.
  - `willInstallUpdateOnQuit` still keeps the handler and returns true.
- [ ] **Step 2: Remove the switch.** Delete the `Toggle("Check for updates automatically", …)`, its `@State`, its `onAppear` line and `AXID.settingsGeneralAutoUpdates`. Keep "Check Now" and the dev caption. Remove `automaticallyChecks` from `UpdaterController` if nothing else reads it.
- [ ] **Step 3: Plists.** `SUScheduledCheckInterval` 3600 in `Info.plist`, `project.yml`, `build.sh` and the assertion in `check-bundle.sh`. `SUAutomaticallyUpdate` stays false in all four: the runtime property decides.
- [ ] **Step 4: Build and check**

Run: `cd rt-tray && swift build 2>&1 | tail -20 && swift run mattstack-checks all`
Expected: build succeeds; `checks: N passed, 0 failed`.

- [ ] **Step 5: Look at the pane.** The Settings General pane lost a row: render it through the repo's tray UI harness (see `rt-tray/Tests` and `.claude/rules/rt-ui.md` for the screenshot path) in both color schemes and check the Updates section reads right with only "Check Now". If no harness can render it without the blessed bundle, say so in the report instead of skipping silently.

- [ ] **Step 6: Commit**

```bash
git add rt-tray
git commit -m "tray: install updates silently when the org setting is on; hourly checks; no opt-out switch"
```

---

### Task 6: The app reopens its windows after an update

**Files:**
- Create: `rt-tray/Sources-core/Updates/WindowRestore.swift`, `rt-tray/Tests/MattstackCoreChecks/WindowRestoreChecks.swift`
- Modify: `rt-tray/Sources/Updates/UpdaterController.swift` (`updater(_:willInstallUpdate:)`, `didFinishUpdateCycleFor`), `rt-tray/Sources/AppDelegate.swift`, `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`
- Test: `cd rt-tray && swift run mattstack-checks WindowRestore`

**Interfaces:**
- Produces:

```swift
public enum RestorableWindow: String, CaseIterable, Sendable { case main, settings, worktreePanel, processPanel }

public struct WindowRestore {
  public static let defaultsKey = "MSUpdateReopenWindows"
  public init(defaults: UserDefaults)
  /// Called right before Sparkle quits the app for an install.
  public func record(_ open: Set<RestorableWindow>)
  /// Returns what was recorded and clears it. Empty when nothing was recorded.
  public func take() -> [RestorableWindow]   // in CaseIterable order
  /// An install that did not happen must not reopen windows at some later launch.
  public func clear()
}
```

- [ ] **Step 1: Write the failing checks:** record then take returns the set in order and a second take is empty; clear empties; an unknown stored string is ignored; nothing recorded gives empty.
- [ ] **Step 2: Run to verify they fail.** Expected: build failure (type missing).
- [ ] **Step 3: Implement `WindowRestore`.**
- [ ] **Step 4: Wire it.** `UpdaterController` gains `var openWindows: (() -> Set<RestorableWindow>)?`; `updater(_:willInstallUpdate:)` records it; `didFinishUpdateCycleFor` with an error clears. `AppDelegate` supplies `openWindows` from its window ivars (main window visible, settings window visible, worktree panel, detached process panel) and, in `setupAutoUpdate` on the `takeInstalledVersion()` branch, reopens each: `showMattstackWindow()`, the coordinator's `showSettings(pane: nil)`, `showWorktreePanel()`, the process panel's detach path. If the coordinator does not exist yet at that point in launch, defer the reopen to where it is created.
- [ ] **Step 5: Run to verify they pass**

Run: `cd rt-tray && swift build 2>&1 | tail -5 && swift run mattstack-checks all`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add rt-tray
git commit -m "tray: reopen the windows that were open before an update"
```

---

### Task 7: The clone checks

**Files:**
- Create: `lib/dev/clone-guards.ts`
- Test: `lib/dev/__tests__/clone-guards.test.ts` (new; real git repos in a temp dir, built the way `lib/setup/__tests__/validators-rt-health.test.ts` builds them: `git init`, commit, a bare `origin`, `push origin HEAD`)

**Interfaces:**
- Produces:

```ts
export type CloneHold = "notOnMain" | "localCommits" | "dirtyTree" | "mergeInProgress" | "fetchFailed";
export type CloneCheck =
  | { ok: true; behind: number }                       // commits origin/main has that HEAD lacks
  | { ok: false; hold: CloneHold; detail: string };    // detail is one plain sentence for a person

export interface CloneGuardDeps {
  git(cwd: string, args: string[], opts?: { timeoutMs?: number }): Promise<{ stdout: string; exitCode: number }>;
  fetch(cwd: string): Promise<{ exitCode: number }>;   // production: runGitOrigin(cwd, ["fetch","origin","main"])
}
/** Fetches, then checks in this order: mergeInProgress, notOnMain, dirtyTree, localCommits. Changes nothing but remote-tracking refs. */
export async function checkClone(deps: CloneGuardDeps, clone: string): Promise<CloneCheck>;
export function realCloneGuardDeps(): CloneGuardDeps;
```

Detail sentences, exactly: `Your clone is on <branch>, not main.` / `Your clone is not on a branch.` / `Your clone has <n> commit(s) that are not on origin/main.` / `Your clone has uncommitted changes.` / `Your clone has a merge or rebase in progress.` / `rt could not fetch origin/main.`

- [ ] **Step 1: Write the failing tests:**

```ts
test("a clean clone on main that is behind passes and reports how far", async () => { /* { ok: true, behind: 2 } */ });
test("a clean clone on main that is up to date passes with behind 0", async () => {});
test("another branch holds: notOnMain, with the branch named", async () => {});
test("a detached HEAD holds: notOnMain", async () => {});
test("a commit origin/main lacks holds: localCommits", async () => {});
test("a modified tracked file holds: dirtyTree", async () => {});
test("a staged change holds: dirtyTree", async () => {});
test("an untracked file holds: dirtyTree", async () => {});
test("an ignored file does not hold", async () => {});
test("a rebase in progress holds: mergeInProgress", async () => { /* a conflicted rebase left stopped */ });
test("a merge in progress holds: mergeInProgress", async () => {});
test("a failed fetch holds: fetchFailed, and is not reported as local commits", async () => {});
test("checkClone leaves HEAD, the index and the working tree as they were", async () => { /* compare rev-parse HEAD, status --porcelain, file bytes before and after, in the dirty case */ });
test("a clone with no upstream configured still works", async () => { /* never @{u} */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/dev/__tests__/clone-guards.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** Dirty: `git status --porcelain=v1 --untracked-files=all` non-empty. In progress: `git rev-parse --git-path <name>` for `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge`, `rebase-apply`, then an existence check. Local commits and behind: `git rev-list --left-right --count refs/remotes/origin/main...HEAD`. Production `git` is `runGit` from `lib/worktree/git-async.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/dev/__tests__/clone-guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dev
git commit -m "dev: checks that say whether a clone can be fast-forwarded safely"
```

---

### Task 8: The guarded dev update

**Files:**
- Create: `lib/dev/auto-update.ts`
- Modify: `lib/dev/update.ts`, `lib/dev/stages.ts` (only if a stage must be split), `commands/dev.ts`, `lib/command-tree-def.ts` (`--auto` on `dev update`), `lib/dev/seams.ts`
- Test: `lib/dev/__tests__/auto-update.test.ts` (new), `lib/dev/__tests__/update.test.ts`, `commands/__tests__/dev.test.ts`

**Interfaces:**
- Consumes: `checkClone`, `CloneHold` (Task 7); `daemon:busy` (Task 2); `getSetting("mattstack.autoUpdate")` (Task 1); `findDevRelease`, `readInstalledDevApp`, `compareVersions`, `ensureTools`, `buildRtUi`, `ensureDevApp`, `registerApps` (existing).
- Produces:

```ts
export type DevHold = CloneHold | "daemonBusy" | "orgOff" | "updateFailed";
export type DevAutoOutcome =
  | { kind: "current" }                                   // nothing newer, or a locally built app
  | { kind: "held"; version: string; hold: DevHold; detail: string }
  | { kind: "updated"; version: string };

export interface DevAutoDeps {
  autoUpdateOn(): boolean;
  daemonBusy(): Promise<boolean>;                          // false when the daemon does not answer
  checkClone(clone: string): Promise<CloneCheck>;
  fastForward(clone: string): Promise<{ exitCode: number; stderr: string }>;   // git merge --ff-only origin/main
  install(clone: string, env: Record<string, string>): Promise<{ exitCode: number; tail: string }>; // bun install --frozen-lockfile
  restartDaemon(): Promise<void>;
  writeStatus(s: { offeredVersion: string | null; heldVersion: string | null; hold: string | null }, now: Date): void; // ~/.mattstack/rt/app-update.json
  notifyOnce(version: string, hold: DevHold, detail: string): void;  // one notification per (version, hold)
  lock<T>(fn: () => Promise<T>): Promise<T | "locked">;
}
export async function runDevAutoUpdate(s: DevSeams, stage: StageRunner, d: DevAutoDeps): Promise<DevAutoOutcome | "locked">;
```

Order inside `runDevAutoUpdate`, fixed:
1. Not dev flavor, no stored clone, or a locally built dev app: `current`, nothing written.
2. Newest release with a dev app not newer than the installed app: `current`; clear a held status.
3. Setting off: `held orgOff` (status written with `heldVersion: null`, no notification).
4. `checkClone`; a hold is returned as is.
5. `daemonBusy()`: `held daemonBusy`.
6. `ensureTools` against the pins of `origin/main` (read with `git show origin/main:package.json` and `origin/main:ui/go.mod`); a missing tool is `held updateFailed` naming the tool. Nothing has changed yet.
7. Fast-forward. Then `bun install --frozen-lockfile`, then the terminal helper rebuild, then `registerApps`. A failure in any is `held updateFailed` naming the step.
8. Last: the app swap (`ensureDevApp`), then `restartDaemon()`. Clear the held status and write `offeredVersion`.

Every `held` outcome writes the status and calls `notifyOnce`, except `orgOff`. Notification: category `setup_update`, title `A mattstack update is waiting`, message `mattstack-dev <version> is ready. <detail>`, id `dev_update:<version>:<hold>`.

`rt dev update` (manual): before its stages it runs `checkClone`; when it passes and the clone is behind, it fast-forwards and runs `bun install --frozen-lockfile`; when it holds, it prints the detail sentence as a note and goes on to install the app as today. `rt dev update --auto [--json]` runs `runDevAutoUpdate` and prints one line: `Your dev setup is up to date`, `Updated to mattstack-dev <version>`, or `An update to mattstack-dev <version> is waiting` with the detail as its hint. Exit code 0 for all three and for `locked`; `--json` prints the outcome object.

- [ ] **Step 1: Write the failing tests** in `auto-update.test.ts`, with `fakeProbes` and the release fakes from `update.test.ts`:

```ts
test("no newer release: current, and nothing is checked or written", async () => {});
test("a locally built dev app: current, the clone is never fetched", async () => {});
test("setting off: held orgOff, status says so, no notification, clone untouched", async () => {});
test.each(["notOnMain", "localCommits", "dirtyTree", "mergeInProgress", "fetchFailed"] as const)(
  "clone hold %s: nothing is pulled, built or swapped; one notification", async (hold) => {});
test("a busy daemon holds after the clone passes", async () => {});
test("a daemon that does not answer does not hold", async () => {});
test("all clear: fast-forward, install, helper, register, then swap, then restart, in that order", async () => {
  expect(order).toEqual(["fetch", "tools", "ff", "install", "ui", "register", "swap", "restart"]);
});
test("a failed install is held updateFailed naming bun install, and the app is not swapped", async () => {});
test("a missing tool is held before the fast-forward", async () => { expect(order).not.toContain("ff"); });
test("a second run for the same version and hold does not notify again", async () => {});
test("a different hold for the same version notifies once more", async () => {});
test("a run while another holds the lock returns locked and does nothing", async () => {});
test("an update clears the held status", async () => {});
```

In `update.test.ts`: the manual run prints the clone's detail sentence and still installs the app when the clone holds; fast-forwards and installs when it passes.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/dev/__tests__/auto-update.test.ts lib/dev/__tests__/update.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** `notifyOnce` persists what it announced in a kv row (`ns "dev-auto-update"`, key `announced`, value `<version>:<hold>`) so a daemon restart does not repeat it. The lock is a lock file under `~/.mattstack/rt` taken with the same helper `rt setup update` uses. `restartDaemon` asks the tray (`/daemon/restart`) and does not wait for the turnover. Real deps live in `commands/dev.ts` beside `realSeams`.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/dev/__tests__ commands/__tests__/dev.test.ts commands/__tests__/command-tree-devonly.test.ts lib/__tests__/no-raw-output.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dev lib/command-tree-def.ts commands
git commit -m "dev: rt dev update --auto updates the clone and the dev app together, or holds and says why"
```

---

### Task 9: The daemon's hourly dev update

**Files:**
- Create: `lib/daemon/dev-update-sweep.ts`
- Modify: `lib/daemon.ts` (the `background-subsystems` unit, beside `org-guard`), `commands/setup.ts` (`announceDevApp`)
- Test: `lib/daemon/__tests__/dev-update-sweep.test.ts` (new), `commands/__tests__/setup*.test.ts` (the file that covers `announceDevApp`)

**Interfaces:**
- Consumes: `rt dev update --auto --json` (Task 8).
- Produces:

```ts
export function createDevUpdateSweep(deps: {
  flavor(): "dev" | "prod";
  autoUpdateOn(): boolean;
  /** Starts `rt dev update --auto --json` detached, in its own process group, and resolves when it has been started. */
  spawnUpdate(): Promise<void>;
  log: Logger;
}): () => Promise<void>;
```

Schedule: `scheduleSweep("dev-auto-update", sweep, { bootDelayMs: 5 * 60_000, intervalMs: 60 * 60_000 }, log)`.

- [ ] **Step 1: Write the failing tests:**

```ts
test("a prod daemon never starts the update", async () => {});
test("the setting off never starts the update", async () => {});
test("a dev daemon with the setting on starts it once per tick", async () => {});
test("a tick that arrives while the previous one is still starting is skipped", async () => {});
test("a settings read that throws is logged and does not throw out of the sweep", async () => {});
```

For `announceDevApp`: with `mattstack.autoUpdate` on it does not announce "Run rt dev update to install it"; with it off it announces as today.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test lib/daemon/__tests__/dev-update-sweep.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** The real `spawnUpdate` uses the daemon's rt self argv with `cli.ts` named explicitly (the plain form starts a competing daemon), `detached: true`, stdio ignored, `unref()`, and `childEnv()`. The child outlives the daemon restart it causes.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test lib/daemon/__tests__/dev-update-sweep.test.ts lib/daemon/__tests__/boot-order.test.ts` and the `announceDevApp` test file.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon lib/daemon.ts commands
git commit -m "daemon: check hourly for a dev update and start it"
```

---

### Task 10: Docs and the proof that can be run here

**Files:**
- Modify: `docs/release-and-distribution.md` ("Sparkle / updates"), `sites/docs/docs/start/menu-bar-app.mdx`, the dev setup page under `sites/docs/docs` that describes `rt dev update`, `sites/docs/docs/start/teams.mdx` or `settings.mdx` (the new org setting)
- Test: `bun run check` scoped as the docs site's own check command says; `bun run test:pty`

- [ ] **Step 1: Rewrite "Sparkle / updates"** in `docs/release-and-distribution.md`: silent install when the org setting is on, the two holds, the hourly check, the removed switch, window reopening, the off path (today's prompt), the dev sweep and its guards, and the hold names on the telemetry page. Remove the text about waiting for windows to close.
- [ ] **Step 2: User docs.** `menu-bar-app.mdx`: updates install by themselves about an hour after a release; an org owner can turn that off with `rt settings set mattstack.autoUpdate false --scope org`. The dev page: the dev app and the clone update together when the clone is on `main` and clean; what the notification means; `rt dev update` by hand.
- [ ] **Step 3: Run the gates that cover what changed**

Run: `bun run test:pty` and `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/daemon.test.ts e2e/tests/settings.test.ts`
Expected: PASS (the known `rt plugin new` mise failure on this Mac aside).

- [ ] **Step 4: Say what was not proven.** The Sparkle path (silent install, the hold, the window reopen) can only be proven by the VM walkthrough's update leg (`rt-tray/vm/run/guest/trigger-update.sh`) or on a real Mac after a release, and the dev sweep end to end needs a dev app from a release. Write both into the PR description as the verification still owed.

- [ ] **Step 5: Commit**

```bash
git add docs sites
git commit -m "docs: automatic updates for prod and dev, and the org setting"
```
