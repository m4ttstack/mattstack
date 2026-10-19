# Version Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every rt daemon reports what it runs to the switchboard relay; one plain page on the relay shows who is on what and whether old-version code can be retired.

**Architecture:** A pure collector in `lib/telemetry/` builds a ping from existing readers; a daemon tick sends it on start, hourly, and when the app or rt version changes. The relay (`apps/board/switchboard/`) stores the latest ping per install id plus an update history in its existing sqlite db, and serves `GET /telemetry` as plain HTML behind a read-only view token. The tray's General pane gets a checkbox bound to the `telemetry.enabled` setting.

**Tech Stack:** Bun + TypeScript (rt, relay, `bun:sqlite`), Swift/SwiftUI (tray, `MattstackCore` checks harness).

**Spec:** `docs/superpowers/specs/2026-10-19-version-telemetry-design.md`

## Global Constraints

- Setting key `telemetry.enabled`, type boolean, scopes `["user"]`, default `true`. The default lives only in the registry row; callers never add `?? true`.
- Ping fields are exactly the spec's table; nothing else (no repos, hostnames, paths, commands).
- Telemetry failures never surface to the user: no warning, no CLI output, no retry beyond the next tick. Log at `debug` only, through `(await getDaemonLogger()).childLogger("telemetry")`.
- Relay retention: drop a row (and its history) not seen for 90 days.
- "Running" = last seen within 60 minutes.
- Relay code stays in `apps/board/switchboard/*.ts` (the Dockerfile copies only those files plus `src/peer/envelope.ts`).
- A built binary runs only under an isolated HOME; tests run from the repo root (`bun test <file>`), relay tests from `apps/board`.

## Review Focus

1. **Relay unreachable or offline Mac** → the tick resolves quietly and the next tick tries again. Test in Task 3.
2. **Hostile strings on the admin page** (a self-reported username or pack name containing `<script>`) → rendered escaped. Test in Task 5.
3. **Malformed or oversized ping body** (non-JSON, missing `installId`, > 64 KB) → 400, nothing stored. Test in Task 5.
4. **A ping with an invalid board token** → stored as unverified, not rejected (a stale token must not stop reporting). Test in Task 5.
5. **Setting turned off while the daemon runs** → the next tick sends nothing; the setting is read every tick, not cached at boot. Test in Task 3.

---

### Task 1: `telemetry.enabled` setting

**Files:**
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (new row near `agent.claude.yolo`)
- Modify: `packages/rt-client/src/settings/registry-schemas.ts`, `packages/rt-client/src/settings/schema-examples.ts`
- Modify: `apps/console/src/app/settings/groups.ts`
- Regenerate: the schema lock via `bun run cli.ts settings schema lock`

**Interfaces:**
- Produces: `getSetting<boolean>("telemetry.enabled").value`

- [ ] **Step 1:** Load the `rt:settings` skill and follow its "add a key" checklist (and `docs/settings-architecture.md`).
- [ ] **Step 2:** Add the row: `{ key: "telemetry.enabled", type: "boolean", scopes: ["user"], default: true, merge: "replace", description: "Send this Mac's mattstack versions to the team's switchboard once an hour, so the org admin can see who is on which version." }`, plus its zod schema and example.
- [ ] **Step 3:** Add the key to a console group (an existing general/"mattstack" group is fine).
- [ ] **Step 4:** Run `bun run cli.ts settings schema lock`, then `bun test packages/rt-client/src/settings apps/console/src/app/settings` and the guard tests the skill names (`registry-console-ready`, `schema-examples`, console `groups`). Expected: PASS.
- [ ] **Step 5:** Commit `add telemetry.enabled setting`.

### Task 2: Ping collector

**Files:**
- Create: `lib/telemetry/ping.ts`, `lib/telemetry/install-id.ts`
- Test: `lib/telemetry/__tests__/ping.test.ts`, `lib/telemetry/__tests__/install-id.test.ts`

