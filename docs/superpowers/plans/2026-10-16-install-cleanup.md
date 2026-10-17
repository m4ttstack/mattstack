# Install Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five first-install problems: per-repo placement instead of one repo folder (with clone progress), the active team's pack left off, the dev-login sheet, the GitLab token link's scopes, and herdr not running.

**Architecture:** rt (Bun/TS) decides everything and exposes it through setup rows, NDJSON apply events, verbs and daemon commands; the Swift app (rt-tray) only renders rows and runs verbs. A new `lib/herdr/start.ts` is the one place that starts herdr; the daemon, a hidden `rt herdr start` verb, the board, gitq and the app reach it.

**Tech Stack:** Bun + TypeScript (`bun test`), SwiftUI app with the `MattstackCoreChecks` harness (`cd rt-tray && swift run mattstack-checks`), board/gitq app packages (their own `bun test`).

**Spec:** `docs/superpowers/specs/2026-10-16-install-cleanup-design.md` (read it first; it carries the why and the copy).

## Global Constraints

- Public repo: placeholders only (`acme`, `widgets`, `acme-api`, `dev1`) in code, tests, fixtures, commit messages and the PR body.
- Run `bun test` from the repo root (bunfig preload isolates HOME); run board tests from `apps/board` (`bun test`) and gitq from `apps/gitq` (`bun run test:unit`). Targeted tests only; CI runs the rest.
- Never run a built binary without an isolated HOME; never start a real herdr in a test; never touch `/Applications/mattstack.app` or `rt-tray/mattstack-dev.app`.
- Everything rt prints goes through `lib/ui/out.ts`; no `console.*` under `lib/`, `commands/`, `cli.ts` (`lib/__tests__/no-raw-output.test.ts`).
- NDJSON and `--json` envelope changes are additive; the app decodes unknown events as `.unknown`.
- A setup migration changes only this Mac; its id is dated and never renamed.
- Comments state constraints the code cannot show, nothing else; match the surrounding code's density.
- A new setup row action type needs, in the same task as the TS type: the Swift decode (`PlanModels.swift`), dispatch (`RowActionDispatcher.swift`), and, when it joins `DONE_ACTION_TYPES`, `DoneActions.route` (`rt-tray/Sources-core/Setup/FinishGate.swift`) with its parity check (`DoneModelChecks.swift`).
- New `ApplyContext` members are optional (`progress?`, `appDriven?`), like `tip?`, so hand-built test contexts keep compiling.
- A verb's handler signature is `(args: string[], _ctx: CommandContext = {}, deps = realDeps())`: `dispatch` always passes the context second (`lib/command-tree.ts:419`). A new `commands/*.ts` module is registered in `lib/module-registry.ts` (guard: `lib/__tests__/module-registry.test.ts`).
- After changing `packages/rt-client/src`, run `bun run build` in `packages/rt-client` (stale `dist/`, see `.claude/rules/workspace-packages.md`).
- UI is not done until rendered and looked at in light and dark: the tray's `--render-checklist-row-snapshots` path (`rt-tray/Sources/**/ChecklistRowSnapshot.swift`; read it first) renders rows to PNG; extend it for each new view, write PNGs to the session scratch dir, open them, and say plainly what looks wrong. Never launch or rebuild an installed app bundle for this.
- The mockups are boards "R · Your repos…" and "R · Install: Clone your repos…" in `docs/apps/design/setup/setup.pen` (plain JSON; the pencil MCP renders it).
- herdr server env (spec §7): login-shell PATH, HOME, SHELL, TMPDIR, LANG plus USER, LOGNAME; caller's `HERDR_*` minus `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`; then `HERDR_MACOS_SERVER_CONTEXT=user`. Nothing else.
- Never `herdr server stop`; never a launchd agent for herdr.

## Review Focus

1. Two tracked identities with the same basename (`gitlab.com/a/api`, `github.com/b/api`): placement keys on the full identity, and the second repo's default clone path collides with the first's, so `checkCloneTarget` refuses it and that row shows the problem instead of cloning over the first. Test in Task 10.
2. A Locate pick of a path with a trailing slash, `~`, or a symlink to the checkout: normalised the same way `checkRepoRoot` expands `~`, and judged by the real path. Test in Task 10.
3. herdr installed but its socket file left over from a crash (exists, refuses connections): `start()` must start it, not report running. Test in Task 4.
4. Two reviews launched at once on a stopped herdr: one spawn, both callers get `started`/`running`. Test in Task 4.
5. A clone whose git output is not English or carries no percentages (old git, `LANG` set): the progress parser returns null and the step still finishes; no bar, no crash. Test in Task 9.

---

### Task 1: GitLab token link pre-checks six scopes

**Files:**
- Modify: `lib/setup/token-create.ts`
- Test: `lib/setup/__tests__/token-create.test.ts`

**Interfaces:**
- Produces: `linkScopes(provider: ForgeProvider, role: ForgeRole): string[]`; `tokenCreateLink` uses it. `forgeScopes`, `missingScopes`, `tokenField` unchanged (GitLab still `["api"]`).

- [ ] **Step 1: Write the failing tests**

```ts
test("gitlab link pre-checks the six scopes, required stays api", () => {
  expect(linkScopes("gitlab", "member")).toEqual(["api", "read_api", "read_user", "read_repository", "write_repository", "ai_features"]);
  expect(forgeScopes("gitlab", "member")).toEqual(["api"]);
  expect(tokenCreateLink("gitlab", "member", null).url).toBe(
    "https://gitlab.com/-/user_settings/personal_access_tokens?name=mattstack&scopes=api%2Cread_api%2Cread_user%2Cread_repository%2Cwrite_repository%2Cai_features",
  );
  expect(missingScopes("gitlab", "member", ["api"])).toEqual([]);
});
test("github link scopes equal the required scopes", () => {
  expect(linkScopes("github", "owner")).toEqual(forgeScopes("github", "owner"));
});
```

