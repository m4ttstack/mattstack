# Fast Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer once, wait once, one progress bar: the setup checklist is replaced everywhere by screens P1 to P7 (plus P3c, P3r, P5s, P6b), whose rows rt works out and the tray only draws.

**Architecture:** rt owns every decision. A new `rt setup form` verb builds each screen's rows from the composed plan plus a few facts (proxy, Homebrew, background installs, CLI sign-in sessions) and says which screen setup is on (`stage`). `rt setup prepare` runs the background installs (Command Line Tools at P1, Claude Code and sign-in tools once accounts are next). `rt setup apply --resume --unattended` is the one run behind the bar: single flight, recorded step by step, resumable after a relaunch and attachable while alive, with each step's bar phase and weight in its `plan` event. CLI sign-ins (Claude, Doppler, ldcli) run as detached sessions rt can read and feed. The tray gains a small Core layer (form decoding, flow state, bar arithmetic, background runner) and one view per screen; the old wizard pages retire.

**Tech Stack:** Bun + TypeScript (rt CLI, `bun:test`), Swift 6 / SwiftUI (rt-tray, the `MattstackCore` checks harness), Swift (proxy-helper, XCTest under Xcode), Docusaurus MDX (website/docs).

**Spec:** `docs/superpowers/specs/2026-10-29-fast-setup-design.md` (binding). It builds on the base branch's spec and plan, `docs/superpowers/specs/2026-10-29-setup-onboarding-flow-design.md` and `docs/superpowers/plans/2026-10-29-setup-onboarding-flow.md`, whose approval helper, `rt setup join-status`, `board.cwds` steps and gates already landed. Mocks: row P of `docs/apps/design/setup/setup.pen`, optional; open them only through the pencil MCP (`get_app_state`, then read-only `execute`), never Read or grep the file.

## Global Constraints

- Read before touching code: root `AGENTS.md`, then the rule file for each area a task touches: `.claude/rules/setup.md`, `output-setup-and-services.md`, `output-layer.md`, `team-switchboard.md`, `settings.md`, `rt-ui.md`, `dev-app.md`, `state.md`, `command-tree.md`.
- TS tests run from the worktree root, targeted only: `bun test <file>`. Never the full suite locally; CI runs it.
- Swift checks: `cd rt-tray && swift run mattstack-checks "<name substring>"` (prints `checks: N passed, M failed`, exit 1 on failure). If `rt-tray/deps/tools/sparkle-xcframework` is missing, run `scripts/fetch-deps.sh arm64` from the worktree root once first. A new `*Checks.swift` file exposes one array and is appended to `allChecks` in `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`.
- proxy-helper tests: once per session `bash rt-tray/proxy-helper/scripts/gen-pins.sh 0.0.0-dev rt-tray/deps/arm64/portless rt-tray/deps/arm64/node/bin/node` (after `scripts/fetch-deps.sh arm64`), then `cd rt-tray/proxy-helper && swift test --filter <TestClass>`.
- A built binary (rt, rt-tray) only ever runs under an isolated HOME: `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin <binary> …`.
- Never rebuild, re-sign or reinstall `/Applications/*.app` or `rt-tray/mattstack-dev.app`.
- Every tray UI change is rendered light and dark through the DEBUG snapshot flags, every PNG is opened with the Read tool, and the task says plainly what looks wrong before it commits. Tests do not replace looking. Render command: `cd rt-tray && swift build --product rt-tray && env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin .build/debug/rt-tray --render-fast-setup-snapshots "$TMPDIR/fast"`.
- No mattstack ticket ids anywhere: code, comments, tests, commit messages.
- This repo is public: placeholders only (acme, widgets, acme-api, Mithrandir, Jane Doe, janedoe). Never a real company, team or person.
- Never stage `docs/apps/design/setup/setup.pen`. `git add` only the task's own files.
- Commit after each task: short imperative message, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The session's Bash guard refuses compound git commands: run `git add` and `git commit` as separate calls.
- No merges, pushes, releases or clean-room runs.
- A copy change updates `commands/__tests__/setup-copy.test.ts` snapshots on purpose (`bun test commands/__tests__/setup-copy.test.ts --update-snapshots`), then the diff is read and only the intended rows moved. A machine-view change (a new key in the plan, a row, an action, a step event or `--json` envelope) lands with its Swift decoding and a decode check in the same task.
- New copy follows the `rt:ui-copy` skill: short plain clauses, no dot separators, no em or en dashes. The spec's strings are used exactly:
  - P1: "Three things from macOS"; "Full Disk Access" "Reads your repos and Chrome's profile"; "Notifications" "Tells you when setup is done"; "Fancy URLs" "Grant mattstack apps permission to use .mattstack"; buttons "Open settings", "Allow".
  - P2: "How are you setting up?"; cards "Join a team", "Create a team", "Just me", "Move from another Mac".
  - P3: "Paste your invite"; "<team>, invited by <admin>"; "Create token"; "Lets mattstack reach the team's repo and open MRs" (PRs on a GitHub team); "Join".
  - P4: team name as a quiet uppercase label; "Waiting for <admin> to confirm your membership"; "Let them know you're waiting. Setup carries on the moment they approve"; "Next: a few questions, then it runs by itself"; "We'll let you know when you're in"; "Hide". Notification title "You're in".
  - P5: "You're in. Connect your accounts"; "One click each. Most open in your browser"; "Connected as <login> from your invite"; "Connect Slack" "Lets mattstack track and post PRs in Slack" (MRs on a GitLab team); "Sign in to Claude" "You know, to do agentic stuff."; "Installing…"; "Sign in" "For running your dev servers"; "So mattstack can read and write Linear tickets"; "Add to Chrome" "Lets agents drive your real Chrome" "Waiting for Chrome…" "Added"; "Get Chrome"; footer "Continue unlocks once each one is connected", "Continue".
  - P5b: "Last bit: this Mac"; "Where <team>'s repos and your settings live"; "Your repos"; "Current checkout" "Locate…"; "New checkout" "Choose…"; "The board starts here"; "Your settings" "Keep on this Mac" "Store in a remote repo" "mattstack keeps your settings in one folder. A private remote copy lets you restore them on a new Mac. You can turn this on later"; footer "About 10 minutes once you start", "Set up this Mac".
  - P6: "Setting up this Mac"; "Nothing needs you. Close the window if you like"; "Hide". P6b: "Setup paused"; "Everything before this step is done"; "Show log"; "Retry".
  - P7: "This Mac is ready"; "Go make something cool"; "Open the board".
  - P3c: "Create team". P3r: "Restore".
  - A done row draws a green check before its detail, so rt's detail carries only the words ("Added", "Connected as janedoe from your invite").
- No decision in Swift about which rows a member needs, where setup resumes, or a row's state: those come from `rt setup form`. Swift owns layout, arithmetic over rt's numbers, and native effects (opening a URL, a settings pane, a permission prompt, a folder panel).
- Nothing on P6 raises a dialog or opens a browser. A step that would asks for a person and pauses the bar (P6b) instead.
- Tasks 40 to 43 are morning spikes for the operator at the Mac. Overnight execution stops after Task 39 and does not start them.

## Review Focus

1. **A relaunch mid-bar while the old `rt setup apply` is still alive.** Sparkle is held, but a crash or a Full Disk Access reopen can still relaunch the app. The orphaned run must keep going (a closed stdout never kills it), and the relaunched app must attach to it, never start a second run. Tests: Task 11 (attach, EPIPE), Task 32 (a launch on stage `running` starts the bar with `--resume`).
2. **Any git step started while Command Line Tools are still downloading.** Join, Create team and Restore clone minutes after P1, and Just me's run refuses before its first step without git. On a fresh Mac git is Apple's stub until the background install finishes, so each screen must hold its button with the busy `tool.clt` row, never fail. Tests: Tasks 7, 10, 16, 24, 25, 26.
3. **A required row no screen shows.** herdr, a pack tool rt cannot install, a field account such as StrongDM, or a finish target the run left unfinished all block Install or Finish. Setup must land on a screen that shows the row with its own action, never on a screen with every row done (a Set up this Mac loop). Tests: Tasks 8, 10, 14.
4. **The window hidden at P4, approval hours later.** Polling must outlive the window and the "You're in" notification must bring the member back to P5. Test: Task 27.
5. **A CLI sign-in left behind.** A Claude or Doppler login whose process died, or that sat for ten minutes, must read as not started (the row offers Sign in again), never as waiting forever. Tests: Task 4, Task 8.

---

## File map

- rt, new: `lib/setup/form.ts` (form contract, copy, row builders, stage), `lib/setup/fancy-urls.ts`, `lib/setup/prepare.ts`, `lib/setup/sign-in-tools.ts`, `lib/setup/cli-login.ts`, `lib/setup/home-remote.ts`, `lib/setup/apply-run.ts` (run record, single flight, attach), `lib/setup/run-phases.ts`, `lib/team/create-repo.ts`; verbs in `commands/setup-form.ts`, `commands/setup-prepare.ts`, `commands/setup-claude.ts`.
- rt, changed: `lib/setup/contract.ts`, `apply.ts`, `need.ts`, `state.ts`, `finish-gate.ts`, `expectations.ts`, `steps/services.ts`, `steps/home.ts`, `steps/settings.ts`, `validators/tools.ts`, `validators/repos.ts`, `lib/team/join.ts`, `team-local.ts`, `create.ts`, `commands/setup.ts`, `commands/team.ts`, `lib/command-tree-def.ts`.
- Tray Core, new: `Sources-core/Contract/FormModels.swift`, `Sources-core/Setup/SetupFormModel.swift`, `FormActionRunner.swift`, `FastSetupFlow.swift`, `PrepareRunner.swift`, `Sources-core/Install/RunProgress.swift`.
- Tray app, new: `Sources/Setup/Fast/` (one file per screen, `FormRowView.swift`, `FormCard.swift`, `FastFooter.swift`, `FastSetupView.swift`, `FastSetupSnapshot.swift`).
- Tray, retired in Task 34: the old wizard screens, `SetupView.swift`, `SetupFlowModel.swift`, `WizardPages.swift`, `SetupPageSnapshot.swift`. `ChecklistScreen` stays for Settings' Accounts pane.
- proxy-helper: `Sources/ProxyInstall/HomebrewStep.swift`, `homebrew-pin.json`.

---

### Task 1: The form contract and the macOS section

**Files:**
- Create: `lib/setup/form.ts`, `lib/setup/fancy-urls.ts`, `commands/setup-form.ts`
- Modify: `lib/command-tree-def.ts` (setup node, beside `join-status`), `lib/setup/state.ts` (`SetupState.homebrew?`)
- Test: `lib/setup/__tests__/form-macos.test.ts`, `lib/setup/__tests__/fancy-urls.test.ts`, `commands/__tests__/setup-form.test.ts` (all create)

**Interfaces:**
- Produces, in `lib/setup/form.ts`:
  - `export type FormSection = "macos" | "invite" | "connect" | "this-mac"`; `export type FormRowState = "done" | "todo" | "busy" | "waiting"`.
  - `export interface FormRow { id: string; title: string; subtext: string; state: FormRowState; detail: string; action: Action | null; waiting: string | null; watch: boolean; optional: boolean }`. `waiting` is the line shown while the row's action runs; `watch` asks the app to re-read the form by itself while the row is `waiting` or `busy`; `optional` rows never hold Continue.
  - `export type FormStage = "macos" | "path" | "invite" | "waiting" | "connect" | "this-mac" | "running" | "paused" | "ready"`; `export type FormPath = "join" | "create" | "solo" | "restore"`.
  - `export interface FormPaused { step: string; title: string; detail: string; remedy: string | null }`.
  - `export interface SetupForm { path: FormPath | null; team: { slug: string; name: string; invitedBy: string | null } | null; stage: FormStage | null; sections: { macos?: FormRow[]; invite?: FormRow[]; connect?: FormRow[]; thisMac?: FormRow[] }; continueReady: boolean; startReady: boolean; paused: FormPaused | null; home: { label: string; url: string } }`.
  - `export const FORM_COPY` holding every string the Global Constraints list for P1, P3, P5 and P5b rows (titles, subtexts, button labels, waiting lines, "Installing…").
  - `export function macosRows(i: { permissions: Row[]; notifications: PermissionsReply["notifications"]["status"] | null; fancyUrls: FancyUrls }): FormRow[]`, ids `perm.fda`, `perm.notifications`, `mac.fancy-urls` in that order. Notifications' answer comes from the tray's reply status (`denied` vs `notDetermined`), never from a row's detail text.
  - `export async function composeForm(p: Probes, opts: { sections: FormSection[]; secrets: SecretPresence; orgs: string[] }): Promise<SetupForm>`. This task fills `macos` only and leaves `stage: null`; later tasks add sections and the stage.
- Produces, in `lib/setup/fancy-urls.ts`:
  - `export async function brewInstalled(p: Pick<Probes, "exists">): Promise<boolean>`: `/opt/homebrew/bin/brew` or `/usr/local/bin/brew` exists.
  - `export interface FancyUrls { state: "done" | "todo"; detail: string; brewMissing: boolean }` and `export async function fancyUrlsState(p: Probes): Promise<FancyUrls>`: done once the proxy is installed and its certificate trusted and Homebrew is present or was already attempted (`SetupState.homebrew` records any outcome); a failed attempt stays done with the detail "Homebrew did not install. Tools that need it say so on their own rows", so P1 never re-raises the admin dialog for it.
  - `SetupState.homebrew?: { at: string; outcome: "ok" | "present" | "failed"; detail?: string }` (Task 2 writes it).
- Produces: `rt setup form [--section <macos|invite|connect|this-mac>] [--json]`, handler `setupForm(args, ctx?, deps?: FormDeps)` with `export interface FormDeps { probes: Probes; secrets: SecretPresence; json: (v: unknown) => void; exit: (code: number) => never; orgs?: () => string[] }`. `--json` prints `envelope(SetupForm)`; without `--section` every section is composed. Human output: one `out.line` per row (`rowStatus` mapping: done → done, busy/waiting → pending, todo → needs-you).