**Interfaces:**
- Consumes: `rtVersion()` (`lib/setup/update.ts`), `processFlavor()` (`lib/flavor.ts`), `readSetupState` (`lib/setup/state.ts`), `MIGRATIONS` (`lib/setup/migrations/index.ts`), `legacyDirsPresent()` (`lib/rt-paths.ts`), `discoverOrgs` (`lib/setup/team-settings.ts`), `markerState` (`lib/team/org-marker.ts`), `readTeamLocal` (`lib/team/team-local.ts`), `listInstalledPlugins`/`installedVersionFor` (`lib/skills/sources.ts`), `readServedPacks` (`lib/setup/pack-cache.ts`), `ENGINE_PACK_REF`.
- Produces:
  ```ts
  export interface TelemetryPing {
    installId: string;
    usernames: string[];               // forgeUsername per team, deduped, sorted
    appVersion: string | null;         // CFBundleShortVersionString of the flavor's app bundle
    rtVersion: string;
    pluginVersion: string | null;      // installed version of ENGINE_PACK_REF
    flavor: "prod" | "dev";
    macosVersion: string | null;       // sw_vers -productVersion
    migrationsRecorded: string[];      // SetupState.migrations
    migrationsKnown: string[];         // MIGRATIONS.map(m => m.id)
    legacyDirs: string[];              // LegacyDirsReport.real ∪ .symlinks
    orgs: { org: string; layout: number | null }[]; // null when the marker is none/invalid
    packs: { id: string; version: string | null }[]; // installed version of every pack any team serves
  }
  export interface PingVersions { appVersion: string | null; rtVersion: string } // cheap subset for change detection
  export function readPingVersions(p: Probes): Promise<PingVersions>;
  export function collectPing(p: Probes): Promise<TelemetryPing>;
  export function readInstallId(p: Probes, flavor: "prod" | "dev"): string; // in install-id.ts
  ```

- [ ] **Step 1: Write failing tests** with a fake `Probes` (model on existing `lib/setup` probe fakes):
  - `collectPing` on a Mac in two teams returns both usernames, both orgs with layouts 3 and 4, and `packs` for each served pack with its installed version.
  - On a Mac in no team: `usernames: []`, `orgs: []`, `packs: []`.
  - Any reader that throws or exits non-zero yields `null` / `[]` for that field and `collectPing` still resolves.
  - `migrationsKnown` equals `MIGRATIONS.map(m => m.id)`.
  - `readInstallId` returns the same id across calls, a different id per flavor, and creates the file once (`~/.mattstack/rt/telemetry-id-<flavor>`, a `crypto.randomUUID()`).
- [ ] **Step 2:** Run `bun test lib/telemetry/__tests__/`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement. Every field is read inside its own try/catch so one bad reader never drops the ping. App bundle path comes from the existing `appBundlePath(p)` used by `rt-health.ts`. `readPingVersions` reads only the app plist and `rtVersion()`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `telemetry: collect a version ping`.

### Task 3: Daemon tick and sender

**Files:**
- Create: `lib/telemetry/tick.ts`
- Modify: `lib/daemon.ts` (next to the `health-sample` `safeInterval`, ~line 1275)
- Test: `lib/telemetry/__tests__/tick.test.ts`

**Interfaces:**
- Consumes: Task 2's `collectPing`, `readPingVersions`; `switchboardUrl()`; `readBoardSwitchboardToken`; `getSetting`.
- Produces:
  ```ts
  export interface TickDeps {
    enabled(): boolean;                         // getSetting<boolean>("telemetry.enabled").value, read every call
    versions(): Promise<PingVersions>;
    collect(): Promise<TelemetryPing>;
    token(): Promise<string | null>;
    post(url: string, body: string, token: string | null): Promise<number>; // HTTP status, 0 = unreachable
    url(): string;                              // `${switchboardUrl()}/telemetry/ping`
    now(): number;
    log: Logger;
  }
  export function makeTelemetryTick(deps: TickDeps): () => Promise<void>;
  ```
  The tick sends when nothing has been sent yet, when 60 minutes have passed since the last successful send, or when `versions()` differs from the last sent. A failed send (status 0 or non-2xx) does not advance the last-sent state.

- [ ] **Step 1: Write failing tests:**
  - first tick sends; a second tick 5 minutes later with the same versions does not; a tick at +60 min does.
  - a tick at +5 min after `rtVersion` changes sends.
  - `enabled()` false → no `collect`, no `post`; flipping it back to true sends on the next tick.
  - `post` returning 0 (Review Focus 1): tick resolves, nothing thrown, nothing logged above `debug`; the next tick retries.
  - token present → passed through to `post`; absent → `null`.