Update the two existing gitlab `tokenCreateLink` expectations to the new URL (note `URLSearchParams` encodes the commas as `%2C`; if the current test's `scopes=api` stays literal, keep whichever encoding `URLSearchParams` produces and assert that).

- [ ] **Step 2: Run** `bun test lib/setup/__tests__/token-create.test.ts` — expect FAIL (`linkScopes` not exported).
- [ ] **Step 3: Implement** a `LINK_EXTRAS: Partial<Record<ForgeProvider, readonly string[]>>` (`gitlab: ["read_api", "read_user", "read_repository", "write_repository", "ai_features"]`) and `linkScopes = dedupe([...forgeScopes, ...extras])`; `tokenCreateLink` reads `linkScopes`. Update the file header comment: the link pre-checks extras; the check and hint read only the required list.
- [ ] **Step 4: Run** the test file and `bun test commands/__tests__/setup-copy.test.ts lib/setup/__tests__/validators-org.test.ts lib/setup/__tests__/validators-accounts.test.ts`; update the gitlab URL in `validators-org.test.ts`, `validators-accounts.test.ts` (it pins the URL at ~76, 88, 140, 169, 965; `rg -n "scopes=api" lib commands` finds every pin) and any snapshot carrying it. Update the sentence in `.claude/rules/setup.md` that calls `token-create.ts` "the one list": it now holds the required list and the link's extras, still the only place either lives (`bun test --update-snapshots` only for that URL change). Expect PASS.
- [ ] **Step 5: Commit** `setup: GitLab token link pre-checks read_user, repository and ai_features scopes`

### Task 2: Dev-login sheet confirms the password, not the host

**Files:**
- Modify: `rt-tray/Sources-core/Settings/DevLoginsModel.swift` (`DevLoginConfirm`)
- Modify: `rt-tray/Sources/Settings/DevLoginSheet.swift`
- Modify: `rt-tray/Sources/AccessibilityIDs.swift` (replace `devLoginSheetConfirmHost` with `devLoginSheetConfirmPassword`)
- Modify: `docs/superpowers/specs/2026-09-28-dev-logins-design.md` (one-line note in its threat model: typed host replaced by password confirmation on 2026-10-16, see `2026-10-16-install-cleanup-design.md` §4)
- Test: `rt-tray/Tests/MattstackCoreChecks/DevLoginsModelChecks.swift`

**Interfaces:**
- Produces: `DevLoginConfirm.canSave(email: String, password: String, confirm: String) -> Bool`, `DevLoginConfirm.mismatch(password: String, confirm: String) -> Bool` (true only when `confirm` is non-empty and differs), `DevLoginSheetCopy.mismatch = "Passwords don't match"`. The old `canSave(host:typedHost:isFirstTime:...)` is removed.

- [ ] **Step 1: Replace the check** "first-time origins need the typed host" with:

```swift
Check("dev logins confirm: save needs an email and two matching passwords") { c in
    c.expect(!DevLoginConfirm.canSave(email: "a", password: "b", confirm: ""))
    c.expect(!DevLoginConfirm.canSave(email: "a", password: "b", confirm: "c"))
    c.expect(!DevLoginConfirm.canSave(email: " ", password: "b", confirm: "b"))
    c.expect(!DevLoginConfirm.canSave(email: "a", password: "", confirm: ""))
    c.expect(DevLoginConfirm.canSave(email: "a", password: "b", confirm: "b"))
    c.expect(!DevLoginConfirm.mismatch(password: "b", confirm: ""))
    c.expect(DevLoginConfirm.mismatch(password: "b", confirm: "c"))
    c.expectEqual(DevLoginSheetCopy.mismatch, "Passwords don't match")
},
```

- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks` — expect a compile failure / FAIL on the new check.
- [ ] **Step 3: Implement** the two functions and the copy constant; in the sheet replace `typedHost` with `confirmPassword`, drop the "Type <host> to confirm" field, add a `SecureField` labelled "Confirm password" (accessibility label "Confirm password", id `AXID.devLoginSheetConfirmPassword`) shown for every valid origin (Add and Edit), and under it, when `mismatch`, a caption in red with `DevLoginSheetCopy.mismatch`. `canSave` ANDs origin validity with the new `DevLoginConfirm.canSave`.
- [ ] **Step 4: Run** `cd rt-tray && swift run mattstack-checks` and `cd rt-tray && swift build` — expect PASS / build ok. Grep the repo for `devLoginSheetConfirmHost`, `confirmHost` and `typedHost`; expect no hits (`rt-tray/Tests/mattstackUITests/SetupFlowUITests.swift` ~328, 333 uses the literal `"devLogin.sheet.confirmHost"`; update it to the new id).
- [ ] **Step 5: Render and look:** render the Add sheet (empty, mismatched, matching) in light and dark through the snapshot path (Global Constraints); check the field order is Site, Email, Password, Confirm password and the mismatch line reads in both schemes.
- [ ] **Step 6: Commit** `tray: dev-login sheet confirms the password instead of the host`

### Task 3: The active team's pack is installed turned on

**Files:**
- Modify: `lib/setup/pack-cache.ts` (`settlePack`, `convergePackCache`, new `enablePack`)
- Modify: `lib/setup/steps/plugins.ts` (`computePlugins`, the install loop, `enableTrusted`)
- Create: `lib/setup/migrations/enable-team-pack.ts`; register in `lib/setup/migrations/index.ts` `MIGRATIONS`
- Modify: `docs/superpowers/specs/2026-09-07-pack-cache-sync-design.md` and the org-and-teams design (find it: `rg -l "never auto-enabled" docs/superpowers/specs`): one-line note pointing to `2026-10-16-install-cleanup-design.md` §3
- Test: `lib/setup/__tests__/pack-cache-settle.test.ts`, `pack-cache-converge.test.ts`, the plugins.install step tests (`rg -l "plugins.install" lib/setup/__tests__`), new `lib/setup/__tests__/migration-enable-team-pack.test.ts`

**Interfaces:**
- Produces:
  - `enablePack(runner: ClaudeRunner, id: string, timeoutMs: number): Promise<{ ok: boolean; detail: string | null }>` in `pack-cache.ts` — runs `plugin enable <id>`; ok when exit 0, `isAlready`, `isAlreadyEnabled` or `isUnknownSubcommand` (move those predicates' imports as needed).
  - `settlePack(..., opts: { teamAuthored: boolean; keepEnabled?: boolean; timeoutMs?: number })` — with `teamAuthored && keepEnabled` it returns `{ kind: "installed" }` without the disable call.
  - `computePlugins` returns `{ trusted; teamAuthored; activeTeamPack: string | null }` (`activeTeamPack` is the `${active}@${marketplaceName}` entry when present).
  - `activeTeamPackId(ctx: ApplyContext): string | null` exported from `plugins.ts` (reads the team marketplace and calls `computePlugins`).
  - Migration id `2026-10-17-enable-team-pack`, title "Turn on your team's plugin".

- [ ] **Step 1: Write failing tests**
  - settle: `settlePack(runner, "acme@acme", admitted, { teamAuthored: true, keepEnabled: true })` → `{kind:"installed"}` and the runner saw no `plugin disable`.
  - converge: a served active-team pack not yet installed ends `installed`, the runner saw `plugin enable acme@acme` and no `plugin disable`.
  - plugins.install, non-update run: active pack absent → installed then enabled; active pack installed and disabled → enabled; an org-listed `claude.plugins` team-authored entry → installed then disabled (unchanged); the detail no longer mentions the active pack as "awaiting your approval".
  - plugins.install, `update` run: active pack installed and disabled → left alone (no `plugin enable`).
  - migration: active pack installed+disabled in one config dir → `done`, `plugin enable` ran for that dir; already enabled → `skipped`; not installed → `skipped`; a previous team's pack disabled → untouched.
- [ ] **Step 2: Run** the four test files — expect FAIL.
- [ ] **Step 3: Implement.** Move `enableTrusted`'s body to `enablePack` (the step keeps its `ctx.log` wrapper). In the install loop treat `plugin === activeTeamPack` like trusted for enablement (re-enable when installed-and-disabled on a non-update run; `settlePack` with `keepEnabled: true` then `enablePack`), keep every other team-authored rule. In `convergePackCache` pass `keepEnabled: true` and call `enablePack` after an `installed` outcome (all packs there are the active team's: `readServedPacks(..., { only: team })`). The migration loops `claudeConfigDirs(ctx.p, [])`, lists plugins (`parsePluginList`), and enables the active pack where `enabled === false`.
- [ ] **Step 4: Run** the four test files plus `bun test lib/setup/__tests__/update-safe.test.ts lib/setup/__tests__/migrations.test.ts lib/setup/__tests__/migration-shared-store-refusal.test.ts lib/setup/__tests__/steps-c.test.ts lib/setup/__tests__/steps-org-folder-marketplace.test.ts commands/__tests__/onboarding-org.test.ts` — expect PASS. `steps-c` asserts the "awaiting your approval" copy and the other two assert `plugin disable`: update only where the plugin is the active team's pack.
- [ ] **Step 5: Commit** `setup: install the active team's pack turned on, with a one-time fix for earlier joins`

### Task 4: One herdr launcher

**Files:**
- Create: `lib/herdr/start.ts`, `lib/herdr/login-env.ts`
- Test: `lib/herdr/__tests__/start.test.ts`, `lib/herdr/__tests__/login-env.test.ts`

**Interfaces:**
- Produces:
  - `loginShellEnv(probe?: (argv: string[]) => Promise<{ exitCode: number; stdout: string }>): Promise<Record<string, string>>` — PATH, HOME, SHELL, TMPDIR, LANG from `zsh -lc` (the same probe `bg-service.ts`'s `seededEnv` runs today; move it here), empty object on failure.
  - `herdrServerEnv(caller: Record<string, string | undefined>, login: Record<string, string>, extra?: Record<string, string>): Record<string, string>` — spec §7's env, `extra` applied before `HERDR_MACOS_SERVER_CONTEXT=user`. Each of PATH, HOME, SHELL, TMPDIR, LANG comes from `login` when present, else from `caller` (a failed login probe must not leave herdr without a PATH or HOME; today's `seededEnv` falls back the same way).
  - `type HerdrStartResult = { state: "running"; bin: string } | { state: "started"; bin: string } | { state: "not-installed"; bin: string } | { state: "failed"; bin: string; detail: string }`
  - `interface HerdrStartSeams { ping(sock: string): Promise<boolean>; resolveBin(): string; exists(path: string): boolean; loginEnv(): Promise<Record<string, string>>; spawn(argv: string[], env: Record<string, string>, cwd: string): void; sleep(ms: number): Promise<void>; now(): number; env: Record<string, string | undefined>; home: string }`
  - `createHerdrStarter(seams?: Partial<HerdrStartSeams>, opts?: { socketPath?: string; extraEnv?: Record<string, string>; readyTimeoutMs?: number; cooldownMs?: number }): { start(): Promise<HerdrStartResult> }`
  - `startHerdr(): Promise<HerdrStartResult>` — the process-wide default starter (one instance, so in-flight starts are shared).
  - Copy: `HERDR_NOT_INSTALLED = "herdr isn't installed. Open mattstack Setup to install it"`.

Defaults: `ping` = `herdrAvailable` (`lib/herdr/client.ts`); `resolveBin` = `resolveHerdrBin()`; `socketPath` = `herdrSocketPath()`; `spawn` = `node:child_process` `spawn(argv[0], argv.slice(1), { detached: true, stdio: "ignore", cwd, env })` then `unref()` (detached = setsid on macOS); `readyTimeoutMs` 10_000, poll every 100 ms; `cooldownMs` 60_000 after a failed start. argv is `[bin, "server"]`.

- [ ] **Step 1: Write failing tests** (all with fake seams; no real herdr):
  - `herdrServerEnv` keeps PATH/HOME/SHELL/TMPDIR/LANG from login, USER/LOGNAME from caller, `HERDR_THEME` from caller; drops `RT_BATCH`, `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`, `NODE_OPTIONS`, `RT_HOME`; sets `HERDR_MACOS_SERVER_CONTEXT` to `"user"` even when the caller set it to something else; `extra` `{HERDR_SESSION:"bg"}` present.
  - ping true → `{state:"running"}`, no spawn.
  - leftover socket (file exists, ping false) → spawns once, then ping true → `{state:"started"}` (Review Focus 3).
  - bin missing (`exists(bin)` false) → `{state:"not-installed"}`, no spawn.
  - never comes up within `readyTimeoutMs` → `{state:"failed", detail}` naming `~/.config/herdr/herdr-server.log`; a second `start()` inside the cooldown does not spawn again and returns `failed`.
  - two concurrent `start()` calls → one spawn, both resolve `started` (Review Focus 4).
  - spawn argv is `[bin, "server"]`, cwd is home, env equals `herdrServerEnv(...)`.
  - `loginShellEnv` parses the probe output; a failing probe → `{}`; `herdrServerEnv(caller, {})` takes PATH/HOME/SHELL/TMPDIR/LANG from the caller.
- [ ] **Step 2: Run** `bun test lib/herdr/__tests__/start.test.ts lib/herdr/__tests__/login-env.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** per the interfaces.
- [ ] **Step 4: Run** the same — expect PASS.
- [ ] **Step 5: Commit** `herdr: one launcher that starts the server detached in the user context`

### Task 5: `rt herdr start`, the `herdr:start` daemon command, and agent launches

**Files:**
- Create: `commands/herdr.ts` (`herdrStart(args: string[], _ctx: CommandContext = {}, deps: { start: () => Promise<HerdrStartResult> } = { start: startHerdr }): Promise<void>`); register the module in `lib/module-registry.ts`
- Modify: `lib/command-tree-def.ts` (top-level `herdr` group, hidden, with hidden leaf `start`)
- Modify: `commands/agent-fallback.ts` (its `createAgentHandlers` call passes `startHerdr`)
- Create: `lib/daemon/handlers/herdr.ts` (`createHerdrHandlers(opts: { start?: () => Promise<HerdrStartResult> })` → `{ "herdr:start": (payload: unknown) => Promise<CommandResult<"herdr:start">> }`); spread in `lib/daemon/command-router.ts`
- Modify: `packages/rt-client/src/commands.ts` (`"herdr:start": { payload: Record<string, never>; data: { state: "running" | "started" | "not-installed" | "failed"; bin: string; detail?: string } }` declared in rt-client itself, which cannot import `lib/`; add to `COMMAND_NAMES`), `packages/rt-client/src/client.ts` (`herdrStart(o?: RtClientOptions)`, timeout 15_000), re-export from `index.ts`
- Modify: `lib/daemon/handlers/agent.ts` (opts gains `startHerdr?: () => Promise<HerdrStartResult>`; absent means no start, so the existing handler tests never spawn a real herdr; before building the runner when `rec.surface === "herdr"` and there is no `extra.herdrSocket`, await it; `not-installed`/`failed` returns `{ ok: false, error: <detail or HERDR_NOT_INSTALLED> }` without touching herdr). Only `command-router.ts` and `agent-fallback.ts` pass the real `startHerdr`.
- Test: `commands/__tests__/herdr.test.ts`, `lib/daemon/__tests__/herdr-handlers.test.ts`, `lib/daemon/__tests__/agent-handlers.test.ts`, plus whatever the `COMMAND_NAMES` pins require (`lib/daemon/__tests__/rt-client-commands.test.ts`, `packages/rt-client/test/*.test.ts`)

**Interfaces:**
- Consumes: Task 4's `startHerdr`, `HerdrStartResult`, `HERDR_NOT_INSTALLED`.
- Produces: verb `rt herdr start [--json]` (`hidden: true`, `omitBehavior: { exempt: "agent- and app-facing; never prompts" }`, `args: [JSON flag]`); `--json` prints `out.json({ contract: 1, at, ...result })`; human output is one `out.line` per state ("herdr is running", "Started herdr", failure → `UserActionableError` with `next: "Open mattstack Setup"` for not-installed, the detail for failed); exit 0 for running/started, 2 otherwise. Daemon command `"herdr:start"`; rt-client `herdrStart`.

- [ ] **Step 1: Write failing tests:** the verb's three outcomes via an injected starter seam (`herdrStart(args, deps = { start: startHerdr })`), `--json` envelope keys; `herdr:start` handler returns the starter's result as `data`; agent:start with a fake starter returning `not-installed` → `ok:false` with `HERDR_NOT_INSTALLED` and the fake herdr runner never called; with `running` → launches as before; with an `extra.herdrSocket` (bg) → starter not called.
- [ ] **Step 2: Run** those files — expect FAIL.
- [ ] **Step 3: Implement**; `command-router.ts` passes `startHerdr` into `createAgentHandlers`.
- [ ] **Step 4: Run** `cd packages/rt-client && bun run build`, then the test files plus `bun test lib/__tests__/command-tree*.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/module-registry.test.ts scripts/__tests__/docs-coverage.test.ts lib/__tests__/no-raw-output.test.ts lib/daemon/__tests__/rt-client-commands.test.ts` and `cd packages/rt-client && bun test`; run `bun run scripts/gen-docs.ts` if the docs gate asks for regenerated reference pages — expect PASS. A test that dispatches the real verb through `dispatch` (not calling `herdrStart` directly) proves the `_ctx` position.
- [ ] **Step 5: Commit** `rt herdr start: hidden verb and daemon command; agent launches start herdr first`

### Task 6: Board and gitq start herdr and find a Homebrew herdr

**Files:**
- Modify: `apps/board/src/herdr.ts`, `apps/gitq/src/server/herdr.ts`
- Test: `apps/board/src/__tests__/herdr.test.ts`, `apps/gitq/tests/board-herdr.test.ts`

**Interfaces:**
- Consumes: rt-client `herdrStart` (Task 5).
- Produces in each app: `herdrBin(env = process.env, exists = existsSync): string` — `HERDR_BIN`, then the first existing of `~/.local/bin/herdr`, `/opt/homebrew/bin/herdr`, `/usr/local/bin/herdr`, else `~/.local/bin/herdr`; `defaultRunner` uses it per call. `ensureHerdr(start = herdrStart): Promise<void>` — calls the daemon, ignores a daemon that is unreachable (the launch then fails as today), throws `Error(data.detail ?? "herdr isn't installed. Open mattstack Setup to install it")` on `not-installed`/`failed`.
- Board: `launchLegacyResume` and the private `launchInWorkspace` call `ensureHerdr()` first; gitq's `launchInWorkspace` does too. `focusTab`/`closeTab`/`sendPaneText` never do.

- [ ] **Step 1: Write failing tests:** `herdrBin` with only `/opt/homebrew/bin/herdr` existing returns it; `HERDR_BIN` wins; `launchInWorkspace` (gitq) with a fake `start` returning `not-installed` throws before the runner runs; with an unreachable daemon (`{ ok:false }`) the runner still runs.
- [ ] **Step 2: Run** `cd apps/board && bun test src/__tests__/herdr.test.ts`, `cd apps/gitq && bun test tests/board-herdr.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Thread `start` as an optional parameter with the rt-client default so tests inject it.
- [ ] **Step 4: Run** the board and gitq suites (`cd apps/board && bun test`, `cd apps/gitq && bun run test:unit`) — expect PASS.
- [ ] **Step 5: Commit** `board, gitq: start herdr before a launch and find a Homebrew herdr`

### Task 7: The app pings herdr and starts it at launch

**Files:**
- Create: `rt-tray/Sources-core/Herdr/HerdrSocketProbe.swift` (`public enum HerdrSocketProbe { public static func isListening(_ path: String) -> Bool }` — POSIX `socket(AF_UNIX)` + `connect`, true only when connect succeeds)
- Modify: `rt-tray/Sources/HerdrBridge.swift` (`checkAvailable` keeps the `HERDR_ENV` shortcut, then `HerdrSocketProbe.isListening` on `HERDR_SOCKET_PATH` or `~/.config/herdr/herdr.sock`)
- Modify: `rt-tray/Sources/AppDelegate.swift` (after `runSetupUpdateAfterLaunch` returns, `runHerdrStartAfterLaunch()`: same `setupIsComplete` guard, `rt.run(["herdr","start","--json"], stdin: nil)`, result only logged)
- Test: new `rt-tray/Tests/MattstackCoreChecks/HerdrSocketProbeChecks.swift`, registered in `AllChecks.swift`

- [ ] **Step 1: Write failing checks:** a temp dir with a bound+listening unix socket → `true`; a regular file at the path → `false`; a socket file whose listener closed → `false`; no file → `false`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd rt-tray && swift run mattstack-checks && swift build` — expect PASS.
- [ ] **Step 5: Commit** `tray: ping herdr's socket, and start herdr after launch`

### Task 8: The background herdr uses the shared launcher

**Files:**
- Modify: `lib/daemon/bg-service.ts`
- Test: `lib/daemon/__tests__/bg-service.test.ts`

**Interfaces:**
- Consumes: Task 4's `herdrServerEnv`, `loginShellEnv`.
- Produces: `createBgService` unchanged publicly; `serverArgv` becomes `[bin, "server"]` spawned detached (same `node:child_process` call as Task 4, cwd home), env `herdrServerEnv(process.env, await loginShellEnv(), { HERDR_SESSION: BG_SESSION })`. `HERDR_SOCKET_PATH` must be absent (today's `envWithoutSocket` strips it; `HERDR_SESSION=bg` makes the server bind `sessions/bg/herdr.sock`). Server stdout/stderr previously went to `bg-service.log` through `nohup >>`; with `stdio: "ignore"` herdr's own `herdr-server.log` carries it — keep `logPath` in the timeout error message pointing at herdr's log. Cooldown, in-flight dedupe and ready poll stay.

- [ ] **Step 1: Update the tests** asserting `serverArgv`/spawn argv and env: argv `[bin, "server"]`, env has `HERDR_MACOS_SERVER_CONTEXT: "user"` and `HERDR_SESSION: "bg"`, no `RT_BATCH`, no `HERDR_SOCKET_PATH` even when the caller's env has one.
- [ ] **Step 2: Run** `bun test lib/daemon/__tests__/bg-service.test.ts` — expect FAIL.
- [ ] **Step 3: Implement**; delete the module-private `envWithoutSocket` and the in-file `seededEnv` probe now in `login-env.ts`.
- [ ] **Step 4: Run** the bg-service tests plus `bun test lib/daemon/__tests__/herd-handlers.test.ts lib/daemon/__tests__/agent-handlers.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `bg herdr: start through the shared launcher in the user context`

### Task 9: Clone progress

**Files:**
- Create: `lib/setup/git-progress.ts`
- Modify: `lib/setup/contract.ts` (`ApplyEvent` gains `{ event: "progress"; id: EventId; label: string; percent: number; note?: string }`)
- Modify: `lib/setup/apply.ts` (`ApplyContext.progress(id: EventId, p: { label: string; percent: number; note?: string }): void`, emits through the wrapped emit)
- Modify: `lib/setup/probes.ts` (`Probes.execStreaming(argv, opts: ExecOpts & { onStderr: (chunk: string) => void }): Promise<ExecResult>`; real impl reads stderr incrementally, still returns the full result, same 124/127 codes as `execWithTimeout`) and `lib/setup/__tests__/fakes.ts` (fake replays a scripted stderr through `onStderr` then returns the scripted result). `steps-a.test.ts`'s `realFsProbes()` overrides only `exec`: override `execStreaming` there too, or its clone tests reach a real `git clone`.
- Modify: `lib/setup/steps/repos.ts` (`cloneInto` uses `execStreaming` with `--progress`; per-repo running detail)
- Modify: `lib/setup/emit.ts` (a `progress` event updates the running step's last sub-line, throttled to whole-percent or phase changes)
- Modify: `rt-tray/Sources-core/Contract/ApplyEvents.swift` (`case progress(id: String, label: String, percent: Int, note: String?)`), `rt-tray/Sources-core/Install/InstallRunModel.swift` (`InstallStep.progress: StepProgress?`; reducer sets it on `.progress`, clears it when the step leaves `running`), `rt-tray/Sources/Setup/Screens/InstallScreen.swift` (under a running step with progress: `ProgressView(value:)` linear, then a caption row: label + percent left, note right, per the "R · Install" board)
- Test: `lib/setup/__tests__/git-progress.test.ts`, `lib/setup/__tests__/steps-a.test.ts` (repos.clone), `lib/setup/__tests__/emit.test.ts`, `rt-tray/Tests/MattstackCoreChecks/InstallRunChecks.swift`, `commands/__tests__/setup-copy.test.ts` if it pins events

**Interfaces:**
- Produces: `parseGitProgress(line: string): { label: string; percent: number; note?: string } | null`; `splitProgressLines(chunk: string): string[]` (git separates updates with `\r`).

- [ ] **Step 1: Write failing tests:**
  - `parseGitProgress("Receiving objects:  42% (4200/10000), 1.21 GiB | 18.40 MiB/s")` → `{label:"Receiving objects", percent:42, note:"1.21 GiB · 18.40 MiB/s"}`; `"Resolving deltas: 100% (900/900), done."` → `{label:"Resolving deltas", percent:100}`; `"Cloning into 'acme-api'..."` → null; `"remote: Enumerating objects: 5, done."` → null; a translated line without `%` → null (Review Focus 5).
  - repos.clone with a fake `execStreaming` whose stderr is `"Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/10)\r"` emits two `progress` events for `repos.clone`, a `step` running event whose detail is `"Cloning acme-api (1 of 1)"`, and the argv contains `--progress`; a clone with no parseable lines still ends `done`.
  - emit: a `progress` event at a terminal updates one sub-line; percent 42 then 42 again emits once.
  - Swift: `ApplyEvent.decode(#"{"event":"progress","id":"repos.clone","label":"Receiving objects","percent":42,"note":"1 GiB"}"#)` → `.progress(...)`; reducer sets `steps[i].progress` and clears it on `step` done.
- [ ] **Step 2: Run** the TS files and `cd rt-tray && swift run mattstack-checks` — expect FAIL.
- [ ] **Step 3: Implement.** The per-repo detail: `Cloning <basename> (<n> of <total>)`, plus ` · <found-names> was already on this Mac` / `were already on this Mac` when earlier repos were found rather than cloned.
- [ ] **Step 4: Run** the same plus `bun test lib/setup/__tests__/apply.test.ts lib/__tests__/no-raw-output.test.ts` — expect PASS.
- [ ] **Step 5: Render and look:** render an install step row running with progress (42%, "Receiving objects", "1.21 GiB · 18.4 MiB/s") in light and dark via the snapshot path; compare with the "R · Install" board.
- [ ] **Step 6: Commit** `setup: show git's clone progress under the running step`

### Task 10: Repo placement core and `rt setup repo place`

**Files:**
- Create: `lib/setup/repo-placement.ts`
- Modify: `commands/setup.ts` (`setupRepoPlace(args: string[], _ctx: CommandContext = {}, deps: RepoPlaceDeps = realRepoPlaceDeps())`, deps shaped like `RepoRootDeps`), `lib/command-tree-def.ts` (`setup repo place`; the identity positional is `optional: true` because the app uses the stdin form)
- Modify: `lib/setup/__tests__/fakes.ts` (move `steps-a.test.ts`'s local `gitRepo()` and `realFsProbes()` helpers here, exported; steps-a imports them)
- Test: `lib/setup/__tests__/repo-placement.test.ts`, `commands/__tests__/setup-repo-place.test.ts`

**Interfaces:**
- Produces:
  - `type PlacementMode = "checkout" | "clone"`; `interface Placement { mode: PlacementMode; path: string }`
  - Staging file `~/.mattstack/rt/repo-placements.json`, `{ "placements": { "<identity>": { "mode", "path" } }, "deferred": ["<identity>"] }`, mode 0o600: `readPlacements(p): { placements: Record<string, Placement>; deferred: string[] }`, `writePlacement(p, identity, placement): void` (also drops the identity from `deferred`), `clearPlacement(p, identity): void`, `markDeferred(p, identity): void`, `clearDeferred(p, identity): void`. It is rt's own runtime file, so it is written before and after Install alike (no home-repo guard needed).
  - `isReusableCloneOf` moves here from `steps/repos.ts` (exported; `repos.ts` imports it).
  - `findCheckout(p, identity, opts: { rootPaths: string[] }): Promise<string | null>` — the index row, then direct children of `rootPaths`, then direct children of `CANDIDATE_ROOT_NAMES` under home and the repo index's inferred roots; each candidate must pass `isReusableCloneOf`.
  - `defaultPlacement(p, identity, ctx: { rootPaths: string[]; placedParents: string[] }): Promise<Placement & { found: boolean }>` — a found checkout, else clone at `join(placedParents[0] ?? rootPaths[0] ?? detectCandidate(p) ?? join(home, "Documents/GitHub"), repoBasename(identity))`. The rows (Task 11) and `repos.clone` both call this, so an untouched row and the clone agree.
  - `checkCheckout(p, identity, raw: string): Promise<{ ok: true; path: string } | { ok: false; detail: string }>` — expands `~`, strips a trailing slash, resolves symlinks for the identity check but returns the path as given (Review Focus 2). Details (exact copy): not a git checkout but has a direct child that is one → `"<path> holds repos but isn't one. Choose the <basename> folder inside it."`; a clone of another identity → `"<path> is your <otherBasename> checkout, not <basename>."` when that identity is tracked, else `"<path> is a checkout of <otherIdentity>, not <basename>."`; otherwise → `"<path> isn't a git checkout."`. Paths print with `~` for home.
  - `checkCloneTarget(p, raw: string, taken: { identity: string; path: string }[]): { ok: true; path: string } | { ok: false; detail: string }` — refuses an existing non-empty folder (`"<path> already exists. Choose an empty or new folder."`) and a path another identity already uses (`"<path> is where <otherBasename> goes. Choose another folder."`, Review Focus 1); an existing empty folder and a missing parent are fine.
  - Verb `rt setup repo place <identity> (--checkout <path> | --clone-to <path>) [--json]`; stdin form `{"identity","mode","path"}` when no positional (the app's channel, like `repo-root set`). Validates with the checks above (taken = the other tracked repos' placements or defaults), then `writePlacement`. `--json` envelope `{ contract: 1, at, identity, mode, path }`. Failures are `UserActionableError` with the check's detail (exit 2), which the app shows under the row. `rt setup repo-root set` is untouched.

- [ ] **Step 1: Write failing tests** on a real temp filesystem (`realFsProbes()` + `gitRepo()` from `fakes.ts`; `isReusableCloneOf` runs real git, so `fakeProbes` cannot model a checkout): each `checkCheckout` message; trailing-slash, `~` and a symlink to the checkout accepted; `defaultPlacement` found vs clone path from `placedParents`, then `rootPaths`, then the candidate; `findCheckout` hits a clone under `~/code` with no roots configured; `checkCloneTarget` collision between `gitlab.com/a/api` and `github.com/b/api`, and an existing empty folder accepted; the verb writes the staging file and prints the envelope; the stdin form works; a bad path exits 2 with the detail; `writePlacement` removes the identity from `deferred`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/repo-placement.test.ts commands/__tests__/setup-repo-place.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** those plus `bun test lib/setup/__tests__/steps-a.test.ts lib/__tests__/command-tree*.test.ts lib/__tests__/picker-conformance.test.ts scripts/__tests__/docs-coverage.test.ts lib/__tests__/no-raw-output.test.ts` — expect PASS.
- [ ] **Step 5: Commit** `setup: repo placement core and rt setup repo place`

### Task 11: `repos.clone` honours placements; one row per tracked repo (rt side and Swift contract)

**Files:**
- Modify: `lib/setup/steps/repos.ts`, `lib/setup/apply.ts` (`ApplyContext.appDriven?: boolean`, flag `appDriven?: boolean` in `createApplyContext`), `commands/setup.ts` (`setupApply` passes `appDriven: json`)
- Create: `lib/setup/validators/repos.ts` (`repoPlacementRows(p, team: OrgRef, snapshot: TeamSnapshot): Promise<Row[]>`)
- Modify: `lib/setup/contract.ts` (Action variant `{ type: "place-repo"; label: string; identity: string; repo: string; mode: PlacementMode; checkoutPath: string | null; clonePath: string; note: string; problem: string | null; then: string[] | null }`; `DONE_ACTION_TYPES` gains `"place-repo"`; finish gating accepts ids starting `repos.place:`), `lib/setup/plan.ts` (rows replace `repoRootRow`), `lib/setup/regroup.ts` (group `repos`, title "Your repos", before `rt` in `SPLIT_ORDER`), `lib/setup/finish-gate.ts` if it keys on `FINISH_GATED_ROW_IDS`
- Modify (Swift contract, same task per Global Constraints): `rt-tray/Sources-core/Contract/PlanModels.swift` (`ActionType.placeRepo = "place-repo"`; `RowAction` gains `identity`, `repo`, `mode`, `checkoutPath`, `clonePath`, `note`, `problem`, `then`), `rt-tray/Sources-core/Readiness/RowActionDispatcher.swift` (without values → new `DispatchedAction.placeRepo(RowAction)`; with `fieldValues ["mode","path"]` → `.rtVerb(["setup","repo","place","--json"], stdin: {"identity","mode","path"})`), `rt-tray/Sources-core/Setup/FinishGate.swift` (`DoneActions.route` handles `.placeRepo`, returning nil like `chooseFolder`)
- Delete: `lib/setup/validators/repo-root.ts` and `lib/setup/__tests__/validators-repo-root.test.ts` (the verb and `lib/setup/repo-root.ts` stay)
- Test: `lib/setup/__tests__/validators-repos.test.ts`, `steps-a.test.ts`, `plan.test.ts`, `regroup.test.ts`, `commands/__tests__/setup-copy.test.ts`, `commands/__tests__/setup-plan.test.ts`, `rt-tray/Tests/MattstackCoreChecks/PlanModelsChecks.swift`, `RowActionChecks.swift`, `DoneModelChecks.swift` (the `DONE_ACTION_TYPES` parity check, ~355)

**Interfaces:**
- Consumes: Task 10's functions; Task 9's `execStreaming` and per-repo running detail (keep both when rewriting the loop).
- Row per tracked identity (skipping `RT_SKIP_REPOS`): id `repos.place:<identity>`, kind `"tool"`, title `<basename>`, why `<host/group>` (the identity minus its basename), required `false`, recheck `"on-activate"`, action `place-repo` with `label` "Locate…" (checkout) / "Choose location…" (clone), `then: null` unless deferred. Status and note, first match wins:
  1. identity in `deferred` and not yet in the repo index → `needs-you`, `finishGated: true`, `waivable: false`, note `"Choose where your repos go"`, and `then: ["setup","apply","--only","repos.clone"]` (the app runs `then` after the place verb succeeds; `RowVerbRun` already streams `setup apply`).
  2. indexed, or placement/default is a checkout that passes `checkCheckout` → `ready`, note `"Found your <basename> checkout"`.
  3. placement is a checkout that now fails (moved since) → `needs-you`, `problem` = the check's detail, label "Locate again…".
  4. clone whose target fails `checkCloneTarget` (Review Focus 1 collision, or the folder filled up) → `needs-you`, `problem` = the detail.
  5. clone → `ready`, note `"rt clones it here when you click Install"`.
  - Rows render whenever `snapshot.trackingIdentities` is non-empty; a joiner's pre-Install plan has none.
- `repos.clone` per identity, in order: (1) placement → checkout: index it (`indexDest`); clone: `mkdirp(dirname(path))`, then clone into exactly that path (an existing empty folder is used, not treated as a collision); (2) no placement, `findCheckout` hit → index it; (3) no placement, no hit, `ctx.appDriven && ctx.intent?.mode === "join"` → `markDeferred`, skip; (4) else `defaultPlacement` → clone. After each repo lands, `clearPlacement` + `clearDeferred`, and append its parent to the machine store's `rt.repoRoots` if absent and `homeGitDir` exists (the guard `promoteStagedRepoRoot` uses). Outcome: any deferred → `{ state: "needs-you", detail: "cloned N, present M, <k> waiting for you", remedy: "Choose where your repos go in Setup" }`; else today's done/partial tallies. `promoteStagedRepoRoot` still runs first. The step no longer skips when `rt.repoRoots` is empty. Deferral survives `clearIntent` because it lives in the placements file, and the `then` retry runs `repos.clone` with `ctx.intent` gone, so step (3) no longer defers on it.
- The page footer stays the checklist's generic one (spec amended).

- [ ] **Step 1: Write failing tests:** rows for a two-repo team (one found under `~/code`, one not) match the board ("Found your widgets checkout" / clone path next to it); a moved checkout shows `problem`; colliding defaults show `problem` on the second; joiner pre-Install → no rows; a deferred identity → `needs-you` finish-gated row with `then`; after it is indexed → `ready`. repos.clone (real temp fs via `realFsProbes`, `execStreaming` overridden): placement checkout indexes without cloning; placement clone clones to the exact path, including into an existing empty folder; joiner + appDriven defers, writes `deferred`, reports `needs-you`; the same with appDriven false clones to the default; `rt.repoRoots` gains the parent and keeps an existing first entry; empty `rt.repoRoots` no longer skips. Swift: decode a `place-repo` row JSON; dispatch with values → `.rtVerb(["setup","repo","place","--json"], stdin)` whose JSON is `{"identity":"gitlab.com/acme/widgets","mode":"checkout","path":"/Users/dev1/code/widgets"}`; without values → `.placeRepo`; parity check passes. Snapshot updates in `setup-copy.test.ts` (deliberate `--update-snapshots`) showing `repos.root` gone and `repos.place:*` rows.
- [ ] **Step 2: Run** the listed TS files and `cd rt-tray && swift run mattstack-checks` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the listed files plus `bun test lib/setup/__tests__/apply.test.ts lib/setup/__tests__/contract.test.ts lib/setup/__tests__/update-safe.test.ts`, `bun test --preload ./e2e/setup.ts e2e/tests/setup.test.ts` (fix expectations naming `repos.root`), and `cd rt-tray && swift run mattstack-checks && swift build` — expect PASS. Update `rt-tray/vm/run/guest/screens.sh` and `assert-installed.sh` where they name `repos.root`.
- [ ] **Step 5: Commit** `setup: one row per tracked repo; repos.clone honours placements`

### Task 12: The app renders the repo rows

**Files:**
- Create: `rt-tray/Sources/Setup/Screens/RepoPlacementRow.swift`, `rt-tray/Sources-core/Setup/RepoPlacementState.swift`
- Modify: `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift`, the row snapshot renderer (Global Constraints)
- Test: `rt-tray/Tests/MattstackCoreChecks/RepoPlacementStateChecks.swift` (registered in `AllChecks.swift`), plus render-and-look

**Interfaces:**
- Consumes: Task 11's `RowAction` fields and `DispatchedAction.placeRepo`.
- Produces: `RepoPlacementRow` per the "R · Your repos" board: name + host, segmented `Picker` "Current checkout" / "New checkout", monospaced read-only path text, button (`action.label`), note line (green for a ready checkout, secondary for a clone, red for `problem` or the last verb error). "Locate…" → `NSOpenPanel` directories only, prompt "Use this checkout"; "Choose location…" → `NSSavePanel`, `nameFieldStringValue = repo`, `canCreateDirectories = true`, directory = parent of `clonePath`. A pick re-dispatches with `fieldValues ["mode","path"]`; on success, when `action.then` is set, run it the same way a `run` action runs its verb. Switching the segment to New checkout records `{mode:"clone", path: clonePath}`; to Current checkout records `checkoutPath` when present, otherwise opens Locate. A refused pick (the verb exits 2): keep the picked segment, show the error (the checklist's existing per-row action error) as the red line, and label the button "Locate again…" / "Choose another location…" until a pick succeeds. `RepoPlacementState.buttonLabel(mode: String, lastError: String?) -> String` and `RepoPlacementState.noteStyle(action: RowAction, lastError: String?) -> NoteStyle` (`.ok`, `.secondary`, `.problem`) hold the pure part.

- [ ] **Step 1: Write failing checks** for `RepoPlacementState`: checkout + no error → "Locate…"; clone + no error → "Choose location…"; checkout + error → "Locate again…"; clone + error → "Choose another location…"; `problem` set → `.problem`; ready checkout → `.ok`; clone → `.secondary`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks` — expect FAIL.
- [ ] **Step 3: Implement** the helper, the view and the checklist wiring.
- [ ] **Step 4: Run** `cd rt-tray && swift run mattstack-checks && swift build` — expect PASS.
- [ ] **Step 5: Render and look:** add the repo row's states (found checkout, clone, refused pick, deferred) to the snapshot renderer; render light and dark; compare with the "R · Your repos" board and say what differs.
- [ ] **Step 6: Commit** `tray: Your repos rows with Current checkout / New checkout`

### Task 13: Docs and wrap-up

**Files:**
- Modify: user docs that describe the repo folder question or `rt setup repo-root set` as the setup step (`rg -n "Repo folder|repo-root" website/docs --glob '!**/reference/**'`), and regenerate reference pages for the new verbs (`bun run scripts/gen-docs.ts`)
- Modify: `.claude/rules/setup.md` where a sentence names `repos.root` (`rg -n "repos.root" .claude`)

- [ ] **Step 1:** Update prose to the Your repos page; regenerate docs; run the docs gate (`bun run scripts/check-docs.ts`) — expect PASS.
- [ ] **Step 2:** `bun run check` (static gates) — expect PASS.
- [ ] **Step 3: Commit** `docs: Your repos page and the herdr start verb`