- [ ] **Step 1: Write the failing tests.**
  - `fancy-urls.test.ts` (`fakeProbes({ files, exec })`): `"a dev build with no proxy helper reads done, so P1 never waits on it"` (`proxyInstallerMissing` true → `state: "done"`, detail `PROXY_INSTALLER_MISSING`); `"proxy installed, certificate trusted and Homebrew present reads done"`; `"a trusted proxy without Homebrew, never attempted, is still to do"` (`brewMissing: true`, `state: "todo"`); `"a failed Homebrew attempt does not hold P1"` (state `done`, the failure in the detail); `"an untrusted certificate is still to do"`; `"no proxy at all is to do"`.
  - `form-macos.test.ts`: `"the three macOS rows come in order with the spec's words"` (titles and subtexts deep-equal the P1 strings); `"Full Disk Access not granted offers Open settings for the fda pane"` (action `{ type: "open-settings", label: "Open settings", target: "fda" }`); `"notifications not asked yet offer Allow"`; `"notifications denied count as answered"` (reply status `denied` → state `done`, detail "Turned off", action opens the notifications pane); `"a not-yet-asked status is to do whatever the row's words say"`; `"fancy URLs to do offers Allow, which runs proxy.install"` (action deep-equals `applyStepAction("Allow", "proxy.install")`, `waiting: "Waiting for your admin password in the macOS dialog…"`); `"granted rows are done with no action"`.
  - `setup-form.test.ts` (injected deps): `"--section macos --json prints the envelope with only the macos section"` (keys `contract`, `at`, `sections.macos` of length 3, no `connect`); `"an unknown section is a usage error"` (exit 2, code `bad-section`).
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/fancy-urls.test.ts lib/setup/__tests__/form-macos.test.ts commands/__tests__/setup-form.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement.** `fancyUrlsState` reads `PORTLESS_LAUNCHD_PLIST`, `deployedProxyVersion`, `proxyCaIsTrusted`, `proxyInstallerMissing` from `lib/setup/steps/services.ts` and `brewInstalled`. `macosRows` maps `perm.fda` from `permissionRows` (ready → done, else todo with "Open settings") and `perm.notifications` from the reply status (`authorized`/`provisional` → done; `denied` → done "Turned off"; anything else → todo with "Allow"), and builds `mac.fancy-urls` from `FancyUrls`. `composeForm` for `macos` calls `fetchPermissions(p.tray)` once (feeding both the rows and the status) and `fancyUrlsState(p)` only, never `composePlan`, so the screen can re-read it every few seconds. The command-tree node is `form: { description: "Show the questions setup still needs answered", module: "./commands/setup-form.ts", fn: "setupForm", hidden: true, args: [SETUP_JSON_ARG, { name: "Section", flag: "--section", type: "string", hint: "Only this part: macos, invite, connect or this-mac" }] }`.
- [ ] **Step 4: Run** the three test files, then `bun test lib/__tests__/command-tree*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `setup: rt setup form, with the three macOS rows`.

### Task 2: Homebrew rides the Fancy URLs admin prompt

**Files:**
- Modify: `lib/setup/contract.ts` (`NeedRequest`), `lib/setup/steps/services.ts` (`proxyInstallRun`, `proxyTrustOnly`, new `withHomebrewOutcome`, writes `SetupState.homebrew`), `commands/setup.ts` (`gateHardPreconditions`, `setupApply`), `rt-tray/Sources-core/Contract/ApplyEvents.swift` (`NeedRequest.homebrew`)
- Test: `lib/setup/__tests__/steps-b.test.ts`, `commands/__tests__/setup-apply.test.ts`, `rt-tray/Tests/MattstackCoreChecks/NeedModelsChecks.swift`

**Interfaces:**
- Consumes: `brewInstalled` (Task 1).
- Produces:
  - `NeedRequest` app-privileged becomes `{ type: "app-privileged"; op: "proxy-install" | "proxy-remove" | "proxy-trust" | "homebrew"; homebrew?: true }`. `homebrew: true` asks the helper to install Homebrew in the same escalation; op `homebrew` installs only Homebrew. Swift `NeedRequest` gains `homebrew: Bool?`.
  - The helper reports `MATTSTACK_HOMEBREW=ok|present|failed` on its own line (Task 36 writes it). `withHomebrewOutcome(outcome: StepOutcome): StepOutcome` keeps a done step done and prefixes "Homebrew did not install (<state>)" to its detail on `failed`. Every request that carried Homebrew records `SetupState.homebrew = { at, outcome, detail? }` from that line (a missing line records `failed`, detail "The helper did not report on Homebrew").
  - Homebrew is asked for only while `SetupState.homebrew` is absent: once any attempt is recorded, neither a P1 Allow nor the bar's `proxy.install` asks again, so an unattended run never pauses on it.
  - `const HARD_PRECONDITION_FREE_STEPS: ReadonlySet<StepId> = new Set(["proxy.install"])` in `commands/setup.ts`: an `--only` run of one of these skips `gateHardPreconditions` (no git, no slow plan before the dialog).

- [ ] **Step 1: Write the failing tests.**
  - `steps-b.test.ts`, `describe("proxy.install and Homebrew")`: `"a fresh install asks for Homebrew in the same prompt when brew is missing"` (need request deep-equals `{ type: "app-privileged", op: "proxy-install", homebrew: true }`); `"with brew present the install asks for the proxy alone"` (no `homebrew` key); `"an installed, current, trusted proxy without brew asks for Homebrew only"` (op `homebrew`); `"everything in place raises no prompt"` (no need, `done` "Already installed"); `"a Homebrew failure keeps the step done and says so"` (reply detail carries `MATTSTACK_HOMEBREW=failed` → done, detail starts "Homebrew did not install"); `"the Homebrew outcome is recorded"` (`readSetupState(p).homebrew.outcome === "failed"`); `"a recorded attempt never asks for Homebrew again"` (brew still missing, record present, proxy in place → no need, done).
  - `setup-apply.test.ts`: `"--only proxy.install skips the hard-precondition gate"` (a `planForGate` that would refuse with `tool.clt` is never called); `"a full run still refuses without Command Line Tools"`.
  - `NeedModelsChecks.swift`: `Check("NeedModels: an app-privileged need's homebrew flag decodes, and absent reads nil")`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/steps-b.test.ts commands/__tests__/setup-apply.test.ts` and `cd rt-tray && swift run mattstack-checks NeedModels`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `setupApply`, resolve the step selection before the gate and skip the gate when `selection.only` is in `HARD_PRECONDITION_FREE_STEPS`. In `proxyInstallRun`, compute `const askBrew = !(await brewInstalled(ctx.p)) && readSetupState(ctx.p).homebrew === undefined` once; add `homebrew: true` to the install and trust requests when it is true; when the proxy needs neither install nor trust and `askBrew`, send op `homebrew`; pass every done outcome through `withHomebrewOutcome` after `withTrustOutcome`, then record the outcome.
- [ ] **Step 4: Run** the commands from Step 2, plus `bun test lib/setup/__tests__/need.test.ts lib/setup/__tests__/contract.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `setup: Homebrew rides the proxy's admin prompt, and Allow skips the slow gate`.

### Task 3: `rt setup prepare`, the background installs

**Files:**
- Create: `lib/setup/prepare.ts`, `lib/setup/sign-in-tools.ts`, `commands/setup-prepare.ts`
- Modify: `lib/command-tree-def.ts`, `lib/setup/tools-install.ts` (export `installRoute`), `lib/setup/update-lock.ts` (export `pidAlive`)
- Test: `lib/setup/__tests__/prepare.test.ts`, `lib/setup/__tests__/sign-in-tools.test.ts`, `commands/__tests__/setup-prepare.test.ts` (all create), `lib/setup/__tests__/tools-install.test.ts`

**Interfaces:**
- Produces, in `lib/setup/sign-in-tools.ts`:
  - `export const CLI_SESSION_INTEGRATIONS: readonly Integration[] = ["doppler", "ldcli"]`.
  - `export function signInTools(reqs: PackRequirements[]): ToolRequirement[]`: every pack tool whose `connect` is a CLI-session integration or a `verb` of its own, first declaration wins by name, optional tools last. A tool connecting any other integration (StrongDM, Linear) is not a sign-in tool: that integration's own account row, with its own fields, covers it (Task 8).
- Produces, in `lib/setup/tools-install.ts`: `export async function installRoute(p: Probes, tool: string, reqs: PackRequirements[], hasBrew: boolean): Promise<"bundled" | "brew" | "vendor" | null>`, the same decision `installTool` makes, without installing; null for a tool rt cannot install (a download URL, a tap formula, steps).
- Produces, in `lib/setup/prepare.ts`:
  - `export type PrepareStage = "macos" | "accounts"`.
  - `export interface PrepareRecord { stage: PrepareStage; startedAt: string; pid?: number; endedAt?: string; items: string[]; failed: { tool: string; detail: string }[] }`, kept at `~/.mattstack/rt/setup-prepare.json` (`preparePath(home)`).
  - `export function readPrepare(p: Pick<Probes, "readFile" | "home">, alive?: (pid: number) => boolean): (PrepareRecord & { running: boolean }) | null`.
  - `export async function prepareTools(p: Probes, stage: PrepareStage, reqs: PackRequirements[]): Promise<string[]>`: `macos` → `["apple-clt"]` when `xcode-select -p` fails; `accounts` → `"claude"` when `claude --version` exits 127, then `"herdr"` when `herdr --version` exits 127 (no apply step installs it), then every required pack tool (sign-in tools first, then the rest, non-optional only) whose `--version` exits 127 and whose `installRoute` is not null. A tool rt cannot install is left to its own row (Task 8).
  - `export interface PrepareResult { stage: PrepareStage; skipped?: "running"; installed: string[]; failed: { tool: string; detail: string }[] }` and `export async function runPrepare(p: Probes, stage: PrepareStage, deps: { reqs: PackRequirements[]; install?: typeof installTool; alive?: (pid: number) => boolean; pid?: number }): Promise<PrepareResult>`.
- Produces: `rt setup prepare <macos|accounts> [--json]` printing `envelope(PrepareResult)`. Hidden. Its json seam swallows a write error, and `process.stdout.on("error", () => {})` is attached under `--json`, so an app that quit mid-install never kills the install.

- [ ] **Step 1: Write the failing tests.**
  - `sign-in-tools.test.ts`: `"pack tools with a sign-in, once each, optional ones last"`; `"a tool with no connect is not a sign-in tool"`; `"a pack tool connecting StrongDM is not a sign-in tool"`.
  - `tools-install.test.ts`: `"installRoute names brew for a plain formula with brew present"`; `"installRoute is null for a download-only tool"`.
  - `prepare.test.ts`: `"macos installs Command Line Tools only when xcode-select fails"`; `"accounts installs Claude Code, herdr, then the team tools rt can install"` (fake `install` sees `["claude", "herdr", "doppler", "jq"]` in that order, `jq` a required pack tool with a brew formula); `"a team tool rt cannot install is left for its row"` (a download-only tool is never passed to `install`); `"a second run while one is alive skips, naming it running"` (record with a live pid → `skipped: "running"`, `install` never called); `"a record whose pid died is not running"`; `"a failed install is recorded with its detail and the rest still run"`; `"the record carries the items while it runs and loses its pid when it ends"`.
  - `setup-prepare.test.ts`: `"--json prints the result envelope"`; `"an unknown stage is a usage error"` (code `bad-stage`); `"a json write that throws does not stop the run"` (json seam throws on first call; `install` still called for every tool).
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/prepare.test.ts lib/setup/__tests__/sign-in-tools.test.ts commands/__tests__/setup-prepare.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write the record (with `pid`, `items`) before the first install and rewrite it after each install, then drop `pid` and set `endedAt` at the end; writes go through `p.writeFile` to a temp path and `p.rename`. `installTool` from `lib/setup/tools-install.ts` does each install (claude through its own script, sign-in tools through brew, CLT through `softwareupdate`). The liveness check reuses the `pidAlive` shape from `lib/setup/update-lock.ts` (move it to an exported `pidAlive` there and import it).
- [ ] **Step 4: Run** the three files and `bun test lib/__tests__/command-tree*.test.ts lib/setup/__tests__/update-lock.test.ts lib/setup/__tests__/tools-install.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `setup: rt setup prepare runs the installs setup can do in the background`.

### Task 4: CLI sign-in sessions

**Files:**
- Create: `lib/setup/cli-login.ts`
- Test: `lib/setup/__tests__/cli-login.test.ts` (create)

**Interfaces:**
- Produces:
  - `export type LoginTool = "claude" | "doppler" | "ldcli"`.
  - `export interface LoginSpec { argv(input: { email?: string }): string[]; urlPattern: RegExp; codePattern: RegExp | null; promptPattern: RegExp | null }` and `export const LOGIN_SPECS: Readonly<Record<LoginTool, LoginSpec>>`: claude `["claude", "auth", "login", ...(email ? ["--email", email] : [])]`, url `/https:\/\/\S+/`, code null, prompt `/paste/i`; doppler `["doppler", "login", "--yes"]`, url `/https:\/\/\S*doppler\.com\S*/`, code `/auth code[^:\n]*:\s*([A-Za-z0-9-]+)/i`, prompt null; ldcli `["ldcli", "login"]`, url `/https:\/\/\S*launchdarkly\S*/`, code null, prompt null. The morning spikes (Tasks 40, 41) confirm the flags and patterns.
  - `export interface LoginSession { tool: LoginTool; pid: number; startedAt: string; logPath: string; fifoPath: string; url: string | null; code: string | null; prompt: boolean }`, recorded at `~/.mattstack/rt/logins/<tool>.json` (`loginSessionPath(home, tool)`).
  - `export const LOGIN_TTL_MS = 10 * 60 * 1000`.
  - `export interface LoginSeams { spawnDetached(argv: string[], io: { fifo: string; log: string }): number | null; alive(pid: number): boolean; kill(pid: number): void; mkfifo(path: string): boolean; writeFifo(path: string, text: string): boolean }` and `export function realLoginSeams(): LoginSeams`.
  - `export async function startLogin(p: Probes, tool: LoginTool, opts: { email?: string; seams?: LoginSeams; waitMs?: number }): Promise<LoginSession | null>`: reuses a live session younger than `LOGIN_TTL_MS`, kills an older one, else spawns a new one; waits up to `waitMs` (default 3000) for the log to show a URL; null when the spawn failed.
  - `export function readLogin(p: Probes, tool: LoginTool, seams?: LoginSeams): LoginSession | null`: null when there is no record, the pid is dead, or it is older than `LOGIN_TTL_MS` (killed then); re-reads the log for `url`, `code`, `prompt`.
  - `export function sendLoginInput(p: Probes, tool: LoginTool, line: string, seams?: LoginSeams): boolean` and `export function endLogin(p: Probes, tool: LoginTool, seams?: LoginSeams): void`.

- [ ] **Step 1: Write the failing tests** (a fake `LoginSeams` that records argv, returns pid 4242, and a log file seeded through `fakeProbes({ files })`):
  - `"a new login spawns the tool under script with its own fifo and log"` (argv deep-equals `["/bin/sh", "-c", <the wrapper in Step 3>, "sh", <fifo path>, "claude", "auth", "login"]`, and the wrapper string contains `/usr/bin/script -q /dev/null "$@"`; record written with pid 4242).
  - `"the email is passed when known"` (`--email jane@example.com` in the argv).
  - `"a live, young session is reused, not spawned again"`.
  - `"a session whose pid died reads as none"` (`readLogin` → null).
  - `"a session older than ten minutes is killed and replaced"` (`kill(4242)` recorded, a new spawn).
  - `"the url, the doppler code and the paste prompt are read from the log"` (log `Your auth code is: ABC-123\nhttps://dashboard.doppler.com/workplace/auth/cli` → `code: "ABC-123"`, `url` set).
  - `"input goes to the fifo with a newline"`.
  - `"ending a login kills it and removes its record"`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/cli-login.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The spawn wrapper opens the fifo read-write so the child never sees end-of-file and never blocks the open: `["/bin/sh", "-c", 'exec 3<>"$1"; shift; exec /usr/bin/script -q /dev/null "$@" <&3', "sh", fifo, ...argv]`, stdout and stderr to the log, started with `child_process.spawn(..., { detached: true, stdio: ["ignore", logFd, logFd] })` and `unref()`. rt never opens the URL itself: the tool does, and the form offers "Open again" with the logged URL. Log lines pass through `withoutUrls` before any CLI log line, never before the session record (the app needs the URL).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `setup: CLI sign-ins run as sessions rt can read and feed`.

### Task 5: Sign in to Claude without a terminal