- [ ] **Step 2:** Run `bun test lib/telemetry/__tests__/tick.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `makeTelemetryTick`. Wire it in `lib/daemon.ts`: run once at boot, then `safeInterval(() => void tick(), 5 * 60_000, "telemetry", log)`; `post` uses `Probes.fetch` with `{ method: "POST", headers: { "content-type": "application/json", ...auth }, body, timeoutMs: 10_000 }`.
- [ ] **Step 4:** Run the tests, then `bun test lib/daemon/__tests__/` and `bun run typecheck` (or the repo's tsc script). Expected: PASS.
- [ ] **Step 5:** Commit `telemetry: send a ping from the daemon`.

### Task 4: Relay telemetry store

**Files:**
- Create: `apps/board/switchboard/telemetry.ts`
- Test: `apps/board/switchboard/__tests__/telemetry-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class TelemetryStore {
    constructor(db: Database);                  // CREATE TABLE IF NOT EXISTS telemetry_macs, telemetry_updates
    record(ping: TelemetryPing, verifiedUsername: string | null, now: number): void;
    prune(now: number): void;                   // drops rows (and their updates) last seen > 90 days ago
    snapshot(now: number): TelemetrySnapshot;
  }
  export interface MacRow extends TelemetryPing { verifiedUsername: string | null; lastSeen: number; running: boolean }
  export interface TelemetrySnapshot {
    macs: MacRow[];                                                    // newest lastSeen first
    versions: { kind: "app" | "rt"; version: string; macs: number; lastSeen: number }[];
    migrations: { id: string; notRun: string[]; tooOld: string[] }[]; // labels of macs; tooOld = id absent from migrationsKnown
    legacyDirs: { label: string; dirs: string[] }[];
    orgLayouts: { org: string; layout: number | null; macs: string[] }[];
    packs: { id: string; oldestVersion: string | null; macs: number }[];
    updates: { label: string; kind: "app" | "rt"; from: string | null; to: string; at: number }[]; // newest first
  }
  export function macLabel(row: MacRow): string; // verifiedUsername ?? usernames.join(", ") ?? installId
  ```
  `TelemetryPing` is redeclared in this file (the relay cannot import from `lib/`); keep the field names identical to Task 2. Store the ping as a JSON column keyed by `installId`. `migrations` covers the union of every `migrationsKnown` seen. `oldestVersion` compares by numeric semver segments.

- [ ] **Step 1: Write failing tests** on `new Database(':memory:')`:
  - two pings from one install id keep one row with the latest fields.
  - an app or rt version change appends one `updates` entry with `from`/`to`; an unchanged ping appends none.
  - `running` is true at +59 min, false at +61 min.
  - `prune` at +91 days removes the row and its updates; at +89 days keeps them.
  - migration `X` known and not recorded → in `notRun`; unknown to a Mac → in `tooOld`.
  - `packs.oldestVersion` picks `1.9.0` over `1.10.0`.
- [ ] **Step 2:** Run `cd apps/board && bun test switchboard/__tests__/telemetry-store.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `switchboard: store telemetry pings`.

### Task 5: Relay routes and page

**Files:**
- Modify: `apps/board/switchboard/server.ts` (new branches before the board-auth gate at ~line 151; `makeFetchHandler` gains `telemetry: TelemetryStore` and `viewToken: string | null` params; wire in `import.meta.main` and add `telemetry.prune` to the hourly prune)
- Create: `apps/board/switchboard/telemetry-page.ts`
- Modify: every existing `makeFetchHandler(...)` call in `apps/board/switchboard/__tests__/`
- Test: `apps/board/switchboard/__tests__/telemetry-server.test.ts`

**Interfaces:**
- Consumes: Task 4's `TelemetryStore`, `macLabel`; `store.authBoard(token): string | null`.
- Produces: `POST /telemetry/ping`, `GET /telemetry`; `renderTelemetryPage(s: TelemetrySnapshot): string`.

