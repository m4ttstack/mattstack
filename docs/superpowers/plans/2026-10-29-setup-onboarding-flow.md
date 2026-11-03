# Setup onboarding flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new member goes from invite to a working board in one pass: Full Disk Access first, then join and wait for the admin, then one checklist where every step is expected, then one Install that also points the board at its repo.

**Architecture:** rt owns every decision. A new approval helper (`lib/team/approval.ts`) and a `rt setup join-status` verb tell the tray whether the admin approved. One id-keyed post-pass in `composePlan` (`lib/setup/expectations.ts`) sets each row's gate (before Install, before Finish, can skip, information only), the way `applyInstallSatisfiedFlip` already does for Install-only rows. Two new apply steps (`board.cwds`, `board.restart`) and a migration own the board's folder. The tray gains two wizard steps (Full Disk Access, Join) and loses its Optional section; its views stay dumb over the contract.

**Tech Stack:** Bun + TypeScript (rt CLI, `bun:test`), Swift 6 / SwiftUI (rt-tray, `MattstackCore` checks harness), bash (rt-tray/vm clean room), Docusaurus MDX (website/docs).

**Spec:** `docs/superpowers/specs/2026-10-29-setup-onboarding-flow-design.md` (read its "Decisions" and "Calls made after the builder check": they are settled). Mocks: boards O1 to O7 in `docs/apps/design/setup/setup.pen`; open them only through the pencil MCP, never Read or grep the file.

## Global Constraints

- Read before touching code: root `AGENTS.md`, `.claude/rules/setup.md`, `.claude/rules/output-setup-and-services.md`, `.claude/rules/team-switchboard.md`, `.claude/rules/settings.md`, `.claude/rules/rt-ui.md` (Swift tasks).
- TS tests run from the worktree root, targeted only: `bun test <file>`. Never the full suite locally; CI runs it.
- Swift checks: `cd rt-tray && swift run mattstack-checks "<name substring>"` (prints `checks: N passed, M failed`, exit 1 on failure). If `rt-tray/deps/tools/sparkle-xcframework` is missing, run `scripts/fetch-deps.sh arm64` from the worktree root once first. `swift test` is not available under CLT.
- A built binary (rt, rt-tray) only ever runs under an isolated HOME: `env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin <binary> …`. Never rebuild, re-sign or reinstall `/Applications/*.app`.
- A copy change updates `commands/__tests__/setup-copy.test.ts` snapshots on purpose: `bun test commands/__tests__/setup-copy.test.ts --update-snapshots`, then read the snapshot diff and confirm only the intended rows moved. A machine-view change (a new Row or Action field) also lands in `rt-tray/Sources-core/Contract/PlanModels.swift` and `rt-tray/Tests/MattstackCoreChecks/PlanModelsChecks.swift` in the same task.
- Copy follows the `rt:ui-copy` skill (short plain clauses, no dot separators). Exact strings the spec fixes: "Waiting for your team admin to approve your request to join the team", "Reopen mattstack", "Add to Chrome", "You can skip", "only if you won't use it", "The board's review, respond and doctor agents start here", "Point the board at <repo>", "Restart the board", "N skipped".
- The three skippable row ids: `skills.overrides`, `tool.chrome-signin`, `tool.mission-control`. The two information rows: `tool.path`, `team.push-access`.
- Board restart goes through the existing seam `restartAppWithDeck(p, "board")` in `lib/deps/resolve.ts`, injected so tests never spawn deck.
- A migration changes only this Mac, writes `board.cwds` at machine scope only, and gets a dated id never renamed.
- Every tray UI change ends with rendering it in light and dark through the DEBUG snapshot flags (`SnapshotRenderer`), reading each PNG with the Read tool, and saying plainly what looks wrong. Tests do not replace looking.
- Commit after each task: `git add` only that task's files, short imperative message, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No mattstack ticket ids in code, comments or tests.

## Review Focus

1. **A joiner whose redeem already cleared the intent.** `joinRedeem` calls `clearIntent` on success, so after the Join page the plan's `team.mode` reads `"none"` with the slug set. The gates, the approval-wait pass and the tray's resume must still treat this Mac as a joiner (they key on `readTeamLocal(...).joinedByRt`, never on intent). Test in Task 1 and Task 8.
2. **No daemon before Install.** A fresh joiner has no rt daemon yet, so `team:pull` answers null. `rt setup join-status` must still fetch and fast-forward the clone itself and never report "daemon unreachable" as a failure. Test in Task 2.
3. **A "Must" row with nothing to press.** An error row or a row whose only action is Re-check must never become `required` (Install unreachable, `.claude/rules/setup.md`). Test, over every composed fixture plan, that no required non-ready row lacks an action other than Re-check. Test in Task 3.
4. **A hand-set `board.cwds`.** A value the member set by hand (not the one rt recorded) is never overwritten by Install, a placement change or the migration; a `board.projects` entry matching two tracked identities on different hosts writes nothing. Test in Task 4 and Task 5.
5. **A waiver stored before this change.** A Mac that skipped `tool.fast-browser-extension` keeps that id in `setup.waived`. It is no longer waivable, so the row blocks Finish again and Settings' Fast Browser pane must not show "Skipped on this Mac". `rt setup unwaive tool.fast-browser-extension` still clears it. Test in Task 3 and Task 9.

---

### Task 1: Approval helper and the approval wait on dependent rows

**Files:**
- Create: `lib/team/approval.ts`
- Modify: `lib/team/team-local.ts` (`TeamLocalRecord.joinedAt`, `readTeamLocal`), `lib/team/join.ts:595`, `lib/setup/team-slack-secret.ts`, `lib/setup/plan.ts` (`composePlan`)
- Test: `lib/team/__tests__/approval.test.ts` (create), `lib/setup/__tests__/team-slack-secret.test.ts`, `lib/setup/__tests__/plan.test.ts`

**Interfaces:**
- Produces:
  - `export type ApprovalState = { kind: "not-joined" } | { kind: "waiting"; since: string | null } | { kind: "approved" } | { kind: "unreadable"; path: string; reason: string }` in `lib/team/approval.ts`.
  - `export function approvalState(p: Pick<Probes, "readFile" | "home">, slug: string): ApprovalState`.
  - `export function ownRecipients(p: Pick<Probes, "readFile" | "home">, slug: string): Set<string>` (moved from `team-slack-secret.ts`, unchanged).
  - `export const APPROVAL_WAIT_DETAIL = "Waiting for your team admin to approve your request to join the team"`.
  - `export const APPROVAL_DEPENDENT_IDS = ["account.slack", "team.sync", "org.admin-secrets", "account.board-peering"] as const`.
  - `export function applyApprovalWait(groups: Group[], wait: ApprovalState): Group[]` in `lib/setup/plan.ts`.
  - `TeamLocalRecord.joinedAt?: string` (ISO time the redeem stamped `joinedByRt`).

