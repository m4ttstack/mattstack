# Tab Ready Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A window tab counts as loaded only when its page says so, recovers by itself when its app comes back, and never depends on a guessed retry duration.

**Architecture:** The server injects a small inline script into the HTML it serves; that script gives the page `window.__mattstackHost` and posts `booting`, `ready`, `failed` or `fatal` to the native window. The tray keeps one pure state machine per tab (`TabReadiness` in `Sources-core`) fed by those signals, WebKit's navigation callbacks and app health, and it emits reloads. Servers serve pages from memory and answer `/api/health` with a process id and a build id.

**Tech Stack:** Swift (AppKit, SwiftUI, WebKit) in `rt-tray`; TypeScript on Bun and Hono in `packages/server`; React in `packages/ui` and `apps/board`.

**Spec:** `docs/superpowers/specs/2026-11-21-tab-ready-signal-design.md` (ticket RT-602)

## Global Constraints

- One PR for everything. Commit after every task.
- No new fixed delay that stands in for "the app is probably back". The only clocks are the backstop deadline (15 seconds) and the health check interval (2 seconds).
- A page that never sends `booting` behaves as it does today: WebKit's "finished" means loaded.
- A ready tab never reloads by itself. Only a `notReady` tab does.
- Old and new mix: a new tray with an old app build, and an old tray with a new app build, both work.
- Pure tray logic lives in `rt-tray/Sources-core` with checks in `rt-tray/Tests/MattstackCoreChecks`; `Sources/` only wires it.
- Never build or run the tray from the shared checkout, never re-sign or replace `/Applications/mattstack-dev.app` without Matt's go-ahead, and run any built binary only under an isolated HOME (`AGENTS.md`, "Operating on this machine").
- Run `bun test` from the repo root for rt's suites, and each app's suite from its own folder or through `bun run <app>:test`. Run only the tests for files you touch.
- Read the rule file for an area before editing it: `.claude/rules/apps/app-server.md`, `.claude/rules/apps/kit-app-layer.md`, `.claude/rules/dev-app.md`.
- Comments state only constraints the code cannot show.
- Tray log lines go through `TrayLog`. No mattstack ticket ids in code or tests are needed; none are forbidden in this repo.

## Review Focus

1. A page navigates inside its own tab (a full-page link, not a route change) while `ready`: the tab must go back to `loading` and reach `ready` again, not get stuck or reload twice. Test in Task 5.
2. A stylesheet link that is still downloading when the app calls `ready()`: the script must wait for it, not report `failed`. Test in Task 1.
3. The app's health route answers 200 with HTML (a single-page app's fallback): the window must treat it as "no mattstack health here" and fall back to the home URL, not parse it as healthy with no token. Test in Task 5.
4. `dist/` is rebuilt while a kit app's server keeps running: the next page load must serve the new files, and a failed re-read must keep the last good copy. Test in Task 2.
5. Two tabs are `notReady` at once and one recovers: the health loop must keep running for the other and stop only when none are left. Test in Task 5 (`needsHealthLoop`).

---

### Task 1: Host signal script, boot id and build id (`packages/server`)