**Files:**
- Create: `commands/setup-claude.ts`
- Modify: `lib/setup/validators/tools.ts` (`claudeRow`: `CLAUDE_SIGNIN_STEPS` and `SIGNIN_LATER` go), `lib/command-tree-def.ts` (`setup claude connect|code`)
- Test: `commands/__tests__/setup-claude.test.ts` (create), `lib/setup/__tests__/validators-tools.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ snapshot)

**Interfaces:**
- Consumes: `startLogin`, `readLogin`, `sendLoginInput`, `endLogin` (Task 4).
- Produces:
  - `rt setup claude connect [--json]`: `claude auth status --json` signed in → `{ integration: "claude", status: "ready", detail: "Signed in as <email>" }` (the email when the status JSON carries one, else "Signed in"); otherwise `startLogin(p, "claude", { email })` with `email` from `git config --global user.email` when set, polls status every 2 s for up to 10 s, then answers ready or `{ status: "needs-you", detail: "Finish signing in in your browser" }`. No session (spawn failed) → exit 2, code `login-failed`.
  - `rt setup claude code [--json]` with stdin `{"code": "<code>"}`: no live session → exit 2, code `no-login`, "Start signing in again"; else `sendLoginInput`, poll status for up to 30 s, ready (and `endLogin`) or `{ status: "invalid", detail: "Claude did not accept that code" }`.
  - `export interface ClaudeDeps { probes: Probes; json: (v: unknown) => void; exit: (code: number) => never; seams?: LoginSeams; stdin: () => Promise<unknown>; sleep?: (ms: number) => Promise<void> }`; `setupClaudeConnect`, `setupClaudeCode`.
  - `tool.claude`'s not-signed-in action becomes `{ type: "run", label: "Sign in to Claude", verb: ["setup", "claude", "connect"] }`, detail "Not signed in yet", no optional note.

- [ ] **Step 1: Write the failing tests.**
  - `setup-claude.test.ts`: `"already signed in answers ready without a login"`; `"a login that lands within the wait answers ready and ends the session"`; `"a login still open answers needs-you, keeping the session"`; `"the git email is passed to claude"`; `"a code reaches the session and a signed-in status answers ready"`; `"a code with no session is refused"` (code `no-login`); `"a code claude rejects answers invalid"`.
  - `validators-tools.test.ts`: replace the sign-in steps expectations with `"not signed in offers Sign in to Claude, which runs rt setup claude connect"`; `"no row tells the member to open a terminal"` (no detail or step contains "terminal" or "Run: claude").
- [ ] **Step 2: Run** `bun test commands/__tests__/setup-claude.test.ts lib/setup/__tests__/validators-tools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the handlers, the row change and two hidden command-tree nodes under `setup.claude` (descriptions "Sign in to Claude Code from setup" and "Send the code your browser shows to a Claude sign-in").
- [ ] **Step 4: Run** the two files, `bun test lib/__tests__/command-tree*.test.ts`, then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and read the diff (only `tool.claude`'s action, detail and note move). Expected: PASS.
- [ ] **Step 5: Commit** `setup: Sign in to Claude runs claude auth login without a terminal`.

### Task 6: Doppler and ldcli sign in through sessions

**Files:**
- Modify: `commands/setup.ts` (`connectCliSession`, `ConnectDeps` gains `loginSeams?: LoginSeams` and `sleep?`)
- Test: `commands/__tests__/setup-connect.test.ts`

**Interfaces:**
- Consumes: `startLogin`, `readLogin`, `endLogin` (Task 4); `integrationDef(id).validate`.
- Produces: off a terminal, `rt setup doppler connect --json` and `rt setup ldcli connect --json` validate first (ready → ready, no session), else start the session, poll `validate` every 2 s for up to 10 s, then answer ready (ending the session) or `{ status: "needs-you", detail }` with detail `Your code is ${code}. Confirm it in your browser` when the log shows a code, else "Finish signing in in your browser". At a terminal the old `inherit: true` login stays.

- [ ] **Step 1: Write the failing tests:** `"off a terminal doppler starts a session and names its code"`; `"a session that signs in within the wait answers ready"`; `"already signed in starts nothing"`; `"at a terminal the login still owns the terminal"` (exec called with `inherit: true`, no spawn).
- [ ] **Step 2: Run** `bun test commands/__tests__/setup-connect.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `connectCliSession`.
- [ ] **Step 4: Run** it again. Expected: PASS.
- [ ] **Step 5: Commit** `setup: Doppler and ldcli sign in from the app without a terminal`.

### Task 7: The join remembers who invited, and the invite section

**Files:**
- Modify: `lib/team/team-local.ts` (`TeamLocalRecord.teamName?`, `invitedBy?`), `lib/team/join.ts:595`, `commands/setup.ts` (`JoinStatus`, `setupJoinStatus`), `lib/setup/form.ts` (`inviteRows`, `composeForm`), `rt-tray/Sources-core/Setup/JoinPageModel.swift` (`JoinStatus.invitedBy`)
- Test: `lib/team/__tests__/join.test.ts`, `commands/__tests__/setup-join-status.test.ts`, `lib/setup/__tests__/form-invite.test.ts` (create), `rt-tray/Tests/MattstackCoreChecks/JoinPageChecks.swift`

**Interfaces:**
- Consumes: `readPrepare` (Task 3); `tokenField`, `tokenCreateLink` and `TITLES` (exported by this task; today it is module-private) from `lib/setup/token-create.ts`.
- Produces:
  - The redeem writes `{ joinedByRt: true, joinedAt, teamName: pointer.name, invitedBy: pointer.owner }`.
  - `JoinStatus` gains `invitedBy: string | null`; `team.name` is `record.teamName ?? slug`. Swift `JoinStatus.invitedBy: String?` (`decodeIfPresent`).
  - `export function cltRow(i: { cltInstalled: boolean; prepare: (PrepareRecord & { running: boolean }) | null }): FormRow | null`: null once Command Line Tools are installed; `busy` "Installing Command Line Tools…" while a `macos` prepare runs; else `todo` with `{ type: "install", label: "Install", tool: "apple-clt", via: "apple-clt" }` and the recorded failure as detail. Every section whose button starts git work leads with it: invite (here), restore (here), create (Task 16), this-Mac (Task 10).
  - `export interface InviteInputs { rows: ReadonlyMap<string, Row>; forge: { provider: "github" | "gitlab"; host: string } | null; ghSignedIn: boolean; cltInstalled: boolean; prepare: (PrepareRecord & { running: boolean }) | null }` and `export function inviteRows(i: InviteInputs): FormRow[]`: `cltRow`, then `forge.token` when the forge needs a token (GitLab always, GitHub only when `ghSignedIn` is false): title from `TITLES`, subtext "Lets mattstack reach the team's repo and open MRs" (PRs on GitHub), `done` with detail "Connected as <login>" once the account row is ready, else `todo` with `{ type: "connect", label: "Connect", integration, fields: [tokenField(provider, "member")], create: { label: "Create token", url: tokenCreateLink(provider, "member", host).url } }` (the link's own label, "Create a token on GitLab…", is replaced by the spec's).
  - `export function restoreRows(i: { cltInstalled: boolean; prepare: … }): FormRow[]`: `cltRow` alone. `FormSection` gains `"restore"`, `SetupForm.sections` gains `restore?: FormRow[]`, and the `--section` hint names it.
  - `composeForm` fills `invite` after `rt team join --dry-run` wrote the invite, from `macRows` and `accountRows` alone (never the tools group, so no twenty-second `fast-browser doctor` behind the paste), and `restore` from `macRows` alone.

- [ ] **Step 1: Write the failing tests.**
  - `join.test.ts`: `"a redeem stamps the team's name and who invited"`.
  - `setup-join-status.test.ts`: `"join-status names the team and the admin who invited"` (`team.name: "Mithrandir"`, `invitedBy: "Jane Doe"`); `"a record from before this change reads the slug and no inviter"`.
  - `form-invite.test.ts`: `"a GitLab team always asks for a token, with Create token"` (action's `create.label` "Create token", url from `tokenCreateLink`); `"a GitHub team with a gh sign-in asks for nothing"` (no `forge.token` row); `"a GitHub team without gh asks for a token"`; `"while Command Line Tools install in the background the invite section holds Join with a busy row"` (`tool.clt` state `busy`); `"a failed background install offers Install with the reason"`; `"with git ready and a token stored every row is done"`; `"the restore section holds Restore while Command Line Tools install"`; `"with git ready the restore section is empty"`.
  - `JoinPageChecks.swift`: `Check("JoinPage: invitedBy decodes, and absent reads nil")`.
- [ ] **Step 2: Run** `bun test lib/team/__tests__/join.test.ts commands/__tests__/setup-join-status.test.ts lib/setup/__tests__/form-invite.test.ts` and `cd rt-tray && swift run mattstack-checks JoinPage`. Expected: FAIL.
- [ ] **Step 3: Implement.** `ghSignedIn` is `account.github` ready with a detail starting "Signed in through the gh CLI"; `cltInstalled` is the plan's `tool.clt` row ready.
- [ ] **Step 4: Run** the commands from Step 2. Expected: PASS.
- [ ] **Step 5: Commit** `setup: the join remembers who invited, and the invite screen's rows`.

### Task 8: The connect section (P5 and P5s)

**Files:**
- Modify: `lib/setup/form.ts` (`connectRows`, `composeForm`), `lib/setup/validators/tools.ts` (`FAST_BROWSER_ADD_ACTION.waiting` becomes "Waiting for Chrome…")
- Test: `lib/setup/__tests__/form-connect.test.ts` (create), `lib/setup/__tests__/validators-tools.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ snapshot)

**Interfaces:**
- Consumes: `signInTools`, `CLI_SESSION_INTEGRATIONS` (Task 3), `readLogin` (Task 4), `readPrepare` (Task 3), `cltRow` (Task 7).
- Produces:
  - `export const RUN_FIXES: ReadonlySet<string>`: the rows a full run sets up: `perm.login-items`, `tool.daemon`, `tool.plugins`, `tool.rt-link`, `tool.shell`, `tool.intercepts`, `tool.proxy`, `tool.extension`, `tool.vsix`, `tool.fast-browser`, `tool.linear-mcp`, `team.sync`, `team.marketplace`, `team.identity`, `tool.state-backup`, `home.backup`, `skills.writing-style`; and `export function runFixes(r: Row): boolean` (an id in the set, a `pack.` id, or a row carrying `waitsForInstall`).
  - `export function formOwnedIds(plan: Plan): Set<string>`: every plan row id some section draws as its own row (`perm.fda`, `perm.notifications`, `tool.clt`, `account.<forge>`, `account.slack-app`, `account.slack`, `tool.claude`, each sign-in tool's `tool.team.<name>` and `account.<integration>`, `account.linear`, `tool.chrome`, `tool.fast-browser-extension`, each `repos.place:*`, `home.backup`).
  - `export function extraRows(plan: Plan, owned: Set<string>, opts: { afterRun: boolean; prepare: (PrepareRecord & { running: boolean }) | null }): FormRow[]`: every row in `plan.requiredMissing` or `plan.finishBlockedBy` that no section owns. With `afterRun: false` it keeps the rows `runFixes` is false for (herdr, a pack tool, a field account such as `account.sdm`); with `afterRun: true` it keeps only the `runFixes` rows, which a run that ended ok left unfinished. Each extra row is the plan row's own: id, title, `why` as subtext, detail, action; `busy` "Installing…" while a running prepare's items hold its tool (`tool.herdr` → `herdr`, `tool.team.<name>` → `<name>`), else `todo`; `optional` when it has no action.
  - `export interface ConnectInputs { path: FormPath; plan: Plan; forge: { provider: "github" | "gitlab"; host: string } | null; forgeLogin: string | null; signIn: ToolRequirement[]; prepare: (PrepareRecord & { running: boolean }) | null; logins: Partial<Record<LoginTool, LoginSession>> }` (tests build the plan with `finalizePlan` over `row()` literals) and `export function connectRows(i: ConnectInputs): FormRow[]`, in this order:
  1. `forge` (team paths): done "Connected as <login> from your invite" on a join, "Connected as <login>" otherwise; todo as in Task 7. On solo: the GitHub row, `optional: true`, subtext "Optional. Lets mattstack open PRs and MRs".
  2. `slack-app` (creator only, when `account.slack-app` is in the plan): the row's own `owner-once` action, title "Slack app", subtext "Lets your team connect Slack. One owner makes it once".
  3. `slack` (only when `account.slack` is in the plan): action `{ type: "oauth", label: "Connect Slack", integration: "slack", verb: ["setup", "slack", "connect"] }`, subtext by forge, `waiting: "Waiting for Slack…"`, `watch: true`, done "Connected".
  4. `claude`: Claude Code missing and an `accounts` prepare running → `busy` "Installing…"; missing otherwise → `todo` with `{ type: "install", label: "Install", tool: "claude", via: "vendor" }`; installed, a live claude session → `waiting` with detail "Finish signing in in your browser" and action `{ type: "form", label: "Paste code", verb: ["setup", "claude", "code"], fields: [{ name: "code", label: "Code from your browser", secret: true }] }`; installed, no session → `todo` "Sign in to Claude"; signed in → `done` with the row's detail. `watch: true`.
  5. One row per `signIn` tool (`signin.<tool>`): title `integrationDef(id).title` for a session integration, else the tool name; subtext the tool's `why`, falling back to "For running your dev servers"; busy "Installing…" / todo install / todo "Sign in" (`run` of `["setup", id, "connect"]`, or the tool's own `connect.verb` and `label`) / waiting with the session's code line and an "Open again" `open-url` to the session URL / done. `watch: true`.
  6. `extraRows(plan, formOwnedIds(plan), { afterRun: false, prepare })`: herdr installing or failed, a pack tool rt cannot install (its Download or steps), a field account such as StrongDM (its email field inline).
  7. `linear` (only when `account.linear` is in the plan): connect with the API key field and `create: { label: "Create token", url: "https://linear.app/settings/account/security" }`.
  8. `fast-browser`: Chrome missing → todo `{ type: "open-url", label: "Get Chrome", url: "https://www.google.com/chrome/" }`; else the extension row's state: ready → done "Added"; needing the store install → todo with `FAST_BROWSER_ADD_ACTION`, `waiting: "Waiting for Chrome…"`; any other state (profile access, not loaded, not paired) → todo with the row's own action and detail and no waiting line, so it never sits on "Waiting for Chrome…". `watch: true`.
  - A row with no action that is not done is `optional: true`, so nothing a member cannot press ever holds Continue.
  - `continueReady` is every non-optional connect row done.

- [ ] **Step 1: Write the failing tests** (rows built with `row()`):
  - `"a joiner's rows come in the spec's order"` (ids `forge, slack, claude, signin.doppler, linear, fast-browser`).
  - `"no Slack row when the team has none"`.
  - `"herdr installing in the background reads Installing, and a failed install offers the row's own Install"`.
  - `"a pack tool rt cannot install shows its own Download"`.
  - `"a required StrongDM account shows with its email field"` (the extra row's action deep-equals `account.sdm`'s connect action).
  - `"rows a run sets up stay off the connect screen"` (a missing `tool.daemon` and `pack.widgets` produce no extra row).
  - `"a doctor remedy other than the store install keeps its own action and no waiting line"`.
  - `"the forge row says the account came from the invite"`.
  - `"Slack follows the forge: MRs on GitLab, PRs on GitHub"`.
  - `"Claude reads Installing while the background install runs"`; `"Claude with a live sign-in waits and offers Paste code"`; `"a dead sign-in is back to Sign in to Claude"` (logins empty, installed, not signed in → todo).
  - `"a sign-in tool shows Doppler's code while its session waits"` (detail "Your code is ABC-123. Confirm it in your browser").
  - `"Linear shows only when the team uses it"`.
  - `"no Chrome offers Get Chrome first"`; `"the extension added reads Added"`.
  - `"solo shows the code host as optional, then Claude and Fast Browser"` (no slack, linear or sign-in rows; `continueReady` true with the forge row todo).
  - `"a creator sees the Slack app row before Slack"`.
  - `"a row nothing can be pressed on never holds Continue"`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/form-connect.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `composeForm` builds `ConnectInputs` from one `composePlan` call (plan mode while setup is unfinished, status mode once finished), `readTeamSnapshot`, `readPackRequirements`, `readTeamLocal(...).forgeUsername`, `readPrepare`, and `readLogin` for each `LoginTool`. Share the one plan between sections when several are asked for.
- [ ] **Step 4: Run** the new file and `bun test lib/setup/__tests__/validators-tools.test.ts`, then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and read the diff (only the extension's waiting line moves). Expected: PASS.
- [ ] **Step 5: Commit** `setup: the connect screen's rows, built from the plan`.

### Task 9: Your settings: keep on this Mac, or a remote repo

**Files:**
- Create: `lib/setup/home-remote.ts`
- Modify: `commands/setup.ts` (`homeRemoteSet` delegates; new `setupHomeBackup`), `lib/setup/state.ts` (`SetupState.homeBackup?`), `lib/setup/steps/home.ts` (home.init applies a staged remote), `lib/command-tree-def.ts` (`setup home-backup`)
- Test: `lib/setup/__tests__/home-remote.test.ts` (create), `commands/__tests__/home-remote-set.test.ts`, `commands/__tests__/setup-home-backup.test.ts` (create), `lib/setup/__tests__/steps-a.test.ts`

**Interfaces:**
- Produces:
  - `export type HomeBackupChoice = { mode: "local" } | { mode: "remote"; url?: string; create?: boolean; name?: string }`; `SetupState.homeBackup?: HomeBackupChoice`.
  - `export interface HomeRemoteResult { url: string; remote: "added" | "updated"; pushed: true; created: boolean }` and `export async function setHomeRemote(p: Probes, input: { url?: string; create?: boolean; name?: string }): Promise<HomeRemoteResult>`, moved out of `homeRemoteSet` unchanged (same errors and codes).
  - `rt home remote set` with no home repo yet stages `{ mode: "remote", ...input }` in setup state and prints `{ staged: true, url: <url or null>, created: false, pushed: false }` instead of refusing `no-home-repo`.
  - `rt setup home-backup <local|remote> [--json]`: `local` writes `{ mode: "local" }`; `remote` writes `{ mode: "remote" }`, keeping a staged url or create already there. Prints `envelope({ homeBackup })`.
  - home.init, after creating the repo, applies a staged remote through `setHomeRemote`; a failure makes the step `partial` with the error's message, and the staged choice stays for the next run.

- [ ] **Step 1: Write the failing tests:** `"set-home-remote keeps today's refusals"` (a moved copy of two existing cases); `"no home repo yet stages the remote instead of refusing"`; `"backup local clears a staged remote"`; `"backup remote keeps a staged url"`; `"an unknown choice is a usage error"`; `steps-a.test.ts`: `"home.init pushes to a staged remote once the repo exists"`, `"a staged remote that fails leaves home.init partial and the choice in place"`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/home-remote.test.ts commands/__tests__/home-remote-set.test.ts commands/__tests__/setup-home-backup.test.ts lib/setup/__tests__/steps-a.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The command-tree node sits under `setup`: `"home-backup": { description: "Choose where your settings are kept", module: "./commands/setup.ts", fn: "setupHomeBackup", hidden: true, args: [SETUP_JSON_ARG] }`. Task 10's choose action runs it as `["setup", "home-backup"]` plus the picked id.
- [ ] **Step 4: Run** the files from Step 2 and `bun test lib/__tests__/command-tree*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `setup: keep settings on this Mac or stage a remote repo before Install`.

### Task 10: The this-Mac section (P5b and P5s)

**Files:**
- Modify: `lib/setup/form.ts` (`thisMacRows`, `composeForm`), `lib/setup/validators/repos.ts` (`BOARD_LINE` = "The board starts here"; the clone segment's label "Choose…"; `CLONES_AT_INSTALL` = "rt clones it here when setup runs")
- Test: `lib/setup/__tests__/form-this-mac.test.ts` (create), `lib/setup/__tests__/validators-repos.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ snapshot)