- [ ] **Step 1: Write the failing tests** in `lib/team/__tests__/approval.test.ts`, seeding files through `fakeProbes({ files })` (`lib/setup/__tests__/fakes.ts`, home `/fake-home`): the team record at `teamLocalPath("/fake-home", "acme")` and `.sops.yaml` at `join(orgDirUnder("/fake-home", "acme"), ".sops.yaml")` with a `path_regex: mattstack/org/secrets/.*` rule (`TEAM_PATH_REGEX`).
  - `"a Mac that did not join by invite has nothing to wait on"` → `{ kind: "not-joined" }`.
  - `"joined, and this Mac's key is a members recipient -> approved"`.
  - `"joined, key only in the admins rule -> still waiting"` → `{ kind: "waiting", since: <record.joinedAt> }`.
  - `"joined, no .sops.yaml in the clone -> unreadable, naming the file"` → `reason: "is missing"`.
  - `"a .sops.yaml rt did not write -> unreadable"` (`parseSopsRules` returns null) → `reason: "has a rule rt did not write"`.
  - `"the key recorded at join counts before Install writes the personal recipients file"`.
  - `"an org with no Slack secret still resolves approved"` (no `secrets/board.json` at all).
- [ ] **Step 2: Run** `bun test lib/team/__tests__/approval.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `approvalState`.** Order: `!readTeamLocal(p, slug).joinedByRt` → not-joined; `ownRecipients` empty → not-joined (same as `slackSecretWait` today); read `.sops.yaml` with `p.readFile`; parse with `parseSopsRules` from `lib/secrets/team-store.ts`; the members rule is the one whose `pathRegex === TEAM_PATH_REGEX`; any own key in its recipients → approved, else waiting with `since: record.joinedAt ?? null`. Move `ownRecipients` here and import it back into `team-slack-secret.ts`.
- [ ] **Step 4: Run** the approval test. Expected: PASS.
- [ ] **Step 5: Write the failing tests** for the rest:
  - `team-slack-secret.test.ts`: `"waiting on approval reads awaiting acceptance before the board file is looked at"` (no `board.json`, key not in `.sops.yaml` → `{ kind: "awaiting-acceptance" }`, where today it reads `not-shared`). The existing `not-shared` cases keep passing once `.sops.yaml` lists the key.
  - `plan.test.ts`, new `describe("approval wait")`:
    - `"while waiting, Slack, team sync, org secrets and board peering show the wait, never their own error"`: each of the four rows present reads `status: "needs-you"`, `detail: APPROVAL_WAIT_DETAIL`, `action: { type: "run", label: "Check again", verb: ["setup", "join-status"] }`, `required: false`, `finishGated: true`, `waivable: false`.
    - `"once approved the four rows are the validators' own"` (deep-equal to a run with `applyApprovalWait` skipped).
    - `"the redeem cleared the intent: a joined clone with no intent still waits"` (no intent file, `orgs: ["acme"]`, record `joinedByRt: true`).
  - `lib/team/__tests__/join.test.ts` (existing file): `"a redeem stamps joinedAt beside joinedByRt"` asserting `readTeamLocal(p, slug).joinedAt === p.now().toISOString()`.
- [ ] **Step 6: Run** `bun test lib/setup/__tests__/team-slack-secret.test.ts lib/setup/__tests__/plan.test.ts lib/team/__tests__/join.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 7: Implement.** `slackSecretWait` first asks `approvalState`: `waiting` → `{ kind: "awaiting-acceptance" }`; `not-joined` → null; otherwise its current `board.json` checks. `readTeamLocal` keeps `joinedAt` when it is a string. `join.ts:595` writes `{ joinedByRt: true, joinedAt: p.now().toISOString() }`. In `composePlan`, compute `const wait = team.slug ? approvalState(i.p, team.slug) : { kind: "not-joined" as const }` and insert `applyApprovalWait(…, wait)` between `gateTeamAccounts` and `applyFinishGate`; it rewrites only rows whose id is in `APPROVAL_DEPENDENT_IDS` and only when `wait.kind === "waiting"`.
- [ ] **Step 8: Run** the three test files again. Expected: PASS. Then `bun test commands/__tests__/setup-copy.test.ts`; a failure here means a fixture now waits, so fix the fixture (give it a recipient), never the assertion.
- [ ] **Step 9: Commit** `team: approval state from the org's sops recipients, and the wait on rows that need it`.

### Task 2: `rt setup join-status`, with a pull that works before the daemon

**Files:**
- Create: `lib/team/org-pull.ts`
- Modify: `commands/setup.ts` (new handler `setupJoinStatus`), `lib/command-tree-def.ts` (setup node, beside `waive`)
- Test: `lib/team/__tests__/org-pull.test.ts` (create), `commands/__tests__/setup-join-status.test.ts` (create)

**Interfaces:**
- Consumes: `approvalState` (Task 1); `layoutGate` (`lib/daemon/home-snapshot.ts`); `checkedOutBranch` (`lib/team/org-branch.ts`); `gitWithToken` (`lib/team/git-credential.ts`); `storedForgeToken` (`lib/team/stored-forge-token.ts`); `PULL_TIMEOUT_MS` (the constant `lib/setup/steps/org.ts` already imports); `readTeamSnapshot` (`lib/setup/team-settings.ts`).
- Produces:
  - `export type OrgPull = { outcome: "pulled" | "up-to-date" | "held" | "skipped" | "failed"; detail: string }`.
  - `export async function pullOrgClone(p: Probes, slug: string, seams?: { token?: (p: Probes, remote: string) => Promise<string | null> }): Promise<OrgPull>`.
  - `export interface JoinStatus { team: { slug: string; name: string }; state: ApprovalState["kind"]; since: string | null; uses: { repos: number; accounts: number; packs: number }; pull: OrgPull }`.
  - `rt setup join-status --json` prints `envelope(JoinStatus)`; the tray decodes exactly these keys. Human output: one `out.line` per state.
  - `export interface JoinStatusDeps { probes: Probes; json: (value: unknown) => void; exit: (code: number) => never; pull: typeof pullOrgClone }` and `export async function setupJoinStatus(args: string[], _ctx?: CommandContext, deps?: JoinStatusDeps)`, modelled on `WaiveDeps`/`setupWaive`.

- [ ] **Step 1: Write the failing tests** in `org-pull.test.ts` with `fakeProbes({ daemon, exec })`:
  - `"a running daemon pulls: team:pull is the only call"` (daemon answers `ping` and `team:pull` `{ ok: true, data: { outcome: "pulled" } }`; no `git` argv in `p.exec` calls).
  - `"no daemon: fetch, then fast-forward a clean clone"` (daemon returns null; exec sees `git … fetch origin <branch>` then `git -C <dir> merge --ff-only FETCH_HEAD`) → `outcome: "pulled"`.
  - `"no daemon, a dirty clone: fetched, not moved"` (`git status --porcelain` prints a line) → `outcome: "skipped"`.
  - `"no daemon, the fetched tip is above this rt's layout: held"` (`git show FETCH_HEAD:mattstack/mattstack.jsonc` returns a marker with `layout: 99`) → `outcome: "held"`, no merge argv.
  - `"no daemon, the fetch fails: failed with git's first line, never thrown"`.