**Files:**
- Create: `packages/server/src/host-signal.ts`
- Create: `packages/server/src/host-signal.test.ts`
- Create: `packages/server/src/instance.ts`
- Modify: `packages/server/src/app.ts` (the `/api/health` route and `CreateAppOptions`)
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/package.json` only if a new subpath export is needed for the board (follow the existing subpath pattern in `.claude/rules/apps/app-server.md`)

**Interfaces:**
- Produces:
  - `export const bootId: string` in `instance.ts`: one `crypto.randomUUID()` per process.
  - `export function buildIdOf(...parts: Array<string | Uint8Array>): string` in `instance.ts`: first 16 hex chars of a SHA-256 over the parts.
  - `export function hostSignalScript(buildId: string | null): string`: a complete `<script>…</script>` element.
  - `export function injectHostSignal(html: string, buildId: string | null): string`: inserts the script directly after the opening `<head…>` tag; returns `html` unchanged when there is no `<head`.
  - `export interface HealthState { ok: boolean; buildId: string | null }` and `CreateAppOptions.health?: () => HealthState`. `/api/health` answers `{ ok, name, version, bootId, buildId }`, with status 200 when `ok` and 503 when not. With no `health` option it answers `ok: true, buildId: null`.

The script's behaviour, which the tests pin:
- On evaluation it posts `{ type: "booting" }` to `window.webkit?.messageHandlers?.mattstackHost` and defines `window.__mattstackHost = { ready(), failed(reason), fatal() }`. With no handler present every call is a no-op and nothing throws.
- `ready()` looks at every `link[rel~="stylesheet"]` that is not `disabled` and is same-origin. A link with no `sheet` yet is waited on through its `load` and `error` events. When all have settled: every one has a sheet with at least one rule, so post `{ type: "ready", buildId }`; otherwise post `{ type: "failed", reason: "stylesheet <href>" }`. A cross-origin sheet (reading `cssRules` throws) counts as fine. `ready()` posts at most once.
- `fatal()` posts `{ type: "fatal" }`. `failed(reason)` posts `{ type: "failed", reason }`.

- [ ] **Step 1: Write the failing tests** in `host-signal.test.ts` (vitest with jsdom, as the package's other DOM-free tests allow; evaluate the script body with `new Function` against a fake `window`/`document` if the package has no DOM environment):

```ts
test('posts booting as soon as the script runs', …)            // posted[0] deep-equals { type: 'booting' }
test('ready posts ready with the build id when every sheet has rules', …) // { type: 'ready', buildId: 'abc' }
test('ready posts failed naming the stylesheet with no rules', …)         // { type: 'failed', reason: 'stylesheet https://x/style.css' }
test('ready waits for a stylesheet that is still loading', …)  // nothing posted until the link fires load
test('a disabled link and a cross-origin sheet do not count', …)
test('ready posts only once', …)
test('with no message handler nothing throws', …)
test('injectHostSignal puts the script right after <head>', …) // '<head><script>' … and unchanged html without <head
test('a null build id is sent as null', …)
```

And in `app.test.ts`:

```ts
test('health carries bootId and the build id from the health option', …) // 200, { ok: true, bootId, buildId: 'abc' }
test('health answers 503 when the health option says not ok', …)
test('health with no option is ok with a null build id', …)
```

- [ ] **Step 2: Run them and see them fail.** Run: `scripts/turbo.sh test --filter=@mattstack/app-server`. Expected: the new tests fail on missing exports.
- [ ] **Step 3: Implement** `instance.ts`, `host-signal.ts` and the `/api/health` change. The script is plain ES2019 with no imports, built as a template string; the build id goes in through `JSON.stringify`.
- [ ] **Step 4: Run the package tests and typecheck.** Expected: all pass.
- [ ] **Step 5: Commit** `server: host signal script, boot id and build id on /api/health`.

### Task 2: Kit apps serve pages from memory (`packages/server`)

**Files:**
- Create: `packages/server/src/memory-static.ts`
- Create: `packages/server/src/memory-static.test.ts`
- Modify: `packages/server/src/static.ts` (`mountStatic`, disk branch and embedded branch)
- Modify: `packages/server/src/static.test.ts`
- Modify: each kit app's server entry that calls `mountStatic` and `createApp` (find them with `rg "mountStatic\(" apps packages/server/src`), to pass `health`

**Interfaces:**
- Consumes: `injectHostSignal`, `buildIdOf`, `HealthState` from Task 1.
- Produces:
  - `export interface StaticSnapshot { files: Map<string, { body: Uint8Array; type: string }>; indexHtml: string | null; buildId: string | null; indexMtimeMs: number | null }`
  - `export function readSnapshot(distRoot: string, fs: SnapshotFs): StaticSnapshot` where `SnapshotFs` is a small seam (`list`, `read`, `mtimeMs`) so tests need no disk. `buildId` is `buildIdOf(indexHtml)`; `indexHtml` is stored with the host signal already injected.
  - `export function createMemoryStatic(distRoot: string, fs?: SnapshotFs): { serve(path: string): Response | null; index(): Response | null; health(): HealthState }`
  - `mountStatic` returns `{ health(): HealthState }` (it returns nothing today).

Rules the tests pin:
- No `dist/` at boot: `health()` is `{ ok: true, buildId: null }`, and `index()` is null (the catch-all answers 404 as today).
- `dist/` exists but reading it throws: `health()` is `{ ok: false, buildId: null }`.
- On each `index()` call, compare `fs.mtimeMs(dist/index.html)` with the snapshot's. If it differs, read a new snapshot. If the stat or the read throws, keep serving the current snapshot and leave `health()` as it was.
- Embedded mode: the index HTML answered has the host signal injected, with `buildId` from the embedded index's bytes; `health()` is `{ ok: true, buildId }`.

- [ ] **Step 1: Write the failing tests:**

```ts
test('serves assets and index from memory after the folder becomes unreadable', …)
test('index html carries the host signal script with the build id', …)
test('no dist folder is healthy with a null build id and no index', …)
test('a dist folder that cannot be read is not ok', …)
test('a rebuilt dist is picked up on the next index request', …)   // Review Focus 4
test('a failed re-read keeps the last good copy', …)               // Review Focus 4
test('embedded index html carries the host signal script', …)
```

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `memory-static.ts`, switch `mountStatic`'s disk branch to it (keeping the `/assets/*`, `/fonts/*`, icon and catch-all routing exactly as it is), inject in the embedded branch, and pass `health` from `mountStatic`'s result into `createApp` in each kit app's server entry.
- [ ] **Step 4: Run** `scripts/turbo.sh test --filter=@mattstack/app-server` and the typecheck for chat, console and boxscore. Expected: pass.
- [ ] **Step 5: Commit** `server: kit apps serve pages from memory and report honest health`.

### Task 3: Board serves its CSS from memory, reports health and signals ready

**Files:**
- Modify: `apps/board/src/server.ts` (the `/style.css` case, the pre-secret route switch that holds `/healthz`, the shell HTML, the `watchClientAssets` `onStyle` callback)
- Modify: `apps/board/src/unconfigured.ts` only if it shares the shell (it must not gain the signal: an unconfigured board stays a legacy page)
- Modify: `apps/board/src/client/main.tsx`
- Test: a new `apps/board/src/__tests__/server-host-signal.test.ts`, modelled on an existing server boot test in that folder

**Interfaces:**
- Consumes: `bootId`, `buildIdOf`, `injectHostSignal` from Task 1 (import from `@mattstack/app-server`'s matching subpath).
- Produces: `GET /api/health` on the board answering `{ ok: true, name: "board", version, bootId, buildId }`, handled in the same early switch as `/healthz`, before the board-secret check. `buildId` is `buildIdOf(clientAssets.appJs, clientAssets.appCss, style)` and is recomputed when the client bundle or the style changes.

Behaviour:
- `/style.css` is answered from a module-level `let style = styleCss` in dev and packaged alike. In dev, `onStyle` re-reads `cssPath` into `style` inside a try/catch that keeps the last value on failure, then calls `sseReload()` as today.
- The shell HTML passes through `injectHostSignal(shell, buildId)`.
- `main.tsx` calls `window.__mattstackHost?.ready()` right after `createRoot(...).render(...)`. Declare the global's type once (a `declare global` beside it).

- [ ] **Step 1: Write the failing tests:**

```ts
test('the board answers /style.css after its source file becomes unreadable', …) // chmod 000 a temp copy, or stub the read to throw EPERM
test('/api/health answers without the board secret, with bootId and buildId', …)
test('the shell carries the host signal script', …)               // html includes '__mattstackHost'
test('the build id changes when the stylesheet changes', …)
```

- [ ] **Step 2: Run** `bun run board:test` (or `bun test src/__tests__/server-host-signal.test.ts` from `apps/board`) and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new test file and the board typecheck. Expected: pass.
- [ ] **Step 5: Commit** `board: css from memory, /api/health, and the ready signal`.

### Task 4: Kit apps signal ready and fatal (`packages/ui`)

**Files:**
- Modify: `packages/ui/src/app/mount.tsx` (after `markMounted()`)
- Modify: `packages/ui/src/boot/SimpleAlerts.ts` (`injectPanelOnce`)
- Modify: `packages/ui/src/app/mount.test.tsx`, `packages/ui/src/boot/SimpleAlerts.test.ts`
- Create: `packages/ui/src/boot/host.ts` with the `declare global` for `window.__mattstackHost` and `export function hostSignal(): { ready(): void; fatal(): void } | undefined`

**Interfaces:**
- Consumes: the `window.__mattstackHost` object the served HTML defines (Task 1).
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the failing tests:**

```ts
test('mountMattstackApp reports ready to the host after mounting', …)   // a fake window.__mattstackHost sees ready() once
test('mounting with no host object does not throw', …)
test('showing the fatal panel reports fatal to the host', …)
```

- [ ] **Step 2: Run** `scripts/turbo.sh test --filter=@mattstack/app-kit` (use the package's real name from `packages/ui/package.json`) and see them fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the package tests, typecheck and `bun run treeshake`. Expected: pass.
- [ ] **Step 5: Commit** `kit: report ready and fatal to the host window`.

### Task 5: The tab state machine (`rt-tray/Sources-core`)

**Files:**
- Create: `rt-tray/Sources-core/Window/TabReadiness.swift`
- Create: `rt-tray/Sources-core/Window/AppHealth.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/TabReadinessChecks.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/AppHealthChecks.swift`
- Modify: `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift` (register both lists)

**Interfaces (produced; Tasks 6 and 8 use exactly these):**

```swift
public enum HostSignal: Equatable, Sendable {
    case booting
    case ready(buildId: String?)
    case failed(reason: String)
    case fatal
    /// nil for anything that is not a well-formed signal.
    public static func parse(_ body: Any) -> HostSignal?
}

public struct AppHealth: Equatable, Sendable {
    public let answering: Bool
    public let token: String?
    public let buildId: String?
}

public enum AppHealthParse {
    /// A mattstack health answer, or nil when the response is not one
    /// (not JSON with a boolean `ok`), which sends the caller to the fallback.
    public static func mattstack(status: Int, body: Data) -> AppHealth?
    public static func deck(status: Int, pid: String?) -> AppHealth
    public static func fallback(status: Int?) -> AppHealth   // answering when status is 100...499
}

public enum TabPhase: Equatable, Sendable { case loading, ready, notReady(reason: String), fatal }

public struct TabState: Equatable, Sendable {
    public var phase: TabPhase = .loading
    public var speaksProtocol = false
    public var buildId: String?
    public var reloadCredit = false
    public var lastHealth: AppHealth?
    public var stale = false
    public init() {}
}

public enum TabEvent: Equatable, Sendable {
    case navigationStarted(byRecovery: Bool)
    case navigationFinished
    case navigationFailed(reason: String)
    case signal(HostSignal)
    case backstopElapsed
    case health(AppHealth)
}

public enum TabEffect: Equatable, Sendable { case reload, startBackstop, cancelBackstop }

public enum TabOverlay: Equatable, Sendable { case none, loading, failure }

public enum TabReadinessTuning {
    public static let backstop: TimeInterval = 15
    public static let healthInterval: TimeInterval = 2
}

public enum TabReadiness {
    public static func reduce(_ state: TabState, _ event: TabEvent) -> (TabState, [TabEffect])
    public static func overlay(_ state: TabState) -> TabOverlay
    /// True while the health loop must run.
    public static func needsHealthLoop(_ states: [TabState]) -> Bool
}
```

The rules, each a check:

| Event | Result |
|---|---|
| `navigationStarted(byRecovery: r)` | phase `loading`; `speaksProtocol`, `buildId`, `stale` reset; `reloadCredit` kept as it is when `r`, cleared otherwise; effect `cancelBackstop`. A later failure sets credit only when the navigation was not a recovery (keep `r` in the state as a private field). |
| `signal(.booting)` | `speaksProtocol = true` |
| `navigationFinished`, not speaking | phase `ready` |
| `navigationFinished`, speaking, still `loading` | effect `startBackstop` |
| `signal(.ready(b))` | phase `ready`, `buildId = b`, effect `cancelBackstop` |
| `signal(.failed(r))`, `navigationFailed(r)`, `backstopElapsed` while `loading` | phase `notReady`, `lastHealth = nil`, credit set unless this navigation was a recovery, effect `cancelBackstop` |
| `signal(.fatal)` | phase `fatal`, same credit rule |
| `health(h)` while `notReady` or `fatal` | reload when `h.answering` and (credit, or `lastHealth` was not answering, or both tokens exist and differ); then clear credit. Always store `lastHealth = h`. |
| `health(h)` while `ready` | `stale = true` when `buildId` and `h.buildId` both exist and differ; `false` when both exist and are equal; unchanged otherwise. No effects. |
| `backstopElapsed` while not `loading` | nothing |

`overlay`: `loading` gives `.loading`; `notReady` gives `.failure`; `ready` and `fatal` give `.none`.

- [ ] **Step 1: Write the failing checks.** One `Check` per table row, plus:

```swift
Check("tab readiness: an app that is up but serves a broken page gets one reload, then waits") { … }
Check("tab readiness: a tab that failed during an outage reloads each time the app comes back") { … }
Check("tab readiness: a new process token reloads a tab that already used its credit") { … }
Check("tab readiness: a full navigation from a ready tab goes back to loading and ready again") { … }   // Review Focus 1
Check("tab readiness: a page that never sends booting is ready when WebKit finishes") { … }
Check("tab readiness: a missing build id on either side never marks the tab stale") { … }
Check("app health: HTML answered at the health route is not a mattstack health answer") { … }          // Review Focus 3
Check("app health: ok false or a non-200 status is not answering") { … }
Check("app health: deck answers with its pid as the token") { … }
Check("app health: the fallback counts any status below 500 as answering, and no response as not") { … }
Check("host signal: parses the four messages and rejects anything else") { … }
Check("tab readiness: the health loop runs while any tab is not ready or fatal") { … }                  // Review Focus 5
```

- [ ] **Step 2: Run the checks and see them fail.** From a scratch copy of `rt-tray` (never the shared checkout; this worktree is fine): `swift run mattstack-checks` in `rt-tray/`. If that product name is wrong, read `rt-tray/Package.swift` for the executable target under `Tests/mattstack-checks`. Expected: compile errors for the missing types.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run the checks.** Expected: all pass.
- [ ] **Step 5: Commit** `tray core: tab readiness state machine and app health parsing`.

### Task 6: Wire the window to the state machine and delete the old retries

**Files:**
- Create: `rt-tray/Sources/Window/AppHealthSource.swift`
- Create: `rt-tray/Sources/Window/HostSignalHandler.swift`
- Modify: `rt-tray/Sources/Window/WebViewStore.swift` (`view(for:)`)
- Modify: `rt-tray/Sources/Window/WindowModel.swift`
- Modify: `rt-tray/Sources/Window/MattstackWindowView.swift` (`ContentArea`, `FailureOverlay`)
- Modify: `rt-tray/Sources/Window/WindowBackends.swift` (add the health source to the backends)
- Modify: `rt-tray/Sources/AppDelegate.swift` (the `retryFailedTabsAfterServedAppsRestart` call)
- Modify: `rt-tray/Sources-core/Window/WindowRecovery.swift` (delete `StylesheetProbe`, `StylesheetRetry`, `FailedTabRetry`)
- Modify: `rt-tray/Tests/MattstackCoreChecks/WindowRecoveryChecks.swift` (delete the checks for the deleted types; the cases they described are covered by Task 5's checks)

**Interfaces:**
- Consumes: everything Task 5 produces.
- Produces:
  - `protocol AppHealthSource: Sendable { func check(_ app: DiscoveryApp) async -> AppHealth }` and `struct URLSessionAppHealthSource`. For deck: `GET <url>/healthz`, `AppHealthParse.deck(status:pid:)` with the `x-deck-pid` header. For any other app: `GET <url>/api/health` with a 3 second timeout and `AppHealthParse.mattstack`; when that is nil, `GET <url>` and `AppHealthParse.fallback`.
  - `WindowModel.tabStates: [String: TabState]` (`@Published private(set)`), `func overlay(for name: String) -> TabOverlay`, `func retry(_ name: String)`.

Wiring:
- `WebViewStore.view(for:)` adds a `HostSignalHandler` (a `WKScriptMessageHandler` holding the app name and a closure, attached through a weak proxy so the content controller does not retain the store) under the name `mattstackHost`. It forwards only main-frame messages: `onHostSignal?(appName, message.body)`.
- `WindowNavigationDelegate` stops writing `loadFailures` and `loadingApps` directly and calls one method, `model.tabEvent(appName, event)`. `didStartProvisionalNavigation` passes `byRecovery` from a per-app flag the model sets just before it reloads for recovery.
- `WindowModel.tabEvent` runs `TabReadiness.reduce`, stores the state, and performs effects: `reload` sets the recovery flag and calls `store.reload(name)`; `startBackstop` starts a cancellable `Task` that sleeps `TabReadinessTuning.backstop` and then sends `.backstopElapsed`; `cancelBackstop` cancels it.
- One health loop `Task` runs while `TabReadiness.needsHealthLoop` is true: every `healthInterval` it checks each `notReady` or `fatal` tab through the health source and sends `.health`. It ends itself when no tab needs it.
- `loadFailures` and `loadingApps` are removed; `ContentArea` switches on `model.overlay(for:)`. `FailureOverlay` draws its card over the same opaque `barFill` ground `LoadingOverlay` uses. Its Retry button calls `model.retry(name)`, which reloads without the recovery flag.
- `store.noteFailedLoad` / `noteLoaded` calls stay where they are.
- Delete `reloadFailedTabs`, `retryFailedTabsAfterServedAppsRestart`, `noteStylesheetProbe`, `stylesheetFailures` and the probe call in `didFinish`.
- Log through `TrayLog`: `window tab not ready` (app, reason) on entering `notReady` or `fatal`, and `window tab reloading` (app, token) on each recovery reload.

- [ ] **Step 1: Delete the old checks and types, and build.** Expected: compile errors at every use, which is the list of call sites to rewire.
- [ ] **Step 2: Implement the wiring above.**
- [ ] **Step 3: Run `swift build` and `swift run mattstack-checks` in `rt-tray/`.** Expected: builds, all checks pass.
- [ ] **Step 4: Confirm the deletions:** `rg "StylesheetProbe|StylesheetRetry|FailedTabRetry|loadFailures|reloadFailedTabs" rt-tray` prints nothing.
- [ ] **Step 5: Commit** `tray: tabs load on the ready signal and recover on app health; drop timed retries`.

### Task 7: A replaced bundle restarts agents and served apps

**Files:**
- Create: `rt-tray/Sources-core/Services/LaunchIdentity.swift`
- Create: `rt-tray/Tests/MattstackCoreChecks/LaunchIdentityChecks.swift` (register in `AllChecks.swift`)
- Modify: `rt-tray/Sources/AppDelegate.swift` (where `version` is read before `handleVersionChange`)

**Interfaces:**
- Produces: `public enum LaunchIdentity { public static func current(version: String, executableModified: Date?) -> String }`. With a date it returns `"<version>@<whole seconds since 1970>"`; with nil it returns `version`.

Behaviour: `AppDelegate` reads the main executable's modification date (`Bundle.main.executableURL`, `.contentModificationDateKey`) and passes `LaunchIdentity.current(...)` everywhere it passes `version` into `handleVersionChange` and the later record step, so `VersionChangeDetector` sees a rebuilt bundle at the same version as changed. Before changing the call sites, list every reader of `progress.change` and of `VersionChangeDetector.key` (`rg "progress.change|\.changed\(|MSLastLaunchedVersion" rt-tray/Sources rt-tray/Sources-core`). Any reader that means "the release version changed" for a person (release notes, a setup update, telemetry's from and to) keeps reading the plain version; say in the commit message which readers those were.

- [ ] **Step 1: Write the failing checks:**

```swift
Check("launch identity: the same version with a newer executable is a different identity") { … }
Check("launch identity: the same version and executable date is the same identity") { … }
Check("launch identity: with no executable date it is the version alone") { … }
Check("launch identity: a rebuilt bundle at the same version reads as changed to the version detector") { … }
```

- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** and rewire `AppDelegate`.
- [ ] **Step 4: Run `swift build` and the checks.** Expected: pass.
- [ ] **Step 5: Commit** `tray: a replaced bundle at the same version restarts agents and served apps`.

### Task 8: The stale state and a placeholder new-version notice

**Files:**
- Modify: `rt-tray/Sources/Window/WindowModel.swift`
- Modify: `rt-tray/Sources/Window/MattstackWindowView.swift`
- Modify: `rt-tray/Sources/Window/BadgePoller.swift` or its caller (to hang the check on the existing poll)

**Interfaces:**
- Consumes: `TabState.stale`, `TabEvent.health`, `AppHealthSource` from Tasks 5 and 6.
- Produces: `WindowModel.checkFreshness(_ name: String) async` and `func reloadStale(_ name: String)`.

Behaviour:
- `checkFreshness` runs the health source for a `ready` tab and sends `.health`. Call it from `select(_:)`, from the window becoming key, and once per existing badge poll for the active tab. No new loop.
- When the active tab's state is `stale`, `ContentArea` shows a plain one-line bar above the web content: the text "A new version of <display name> is available" and a button titled "Reload". The button calls `reloadStale`, a normal (non-recovery) reload.
- This bar is a placeholder. Its look and words are settled with Matt in Task 9. Use the window's existing chrome colours and fonts; add no new tokens.

- [ ] **Step 1: Implement.** (The stale rule itself is already checked in Task 5.)
- [ ] **Step 2: Run `swift build` and the checks.** Expected: pass.
- [ ] **Step 3: Commit** `tray: placeholder notice when a tab's app is serving a newer build`.

### Task 9: See it working, then settle the notice with Matt

This task is done by the lead session with Matt, not by a subagent.

- [ ] **Step 1: Run the apps' suites that the PR touches** (`bun run board:test`, the app-server and app-kit packages, the tray checks) and `bun run check`. Report failures with their output.
- [ ] **Step 2: Ask Matt before touching the dev app.** Build the dev app in a scratch tree at this branch (`.claude/rules/dev-app.md`, "Tray and shim changes need a dev app rebuild"), and with his go-ahead put it in place the way the `rt:build-dev-app` skill does. The served apps come from the shared checkout, so they also need this branch there or a `deck live`/deploy from it; agree with Matt how.
- [ ] **Step 3: Force each case and look at it, in light and dark:**
  - Board stylesheet failing (temporarily make the board answer 500 for `/style.css`): loading overlay, then the failure overlay on an opaque ground, never unstyled content.
  - Board restarted while the tab is failed: the tab reloads by itself and is styled.
  - Board up but still failing: one reload, then it waits.
  - Deck restarted: deck's tab recovers by itself.
  - A user app that sends no signal (mantine-kit): loads as before.
  - Board redeployed with a tab open: the placeholder notice shows; Reload clears it.
  - Dev bundle replaced at the same version: the tray log shows the agents kickstarted and "served apps restarted".
- [ ] **Step 4: Screenshot both colour schemes** and add them as one Human Todos image item for Matt.
- [ ] **Step 5: Settle the notice's look and words live with Matt**, then commit `tray: new-version notice`.
- [ ] **Step 6: Open the PR** from the repo's PR template, mark it ready, and hand it to a live pr-usher if one is signed in for this repo.