**Interfaces:**
- Consumes: `HomeBackupChoice` (Task 9); `configuredRepoRoots` from `lib/setup/repo-placement.ts`; `detectCandidate` and the staged root from `lib/setup/repo-root.ts`; `cltRow` (Task 7); `extraRows`, `formOwnedIds` (Task 8).
- Produces: `export interface ThisMacInputs { path: FormPath; plan: Plan; ranOk: boolean; cltInstalled: boolean; prepare: (PrepareRecord & { running: boolean }) | null; backup: HomeBackupChoice | undefined; homeRemote: string | null; ghSignedIn: boolean; repoRoot: { configured: string | null; staged: string | null; candidate: string | null } }` and `export function thisMacRows(i: ThisMacInputs): FormRow[]`, in this order:
  0. `cltRow`: Set up this Mac waits for git on every path (Just me's run would otherwise refuse before its first step, leaving P6b nothing to name).
  1. Team paths: one row per `repos.place:<identity>` row, same id, title the repo, subtext the action's `board` line or the namespace, the row's own `place-repo` action, done when the plan row is ready.
  2. Solo: `repos.root`, title "Your repos", subtext "Where new clones go", `{ type: "choose-folder", label: "Choose…", startAt: candidate }`, done when a root is configured or staged.
  3. `settings.backup`: title "Your settings", subtext the P5b sentence, `{ type: "choose", label: "Change", verb: ["setup", "home-backup"], options: [{ id: "local", label: "Keep on this Mac", detail: "" }, { id: "remote", label: "Store in a remote repo", detail: "" }], selected }` with `selected` from `backup?.mode ?? "local"`; always done.
  4. `settings.remote`, only while `remote` is chosen: title "Remote repo", subtext "Where the private copy lives", done when a remote is set or staged (detail the url), else todo `{ type: "form", label: "Use this repo", verb: ["home", "remote", "set"], fields: [{ name: "url", label: "Repo URL", secret: false, hint: "git@github.com:janedoe/mattstack-home.git" }], alternatives: ghSignedIn ? [{ id: "create", label: "Create a private GitHub repo" }] : undefined }`.
  5. When `ranOk` (the last run ended ok): `extraRows(plan, formOwnedIds(plan), { afterRun: true, prepare })`, the rows a run sets up that it left blocking Install or Finish (a shell rt does not recognize, a declined certificate), each with its own action. Pressing Set up this Mac after fixing one runs the bar again.
  - `startReady` is every non-optional this-Mac row done.

- [ ] **Step 1: Write the failing tests:** `"Set up this Mac waits for Command Line Tools on Just me"` (`tool.clt` busy, `startReady` false); `"a row the run could not set up comes back here with its own action"` (`ranOk`, `tool.shell` blocking Finish → an extra row with its Re-check); `"before any run, rows a run sets up stay off this screen"`; `"one row per tracked repo, the board's says the board starts here"`; `"a repo that needs an answer holds Set up this Mac"`; `"settings default to this Mac and are done"`; `"choosing a remote adds the repo row until one is set or staged"`; `"Create a private GitHub repo shows only with a gh sign-in"`; `"solo asks where new clones go, starting at the found folder"`; `validators-repos.test.ts`: update the board-line and clone-label expectations.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/form-this-mac.test.ts lib/setup/__tests__/validators-repos.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `homeRemote` is `git -C ~/.mattstack/user remote get-url origin` when the repo exists, else the staged url. `composeForm` passes `ranOk: false` here; Task 14 wires it to the run record Task 11 adds.
- [ ] **Step 4: Run** the two files, then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and read the diff (the board line, the clone label, the clone note). Expected: PASS.
- [ ] **Step 5: Commit** `setup: the this-Mac screen's rows: repos, a folder for Just me, and settings`.

### Task 11: One run, recorded, resumable and attachable

**Files:**
- Create: `lib/setup/apply-run.ts`
- Modify: `lib/setup/state.ts` (`SetupState.run?`), `lib/setup/apply.ts` (`runApplyWith` opts `record`, `beforeDone`), `lib/setup/update-lock.ts` (`maxAgeMs` option), `commands/setup.ts` (`setupApply`: `--resume`, the run lock, the events file, EPIPE)
- Test: `lib/setup/__tests__/apply-run.test.ts` (create), `lib/setup/__tests__/apply.test.ts`, `lib/setup/__tests__/update-lock.test.ts`, `commands/__tests__/setup-apply.test.ts`

**Interfaces:**
- Produces:
  - `export interface SetupRun { startedAt: string; done: StepId[]; endedAt?: string; ok?: boolean; failed?: { step: StepId; detail: string; remedy?: string } }`; `SetupState.run?: SetupRun`.
  - `runApplyWith(steps, ctx, opts: { from?: StepId; only?: StepId; record?: "fresh" | "continue"; beforeDone?: () => void })`: `fresh` writes `{ startedAt, done: [] }` before the first step; `continue` keeps `done` and clears `endedAt`, `ok`, `failed`; each step that ends `done`, `partial`, `skipped` or `needs-you` is appended to `done`; the end writes `endedAt`, `ok` and, on failure, `failed`. `beforeDone` runs in the `finally`, just before the `done` event. `--only` runs never record.
  - Which runs record what: a full run without `--resume` records `fresh`; a `--from` run (P6b's Retry) and a `--resume` of an unended run record `continue`; `--only` records nothing.
  - `createUpdateLock(path, opts)` gains `maxAgeMs?: number` (default `UPDATE_LOCK_MAX_AGE_MS`). `export function applyRunLockPath(home: string): string` (`~/.mattstack/rt/setup-apply.lock`, a two-hour `maxAgeMs`) and `export function applyEventsPath(home: string): string` (`~/.mattstack/rt/setup-run.ndjson`). The run lock is released through `beforeDone`, so a Retry the app starts on the `done` event never meets its own previous run's lock.
  - `export function recordingEmit(p: Probes, inner: Emit, opts: { truncate: boolean }): Emit`: appends each event as one line to the events file, then forwards it; a forward that throws (a closed stdout) is swallowed.
  - `export function resumePoint(run: SetupRun | undefined, applicable: StepId[]): StepId | undefined`: the first applicable step not in `run.done`; undefined when the run is absent or ended.
  - `export async function attachToRun(p: Pick<Probes, "readFile" | "home">, out: (event: ApplyEvent) => void, opts: { holderAlive: () => boolean; sleep?: (ms: number) => Promise<void>; pollMs?: number }): Promise<{ ok: boolean }>`: replays the events file, then follows it until a `done` event; a holder that dies first ends with `{ event: "done", ok: false }`. A replayed `need` is forwarded only when no later event for its id follows it in the file (an answered need is never performed twice; the one the orphaned run is still polling for is).
  - `rt setup apply --resume [--json]`: a live lock holder → attach (exit 0 on ok, 2 otherwise, no step run); else take the lock and, for an unended run, emit `plan`, then a `done` step event (no detail) for each recorded step, then run `--from resumePoint` with `record: "continue"`; otherwise a full run with `record: "fresh"`. A full or `--from` run without `--resume` takes the lock too, and refuses with code `run-busy` ("Setup is already running") while it is held. Under `--json`, `process.stdout.on("error", () => {})` is attached and every event goes through `recordingEmit`.

- [ ] **Step 1: Write the failing tests.**
  - `apply-run.test.ts`: `"resume starts at the first step the run had not finished"`; `"an ended run has no resume point"`; `"events are appended one per line"`; `"a forward that throws still records the event"`; `"attach replays then follows until done"`; `"attach ends failed when the holder dies before done"`; `"attach performs only a need still waiting at the tail"` (a need followed by its step's `done` is dropped; a trailing need is forwarded).
  - `update-lock.test.ts`: `"a lock older than its max age is stale"` (custom `maxAgeMs`).
  - `apply.test.ts`: `"a fresh record lists each finished step and the outcome"`; `"a failed step is recorded with its detail and remedy"`; `"continue keeps what was done and clears the end"`; `"--only never touches the record"`; `"beforeDone runs before the done event"`.
  - `setup-apply.test.ts`: `"--resume with no record runs everything"`; `"--resume after a run died runs only what was left, marking the rest done first"` (stream: `plan`, `done` events for recorded ids, then `running` for the resume point); `"a --resume while the run's holder lives attaches and starts nothing"` (`deps.steps` bodies never called; the replayed events reach `json`); `"a second full run while one is alive is refused"` (code `run-busy`); `"a run whose stdout closed keeps going and records every step"` (`json` seam throws after the first event; every step body still runs; record ends ok); `"a Retry records continue: it keeps what was done and an ok Retry clears the pause"` (record `failed` gone, `ok: true`); `"a Retry started on the done event is never refused"` (the lock is free when `done` reaches `json`); `"a --resume while a Retry's holder lives attaches"`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/apply-run.test.ts lib/setup/__tests__/apply.test.ts commands/__tests__/setup-apply.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `ApplyDeps` gains `runLock?: UpdateLock` and `holderAlive?: () => boolean` seams (real ones from `applyRunLockPath`); the events file is truncated when a run takes the lock.
- [ ] **Step 4: Run** the three files and `bun test lib/setup/__tests__/update-lock.test.ts commands/__tests__/setup-update.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `setup: one apply at a time, recorded step by step, resumed or attached after a relaunch`.

### Task 12: An unattended run pauses instead of prompting

**Files:**
- Modify: `lib/setup/apply.ts` (`CreateApplyContextDeps.flags.unattended`, `ctx.need`), `lib/setup/need.ts` (`outcomeFromNeed`), `lib/setup/steps/step-utils.ts` (`needOutcome`), `commands/setup.ts` (`applyFlags`)
- Test: `lib/setup/__tests__/need.test.ts`, `lib/setup/__tests__/apply.test.ts`, `commands/__tests__/setup-apply.test.ts`

**Interfaces:**
- Produces: `rt setup apply --unattended`: `ctx.need` answers `"unattended"` for any `app-privileged` request without emitting the need; `outcomeFromNeed("unattended")` is `{ state: "failed", detail: "This step needs your admin password, so setup paused here" }`; `needOutcome` adds `remedy: "Press Retry and answer the macOS prompt"`. Other needs (services) are emitted as today. The reply union in `ApplyContext.need`, `outcomeFromNeed` and `needOutcome` gains `"unattended"`.

- [ ] **Step 1: Write the failing tests:** `"an unattended run never emits an admin need"`; `"the step fails with the pause copy and the Retry remedy"`; `"services needs still go to the app when unattended"`; `"--unattended reaches the context"`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/need.test.ts lib/setup/__tests__/apply.test.ts commands/__tests__/setup-apply.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `setup: an unattended run pauses at an admin prompt instead of raising it`.

### Task 13: Bar phases in the plan event

**Files:**
- Create: `lib/setup/run-phases.ts`
- Modify: `lib/setup/contract.ts` (`ApplyEvent` plan steps), `lib/setup/apply.ts` (the `plan` emit in `runApplyWith`), `rt-tray/Sources-core/Contract/ApplyEvents.swift` (`StepInfo.phase`, `weight`, `paused`)
- Test: `lib/setup/__tests__/run-phases.test.ts` (create), `lib/setup/__tests__/apply.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ snapshot), `rt-tray/Tests/MattstackCoreChecks/InstallRunChecks.swift`

**Interfaces:**
- Produces: `export const STEP_PHASES: Readonly<Record<StepId, { phase: string; weight: number; paused: string }>>`; the plan event's steps become `{ id; title; kind; phase?: string; weight?: number; paused?: string }` (apply runs carry all three; update runs keep the old shape). Swift `StepInfo` gains `phase: String?`, `weight: Double?`, `paused: String?`. The table (phase, weight, paused; "Couldn't" is always followed by the phase's verb in its plain form):
  - home.init "Setting up your settings folder" 1; home.restore "Restoring your settings" 2; team.create "Creating your team" 1; team.join "Joining your team" 1.
  - org.folder, org.pull, team.identity, org.forge-access "Getting your team's settings" 1 each.
  - secrets.write "Saving your sign-ins" 1; git.identity "Setting up git" 1; path.link, settings.seed, intercepts.install "Setting up rt" 1 each.
  - repos.clone "Cloning your repos" 10; services.register "Starting mattstack" 1; proxy.install "Setting up fancy URLs" 1; deck.managed "Starting your apps" 2.
  - skills.materialize "Installing skills" 2; skills.link "Installing skills" 1; board.keys, board.cwds, cron.triage "Setting up the board" 1 each.
  - plugins.install "Installing Claude plugins" 6; linear.mcp "Connecting Linear" 1; claude.permissions "Setting up Claude" 1; fastbrowser.setup "Setting up Fast Browser" 4; herdr.integration "Setting up herdr" 1; extension.install "Installing editor extensions" 2.
  - services.start "Starting mattstack" 2; board.restart "Starting the board" 1; snapshot.push "Saving a snapshot" 1; verify "Checking everything" 2.
  - `paused` examples: "Couldn't clone your repos", "Couldn't get your team's settings", "Couldn't check everything".

- [ ] **Step 1: Write the failing tests:** `"every step id has a phase, a positive weight and a paused line starting Couldn't"`; `"the apply plan event carries each step's phase, weight and paused line"`; `"the update plan event keeps its old shape"`; `InstallRunChecks.swift`: `Check("InstallRun: a plan step's phase, weight and paused decode, and absent reads nil")`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/run-phases.test.ts lib/setup/__tests__/apply.test.ts` and `cd rt-tray && swift run mattstack-checks InstallRun`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the commands from Step 2, then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and read the diff (plan events gain three keys per step). Expected: PASS.
- [ ] **Step 5: Commit** `setup: each apply step says its bar phase, weight and paused line`.

### Task 14: Where setup is, and Finish after any whole run

**Files:**
- Modify: `lib/setup/form.ts` (`formStage`, `formPath`, `pausedFor`, `homeApp`, `composeForm` with no `--section`), `commands/setup.ts` (`setupApply`: stamp and `finishIfClear` for every non-`--only` run)
- Test: `lib/setup/__tests__/form-stage.test.ts` (create), `commands/__tests__/setup-form.test.ts`, `commands/__tests__/setup-apply.test.ts`

**Interfaces:**
- Consumes: `SetupRun` (Task 11), `STEP_PHASES` (Task 13), `approvalState`, `readIntent`, `readTeamLocal`, `isSetupFinished`.
- Produces:
  - `export function formPath(i: { intent: SetupIntent | null; joined: boolean; created: boolean; orgs: string[]; ranOrFinished: boolean }): FormPath | null`: the intent's mode; else `join` when a clone's record has `joinedByRt`, `create` when `createdByRt`, `join` for any other clone; else `solo` once a run exists or setup finished; else null.
  - `export interface StageInputs { finished: boolean; path: FormPath | null; macosDone: boolean; join: "unredeemed" | ApprovalState["kind"] | null; run: SetupRun | undefined; connectDone: boolean; thisMacDone: boolean; needsRun: boolean }` and `export function formStage(i: StageInputs): FormStage`. An unfinished Mac, in order: macOS not done → `macos`; an unended run → `running`; an ended failed run → `paused`; no path → `path`; an unredeemed invite → `invite`; `waiting` approval → `waiting`; restore with no run → `running`; connect not done → `connect`; else `this-mac` (also a run that ended ok but left Install or Finish blocked: its leftover rows are on that screen, Task 10, never back on `running`). A finished Mac: an unredeemed invite → `invite` and a `waiting` approval → `waiting` first (a Join from Settings in flight outranks the finished state); then the first section with a todo row (`macos`, `connect`, `this-mac`); else `this-mac` when `needsRun`; else `ready`. `unreadable` approval counts as approved.
  - `connectDone` and `thisMacDone` include the extra rows (Tasks 8 and 10), and `needsRun` counts only `runFixes` rows blocking the status-mode plan (`requiredMissing` or `finishBlockedBy`) on a finished Mac: a row the bar can fix sends the member to Set up this Mac; any other row is already on a screen. `composeForm` now passes `ranOk: readSetupState(p).run?.ok === true` to Task 10's builder.
  - `export function pausedFor(run: SetupRun | undefined, extras: { events: string | null; loginItems: Row | undefined }): FormPaused | null`: `{ step, title: STEP_PHASES[step].paused, detail, remedy, log, action }` from `run.failed`. `FormPaused` gains `log: string[]` (the failed step's last 50 `log` lines from the events file, so Show log has lines after a relaunch) and `action: Action | null` (the `perm.login-items` row's action when that row needs you, so a background item macOS holds gets its Open Login Items button beside Retry).
  - `export function homeApp(path: FormPath | null): { label: string; url: string }`: solo → `{ label: "Open the console", url: "https://console.mattstack" }`, else `{ label: "Open the board", url: "https://board.mattstack" }`.
  - A `--from` or `--resume` run that ends ok stamps the update and calls `finishIfClear`, like a full run.

- [ ] **Step 1: Write the failing tests** in `form-stage.test.ts`, one per branch above, named for the person: `"a fresh Mac starts at macOS"`, `"a run that died mid-bar resumes the bar"`, `"a run that failed shows Setup paused"`, `"no choice yet is the four cards"`, `"an invite not joined yet is the invite screen"`, `"waiting on the admin is the waiting screen"`, `"an unreadable approval lets the member on"`, `"a restore goes straight to the bar"`, `"accounts not connected is the connect screen"`, `"nothing run yet is the this-Mac screen"`, `"a run that ended ok with Finish still blocked never loops back to the bar"`, `"a finished Mac with everything done is ready"`, `"a finished Mac an update broke goes back to the this-Mac screen"`, `"a finished Mac missing an account goes to the connect screen"`, `"a finished Mac joining another team from Settings lands on the wait"`, `"setup never lands on a screen that shows none of the missing rows"` (over fixture plans with a missing herdr, a download-only pack tool, `account.sdm`, a blocking `tool.shell` after an ok run, and a missing `tool.daemon` on a finished Mac: the landed section holds a todo row for each, or the stage is `this-mac` with only `runFixes` rows missing); `"the paused copy names the step and carries its detail and log"`; `"a held background item puts Open Login Items on the paused screen"`; `"Just me opens the console"`. In `setup-form.test.ts`: `"no --section prints every section, the stage and home"`. In `setup-apply.test.ts`: `"a resumed run that ends ok finishes setup when nothing blocks it"`; `"a retry from a step finishes setup too"`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/form-stage.test.ts commands/__tests__/setup-form.test.ts commands/__tests__/setup-apply.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `join` is `"unredeemed"` when the intent is a join, else the first joined clone's `approvalState(...).kind`, else null.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `setup: rt says which screen setup is on, and a finished run finishes setup`.

### Task 15: Writing style and the three Settings rows leave the finish gate

**Files:**
- Modify: `lib/setup/steps/settings.ts` (`settingsSeedRun`), `lib/setup/contract.ts` (`FINISH_GATED_ROW_IDS`), `lib/setup/expectations.ts` (`ROW_TARGETS`: the three `skip` ids become `settings`), `lib/setup/finish-gate.ts` (the module-private `assertFinishGated` also accepts a waivable id), `lib/setup/validators/writing-style.ts` (`BASE.finishGated` false), `.claude/rules/setup.md` (writing-style paragraph)
- Test: `lib/setup/__tests__/steps-a.test.ts`, `lib/setup/__tests__/expectations.test.ts`, `lib/setup/__tests__/finish-gate.test.ts`, `lib/setup/__tests__/plan.test.ts`, `lib/setup/__tests__/validators-writing-style.test.ts`, `commands/__tests__/setup-waive.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ snapshot)

**Interfaces:**
- Produces:
  - settings.seed, when `ctx.update` is unset, setup is not finished and `resolveWritingStyle().source === "fallback"`, writes `skills.writingStyle = "mattstack:writing-style-sparse"` at user scope and lists it in its detail. Never on an update run or a finished Mac; the registry default does not change.
  - `FINISH_GATED_ROW_IDS = ["tool.fast-browser-extension"]` (writing style and the three skip ids leave it); `WAIVABLE_ROW_IDS` keeps its three ids so stored waivers still read; `Target` gains `"settings"`: never required, never finish-gated, no `waivable`.
  - What stays finish-gated, unchanged: `FINISH_GATED_ACCOUNT_IDS` (Slack, Linear), every `repos.place:*` row, the approval-wait rows, and the 14 `finish` targets in `ROW_TARGETS` (`tool.herdr`, `tool.claude`, `tool.fast-browser`, `tool.linear-mcp` (only when the team uses Linear, as the base branch ruled), `tool.extension`, `tool.vsix`, `tool.rt-link`, `tool.shell`, `tool.intercepts`, `tool.proxy`, `team.sync`, `team.marketplace`, `home.backup`, `tool.state-backup`). Each has a screen: the form owns `tool.claude`, `tool.herdr` shows as a connect extra row, and the rest are `runFixes` rows the bar sets up, which come back on the this-Mac screen with their own action when a run leaves one blocking (Task 10).
  - The writing-style row is never finish-gated.

- [ ] **Step 1: Write the failing tests:** `"a new Mac with no style gets sparse at Install"`; `"an update run never writes a style"`; `"a finished Mac keeps the style it had, even none"`; `"a chosen style is never replaced"`; `"Mission Control, Chrome sign-in and skill overrides never block Finish"`; `"writing style never blocks Finish"`; `"the contract's finish-gated ids are the extension alone, and the finish targets stay gated"` (replace the plan test that counts gated rows: `FINISH_GATED_ROW_IDS` deep-equals `["tool.fast-browser-extension"]`, and a not-ready `tool.shell` still reads `finishGated: true`); `"unwaive still clears an old waiver"`; update tests that pinned the old gates, never weakening an invariant test.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/steps-a.test.ts lib/setup/__tests__/expectations.test.ts lib/setup/__tests__/finish-gate.test.ts lib/setup/__tests__/plan.test.ts lib/setup/__tests__/validators-writing-style.test.ts commands/__tests__/setup-waive.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and reword the rule's writing-style paragraph: a new Mac gets sparse at Install when nothing chose a style; the row no longer blocks Finish.
- [ ] **Step 4: Run** the command from Step 2, then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and read the diff (gate fields only). Expected: PASS.
- [ ] **Step 5: Commit** `setup: new Macs write sparse, and four rows stop blocking Finish`.

### Task 16: Create a team on GitLab or GitHub with a token

**Files:**
- Create: `lib/team/create-repo.ts`
- Modify: `lib/team/create.ts` (`CreateTeamOpts.forgeRepo?`), `commands/team.ts` (`teamCreate`: `--forge`, `--group`, `--host`), `lib/setup/form.ts` (`createRows`, `--section create` with `--forge` and `--host`), `commands/setup-form.ts`, `lib/command-tree-def.ts`
- Test: `lib/team/__tests__/create-repo.test.ts` (create), `lib/team/__tests__/create.test.ts`, `commands/__tests__/team.test.ts`, `lib/setup/__tests__/form-create.test.ts` (create)

**Interfaces:**
- Produces:
  - `export async function createForgeRepo(p: Probes, i: { provider: "github" | "gitlab"; host: string; namespace: string; name: string; token: string; login: string | null }): Promise<{ remote: string }>`: GitLab resolves `GET https://<host>/api/v4/namespaces/<encoded namespace>` to an id, then `POST /api/v4/projects` `{ name, path: name, namespace_id, visibility: "private" }` → `http_url_to_repo`; GitHub `POST https://api.github.com/user/repos` when `namespace === login`, else `POST /orgs/<namespace>/repos`, `{ name, private: true }` → `clone_url`. A taken name → `UserActionableError("create-repo-exists", ...)` with `next: "rt team create <name> --remote <its url>"`; a namespace the token cannot see → `create-repo-failed` naming the namespace. Responses pass through `withoutUrls` into any log.
  - `rt team create <name> --forge <github|gitlab> --group <namespace> [--host <host>] [--others] [--json]` creates `<namespace>/mattstack-team-<slug>` with the stored forge token (`storedForgeToken`), then continues as `--remote`. `--create-repo <owner>` (gh) stays.
  - `rt setup form --section create --forge <github|gitlab> [--host <host>]` returns `sections.create: FormRow[]`: `cltRow` first (Create team clones with git), then one `forge.token` row (owner role scopes, "Create token" over `tokenCreateLink`'s url), absent on GitHub with a gh sign-in. `FormSection` gains `"create"` and `SetupForm.sections` gains `create?: FormRow[]`; the command-tree node gains `{ name: "Forge", flag: "--forge", type: "string", hint: "github or gitlab, for the create section" }` and `{ name: "Host", flag: "--host", type: "string", hint: "A self-hosted forge's host" }`.

- [ ] **Step 1: Write the failing tests** (fake `fetch`): `"GitLab creates a private project under the group"`; `"GitHub creates under the member's own account or an org"`; `"a name already taken says so with the way out"`; `"a group the token cannot see is named"`; `"team create with --forge gitlab uses the stored token and the new remote"`; `"--forge without --group is a usage error"`; `"the create section asks for an owner-scoped token with Create token"`; `"GitHub with gh signed in asks for no token"`; `"Create team waits for Command Line Tools"` (`tool.clt` busy leads the create section).
- [ ] **Step 2: Run** `bun test lib/team/__tests__/create-repo.test.ts lib/team/__tests__/create.test.ts commands/__tests__/team.test.ts lib/setup/__tests__/form-create.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `bun test lib/__tests__/command-tree*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `team: create the team repo on GitLab or GitHub with a token`.

### Task 17: Tray Core: the form contract

**Files:**
- Create: `rt-tray/Sources-core/Contract/FormModels.swift`, `rt-tray/Sources-core/Setup/SetupFormModel.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/FormModelsChecks.swift` (create), `AllChecks.swift`

**Interfaces:**
- Consumes: `rt setup form --json` (Tasks 1, 7, 8, 10, 14, 16).
- Produces:
  - `public enum FormRowState: String, Decodable, Sendable { case done, todo, busy, waiting }` (unknown → `.todo`); `public enum FormStage: String, Decodable, Sendable { case macos, path, invite, waiting, connect, thisMac = "this-mac", running, paused, ready }` (unknown → nil at the optional site).
  - `public struct FormRow: Decodable, Equatable, Identifiable, Sendable { id, title, subtext: String; state: FormRowState; detail: String; action: RowAction?; waiting: String?; watch: Bool; optional: Bool }`.
  - `public struct SetupForm: Decodable, Equatable, Sendable { path: String?; team: FormTeam?; stage: FormStage?; sections: FormSections; continueReady: Bool; startReady: Bool; paused: FormPaused?; home: FormHome }` with `FormTeam { slug, name: String; invitedBy: String? }`, `FormSections { macos, invite, restore, create, connect, thisMac: [FormRow]? }`, `FormPaused { step, title, detail: String; remedy: String?; log: [String]; action: RowAction? }` (`log` absent reads `[]`), `FormHome { label, url: String }`.
  - `@MainActor public final class SetupFormModel: ObservableObject` with `@Published public private(set) var form: SetupForm?`, `@Published public private(set) var error: String?`, `@Published public private(set) var isLoading: Bool`; `public init(rt: RtRunning, sleep: @escaping @Sendable (TimeInterval) async -> Void = { try? await Task.sleep(nanoseconds: UInt64($0 * 1e9)) })`; `public func load(section: String?, extra: [String] = []) async` (nil reads the whole form; `extra` carries `--forge`/`--host` for the create section); `public func watch(section: String?, every seconds: TimeInterval = 2)` re-reads serially while any row in that section is `waiting` or `busy`; `public func stopWatching()`; `public var isWatching: Bool`.

- [ ] **Step 1: Write the failing checks:** `"FormModels: a whole form decodes"` (fixture JSON with every section); `"FormModels: an unknown row state reads todo"`; `"FormModels: a section rt left out reads nil"`; `"SetupForm: load runs setup form with the section"` (ScriptedRt sees `["setup", "form", "--section", "connect", "--json"]`); `"SetupForm: a failed read keeps the last form and sets the error"`; `"SetupForm: watching stops once nothing waits"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "FormModels"` and `swift run mattstack-checks "SetupForm"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Error copy comes from `RtResult.failureCopy(verb: "setup form")` or the user error's message.
- [ ] **Step 4: Run** the checks. Expected: PASS.
- [ ] **Step 5: Commit** `tray: decode rt setup form and keep it fresh while rows wait`.

### Task 18: Tray Core: the flow

**Files:**
- Create: `rt-tray/Sources-core/Setup/FastSetupFlow.swift`
- Modify: `rt-tray/Sources-core/Setup/SetupFlowModel.swift` (`SetupEntry` gains `.status`), `rt-tray/Sources-core/Launch/SetupResume.swift` (screen names beside the old step names)
- Test: `rt-tray/Tests/MattstackCoreChecks/FastSetupFlowChecks.swift` (create), `SetupFlowChecks.swift`, `AllChecks.swift`

**Interfaces:**
- Consumes: `FormStage` (Task 17), `TeamChoice` (`TeamChoiceModel.swift`).
- Produces:
  - `public enum FastSetupScreen: String, CaseIterable, Sendable { case loading, macos, path, invite, createTeam = "create-team", restore, waiting, connect, thisMac = "this-mac", running, paused, ready }`.
  - `@MainActor public final class FastSetupFlow: ObservableObject` with `@Published public private(set) var screen: FastSetupScreen = .loading`, `@Published public var entry: SetupEntry`, `public var requested: TeamChoice?` (an upgrade's Join or Create); methods `land(on stage: FormStage)` (rt's stage wins; `requested` is used only when the stage is `ready` on an upgrade entry, i.e. a finished Mac whose Join or Create from Settings has not started, which lands on invite or createTeam; once that join is in flight rt's stage says `invite` or `waiting` itself), `macosDone()` (macos → `path` on first run, the requested screen on an upgrade), `choose(_ c: TeamChoice)` (join → invite, create → createTeam, restore → restore, solo → connect), `joined()`, `approved()`, `created()`, `restored()`, `continueToThisMac()`, `startRun()`, `runEnded(stage: FormStage)`, `retry()`, `back()`; `public static func screen(for stage: FormStage) -> FastSetupScreen`; `public var canGoBack: Bool` (invite, createTeam, restore on a first run; thisMac; connect only on Just me's first run); `public var hidesOnPrimary: Bool` (waiting, running).
  - `SetupResume.relaunchArguments(passthrough:resumeScreen:)` and `SetupResume.screen(from:) -> FastSetupScreen?` (the old step functions stay until Task 34).

- [ ] **Step 1: Write the failing checks:** one per transition, named for the person: `"FastSetupFlow: each rt stage lands on its screen"`, `"FastSetupFlow: macOS done moves on to the four cards"`, `"FastSetupFlow: an upgrade's Join skips the cards"`, `"FastSetupFlow: an upgrade on a ready Mac lands on the requested screen, a join in flight on rt's stage"`, `"FastSetupFlow: Just me goes straight to accounts"`, `"FastSetupFlow: a join waits, approval opens accounts"`, `"FastSetupFlow: a restore starts the bar"`, `"FastSetupFlow: a failed run pauses, Retry runs again"`, `"FastSetupFlow: no Back from the wait, the bar or ready"`, `"FastSetupFlow: Back from this Mac returns to accounts"`, `"SetupResume: screen names round-trip"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "FastSetupFlow"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `swift run mattstack-checks "FastSetupFlow"` and `swift run mattstack-checks "SetupFlow"`. Expected: PASS.
- [ ] **Step 5: Commit** `tray: the fast setup flow, driven by rt's stage`.

### Task 19: Tray Core: the bar's arithmetic and the run's arguments

**Files:**
- Create: `rt-tray/Sources-core/Install/RunProgress.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/RunProgressChecks.swift` (create), `AllChecks.swift`

**Interfaces:**
- Consumes: `InstallStep`, `StepInfo.phase/weight/paused` (Task 13).
- Produces:
  - `public struct RunBar: Equatable, Sendable { public var fraction: Double; public var message: String; public var secondsLeft: Int? }` and `public enum RunProgress { public static func bar(steps: [InstallStep], elapsed: TimeInterval) -> RunBar; public static func timeLeftText(_ seconds: Int?) -> String?; public static func percentText(_ fraction: Double) -> String }`. Fraction: finished weight (states done, partial, skipped, needsYou) plus the running step's weight times its `progress.percent / 100`, over the total weight (weight defaults to 1). Message: the running step's `phase`, else the last finished step's, else "Getting ready". Seconds left: nil when fraction < 0.05 or elapsed < 20; else `elapsed * (1 - f) / f` rounded. Time text: nil, "Less than a minute left", or "About N minutes left" (N rounded up). Percent text: "42%".
  - `public enum FastSetupRun { public static func arguments(retryFrom: String?) -> [String] }`: nil → `["setup", "apply", "--resume", "--unattended", "--json"]`; an id → `["setup", "apply", "--from", id, "--json"]` (a person pressed Retry, so the run may prompt; rt records it as `continue`, Task 11).

- [ ] **Step 1: Write the failing checks:** `"RunProgress: weights decide the fraction"`; `"RunProgress: a running step's own percent counts"`; `"RunProgress: the message is the running step's phase"`; `"RunProgress: no estimate before twenty seconds or five percent"`; `"RunProgress: time text rounds minutes up"`; `"FastSetupRun: the bar resumes unattended, Retry runs attended from the step"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "RunProgress"` and `swift run mattstack-checks "FastSetupRun"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the checks. Expected: PASS.
- [ ] **Step 5: Commit** `tray: the bar's percent, message and time left from rt's weights`.

### Task 20: Tray Core: background installs, and updates held while setup runs

**Files:**
- Create: `rt-tray/Sources-core/Setup/PrepareRunner.swift`
- Modify: `rt-tray/Sources/Setup/SetupSession.swift` (`runInFlight`), `rt-tray/Sources-core/Updates/UpdatePolicy.swift` (`setupBusy`), `rt-tray/Sources/AppDelegate.swift:59` (the updater's `isBusy`)
- Test: `rt-tray/Tests/MattstackCoreChecks/PrepareRunnerChecks.swift` (create), `UpdatePolicyChecks.swift`, `AllChecks.swift`

**Interfaces:**
- Consumes: `rt setup prepare <stage> --json` (Task 3).
- Produces:
  - `@MainActor public final class PrepareRunner: ObservableObject { @Published public private(set) var running: Set<String>; public init(rt: RtRunning); public func start(_ stage: String); public var onFinished: ((String) -> Void)? }`: one `rt setup prepare <stage> --json` per stage at a time, a second `start` of a running stage does nothing.
  - `public static func setupBusy(windowRunning: Bool, runInFlight: Bool) -> Bool` in `UpdatePolicy` (either holds updates).
  - `SetupSession.setRunInFlight(_ inFlight: Bool, for owner: ObjectIdentifier)` and `SetupSession.runInFlight: Bool`, locked like `owners`; the updater's `isBusy` becomes `{ UpdatePolicy.setupBusy(windowRunning: SetupSession.isRunning, runInFlight: SetupSession.runInFlight) }`.

- [ ] **Step 1: Write the failing checks:** `"PrepareRunner: start runs setup prepare for the stage"`; `"PrepareRunner: a second start while one runs does nothing"`; `"PrepareRunner: a finished stage reports and frees the slot"`; `"UpdatePolicy: a run in flight holds updates with no window open"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "PrepareRunner"` and `swift run mattstack-checks "UpdatePolicy"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the checks, then `swift build --product rt-tray`. Expected: PASS, builds.
- [ ] **Step 5: Commit** `tray: run background installs, and hold updates while setup runs, window or not`.

### Task 21: Tray Core: performing a form row's action

**Files:**
- Create: `rt-tray/Sources-core/Setup/FormActionRunner.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/FormActionRunnerChecks.swift` (create), `AllChecks.swift`

**Interfaces:**
- Consumes: `RowActionDispatcher.dispatch`, `RowVerbRun.apply`, `FormRow` (Task 17).
- Produces:
  - `public protocol FormEffects: Sendable { @MainActor func openURL(_ url: URL); @MainActor func openSettings(_ target: String); func requestPermission(_ which: String) async -> Bool }`.
  - `@MainActor public final class FormActionRunner: ObservableObject { @Published public private(set) var waiting: [String: String]; @Published public private(set) var errors: [String: String]; public init(rt: RtRunning, needs: NeedBroker, effects: FormEffects, reload: @escaping @MainActor () async -> Void); public func perform(_ row: FormRow, values: [String: String]? = nil, alternative: String? = nil) async; public func reconcile(with rows: [FormRow]) }`.
  - Behaviour: `setup apply` verbs go through `RowVerbRun.apply` (its waiting copy shown); other verbs through `rt.run`, with `waiting[row.id] = row.waiting` while they run; a user error or a `ConnectResult` with status `invalid` or `error` sets `errors[row.id]`; `needs-you` keeps `waiting[row.id]` at its detail; `openURL` sets `waiting[row.id] = row.waiting` when present; every path ends with `await reload()`. `reconcile` drops waiting and errors for rows that are now done. `collectFields`, `chooseOption`, `placeRepo` and `chooseFolder` are never sheets here: the view passes `values` and the dispatcher answers with a verb.

- [ ] **Step 1: Write the failing checks:** `"FormActionRunner: Connect Slack waits with rt's line, then reloads"`; `"FormActionRunner: Allow runs proxy.install through the apply stream"`; `"FormActionRunner: a rejected token shows rt's detail on the row"`; `"FormActionRunner: a sign-in still open keeps the row waiting"`; `"FormActionRunner: Add to Chrome opens the store and waits"`; `"FormActionRunner: a done row loses its waiting line"`; `"FormActionRunner: notifications Allow asks macOS, then reloads"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "FormActionRunner"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the checks. Expected: PASS.
- [ ] **Step 5: Commit** `tray: perform a form row's action and track its wait`.

### Task 22: Views: form rows, cards, footer and the snapshot flag

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/FormRowView.swift`, `FormCard.swift`, `FastFooter.swift`, `FastScreenHeader.swift`, `FastSetupSnapshot.swift`
- Modify: `rt-tray/Sources/main.swift` (register the flag), `rt-tray/Sources/AccessibilityIDs.swift`

**Interfaces:**
- Consumes: `FormRow` (Task 17); `RepoPlacementRow` for `place-repo` actions.
- Produces:
  - `struct FormRowView: View { let row: FormRow; let waiting: String?; let error: String?; let onAction: (FormRow, [String: String]?, String?) -> Void }`. Title and subtext on the left, the control on the right; `connect` and `form` actions draw their fields inline with a Return-to-submit button labelled by the action, `create` as a link button ("Create token") and each alternative as a secondary button; a two-option `choose` draws an inline segmented control; `place-repo` embeds `RepoPlacementRow`; `choose-folder` opens `NSOpenPanel` then calls `onAction` with `["root": path]`; `busy` and `waiting` draw a small spinner with the line; `done` draws a green check before the detail; an error line under the row in the failure color.
  - `struct FormCard: View { let title: String?; let rows: [FormRow]; ... }` (one rounded card of rows with dividers).
  - `struct FastScreenHeader: View { let label: String?; let title: String; let subtitle: String? }` and `struct FastFooter: View { let note: String?; let secondary: (String, () -> Void)?; let primary: (String, Bool, () -> Void)? }`.
  - AX ids: `AXID.fastScreen(_ name: String)` = `setup.fast.<name>`, `AXID.fastPrimary(_:)` = `setup.fast.<name>.primary`, `AXID.fastSecondary(_:)`, `AXID.fastRow(_ id: String)` = `setup.fast.row.<id>`, `AXID.fastRowAction(_:)`, `AXID.fastRowField(_:)`.
  - `rt-tray --render-fast-setup-snapshots <out-dir>` (DEBUG only, same shape as `SetupPageSnapshot.runIfRequested`), rendering registered `(name, AnyView)` pairs at `SetupWindowController.width` light and dark as `<name>-<light|dark>.png`. This task registers `rows-<state>` for one row in each state, a connect row with its field, a two-option choose row, and a repo row.

- [ ] **Step 1: Implement** the views and the flag.
- [ ] **Step 2: Build** `cd rt-tray && swift build --product rt-tray`. Expected: builds.
- [ ] **Step 3: Look at it.** Render (the Global Constraints command), Read every PNG in light and dark, and say what reads wrong (alignment of the control column, field width, contrast of subtexts, the check glyph, the spinner line wrapping). Fix and render again until nothing does.
- [ ] **Step 4: Commit** `tray: form rows, cards and the fast setup snapshot flag`.

### Task 23: P1, three things from macOS

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/MacOSScreen.swift`
- Modify: `FastSetupSnapshot.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/FastSetupFlowChecks.swift`

**Interfaces:**
- Consumes: `SetupFormModel` (`load(section: "macos")`, watched every 2 s while shown), `FormActionRunner`, `PermissionSnapshot` overlay (`PermissionRowOverlay`) for the two TCC rows between rt reads, `ReadinessModel.fdaNeedsRelaunch`, `PrepareRunner.start("macos")`, `AppRelaunch.relaunchInPlace`.
- Produces: `struct MacOSScreenBody: View { let rows: [FormRow]; let waiting: [String: String]; let errors: [String: String]; let onAction: ... }` with header title "Three things from macOS" and one card, no footer button. `public static func allDone(_ rows: [FormRow]) -> Bool` on `FastSetupFlow` (every non-optional row done; an empty list is done, so a section with nothing to wait on never holds a button) and `public static func macosReady(_ rows: [FormRow]?) -> Bool` (the macOS section loaded, not empty, and `allDone`), which is what moves P1 on. The container (Task 32) calls `flow.macosDone()` when it turns true, starts `prepare macos` when the screen first shows, and relaunches into the same screen when `fdaNeedsRelaunch` turns true while it is shown.

- [ ] **Step 1: Write the failing checks:** `"FastSetupFlow: macOS is done only when all three rows are"`; `"FastSetupFlow: a macOS section not loaded yet never moves P1 on"`; `"FastSetupFlow: an empty section holds nothing"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "FastSetupFlow"`. Expected: FAIL.
- [ ] **Step 3: Implement** the body and the helper; register snapshots `macos-fresh`, `macos-waiting-admin` (Fancy URLs waiting), `macos-done`.
- [ ] **Step 4: Run** the check. Expected: PASS.
- [ ] **Step 5: Look at it.** Render, Read the six PNGs, say what reads wrong, fix.
- [ ] **Step 6: Commit** `tray: P1, three things from macOS, moving on by itself`.

### Task 24: P2, how are you setting up, and P3, paste your invite

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/PathScreen.swift`, `InviteScreen.swift`
- Modify: `FastSetupSnapshot.swift`, `rt-tray/Sources-core/Setup/TeamChoiceModel.swift` (`inviteLine`)
- Test: `rt-tray/Tests/MattstackCoreChecks/TeamChoiceChecks.swift`

**Interfaces:**
- Consumes: `TeamChoiceModel` (`previewInvite`, `validateAndPrepare`, `inviteCode`, `pasteInvite`), `JoinPageModel.join()`, `SetupFormModel.load(section: "invite")` after a good preview, `FormActionRunner`.
- Produces:
  - `struct PathScreenBody: View { let showsSolo: Bool; let onChoose: (TeamChoice) -> Void }`: header "How are you setting up?", four cards "Join a team", "Create a team", "Just me", "Move from another Mac", each a full-card button; choosing one moves on.
  - `struct InviteScreenBody: View { let code: Binding<String>; let inviteLine: String?; let failure: String?; let rows: [FormRow]; let joinEnabled: Bool; ... }`: header "Paste your invite", the code field (prefilled from the link), the invite line under it, the invite section's rows in a card, footer primary "Join".
  - `public var inviteLine: String?` on `TeamChoiceModel`: `"\(team.name), invited by \(team.owner)"` from the last good dry run.
  - `public static func joinEnabled(verdictOK: Bool, rows: [FormRow]) -> Bool` on `FastSetupFlow`: a good verdict and every non-optional invite row done.

- [ ] **Step 1: Write the failing checks:** `"TeamChoice: a good preview reads Mithrandir, invited by Jane Doe"`; `"FastSetupFlow: Join waits for every invite row, Command Line Tools included"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "TeamChoice"` and `swift run mattstack-checks "FastSetupFlow"`. Expected: FAIL.
- [ ] **Step 3: Implement**; register snapshots `path`, `invite-empty`, `invite-read` (line shown, token row todo), `invite-clt-busy`, `invite-ready`.
- [ ] **Step 4: Run** the checks. Expected: PASS.
- [ ] **Step 5: Look at it.** Render, Read every PNG, say what reads wrong, fix.
- [ ] **Step 6: Commit** `tray: P2's four cards and P3's invite with its token row`.

### Task 25: P3c, create a team

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/CreateTeamScreen.swift`
- Modify: `rt-tray/Sources-core/Setup/TeamChoiceModel.swift` (`forge`, `group`, create arguments), `FastSetupSnapshot.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/TeamChoiceChecks.swift`

**Interfaces:**
- Consumes: `rt team create … --forge --group` (Task 16), `rt setup form --section create --forge <f>` (Task 16).
- Produces: `TeamChoiceModel` gains `@Published public var forge: String = "gitlab"` and `@Published public var group = ""`; create runs `["team", "create", teamName, "--forge", forge, "--group", group, "--others", "--json"]` unless GitHub with a gh handle, which keeps `--create-repo`. `struct CreateTeamScreenBody: View` with a team name field, a "GitLab" / "GitHub" segmented control under "Where its settings live", a group field, the create section's rows (`tool.clt` while git downloads, then the token row), footer primary "Create team", enabled only with a name, a group and every non-optional create row done (`FastSetupFlow.allDone`). After it succeeds the container calls `flow.created()`.

- [ ] **Step 1: Write the failing checks:** `"TeamChoice: create on GitLab sends forge and group"`; `"TeamChoice: create on GitHub with gh keeps create-repo"`; `"TeamChoice: Create team needs a name and a group"`; `"FastSetupFlow: Create team waits for Command Line Tools"` (a busy `tool.clt` row keeps it off).
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "TeamChoice"`. Expected: FAIL.
- [ ] **Step 3: Implement**; register snapshots `create-empty`, `create-clt-busy`, `create-filled`, `create-error`.
- [ ] **Step 4: Run** the checks. Expected: PASS.
- [ ] **Step 5: Look at it.** Render, Read every PNG, say what reads wrong, fix.
- [ ] **Step 6: Commit** `tray: P3c, create a team on GitLab or GitHub`.

### Task 26: P3r, move from another Mac

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/RestoreScreen.swift`
- Modify: `FastSetupSnapshot.swift`

**Interfaces:**
- Consumes: `TeamChoiceModel` restore (`restoreRepo`, `restoreAgeKey`, `validateAndPrepare` with `choice = .restore`); `SetupFormModel.load(section: "restore")`, watched while it holds a busy row (Task 7).
- Produces: `struct RestoreScreenBody: View` with a backup repo field (`janedoe/mattstack-home`), a secure recovery key field with the hint "On your old Mac run rt home key export, or find it in your password manager", the restore section's rows above the footer (the busy `tool.clt` row while git downloads), footer primary "Restore", enabled only with both fields filled and `FastSetupFlow.allDone` over the restore rows. After it succeeds the container calls `flow.restored()`, which starts the bar.

- [ ] **Step 1: Implement**; register snapshots `restore-empty`, `restore-clt-busy`, `restore-error`.
- [ ] **Step 2: Build** `cd rt-tray && swift build --product rt-tray`. Expected: builds.
- [ ] **Step 3: Look at it.** Render, Read every PNG, say what reads wrong, fix.
- [ ] **Step 4: Commit** `tray: P3r, restore from another Mac`.

### Task 27: P4, waiting for your team admin

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/WaitingScreen.swift`
- Modify: `rt-tray/Sources-core/Setup/JoinPageModel.swift` (`onApproved`), `rt-tray/Sources-core/Launch/NotificationClick.swift` (`setupProgressCategory`, `Route.resumeSetup`), `rt-tray/Sources/NotificationManager.swift` (register the category, `fireSetupProgress(title:body:)`), `FastSetupSnapshot.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/JoinPageChecks.swift`, `NotificationClickChecks.swift`

**Interfaces:**
- Consumes: `JoinPageModel` (`waiting`, polling), `JoinStatus.invitedBy` and `team.name` (Task 7).
- Produces:
  - `JoinPageModel.onApproved: (@MainActor (JoinStatus) -> Void)?`, called once when a check first reads approved, whether or not a window is open.
  - `NotificationClick.setupProgressCategory = "setup_progress"`, `Route.resumeSetup` (does not suppress the activation show), `bannerRoute` maps the category to it.
  - `struct WaitingScreenBody: View { let team: String; let admin: String? }`: a ticket SF Symbol in a neutral tile, the team name as a quiet uppercase label, title "Waiting for <admin> to confirm your membership" ("your team admin" when nil), lines "Let them know you're waiting. Setup carries on the moment they approve", "Next: a few questions, then it runs by itself", "We'll let you know when you're in", footer primary "Hide". No progress bar, no copyable message, never the failure color.
  - The container (Task 32) wires `onApproved` to: post "You're in" with body "A few questions, then it runs by itself" in `setup_progress`, start `prepare accounts`, preload the connect section, and `flow.approved()`. `prepare accounts` also starts every time the connect screen shows (it is single flight), so Create, Just me and a relaunch after approval read "Installing…" too.

- [ ] **Step 1: Write the failing checks:** `"JoinPage: approval calls onApproved once"`; `"JoinPage: polling with no page on screen still reports approval"` (`startPolling(every: 0.01)` with no view, ScriptedRt answers waiting then approved, `onApproved` fires once and polling stops); `"NotificationClick: a setup_progress banner resumes setup"`. Task 32 removes the window close's `stopPolling()` call, so nothing but approval or a new join ends the polling.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "JoinPage"` and `swift run mattstack-checks "NotificationClick"`. Expected: FAIL.
- [ ] **Step 3: Implement**; register snapshots `waiting`, `waiting-no-admin`.
- [ ] **Step 4: Run** the checks. Expected: PASS.
- [ ] **Step 5: Look at it.** Render, Read every PNG; confirm the wait never reads as a failure (no coral, no warning glyph); fix what reads wrong.
- [ ] **Step 6: Commit** `tray: P4, a calm wait that keeps checking after Hide`.

### Task 28: P5, connect your accounts

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/ConnectScreen.swift`
- Modify: `FastSetupSnapshot.swift`

**Interfaces:**
- Consumes: `SetupFormModel` (`load(section: "connect")`, `watch(section: "connect")` while shown, and a reload on `NSApplication.didBecomeActiveNotification`), `FormActionRunner`, `PrepareRunner.start("accounts")` each time the screen shows.
- Produces: `struct ConnectScreenBody: View { let teamFirst: Bool; let rows: [FormRow]; let waiting: [String: String]; let errors: [String: String]; let continueReady: Bool; ... }`: header title "You're in. Connect your accounts" on a team path ("Connect your accounts" on Just me), subtitle "One click each. Most open in your browser", one card, footer note "Continue unlocks once each one is connected" and primary "Continue" enabled by `continueReady`.

- [ ] **Step 1: Implement**; register snapshots `connect-fresh` (Claude installing, Slack todo, Doppler todo, herdr installing as an extra row, a StrongDM email field, Linear field, Fast Browser todo), `connect-waiting` (Slack waiting, Claude paste code, Fast Browser waiting for Chrome), `connect-done`, `connect-solo`, `connect-get-chrome`.
- [ ] **Step 2: Build** `cd rt-tray && swift build --product rt-tray`. Expected: builds.
- [ ] **Step 3: Look at it.** Render, Read every PNG, say what reads wrong (row height with an inline field, the paste-code field beside the waiting line), fix.
- [ ] **Step 4: Commit** `tray: P5, one click each, rows that watch themselves`.

### Task 29: P5b, last bit: this Mac

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/ThisMacScreen.swift`
- Modify: `FastSetupSnapshot.swift`

**Interfaces:**
- Consumes: `SetupFormModel.load(section: "this-mac")`, `FormActionRunner`, `RepoPlacementRow` through `FormRowView`.
- Produces: `struct ThisMacScreenBody: View { let teamName: String?; let rows: [FormRow]; let startReady: Bool; ... }`: header title "Last bit: this Mac", subtitle "Where <team>'s repos and your settings live" ("Where your repos and settings live" on Just me), a "Your repos" card, a "Your settings" card, footer note "About 10 minutes once you start" and primary "Set up this Mac" enabled by `startReady`, which calls `flow.startRun()`.

- [ ] **Step 1: Implement**; extra rows a run left (Task 10) draw in a third card titled "Still to do"; register snapshots `this-mac` (two repos, one found, the board's), `this-mac-remote` (remote chosen, repo row todo), `this-mac-solo` (with the busy `tool.clt` row), `this-mac-leftover` (a `tool.shell` row the run left).
- [ ] **Step 2: Build** `cd rt-tray && swift build --product rt-tray`. Expected: builds.
- [ ] **Step 3: Look at it.** Render, Read every PNG, say what reads wrong, fix.
- [ ] **Step 4: Commit** `tray: P5b, where repos and settings live`.

### Task 30: P6 and P6b, one progress bar and Setup paused

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/RunScreen.swift`
- Modify: `FastSetupSnapshot.swift`

**Interfaces:**
- Consumes: `InstallRunModel` (steps, phase, logs), `RunProgress.bar`, `RunProgress.timeLeftText`, `SetupForm.paused` (Task 14; the container re-reads the form when a run ends, so a live failure and a relaunch on stage `paused` read the same thing), `LogSheet`.
- Produces: `struct RunScreenBody: View { let bar: RunBar?; let paused: FormPaused?; let onHide: () -> Void; let onShowLog: () -> Void; let onRetry: () -> Void; let onPausedAction: ((RowAction) -> Void)? }`. Running: title "Setting up this Mac", subtitle "Nothing needs you. Close the window if you like", one bar, under it the message on the left and "<percent>" with the time-left text on the right, footer primary "Hide"; no step list. Paused: title "Setup paused", the bar stopped at its fraction in a neutral color, `paused.title` ("Couldn't clone your repos") then the detail then the remedy when present, "Everything before this step is done", footer secondary "Show log", primary "Retry", and `paused.action`'s button ("Open Login Items…") beside them only when rt sent one. Show log opens `LogSheet` with this app's lines for the step, or `paused.log` when it has none (after a relaunch). The view ticks every second (`TimelineView(.periodic)`) for elapsed time.

- [ ] **Step 1: Implement**; register snapshots `run-early` (no estimate yet), `run-mid` (cloning, 42%, "About 4 minutes left"), `run-late`, `paused` (detail "GitLab says your token can't see acme/acme-api"), `paused-login-items` (with the Open Login Items button).
- [ ] **Step 2: Build** `cd rt-tray && swift build --product rt-tray`. Expected: builds.
- [ ] **Step 3: Look at it.** Render, Read every PNG; confirm the bar never looks stuck and the paused state is calm; fix what reads wrong.
- [ ] **Step 4: Commit** `tray: P6's one bar and P6b's Setup paused`.

### Task 31: P7, this Mac is ready

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/ReadyScreen.swift`
- Modify: `FastSetupSnapshot.swift`

**Interfaces:**
- Consumes: `SetupForm.home` (Task 14).
- Produces: `struct ReadyScreenBody: View { let home: FormHome; let onOpen: () -> Void }`: a large green check, "This Mac is ready", "Go make something cool", primary button `home.label` ("Open the board"). No summary list.

- [ ] **Step 1: Implement**; register snapshots `ready`, `ready-solo`.
- [ ] **Step 2: Build** `cd rt-tray && swift build --product rt-tray`. Expected: builds.
- [ ] **Step 3: Look at it.** Render, Read every PNG, say what reads wrong, fix.
- [ ] **Step 4: Commit** `tray: P7, this Mac is ready`.

### Task 32: Wire the new flow everywhere setup opens

**Files:**
- Create: `rt-tray/Sources/Setup/Fast/FastSetupView.swift`, `rt-tray/Sources/Setup/Fast/AppFormEffects.swift`
- Modify: `rt-tray/Sources/Setup/SetupWindowController.swift`, `SetupCoordinator.swift`, `SetupSession.swift`, `rt-tray/Sources/AppDelegate.swift` (the `setup_progress` route; the `setup_update` route opens the same window), `rt-tray/Sources/AppRelaunch.swift` (`relaunchInPlace(resumeScreen:)`), `rt-tray/Sources-core/Launch/LaunchGuard.swift` (`SetupCompletion.onLaunch` keeps deciding only whether to show)
- Test: `rt-tray/Tests/MattstackCoreChecks/LaunchChecks.swift`, `FastSetupFlowChecks.swift`

**Interfaces:**
- Consumes: everything in Tasks 17 to 31; `FastSetupRun.arguments`.
- Produces:
  - `struct FastSetupView: View` switching on `flow.screen` (`.loading` draws "Checking where setup left off…"), owning one `SetupFormModel` and one `FormActionRunner` (with `AppFormEffects`), calling the flow methods named in each screen task.
  - `SetupCoordinator`: one `FastSetupFlow`; `install = InstallRunModel(stream: { from in rt.stream(FastSetupRun.arguments(retryFrom: from), stdin: nil) }, needs:)`; a `PrepareRunner`; `SetupSession.setRunInFlight(install.isRunning || !prepare.running.isEmpty, ...)` on every change; `join.onApproved` wired as Task 27 says; `prepare.start("macos")` whenever P1 shows and `prepare.start("accounts")` whenever the connect screen shows; `showSetup(entry:choice:joinCode:)` loads the whole form and `flow.land(on: stage)`, then starts the bar (`install.start()`) when the screen is `.running` and no run is live in this app; the end of a run re-reads the form and calls `flow.runEnded(stage:)`, posting "This Mac is ready" / "Go make something cool" or "Setup paused" / the paused title in `setup_progress` when the window is not key.
  - Entries: first run and "Resume setup…" → `entry .firstRun`; "Setup status…" and the `setup_update` click → `entry .status` in the same window (the read-only status window and `statusReadiness`/`statusInstall` go); Settings' Join and Create → `entry .upgrade` with `requested` set; a join link → the invite screen with the code.
  - The window is always closable. Closing never stops join polling or a run (`windowWillClose` drops its `environment.join.stopPolling()` call).
  - `public enum FastSetupLaunch { public static func startsRun(stage: FormStage, runLive: Bool) -> Bool }` in `FastSetupFlow.swift`: true for `.running` when this app has no live run. Closing on P7, or pressing its button, runs `rt setup finish --json` (as `recordFinish` does) and opens `home.url` (stub mode logs instead).
  - `SetupWindowController.applyStyle` marks the window running while it is visible and the screen is not `.ready`.

- [ ] **Step 1: Write the failing checks:** `"FastSetupFlow: a launch on stage running starts the bar with --resume"` (`FastSetupLaunch.startsRun(stage: .running, runLive: false)` is true, with a live run false, and the install stream's arguments are `FastSetupRun.arguments(retryFrom: nil)`); `"Launch: an unfinished Mac still opens setup at launch"`; `"FastSetupFlow: a run that ends lands where rt says"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "FastSetupFlow"` and `swift run mattstack-checks "Launch"`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring. The old `SetupView` is no longer reached; leave its files for Task 34.
- [ ] **Step 4: Run** the checks, then `swift build --product rt-tray`. Expected: PASS, builds.
- [ ] **Step 5: Look at it.** Extend `FastSetupSnapshot` with `container-loading` and one full-window render per screen through `FastSetupView` driven by fixture forms; render, Read every PNG, say what reads wrong, fix.
- [ ] **Step 6: Commit** `tray: the new flow is setup, from first run to Setup status and Settings`.

### Task 33: Nothing asks before P1

**Files:**
- Create: `rt-tray/Sources-core/Launch/LaunchPrompts.swift`
- Modify: `rt-tray/Sources/AppDelegate.swift` (`setupNotifications`, `autoRegisterLoginItem`, `checkMissionControlConflict`)
- Test: `rt-tray/Tests/MattstackCoreChecks/LaunchChecks.swift`

**Interfaces:**
- Produces: `public enum LaunchPrompts { public static func asksAtLaunch(setupFinished: Bool) -> Bool }` (true only when setup finished). At launch, `notificationManager.requestPermission()`, `autoRegisterLoginItem()` and the Mission Control notification run only when it is true; categories still register. P7's finish path (Task 32) calls `autoRegisterLoginItem()` once.

- [ ] **Step 1: Write the failing check:** `"Launch: an unfinished Mac is asked nothing before P1"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "Launch"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the check and `swift build --product rt-tray`. Expected: PASS, builds.
- [ ] **Step 5: Commit** `tray: no notification prompt or login item before P1`.

### Task 34: Retire the old wizard

**Files:**
- Delete: `rt-tray/Sources/Setup/SetupView.swift`, `SetupPageSnapshot.swift`, `Screens/WelcomeScreen.swift`, `Screens/FullDiskAccessScreen.swift`, `Screens/TeamScreen.swift`, `Screens/JoinScreen.swift`, `Screens/InstallScreen.swift`, `Screens/SummaryOverview.swift`; `rt-tray/Sources-core/Setup/SetupFlowModel.swift` (keeping `SetupEntry`, moved to `FastSetupFlow.swift`), `WizardPages.swift`, `FullDiskAccessPage.swift`, and `DoneModel` with what only it uses in `FinishGate.swift`; the matching checks (`SetupFlowChecks`, `WizardPagesChecks`, `FullDiskAccessPageChecks`, `DoneModelChecks`) and their `AllChecks` entries
- Modify: `rt-tray/Sources/main.swift` (drop `SetupPageSnapshot`), `SetupResume.swift` (drop the step functions), `LaunchGuard.swift` (`resumeStep` goes; `onLaunch` returns whether to show), `ChecklistScreen.swift` (drop the `.page` and `.sidebar` presentations; `.accounts` and `.rows` stay), `rt-tray/Tests/stub-rt/stub.ts` only if a removed type is named there

**Interfaces:**
- Consumes: nothing new. `ChecklistScreen(.accounts)`, `RowView`, `ReadinessModel` and `WaiverClient` stay for Settings.

- [ ] **Step 1: Delete** the files and fix every reference the compiler names.
- [ ] **Step 2: Build and check:** `cd rt-tray && swift build --product rt-tray`, then `swift run mattstack-checks ""` (every check). Expected: builds; `checks: N passed, 0 failed`.
- [ ] **Step 3: Look at it.** Render `--render-checklist-row-snapshots "$TMPDIR/rows"` and `--render-fast-setup-snapshots "$TMPDIR/fast"` under an isolated HOME; Read the PNGs and confirm Settings' rows and the new screens are unchanged.
- [ ] **Step 4: Commit** `tray: retire the old setup wizard`.

### Task 35: Settings holds Mission Control, Chrome sign-in and skill overrides

**Files:**
- Create: `rt-tray/Sources-core/Settings/SettingsExtras.swift`, `rt-tray/Sources/Settings/SettingsExtrasSnapshot.swift`
- Modify: `rt-tray/Sources/Settings/GeneralPane.swift` (a "Keyboard" section with `tool.mission-control`; a "Skill overrides" section when `skills.overrides` shows), `rt-tray/Sources/Settings/FastBrowserPane.swift` (a "Chrome sign-in" section when `tool.chrome-signin` shows), `rt-tray/Sources/main.swift` (register the flag)
- Test: `rt-tray/Tests/MattstackCoreChecks/SettingsChecks.swift`

**Interfaces:**
- Consumes: `ReadinessModel.row(_:)` over `setup plan`; rt decides when each row exists (Tasks 15 and the validators).
- Produces: `public enum SettingsExtras { public static func shows(_ row: PlanRow?) -> Bool }` (a present row that is neither ready nor skipped; Mission Control shows whenever present). Each section draws `RowView` with the row's own action. `rt-tray --render-settings-extras-snapshots <out-dir>` (DEBUG) renders the three sections from fixture rows, light and dark, as `extras-<row>-<scheme>.png`.

- [ ] **Step 1: Write the failing checks:** `"SettingsExtras: a row that is not there shows nothing"`; `"SettingsExtras: skill overrides with old keys show"`; `"SettingsExtras: a ready Chrome sign-in hides"`.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "SettingsExtras"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the checks and build. Expected: PASS.
- [ ] **Step 5: Look at it.** `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin .build/debug/rt-tray --render-settings-extras-snapshots "$TMPDIR/extras"`; Read every PNG light and dark; say what reads wrong; fix.
- [ ] **Step 6: Commit** `tray: Mission Control, Chrome sign-in and skill overrides live in Settings`.

### Task 36: The proxy helper installs Homebrew in the same escalation

**Files:**
- Create: `rt-tray/proxy-helper/Sources/ProxyInstall/HomebrewStep.swift`, `rt-tray/proxy-helper/homebrew-pin.json`, `rt-tray/proxy-helper/Tests/ProxyInstallTests/HomebrewStepTests.swift`
- Modify: `rt-tray/proxy-helper/Sources/ProxyInstall/main.swift` (`install --homebrew`, `trust --homebrew`, `homebrew`), `Pins.swift` (`homebrewPkgUrl`, `homebrewPkgSha256`), `rt-tray/proxy-helper/scripts/gen-pins.sh` (reads the pin file), `Report.swift` (`homebrewLine`), `rt-tray/Sources/Services/PrivilegedInstaller.swift`, `rt-tray/Sources-core/Needs/NeedBroker.swift` (passes `homebrew`, handles op `homebrew`), `rt-tray/Sources-core/Needs/NeedModels.swift` (`PrivilegedInstalling`), the checks' fake installer
- Test: `HomebrewStepTests.swift`, `rt-tray/Tests/MattstackCoreChecks/NeedBrokerChecks.swift`

**Interfaces:**
- Consumes: `NeedRequest.homebrew` and op `homebrew` (Task 2).
- Produces:
  - `homebrew-pin.json`: `{ "version": "<latest Homebrew release>", "url": "https://github.com/Homebrew/brew/releases/download/<version>/Homebrew-<version>.pkg", "sha256": "<hex>" }` (look up the latest release with `gh release view --repo Homebrew/brew`, download once into the session scratchpad to compute the sha).
  - `struct HomebrewStep { let fs: FileOps; let runner: CommandRunner; let pins: PinsValues; func run() -> HomebrewOutcome }` with `enum HomebrewOutcome: String { case ok, present, failed }`: present when `/opt/homebrew/bin/brew` or `/usr/local/bin/brew` exists; else download the pinned URL with `/usr/bin/curl --fail --location --proto =https -o <root-owned stage>` (stage under `ProxyPaths.root`, never a user path, never argv), refuse a sha that differs, run `/usr/sbin/installer -pkg <stage> -target /`, delete the stage either way. It runs first and is never fatal: the op goes on and reports `MATTSTACK_HOMEBREW=<outcome>` on its own line before the trust line.
  - `PrivilegedInstalling.proxyInstall(homebrew: Bool)`, `proxyTrust(homebrew: Bool)`, `homebrew()`; the helper's prompt text is unchanged.

- [ ] **Step 1: Write the failing tests:** XCTest `testPresentBrewSkipsTheDownload`, `testShaMismatchRefusesAndRemovesTheStage`, `testInstallerFailureIsReportedNotFatal`, `testInstallRunsTheInstallerOnThePinnedPackage`; checks `"NeedBroker: a proxy install with homebrew passes the flag"`, `"NeedBroker: the homebrew op runs the helper's homebrew verb"`.
- [ ] **Step 2: Run** `cd rt-tray/proxy-helper && swift test --filter HomebrewStepTests` (after the gen-pins step in the Global Constraints) and `cd rt-tray && swift run mattstack-checks "NeedBroker"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the commands from Step 2, `swift test --filter InstallOpTests`, and `cd rt-tray && swift build --product rt-tray`. Expected: PASS, builds.
- [ ] **Step 5: Commit** `proxy helper: install Homebrew in the same admin prompt`.

### Task 37: The stub rt answers the new verbs

**Files:**
- Modify: `rt-tray/Tests/stub-rt/stub.ts`
- Test: `rt-tray/Tests/stub-rt/stub.test.ts`

**Interfaces:**
- Consumes: the `SetupForm`, `PrepareResult`, `ConnectResult` shapes (Tasks 1 to 14).
- Produces: per scenario, `setup form [--section]` answers a form whose stage walks the scenario (join-happy: macos, path, invite, waiting, then connect after two join-status calls, then this-mac, running, ready); `setup prepare` answers `{ installed: [...] }`; `setup claude connect` answers needs-you then ready; `setup apply --resume --unattended --json` streams a plan with phases and a done.

- [ ] **Step 1: Write the failing tests:** `"setup form walks the join scenario's stages"`; `"apply --resume streams phases and ends ok"`; `"prepare answers what it installed"`.
- [ ] **Step 2: Run** `bun test rt-tray/Tests/stub-rt/stub.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expected: PASS.
- [ ] **Step 5: Commit** `stub rt: answer the fast setup verbs`.

### Task 38: The clean-room scripts follow the new screens

**Files:**
- Modify: `rt-tray/vm/run/guest/screens.sh`, `rt-tray/vm/run/guest/drive-setup.sh`, `rt-tray/vm/run/walkthrough.sh`, `rt-tray/vm/README.md`
- Test: `rt-tray/vm/check-vm-scripts.sh`, `rt-tray/vm/run/helpers/__tests__/wizard-pages.test.sh`, `rt-tray/vm/run/helpers/__tests__/join-rows.test.ts`

**Interfaces:**
- Consumes: the AX ids from Task 22 (`setup.fast.<screen>`, `.primary`, `setup.fast.row.<id>.action`).
- Produces: one `screen_<name>` function per screen in drive order (macos, path, invite, waiting, connect, this-mac, running, ready), each waiting on its `setup.fast.<screen>` element, pressing what the member would, and screenshotting `<nn>-<screen>`; the approve-join handshake moves to `screen_waiting`. Not run: the clean room needs the operator's go.

- [ ] **Step 1: Rewrite** the screen drivers and the README's screenshot list.
- [ ] **Step 2: Run** `bash rt-tray/vm/check-vm-scripts.sh`, `bash rt-tray/vm/run/helpers/__tests__/wizard-pages.test.sh` (its expected list becomes the new screens) and `bun test rt-tray/vm/run/helpers/__tests__/join-rows.test.ts`. Expected: PASS.
- [ ] **Step 3: Commit** `clean room: drive the fast setup screens`.

### Task 39: Docs and rules

**Files:**
- Modify: `website/docs/start/install.mdx`, `website/docs/start/setup.mdx`, `website/docs/start/teams.mdx`, `website/docs/start/settings.mdx`, `.claude/rules/setup.md` (the checklist section becomes the form and the bar; Finish rules), `.claude/rules/team-switchboard.md` (board peering never shows in setup)

- [ ] **Step 1: Docs.** Load the `rt:docs` skill and follow it. Describe the new order (three macOS switches, four choices, invite, wait, connect, this Mac, one bar, ready), what each answer lets mattstack do, the Settings home of Mission Control, Chrome sign-in and skill overrides, keep on this Mac versus a remote repo, and that setup resumes by itself after a relaunch. Remove every checklist, Install button and Summary reference. Run the website checks the skill names. Expected: green.
- [ ] **Step 2: Rules.** Reword the two rule files so they state today's mechanics only (no history), naming `rt setup form`, `rt setup prepare`, `--resume`/`--unattended`, and the finish gate: the extension, the repos, the team's accounts, the approval-wait rows and the `finish` targets in `ROW_TARGETS` (the rows Install sets up), with the rule that every row blocking Install or Finish has a screen (a form row, an extra row, or a leftover on the this-Mac screen after a run).
- [ ] **Step 3: Run** `bash scripts/repo-purity.sh`. Expected: ok.
- [ ] **Step 4: Commit** `docs: fast setup, answer once, wait once, one bar`.

---

## Morning spikes (operator at the Mac; not executed overnight)

Each spike runs on the operator's own Mac with the branch's tray built into a scratch directory, never `/Applications`. Each ends with a short note in the PR and, where its result changes code, a follow-up task.

### Task 40 (SPIKE, morning only): `claude auth login` without a terminal

- [ ] Under an isolated HOME with a scratch `CLAUDE_CONFIG_DIR`, run `rt setup claude connect --json` from a non-terminal shell (`</dev/null`). Record: did claude open the browser itself, did the localhost hand-back sign in with no code, what did the log at `~/.mattstack/rt/logins/claude.log` show, did `script` change anything.
- [ ] If it signs in with no code: keep the session path, and the Paste code field stays only as the fallback the form shows while waiting. If it needs a code: confirm `rt setup claude code` with the browser's code signs in; adjust `LOGIN_SPECS.claude.promptPattern` to the real prompt. If neither works: say so, and the fallback to plan is a terminal-free `claude setup-token` flow.

### Task 41 (SPIKE, morning only): Doppler's login without a terminal

- [ ] Run `rt setup doppler connect --json` from a non-terminal shell. Record the real flags (`--yes` or its current name), the exact auth-code line, and whether `doppler me --json` turns ready after the browser confirm.
- [ ] Fix `LOGIN_SPECS.doppler` (argv and `codePattern`) to match; if Doppler refuses without a TTY even under `script`, keep the Sign in row and record the refusal text for a follow-up.

### Task 42 (SPIKE, morning only): one admin prompt for proxy, certificate and Homebrew

- [ ] On a Mac without Homebrew (or a fresh VM user, by hand), press Fancy URLs Allow. Count the dialogs: the escalation prompt, then the trust-settings prompt `TrustStep` documents. Record whether Homebrew's pkg installed with the console user as owner of `/opt/homebrew`.
- [ ] The build ships two dialogs back to back on P1 (still before anything else runs). Try one prompt: request `system.privilege.admin` and `com.apple.trust-settings.admin` in one `AuthorizationCopyRights` and write the trust from the app with `SecTrustSettingsSetTrustSettings`; if one dialog results, plan the change as a follow-up task; if not, record why.

### Task 43 (SPIKE, morning only): watching for the Fast Browser extension

- [ ] With Chrome open, press Add to Chrome on P5 and time how long the row takes to flip to Added with the shipped watch (a serial re-read of the connect section, about 20 s per read because of `fast-browser doctor`, plus a re-read on activate).
- [ ] If it is slower than a member will wait, try a cheaper probe (`fast-browser doctor --checks extension-installed --json`, or watching Chrome's profile `Preferences` for the extension id) behind a `--row tool.fast-browser-extension` form read, and plan it as a follow-up task.