- [ ] **Step 2: Run** `bun test lib/team/__tests__/org-pull.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `pullOrgClone`.** Daemon path when `p.daemon("ping")` answers: `p.daemon("team:pull", { slug }, PULL_TIMEOUT_MS)`, mapping its `data.outcome`/`hold` the way `orgPullRun` reads them. Direct path otherwise: branch from `checkedOutBranch`, fetch through `gitWithToken` with the stored token for the clone's origin, `layoutGate(p.exec, dir, "FETCH_HEAD", branch)` non-null → held, dirty → skipped, else `merge --ff-only FETCH_HEAD`; equal heads → up-to-date. Every git line passes through `withoutUrls` before it reaches `detail`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Write the failing tests** in `commands/__tests__/setup-join-status.test.ts` with injected deps (a fake `pull`):
  - `"--json: a waiting joiner reads waiting with since and what the team uses"` → `{ contract: 1, at, team: { slug: "acme", name: "acme" }, state: "waiting", since: "<joinedAt>", uses: { repos: 2, accounts: 2, packs: 1 }, pull: { outcome: "pulled", … } }` (repos = `trackingIdentities.length`, accounts = declared integrations other than `forge`, packs = `plugins.length`).
  - `"the pull runs before the check"` (fake pull flips the fixture's `.sops.yaml` to include the key → `state: "approved"`).
  - `"a failed pull still answers the check, reporting the pull"` (exit 0, `pull.outcome: "failed"`).
  - `"no joined team on this Mac: refused with a usage error"` → `exitWithUserError` with code `"no-join"`, message "This Mac has not joined a team".
  - `"human output: waiting prints the wait sentence"` → stdout line contains `APPROVAL_WAIT_DETAIL`; approved prints "You're in the acme team".
- [ ] **Step 6: Run** `bun test commands/__tests__/setup-join-status.test.ts`. Expected: FAIL.
- [ ] **Step 7: Implement `setupJoinStatus`** and its command-tree node: `"join-status": { description: "Check whether your team admin approved your request to join", module: "./commands/setup.ts", fn: "setupJoinStatus", hidden: true, args: [SETUP_JSON_ARG] }`. The slug is the first org whose team record has `joinedByRt` (`listOrgs()` order). Run `bun test lib/__tests__/command-tree*.test.ts` too (the descriptions rule).
- [ ] **Step 8: Run** both new test files. Expected: PASS.
- [ ] **Step 9: Commit** `setup: join-status verb, pulling the org itself when no daemon runs`.

### Task 3: One set of gates for every path

**Files:**
- Create: `lib/setup/expectations.ts`
- Modify: `lib/setup/contract.ts` (`Row.information`, `FINISH_GATED_ROW_IDS`, `WAIVABLE_ROW_IDS`), `lib/setup/finish-gate.ts` (`WAIVED_NOTE` → `waivedNote`, `applyFinishGate`), `lib/setup/plan.ts` (`composePlan`), `lib/setup/validators/repos.ts` (`required: true`), `lib/setup/validators/accounts.ts` (`BOARD_PEERING_BASE` comment), `.claude/rules/team-switchboard.md` (the "never required or finish-gated" sentence), `rt-tray/Sources-core/Contract/PlanModels.swift` (`PlanRow.information`)
- Test: `lib/setup/__tests__/expectations.test.ts` (create), `lib/setup/__tests__/plan.test.ts`, `lib/setup/__tests__/finish-gate.test.ts`, `commands/__tests__/setup-waive.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ snapshot), `rt-tray/Tests/MattstackCoreChecks/PlanModelsChecks.swift`

**Interfaces:**
- Consumes: `applyApprovalWait` (Task 1) runs after this pass.
- Produces:
  - `export type Target = "install" | "finish" | "skip" | "info"` and `export const ROW_TARGETS: Readonly<Record<string, Target>>` in `lib/setup/expectations.ts`:
    - `install`: `tool.editor`, `tool.chrome`, `home.backup`, `tool.state-backup`, `team.identity`, `perm.notifications`.
    - `finish`: `tool.herdr`, `tool.claude`, `tool.fast-browser`, `tool.linear-mcp`, `tool.extension`, `tool.vsix`, `tool.rt-link`, `tool.shell`, `tool.intercepts`, `tool.proxy`, `team.sync`, `team.marketplace`, `account.board-peering`.
    - `skip`: `skills.overrides`, `tool.chrome-signin`, `tool.mission-control`.
    - `info`: `tool.path`, `team.push-access`.
    - Unlisted ids (the org fault rows, `perm.fda`, `perm.login-items`, `tool.daemon`, `tool.plugins`, `pack.*`, accounts, access) keep the validators' and the existing passes' shape.
  - `export function applyExpectations(groups: Group[]): Group[]`.
  - `Row.information?: true`; Swift `PlanRow.information: Bool` (`decodeIfPresent ?? false`).
  - `WAIVABLE_ROW_IDS = ["skills.overrides", "tool.chrome-signin", "tool.mission-control"]`; `FINISH_GATED_ROW_IDS = ["tool.fast-browser-extension", "skills.writing-style", ...WAIVABLE_ROW_IDS]`.
  - `export const WAIVED_NOTES: Readonly<Record<string, string>>` and `export function waivedNote(id: string): string` in `finish-gate.ts`.

- [ ] **Step 1: Write the failing tests** in `expectations.test.ts`, building rows with `row()` from `contract.ts`:
  - `"an install row with something to press becomes required, and loses its works-without note"` (`tool.chrome` missing with the Download `open-url`) → `required: true`, `optionalNote: null`.
  - `"an install row with only Re-check, or nothing, waits for Finish instead"` → `finishGated: true`, `waivable: false`, `required: false`.
  - `"a finish row that is not ready blocks Finish, never Install"` (`tool.linear-mcp` needs-you with `ADD_LINEAR_MCP_ACTION`).
  - `"a validator's required state is never lowered"` (`tool.herdr` missing, `required: true` in → unchanged).
  - `"ready and skipped rows keep their gate"` (for every target).
  - `"a skip row is finish-gated and waivable"` (`tool.mission-control` needs-you) → `finishGated: true`, `waivable: true`.
  - `"an info row is never a task, whatever its state"` (`team.push-access` needs-you with connect) → `required: false`, `information: true`, no `finishGated`.
  - `"every repos.place row is required before Install"` (assert on `repoPlacementRows` output in `validators-repos.test.ts` instead: `required: true` on each row; a deferred row still carries `finishGated: true`).
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/expectations.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `applyExpectations`.** For a row whose id has a target: ready or skipped → unchanged except `optionalNote: null`; `info` → `{ required: false, information: true, finishGated: undefined, waivable: undefined }`; `skip` → `finishGated: true`; `finish` → when `required` is false, `finishGated: true, waivable: false, optionalNote: null`; `install` → when `required` is false, `required: true, optionalNote: null` if `r.action` is non-null and is not a `run` of `["setup", "status"]`, else as `finish`. A finish-gated row with `action: null` gets `{ type: "run", label: "Re-check", verb: ["setup", "status"] }`. Wire it into `composePlan` after `gateTeamAccounts` and before `applyApprovalWait`. In `repos.ts` the row's `required` becomes `true`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Write the failing tests** for the gate changes:
  - `finish-gate.test.ts`: `"a skipped can-skip row reads optional with its own note"` (`waivedNote("tool.mission-control")`); `"a waiver stored for tool.fast-browser-extension is no longer honored"` (row keeps `finishGated`, no `waived`, still in `finishBlockers`); `"status mode keeps a can-skip row optional, so verify never nags about it"` (`applyFinishGate(..., "status")` leaves `required: false` for a waivable row).
  - `plan.test.ts`: replace `"the contract names exactly two finish-gated rows today"` with `"the contract names the finish-gated rows and the three that can be skipped"`; add `"no required row that is not ready lacks an action a person can press"` over the create, join (cloned), restore and solo fixture plans already in the file (`blocksInstall` rows each have an action other than Re-check); update `"solo intent, no teams -> … fast-browser optional"` so Fast Browser reads finish-gated, not optional.
  - `setup-waive.test.ts`: `"tool.mission-control can be skipped"`; `"tool.fast-browser-extension cannot be skipped any more"` (`not-waivable`); `"unwaive still clears an old fast-browser-extension waiver"`.
  - `PlanModelsChecks.swift`: `Check("PlanModels: information decodes, and absent reads false")`.