Viewing (my call, replaces the spec's open question): the page is read with a separate env token `SWITCHBOARD_TELEMETRY_TOKEN`, accepted as `?key=<token>` or `Authorization: Bearer`, so Matt can bookmark it without exposing the admin token. Unset → `GET /telemetry` is 404. Response headers match the invite page: `content-type: text/html; charset=utf-8`, `cache-control: no-store`, `referrer-policy: no-referrer`.

- [ ] **Step 1: Write failing tests** with the `server.test.ts` `setup()` pattern:
  - `POST /telemetry/ping` with a valid body and a valid board token → 204, row stored with `verifiedUsername` from `authBoard`.
  - same with an invalid token (Review Focus 4) → 204, `verifiedUsername: null`.
  - non-JSON body, missing `installId`, body > 64 KB (Review Focus 3) → 400, nothing stored.
  - `GET /telemetry` without key → 401; with `?key=` → 200 HTML containing the four section headings `Macs`, `Versions`, `Retirement checks`, `Recent updates`; with no view token configured → 404.
  - a ping whose `usernames` is `["<script>x</script>"]` (Review Focus 2) → the page contains `&lt;script&gt;` and not `<script>x`.
- [ ] **Step 2:** Run `cd apps/board && bun test switchboard`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the routes and `renderTelemetryPage` (plain tables, no JS, every interpolated string through one `escapeHtml`). Running rows show `running` in the last-seen cell; unverified usernames show `(unverified)`.
- [ ] **Step 4:** Run `cd apps/board && bun test switchboard && bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `switchboard: telemetry ping route and readout page`.

### Task 6: Tray checkbox

**Files:**
- Create: `rt-tray/Sources-core/Settings/TelemetrySettingsModel.swift`
- Modify: `rt-tray/Sources/Settings/GeneralPane.swift`, `rt-tray/Sources/AccessibilityIDs.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/SettingsChecks.swift` (append; register in `AllChecks.swift` if a new file)

**Interfaces:**
- Produces:
  ```swift
  @MainActor public final class TelemetrySettingsModel: ObservableObject {
    @Published public private(set) var enabled: Bool   // true until load() answers
    @Published public private(set) var inFlight: Bool
    @Published public private(set) var error: String?
    public init(rt: RtRunning)
    public func load() async                            // rt settings get telemetry.enabled --json → .value
    public func setEnabled(_ on: Bool) async            // rt settings set telemetry.enabled true|false --scope user
  }
  ```
  Copy `AppsSettingsModel`'s optimistic update, rollback on failure, and reload. `rt settings set` has no `--json`; judge it by exit code.

- [ ] **Step 1: Write failing checks** modelled on `SettingsChecks.swift:539` with `ScriptedRt`:
  - `load()` runs exactly `["settings","get","telemetry.enabled","--json"]` and reflects `value: false`.
  - `setEnabled(false)` runs exactly `["settings","set","telemetry.enabled","false","--scope","user"]`.
  - a non-zero exit rolls `enabled` back and sets `error`.
- [ ] **Step 2:** Run `cd rt-tray && swift run mattstack-checks Telemetry`. Expected: FAIL.
- [ ] **Step 3:** Implement the model, then a `Toggle("Share version info with your team's admin", ...)` in `GeneralPane.swift` with `.toggleStyle(.switch)`, disabled while `inFlight`, `AXID.settingsTelemetryToggle`. Load the `rt:ui-copy` skill for the label and its help text.
- [ ] **Step 4:** Run `swift test --package-path rt-tray`. Expected: PASS.
- [ ] **Step 5:** Commit `tray: telemetry checkbox in General settings`.

### Task 7: Docs and live check

**Files:**
- Modify: the settings reference page on the docs site for the new key (load `rt:docs`).

- [ ] **Step 1:** Document `telemetry.enabled` and the Settings checkbox (what is sent, one line each).
- [ ] **Step 2:** Run the relay locally (`SWITCHBOARD_TELEMETRY_TOKEN=t SWITCHBOARD_ADMIN_TOKEN=a SWITCHBOARD_DB=<scratch>/sb.sqlite bun run switchboard`), POST a ping built by `collectPing` from a script run under an isolated HOME, open `/telemetry?key=t` in Fast Browser and screenshot it in light and dark. Say what reads wrong.
- [ ] **Step 3:** Commit `docs: telemetry setting`.

After merge (not part of the branch): set `SWITCHBOARD_TELEMETRY_TOKEN` on the Railway service, and rebuild the dev app for the tray checkbox (`rt:build-dev-app`).