- [ ] **Step 6: Run** `bun test lib/setup/__tests__/finish-gate.test.ts lib/setup/__tests__/plan.test.ts commands/__tests__/setup-waive.test.ts lib/setup/__tests__/validators-repos.test.ts` and `cd rt-tray && swift run mattstack-checks PlanModels`. Expected: the new tests FAIL.
- [ ] **Step 7: Implement** the contract and gate changes. `WAIVED_NOTES`: `skills.overrides` → "Skipped on this Mac: old slot keys stay in your overrides file.", `tool.chrome-signin` → "Skipped on this Mac: confirm Chrome's sign-in yourself.", `tool.mission-control` → "Skipped on this Mac: Control+Up stays with Mission Control." `applyFinishGate`'s status-mode branch skips waivable rows. Decode `information` in `PlanRow.init(from:)` beside `finishGated`. Reword `BOARD_PEERING_BASE`'s comment and the team-switchboard rule sentence to: "It blocks Finish (never Install) and is never waivable; only the org admin can fix it, so its steps name them."
- [ ] **Step 8: Run** the same commands. Expected: PASS. Then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots`, read the `.snap` diff (only gate fields, `optionalNote` and the waived notes move), and `bun test lib/setup/__tests__/validators-*.test.ts lib/setup/__tests__/update-safe.test.ts commands/__tests__/setup-plan.test.ts commands/__tests__/setup-finish.test.ts`. Fix tests that pinned an old optional shape; never weaken an invariant test.
- [ ] **Step 9: Commit** `setup: every step expected, three can be skipped, two are information only`.

### Task 4: The board's folder, written at Install and on a placement change

**Files:**
- Create: `lib/setup/board-folder.ts`
- Modify: `lib/setup/team-settings.ts` (`TeamSnapshot.boardRepo`), `lib/setup/state.ts` (`SetupState.boardCwdsWritten`, `boardRestartPending`), `lib/setup/steps/skills.ts` (`boardKeysRun` stops writing `board.cwds`; new `boardCwdsStep`, `boardRestartStep`), `lib/setup/steps/repos.ts` (`reposCloneStep.satisfied`), `lib/setup/steps/index.ts`, `lib/setup/contract.ts` (`STEP_IDS`, place-repo `board`), `lib/setup/apply.ts` (`StepDef.titleFor`), `lib/setup/validators/repos.ts`, `rt-tray/Sources-core/Contract/PlanModels.swift` (`RowAction.board`), `rt-tray/Sources/Setup/Screens/RepoPlacementRow.swift`, `rt-tray/Sources/Setup/ChecklistRowSnapshot.swift`, `rt-tray/Tests/stub-rt/stub.ts` (plan step list)
- Test: `lib/setup/__tests__/board-folder.test.ts` (create), `lib/setup/__tests__/steps-b.test.ts`, `lib/setup/__tests__/contract.test.ts`, `lib/setup/__tests__/apply.test.ts`, `lib/setup/__tests__/validators-repos.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ snapshot), `PlanModelsChecks.swift`

**Interfaces:**
- Produces:
  - `export type BoardCwds = { review: string; respond: string; doctor: string }`.
  - `export function boardRepoIdentity(projects: unknown, tracked: string[]): string | null`: the first `board.projects` entry matched to a tracked `host/path` identity by its path with the host dropped, only when exactly one identity matches; `projects` unset or empty → `tracked[0] ?? null`.
  - `export type BoardCwdsPlan = { write: BoardCwds } | { leave: "current" | "hand-set" | "no-repo" }`.
  - `export function planBoardCwds(i: { current: Partial<BoardCwds> | undefined; rtWrote: BoardCwds | undefined; target: string | null; mode: "install" | "migration"; exists: (path: string) => boolean; isTrackedCheckout: (path: string) => boolean }): BoardCwdsPlan`. Install mode writes when `current` is empty or deep-equals `rtWrote`; migration mode writes when `current` is missing, or any of its three paths does not exist or is not a checkout of a tracked repo. Both leave a value equal to the target (`current`).
  - `TeamSnapshot.boardRepo?: string | null`, set in `readTeamSnapshot` from `board.projects` and `trackingIdentities`.
  - `SetupState.boardCwdsWritten?: BoardCwds` and `SetupState.boardRestartPending?: boolean` (optional fields; `parseSetupState` needs no change).
  - `StepDef.titleFor?(ctx: ApplyContext): string`; `runApplyWith` emits `titleFor?.(ctx) ?? title` in the `plan` event and in a failed step's detail prefix.
  - `STEP_IDS` gains `"board.cwds"` right after `"board.keys"` and `"board.restart"` right after `"services.start"`.
  - `export function makeBoardRestartStep(seams: { restartBoard(p: Probes): Promise<boolean> } = { restartBoard: (p) => restartAppWithDeck(p, "board") }): StepDef`.
  - place-repo action gains `board: string | null`: `"The board's review, respond and doctor agents start here"` on the board repo's row, else null. That row's `then` becomes `["setup", "apply", "--only", "board.restart"]` once installed.

- [ ] **Step 1: Write the failing tests** in `board-folder.test.ts`:
  - `"the first board project picks its tracked repo by path, whatever the host"` (`["acme/widgets"]`, tracked `["gitlab.example.com/acme/widgets", "github.com/x/y"]`).
  - `"no board projects: the first tracked repo, as before"`.
  - `"a project two tracked repos match on different hosts picks none"` → null.
  - `"install: an empty value is written"`; `"install: the value rt wrote last is replaced"`; `"install: a value set by hand is left alone"` → `{ leave: "hand-set" }`; `"install: the target already in place writes nothing"` → `{ leave: "current" }`; `"no board repo writes nothing"` → `{ leave: "no-repo" }`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/board-folder.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `boardRepoIdentity` and `planBoardCwds` in `lib/setup/board-folder.ts`, and set `boardRepo` in `readTeamSnapshot`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Write the failing step tests** in `steps-b.test.ts` (move the `board.cwds` cases out of the `board.keys` describe into `describe("board.cwds and board.restart")`):
  - `"board.keys no longer writes board.cwds"`.
  - `"board.cwds writes all three to the board repo's registered path and records what it wrote"` (`readSetupState(p).boardCwdsWritten` equals the value, `boardRestartPending: true`).
  - `"board.cwds waits while the board repo is not registered yet"` → `skipped`, nothing written.
  - `"board.cwds leaves a hand-set value and says so"` → `skipped`, detail "You set the board's folders yourself, so rt left them alone".
  - `"board.restart restarts the board once after a write, then clears the flag"` (fake seam counts 1, flag gone).
  - `"board.restart with nothing new skips without calling deck"`.
  - `"a restart deck refuses is partial with the command to run"` → `{ state: "partial", remedy: "Run deck restart board" }`.
  - `"an --only board.restart run clones and repoints first"` via `runApplyWith(STEPS, ctx, { only: "board.restart" })`: the queue is `repos.clone`, `board.cwds`, `board.restart` when unsatisfied.
  - `"the plan event names the board's repo"` (`plan` event title for `board.cwds` is `"Point the board at widgets"`; `board.restart` is `"Restart the board"`).
  - `contract.test.ts`: update `"matches the contract's 29 ids in order"` to 31 ids; `apply.test.ts`'s `"has exactly one def per STEP_IDS entry"` keeps passing.
  - `validators-repos.test.ts`: `"the board repo's row says the board's agents start there, and its then repoints the board"`; other rows carry `board: null` and the `repos.clone` then.
  - `PlanModelsChecks.swift`: `Check("PlanModels: a place-repo action's board line decodes, and absent reads nil")`.
- [ ] **Step 6: Run** `bun test lib/setup/__tests__/steps-b.test.ts lib/setup/__tests__/contract.test.ts lib/setup/__tests__/apply.test.ts lib/setup/__tests__/validators-repos.test.ts` and `cd rt-tray && swift run mattstack-checks PlanModels`. Expected: FAIL.
- [ ] **Step 7: Implement.** `boardCwdsStep`: `{ id: "board.cwds", title: "Point the board at your repo", titleFor: (ctx) => \`Point the board at ${repoBasename(boardRepo)}\`, kind: "rt", applies: () => true, prerequisites: ["repos.clone"], satisfied: (ctx) => current board.cwds equals the target }`; it reads the target path from `trackedRepos(ctx)` (extend its `found` entries with `identity`) and writes with `setSetting("board.cwds", value, "machine")` through `writable(ctx, "board.cwds")`, then `updateSetupState` for both new fields. `board.restart` lists `prerequisites: ["board.cwds"]`. `reposCloneStep.satisfied`: every shown tracked identity is registered, and each recorded placement's path equals its registered path. Neither new step is `updateSafe`. Swift: `RowAction.board: String?`; `RepoPlacementRow` shows it as a secondary line under the title when non-nil; add a board-repo row to `ChecklistRowSnapshot`'s `RepoRows`. Add both steps to `stub.ts`'s step list.
- [ ] **Step 8: Run** the commands from Step 6. Expected: PASS. Then `bun test lib/setup/__tests__/update-safe.test.ts commands/__tests__/setup-apply.test.ts commands/__tests__/setup-repo-place.test.ts rt-tray/Tests/stub-rt/stub.test.ts`, and `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` (read the diff: the two new plan titles and the place-repo `board` key).
- [ ] **Step 9: Look at it.** `cd rt-tray && swift build --product rt-tray && env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin .build/debug/rt-tray --render-checklist-row-snapshots "$TMPDIR/rows"`; Read `repo-rows-light.png` and `repo-rows-dark.png` (or the names `RepoRows` writes). Say what reads wrong (line length, contrast, wrapping) and fix it before committing.
- [ ] **Step 10: Commit** `setup: point the board at its repo at Install and on a move, then restart it`.

### Task 5: Migration for members already set up

**Files:**
- Create: `lib/setup/migrations/board-cwds-follow-board-repo.ts`
- Modify: `lib/setup/migrations/index.ts` (append to `MIGRATIONS`)
- Test: `lib/setup/__tests__/migration-board-cwds-follow-board-repo.test.ts` (create), `lib/setup/__tests__/migrations-ids.test.ts`

**Interfaces:**
- Consumes: `planBoardCwds(..., mode: "migration")`, `boardRepoIdentity`, `BoardCwds` (Task 4); `restartAppWithDeck`.
- Produces: `export function makeBoardCwdsFollowBoardRepoMigration(seams: { restartBoard(p: Probes): Promise<boolean> } = …): MigrationDef` with `id: "2026-10-29-board-cwds-follow-board-repo"`, `title: "Point the board at its repo"`; `export const boardCwdsFollowBoardRepoMigration`.

- [ ] **Step 1: Write the failing tests** (pattern: `migration-import-app-settings.test.ts`, `fakeProbes({ home, files })`, `migration.run({ p } as unknown as ApplyContext)`, isolated HOME and settings stores):
  - `"a missing board.cwds is written from the board repo and the board restarts"` → `done`, restarts 1, `boardCwdsWritten` recorded.
  - `"a board.cwds pointing at a folder that is gone is rewritten"`.
  - `"a board.cwds pointing at a folder that is no tracked checkout is rewritten"`.
  - `"a board.cwds pointing at a real checkout is left alone"` → `skipped`, restarts 0.
  - `"no team or no board repo: skipped, nothing written"`.
  - `"a restart that fails still records the write, with the note to restart by hand"` → `done`, detail ends "Restart the board from deck to use it".
  - `"it runs last among the migrations"` (`MIGRATIONS.at(-1)!.id`).
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/migration-board-cwds-follow-board-repo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration: read the active org's snapshot (`readTeamSnapshot` for the first `listOrgs()` entry), resolve the target path through the repo index (`resolveIndexPathForIdentity`), `isTrackedCheckout` = the path equals some tracked identity's indexed path, then write at machine scope, record `boardCwdsWritten`, and restart through the seam inside a try/catch like `import-app-settings.ts:212-241`.
- [ ] **Step 4: Run** the new test plus `bun test lib/setup/__tests__/migrations-ids.test.ts lib/setup/__tests__/migration-shared-store-refusal.test.ts lib/setup/__tests__/migrations.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `setup: migrate a wrong or missing board.cwds to the board's repo`.

### Task 6: Fast Browser extension is one "Add to Chrome" button

**Files:**
- Modify: `lib/setup/contract.ts` (open-url `waiting?`, `again?`, `primary?`), `lib/setup/validators/tools.ts` (`FAST_BROWSER_LOAD_STEPS` → `FAST_BROWSER_ADD_ACTION`, `doctorRemedy`, `FAST_BROWSER_PROFILE_ACCESS_STEPS` and its detail), `rt-tray/Sources-core/Contract/PlanModels.swift` (`RowAction.waiting`, `again`, `primary`), `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift` (`perform`), `rt-tray/Sources/Setup/Components/ChecklistSections.swift` (`SectionRow`), `rt-tray/Sources/Setup/ChecklistRowSnapshot.swift`
- Test: `lib/setup/__tests__/validators-tools.test.ts`, `commands/__tests__/setup-copy.test.ts` (+ snapshot), `PlanModelsChecks.swift`, `rt-tray/Tests/MattstackCoreChecks/RowActionChecks.swift`

**Interfaces:**
- Produces: `const FAST_BROWSER_ADD_ACTION: Action = { type: "open-url", label: "Add to Chrome", url: FAST_BROWSER_WEB_STORE_URL, primary: true, waiting: "Waiting for Chrome", again: "Open again" }`. The pairing state keeps `FAST_BROWSER_PAIR_STEPS`.

- [ ] **Step 1: Write the failing tests:**
  - `validators-tools.test.ts`: `"a missing extension offers Add to Chrome, opening the Web Store"` (needs-you row's action deep-equals `FAST_BROWSER_ADD_ACTION`); `"not loaded offers the same button"`; `"loaded but unpaired keeps the pairing steps"`; `"a profile mattstack cannot read asks for Full Disk Access and never offers a skip"` (no step or detail contains "skip"). Update the test at `:643` so it no longer requires `DONE_ACTION_TYPES` for this row's actions (Task 9 removes that list).
  - `PlanModelsChecks.swift`: `Check("PlanModels: an open-url action's waiting, again and primary decode")`.
  - `RowActionChecks.swift`: `Check("RowActionDispatcher: Add to Chrome opens the Web Store")`.
- [ ] **Step 2: Run** `bun test lib/setup/__tests__/validators-tools.test.ts` and `cd rt-tray && swift run mattstack-checks PlanModels`. Expected: FAIL.
- [ ] **Step 3: Implement.** rt: the action and the copy above; the profile-access detail becomes "mattstack cannot read Chrome's profile. Turn on Full Disk Access for mattstack, then Re-check", with one step "Turn on Full Disk Access for mattstack in System Settings, then Re-check". Swift: decode the three fields; in `ChecklistScreen.perform`, after an `open-url` with `waiting` set, put `activity.waiting[row.id] = action.waiting` until the row reads ready; `SectionRow` draws `action.primary == true` with `.borderedProminent` and, while waiting, shows the waiting text and a button labelled `action.again`.
- [ ] **Step 4: Run** the same commands plus `swift run mattstack-checks RowAction`. Expected: PASS. Then `bun test commands/__tests__/setup-copy.test.ts --update-snapshots` and read the diff (only the extension row's action and the profile-access copy).
- [ ] **Step 5: Look at it.** Add rows to `ChecklistRowSnapshot.Rows` for the extension row before the click and while waiting; render with `--render-checklist-row-snapshots "$TMPDIR/rows"` under an isolated HOME (Task 4 Step 9's command); Read `checklist-rows-light.png` and `checklist-rows-dark.png` and say what looks wrong.
- [ ] **Step 6: Commit** `setup: the Fast Browser extension is an Add to Chrome button`.

### Task 7: Tray: Full Disk Access is the first step

**Files:**
- Create: `rt-tray/Sources-core/Setup/FullDiskAccessPage.swift`, `rt-tray/Sources/Setup/Screens/FullDiskAccessScreen.swift`, `rt-tray/Sources/Setup/SetupPageSnapshot.swift`
- Modify: `rt-tray/Sources-core/Setup/SetupFlowModel.swift` (`SetupStep`, `progress`, `next`, `back`, `canGoBack`), `rt-tray/Sources-core/Launch/SetupResume.swift` (`names`), `rt-tray/Sources/Setup/SetupView.swift` (switch, `continueEnabled`), `rt-tray/Sources/AccessibilityIDs.swift`, `rt-tray/Sources/main.swift` (register the snapshot flag), `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/FullDiskAccessPageChecks.swift` (create), `rt-tray/Tests/MattstackCoreChecks/SetupFlowChecks.swift`

**Interfaces:**
- Produces:
  - `public enum SetupStep: Int, CaseIterable, Sendable { case welcome, fullDiskAccess, team, join, checklist, install, done }`; titles "Full Disk Access" and "Join your team" for the new cases.
  - `SetupFlowModel.joining: Bool` (`@Published`, set by Task 8); `public var steps: [SetupStep]`: `.fullDiskAccess` only when `entry == .firstRun`, `.join` only when `joining`. `next()`/`back()` walk `steps`, and `progress` counts `steps` with the checklist expanded to its pages.
  - `SetupResume` names `"full-disk-access"` and `"join"`.
  - `public enum FDAPageState: Equatable, Sendable { case off, needsReopen, on }` and `public enum FullDiskAccessPage { public static func state(row: PlanRow?, needsRelaunch: Bool) -> FDAPageState }`: row nil or not ready → off; ready and `needsRelaunch` → needsReopen; else on.
  - AX ids: `AXID.fdaScreen`, `AXID.fdaOpen`, `AXID.fdaReopen`.

- [ ] **Step 1: Write the failing checks:**
  - `FullDiskAccessPageChecks.swift`: `"FullDiskAccessPage: no row yet reads off"`, `"…a denied row reads off"`, `"…granted in this run reads needs a reopen"`, `"…granted at launch reads on"`.
  - `SetupFlowChecks.swift`: `"SetupFlow: first run walks Welcome, Full Disk Access, Your team"`; `"SetupFlow: an upgrade entry has no Full Disk Access step"`; `"SetupFlow: the counter follows the real step list"` (first run, not joining, 3 pages → Welcome is `1 of 8`, Install `7 of 8`); `"SetupFlow: joining adds the Join step to the count"`; `"SetupResume: full-disk-access and join round-trip"`. Fix the existing counter checks to the new totals.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks "FullDiskAccessPage"` and `swift run mattstack-checks "SetupFlow"`. Expected: FAIL (build errors count).
- [ ] **Step 3: Implement** the Core types and `SetupFlowModel` changes. Then `FullDiskAccessScreen(readiness:)`: one card titled "Turn on Full Disk Access", three lines "Open Full Disk Access", "Turn on mattstack", "Reopen mattstack"; button "Open Full Disk Access" opens `SystemSettingsLinks.fullDiskAccess`; in `.needsReopen` the primary button is "Reopen mattstack" calling `AppRelaunch.relaunchInPlace(resumeAt: .team)`; in `.on` a green "Full Disk Access is on". It counts as visible to `ReadinessModel` (`becameVisible()`/`becameHidden()`, as the checklist does) so the on-activate recheck refreshes `perm.fda`. `SetupView.continueEnabled` for `.fullDiskAccess` is `state == .on`. Match boards O1 and O1b.
- [ ] **Step 4: Run** the checks from Step 2. Expected: PASS.
- [ ] **Step 5: Add `SetupPageSnapshot`** (`rt-tray --render-setup-page-snapshots <out-dir>`, DEBUG only, same shape as `ChecklistRowSnapshot.runIfRequested`) rendering `FullDiskAccessScreen` in its three states from fixture `PlanRow`s, light and dark, as `fda-<state>-<scheme>.png`. Register it in `main.swift` beside the other snapshot flags.
- [ ] **Step 6: Look at it.** `cd rt-tray && swift build --product rt-tray && env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin .build/debug/rt-tray --render-setup-page-snapshots "$TMPDIR/setup-snap"`; Read all six PNGs; compare against O1/O1b through the pencil MCP; say what looks wrong and fix it.
- [ ] **Step 7: Commit** `tray: Full Disk Access is setup's first step, with Reopen mattstack`.

### Task 8: Tray: the Join page waits for approval

**Files:**
- Create: `rt-tray/Sources-core/Setup/JoinPageModel.swift`, `rt-tray/Sources/Setup/Screens/JoinScreen.swift`
- Modify: `rt-tray/Sources/Setup/SetupView.swift`, `rt-tray/Sources/Setup/SetupWindowController.swift` (`show`), `rt-tray/Sources/Setup/SetupCoordinator.swift` (owns a `JoinPageModel`), `rt-tray/Sources/Setup/SetupPageSnapshot.swift`, `rt-tray/Sources/AccessibilityIDs.swift`, `rt-tray/Tests/stub-rt/stub.ts` (`setup join-status` answers per scenario), `rt-tray/Tests/MattstackCoreChecks/AllChecks.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/JoinPageChecks.swift` (create), `rt-tray/Tests/stub-rt/stub.test.ts`

**Interfaces:**
- Consumes: `rt setup join-status --json` and `JoinStatus` (Task 2); `rt setup apply --only team.join --json` through `RowVerbRun.apply(_:rt:needs:waiting:)`; the plan's `access.team-repo` row and its connect action (dispatched through `ConnectSheet`, as the checklist does); `SetupFlowModel.joining` (Task 7).
- Produces:
  - `public struct JoinStatus: Decodable, Equatable, Sendable { team: Team; state: String; since: String?; uses: Uses; pull: Pull }` mirroring Task 2's keys.
  - `@MainActor public final class JoinPageModel: ObservableObject` with `@Published public private(set) var phase: Phase` where `public enum Phase: Equatable { case needsToken, ready, joining, failed(detail: String, remedy: String?), waiting(JoinStatus), approved(team: String) }`; `init(rt: RtRunning, needs: NeedBroker, clock: @escaping @Sendable () -> Date = Date.init)`; `func update(teamRepoRow: PlanRow?)`; `func join() async`; `func check() async`; `func startPolling(every seconds: TimeInterval = 15)`; `func stopPolling()`.
  - `public static func usesText(_ uses: JoinStatus.Uses) -> String` ("2 repos, 2 accounts, 1 pack", zeros dropped, singulars right) and `public static func sinceText(_ since: Date, now: Date) -> String` ("just now", "5 minutes ago", "2 hours ago").
  - AX ids: `AXID.joinScreen`, `AXID.joinRun`, `AXID.joinCheckAgain`, `AXID.joinWaiting`, `AXID.joinApproved`.

- [ ] **Step 1: Write the failing checks** in `JoinPageChecks.swift` with `ScriptedRt`:
  - `"JoinPage: a team repo row that needs a token reads needs token"`; `"…a ready row reads ready"`.
  - `"JoinPage: join runs team.join, then checks"` (scripted `setup apply --only team.join --json` stream ends ok, then `setup join-status --json` answers waiting → `.waiting`).
  - `"JoinPage: a failed join shows the step's detail and remedy"`.
  - `"JoinPage: approved reads You're in the team"` (`.approved(team: "acme")`).
  - `"JoinPage: Check again runs join-status once more"`.
  - `"JoinPage: usesText drops zeros and pluralises"`; `"JoinPage: sinceText reads minutes and hours"`.
  - `"JoinPage: a status rt cannot answer keeps the last state and says so"` (exit 2 → phase unchanged, error text set from `failureCopy(verb: "setup join-status")`).
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks JoinPage`. Expected: FAIL.
- [ ] **Step 3: Implement `JoinPageModel`.**
- [ ] **Step 4: Run** the checks. Expected: PASS.
- [ ] **Step 5: Implement `JoinScreen` and the wiring.** `SetupView.advance()` for `.team` sets `flow.joining = team.choice == .join` after `validateAndPrepare()` succeeds. The screen: the team repo row's Connect while `.needsToken`; a primary "Join <team>" in `.ready`; "Joining…" with the step's log lines in `.joining`; in `.waiting` the headline "Waiting for your team admin to approve your request to join the team" and three lines "Invite accepted", "Team settings copied" (with `usesText`), "Waiting for approval" (with `sinceText`), plus "Check again"; polling runs only while the page is shown; in `.approved` "You're in the <team> team" and Continue enabled (Continue is disabled in every other phase). Back returns to Your team. After the join lands, the screen calls `readiness.load()` so the checklist has the cloned team's rows. In `SetupWindowController.show`, a first-run window arriving at `.checklist` runs `setup join-status --json` first and, on `state == "waiting"`, sets `flow.joining = true` and jumps to `.join`. Match boards O2 and O2b.
- [ ] **Step 6: Stub.** `stub.ts` answers `setup join-status --json` with `waiting` for the `join` scenario and `approved` after a second call; add `"join-status answers waiting, then approved"` to `stub.test.ts`; run `bun test rt-tray/Tests/stub-rt/stub.test.ts`. Expected: PASS.
- [ ] **Step 7: Look at it.** Extend `SetupPageSnapshot` with `join-<needs-token|joining|waiting|approved|failed>-<scheme>.png`; render (Task 7 Step 6's command); Read every PNG; compare with O2/O2b; confirm the waiting state never reads as a failure (no coral, no warning glyph); fix what reads wrong.
- [ ] **Step 8: Commit** `tray: the Join page joins, then waits for the admin's approval`.

### Task 9: Tray: no Optional section, a "You can skip" card, information rows, "N skipped"

**Files:**
- Modify: `rt-tray/Sources-core/Readiness/ChecklistSorting.swift` (`RowSection`, `section(for:finishBlockedBy:)`, `NeedBadge`), `rt-tray/Sources-core/Readiness/ChecklistLayout.swift` (`Section.canSkip`, `SummaryKind.skipped`, `make`, `summary`), `rt-tray/Sources-core/Contract/PlanModels.swift` (`PlanRow.badge`), `rt-tray/Sources-core/Setup/FinishGate.swift` (delete `DoneActions`, `DoneRoute`), `rt-tray/Sources/Setup/Components/ChecklistSections.swift`, `rt-tray/Sources/Setup/Components/RowView.swift`, `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift` (`sidebarBody`, `PageLead`, `SummaryGlyph`, `SummaryCount`), `rt-tray/Sources/Settings/FastBrowserPane.swift`, `rt-tray/Sources/Setup/ChecklistRowSnapshot.swift`, `lib/setup/contract.ts` (delete `DONE_ACTION_TYPES`), `lib/setup/__tests__/contract.test.ts`, `lib/setup/__tests__/validators-tools.test.ts:643`, `lib/setup/__tests__/validators-writing-style.test.ts:73`
- Test: `rt-tray/Tests/MattstackCoreChecks/ChecklistSortingChecks.swift`, `ChecklistLayoutChecks.swift`, `DoneModelChecks.swift`, `PlanModelsChecks.swift`

**Interfaces:**
- Consumes: `PlanRow.information` (Task 3), `waivable`/`waived`.
- Produces:
  - `public enum RowSection: Equatable, Sendable { case needsYou, canSkip, noAction }`; `section(for row: PlanRow, finishBlockedBy: Set<String>) -> RowSection` (the `afterInstall` parameter is gone): `information` → noAction; `finishGated && waivable && !waived` and not ready or skipped → canSkip; blocks Install or in `finishBlockedBy` → needsYou; ready, skipped or waived → noAction; anything else not ready → needsYou.
  - `NeedBadge` keeps only `.beforeFinish = "Before you finish"`; `RowBadge` and `PlanRow.badge` are removed.
  - `ChecklistLayout.Section { needsYou, canSkip, noAction }`; `SummaryKind { needsYou, ready, skipped, notNeeded }`; the summary part reads `"\(n) skipped"` counting waived rows.

- [ ] **Step 1: Write the failing checks:**
  - `ChecklistSortingChecks.swift`: replace the Optional checks with `"ChecklistSorting: a skippable row that is not done sits in You can skip"`, `"…a skipped row needs no action"`, `"…an information row needs no action whatever its state"`, `"…a row that is not required and not ready still needs you"`, `"…an old waiver on a row that cannot be skipped still needs you"`.
  - `ChecklistLayoutChecks.swift`: `"ChecklistLayout: the summary says N skipped, never optional"`.
  - `DoneModelChecks.swift`: delete `"Done routes exactly the contract's DONE_ACTION_TYPES"`; `PlanModelsChecks.swift`: drop the `DoneActions.route` expectations (lines 30-48, 202) and keep the decode assertions.
- [ ] **Step 2: Run** `cd rt-tray && swift run mattstack-checks Checklist`. Expected: FAIL.
- [ ] **Step 3: Implement** the Core changes, then the views: `ChecklistSectionsView` draws "Needs you", then a "You can skip" card whose header note reads "only if you won't use it" and whose rows each carry a "Skip" button (`onSkip`, `AXID.doneSkipRow(row.id)`), then "No action needed"; delete the Optional card, the Required capsule and `RowView`'s badge; `ChecklistScreen` drops `afterInstall: true`; `PageLead`'s last line reads `section.canSkip.isEmpty ? "Nothing here needs you." : "Nothing here blocks Install."`; `SummaryCount` uses `idName` `"skipped"`. Skip is offered on checklist pages too, not only the summary (`ChecklistScreen.Presentation.page` passes the same `onSkip` through `DoneModel.requestSkip`). `FastBrowserPane` shows its "Skipped on this Mac" block only when `row.isWaived` (already so; confirm with Review Focus 5). Delete `DoneActions`/`DoneRoute` and the TS `DONE_ACTION_TYPES` with their tests, since the summary dispatches every row through the checklist (`FinishGate.swift:94-96`). Match boards O3, O6, O7.
- [ ] **Step 4: Run** `swift run mattstack-checks Checklist`, `swift run mattstack-checks Done`, `swift run mattstack-checks PlanModels`, and `bun test lib/setup/__tests__/contract.test.ts lib/setup/__tests__/validators-tools.test.ts lib/setup/__tests__/validators-writing-style.test.ts`. Expected: PASS.
- [ ] **Step 5: Look at it.** Update `ChecklistRowSnapshot.Rows` to show all three sections (a can-skip row, an information row under No action needed, a skipped row) and extend `SetupPageSnapshot` with the summary sidebar chips; render both flags under an isolated HOME; Read every PNG in light and dark; compare with O3/O6/O7; fix what reads wrong.
- [ ] **Step 6: Commit** `tray: drop Optional, add You can skip, count skipped steps`.

### Task 10: Docs and the clean-room join walkthrough

**Files:**
- Modify: `website/docs/start/install.mdx` (L31, L44, L49, L64, L85, L87, L118), `website/docs/start/setup.mdx` (L12, L14, L18, L35), `website/docs/start/teams.mdx` (L142, L155, L173), `website/docs/rt/reference/setup/waive.mdx`, `website/docs/rt/reference/_partials/setup/waive.mdx`, `rt-tray/vm/run/guest/screens.sh`, `rt-tray/vm/run/guest/drive-setup.sh`, `rt-tray/vm/run/walkthrough.sh`, `rt-tray/vm/README.md` ("Facts a join run depends on", the FDA relaunch note)
- Create: `rt-tray/vm/run/host/approve-join.sh`
- Test: `rt-tray/vm/run/helpers/__tests__/wizard-pages.test.sh`, `rt-tray/vm/run/helpers/__tests__/join-rows.test.ts`, `rt-tray/vm/check-vm-scripts.sh`

**Interfaces:**
- Consumes: the AX ids from Tasks 7 to 9; `rt setup join-status` (Task 2).

- [ ] **Step 1: Docs.** Load the `rt:docs` skill and follow it. Rewrite the setup pages for the new order (Welcome, Full Disk Access, Your team, Join and wait, the checklist pages, Install, Summary), remove every "Optional" section and "After Install" wording, name the three steps you can skip and the two information rows, describe "Add to Chrome", and say Install points the board at its repo and restarts it. The waive reference lists the three skippable ids and drops `tool.fast-browser-extension`. Run the website's own checks the skill names. Expected: green.
- [ ] **Step 2: Walkthrough scripts.** Move `screen_row_fda` out of `screen_readiness` into a new `screen_full_disk_access` between `screen_welcome` and `screen_team` (drive `AXID.fdaOpen`, the System Settings toggle, then `AXID.fdaReopen` and wait for the window to return at Your team); add `screen_join` after `screen_team` for the join scenario (connect the token if `access.team-repo` asks, press `AXID.joinRun`, wait on `AXID.joinWaiting`, screenshot `02b-join-waiting`, signal the host, wait up to 300s for `AXID.joinApproved`, screenshot `02c-join-approved`, Continue). `approve-join.sh --rt <rt> --home <mint home> --slug <slug>` runs `rt team members sync --json` under the mint HOME (the owner leg `team-propagate.sh` already runs) and exits non-zero unless the joiner's age key is in the clone's `.sops.yaml` afterwards. `walkthrough.sh` runs it when the guest signals. Drop the "Skip for now" handling for the Fast Browser extension. Update `drive-setup.sh`'s header and its screen list. Update the README's join facts and screenshot list.
- [ ] **Step 3: Run** `bash rt-tray/vm/check-vm-scripts.sh`, `bash rt-tray/vm/run/helpers/__tests__/wizard-pages.test.sh` and `bun test rt-tray/vm/run/helpers/__tests__/join-rows.test.ts`. Expected: PASS (update `wizard-pages.test.sh`'s expected page list to include the two new steps).
- [ ] **Step 4: Commit** `docs and clean room: Full Disk Access first, join and wait, one Install`.
- [ ] **Step 5: Clean-room run (on Matt's go).** The walkthrough takes about an hour, so ask before starting it. Command: `rt-tray/vm/run/walkthrough.sh --ver 26 --app <scratch-built mattstack.app> --scenario join --fresh-team-repo --forge gitlab --pat-env MATTSTACK_VMTEST_PAT --no-quarantine`. Pass means: FDA page first, the waiting screen held until `approve-join.sh` ran, one Install with "Point the board at <repo>" and "Restart the board", and `assert-installed.sh --join <slug>` green with `board.cwds` equal to the placed repo. Report the artifacts directory and every screenshot that reads wrong.
