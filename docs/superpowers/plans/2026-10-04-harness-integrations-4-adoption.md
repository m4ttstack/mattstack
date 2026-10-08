# Harness Skills Setup and Application Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared runtime usable throughout Mattstack, including a complete Codex-only installation and lifecycle.

**Architecture:** Extend existing skill compilation and setup seams with integration targets. Apps consume shared metadata and launch/context APIs. Release acceptance covers the distributed suite and all audit rows.

**Tech Stack:** Bun/TypeScript, existing skill compiler/setup framework, React app stacks, Swift tray, Bun/Vitest, existing macOS VM clean room.

**Spec:** [Approved design](../specs/2026-10-04-harness-integrations-design.md).

## Global Constraints

Inherit the [parent plan](2026-10-04-harness-integrations.md). **Re-planned
2026-10-05** with exact project trust, hook-hash lifecycle and session readiness
from the focused follow-up. “Claude is
optional on a Codex installation.” “Canonical sources remain authoritative.”
“Existing installations retain their configured behavior.” Settings use the
suite registry/resolver; generated skills never become source copies. Read
the settings skill before registry edits, writing-skills before skill edits,
app AGENTS/UI authoring before UI changes, SwiftUI guidance before SwiftUI
edits, and release/distribution docs before bundle/VM edits.

S1/S2/S3/S4a/S4b and the necessary S11 fragments are early prerequisites, not work
to postpone until after runtime tests. S9 is last regardless of numbering.
S10 and S12 are separate lifecycle and maintenance tasks so they can be
reviewed independently of initial setup and compilation.

## Review Focus

- Same skill ID exists in multiple native caches with different versions (S1).
- Native instruction differs by sequence rather than tool spelling (S2, S11).
- Empty enabled list differs from an absent setting (S3).
- User disables a plugin after setup, then update/restore runs (S10).
- Source tests pass but the installed bundle still calls Claude (S9).

## File structure

`lib/agent-integrations/{claude,codex}/skills.ts` owns host inventory/paths;
`lib/skills/harness-target.ts` owns compile target binding. Native installation
modules provide existing `StepDef` operations; common setup retains sequencing
and ownership. App changes use F6 metadata; the release runner records a
machine-readable profile/scenario evidence matrix.

### S1: Discover resources through each integration

**Files:** Create `lib/agent-integrations/claude/skills.ts`,
`lib/agent-integrations/codex/skills.ts`,
`lib/skills/__tests__/harness-inventory.test.ts`;
modify `lib/skills/sources.ts`, `lib/skills/packs.ts`,
`lib/skills/installed-plugins.ts`, `lib/skills/writing-style-sources.ts`.

**Interfaces:** `SkillAdapter.inventory(): Promise<Outcome<PluginListEntry[]>>`,
`resourceRoots(): Promise<Outcome<string[]>>`,
`resolveResource(plugin: string, relativePath: string): Promise<Outcome<string>>`.
Produce `createClaudeSkills(): SkillAdapter` and `createCodexSkills(): SkillAdapter`.
Canonical resources are keyed by harness/profile/plugin/version; a display ID
alone does not choose between different caches.

- [ ] Write `Codex inventory never invokes Claude` and `same ID in two hosts stays distinct`.
  Assert `expect(spawnedCommands).not.toContain('claude')`, both versions remain
  represented, and traversal/symlink/foreign-cache references refuse rather
  than becoming permitted roots.
- [ ] Run `bun test lib/skills/__tests__/harness-inventory.test.ts lib/skills/__tests__/sources.test.ts`;
  expect new target cases red.
- [ ] Extract Claude CLI/cache discovery and implement Codex inventory from its
  installed supported configuration. Preserve shared manifest formats and
  existing source precedence. Return explicit unavailable/invalid results;
  failure to inspect one host must not silently select another. Feed validated
  roots to M6 confinement without widening unrelated roots.
- [ ] Run both suites and installed-plugin/writing-style suites. Verify native
  inventory against installed resources for each host with distinct same-ID
  test plugins and no secret output.
- [ ] Stage task files and commit `refactor: discover skill resources through integrations`.

### S2: Compile one workflow source for distinct harness targets

**Files:** Create `lib/skills/harness-target.ts`,
`lib/skills/__tests__/harness-target.test.ts`;
modify `lib/skills/types.ts`, `lib/skills/compile.ts`,
`lib/skills/placeholders.ts`, `lib/skills/expand.ts`, `lib/skills/layout.ts`,
`commands/skills.ts`, `commands/skills-expand.ts`, `lib/command-tree-def.ts`,
`package.json`, `lib/__tests__/no-board-skills-drift.test.ts`.

**Interfaces:** `resolveHarnessTarget(harness: HarnessId): Promise<Outcome<SkillTarget>>`.
`SkillTarget` contains `harness`, supported capabilities,
`fragments: Record<string,string>`, and
`resourcePath(relativePath: string): Outcome<string>`.
Extend `compileSkill`'s existing opts with `target?: SkillTarget`, preserving
legacy Claude behavior when omitted during migration. Final command entry
points always resolve an explicit target. Add `--harness` to compile/check/expand.

- [ ] Write `same source compiles distinct native sequences`,
  `missing required capability rejects compilation`, and `target outputs never overwrite each other`.
  Assert a Codex artifact contains neither `AskUserQuestion` nor unresolved
  `${CLAUDE_SKILL_DIR}` for a fixture requiring adapted questions/resources;
  `expect(result.errors).toHaveLength(0)` only when all referenced fragments
  and required capabilities exist. Retain exact existing diagnostic coordinates.
- [ ] Run `bun test lib/skills/__tests__/harness-target.test.ts lib/skills/__tests__/expand.test.ts`;
  expect target assertions red.
- [ ] Extend the existing placeholder parser with `{{harness:<fragment>}}`
  and source requirements with an optional capability list. Resolve explicit
  fragments through the target before unresolved-placeholder checks. Adapt
  path rendering through `resourcePath`, including allowed-tool paths; accept
  legacy Claude tokens only in the Claude compatibility input path. Preserve
  relative-path validation and source maps. Generated outputs carry target
  identity in their manifest/cache key; the same output directory cannot mix
  targets. Existing `apps/board/skills` remains the Claude generated target;
  add `apps/board/skills-targets/codex` as a generated target from the same
  `skills-src`, with target metadata consumed by setup/build tooling.
  Extend `skills:expand:board` and its drift guard to generate/check both
  targets explicitly; a configured user default must not alter build output.
- [ ] Run the suites plus existing compile-source/output command tests.
  Generate both targets into separate temporary directories, check all links,
  and run `bun run docs:gen` for the new flags.
- [ ] Stage task files, generated command docs and fixtures and commit `feat: compile harness-specific skill targets`.

### S3: Configure enabled integrations without changing defaults silently

**Files:** Create `lib/agent-integrations/preferences.ts`,
`lib/agent-integrations/__tests__/preferences.test.ts`;
modify `packages/rt-client/src/settings/registry-defs.ts`,
`packages/rt-client/src/settings/registry-schemas.ts`,
`packages/rt-client/src/settings/__tests__/schema-examples.ts`,
`lib/daemon/handlers/agent-integrations.ts`.

**Interfaces:** `enabledIntegrations(): HarnessId[]` reads `agent.integrations`
through the resolver. On absence it returns `["claude"]` plus the configured
`agent.provider` when that differs, which is what the migration writes.
A dated `MigrationDef` in `lib/setup/migrations/index.ts` writes that value
once on existing installations.
`validateIntegrationPreference(ids: string[]): Outcome<HarnessId[]>` validates
registered IDs, rejects duplicates and retains the user's order. Explicit
empty list is valid and enables none. Registration and readiness stay separate.

- [ ] Write `upgrade keeps Claude and adds configured Codex`,
  `empty preference enables none`, and `installed binary does not enable itself`.
  Assert `expect(enabledIntegrations()).toEqual(['claude','codex'])` with an
  absent list and `agent.provider` explicitly `codex`; `['claude']` with an
  absent list and no provider set; and `[]` with an explicit empty list even
  when both executables are installed. Assert the migration writes the same
  value, is recorded `done`, and a second run changes nothing. Test machine
  scope overriding user scope.
- [ ] Run `bun test lib/agent-integrations/__tests__/preferences.test.ts`; expect red.
- [ ] Register the parent plan's setting shape/scopes with no default and
  update metadata readiness. Preserve existing per-provider keys and the
  existing default for upgraded installations. Fresh setup writes its chosen
  list/default through the resolver. A default outside the enabled set is
  reported as an actionable configuration problem, not replaced silently.
- [ ] Run the test, `bun run cli.ts settings schema lock`, and
  `bun run --cwd packages/rt-client build`; run schema examples/checks and
  inspect any schema diff before committing the lock.
- [ ] Stage task files and registry lock artifacts and commit `feat: configure enabled harness integrations`.

### S4a: Install selected native tools, skills and MCP

**Files:** Create `lib/agent-integrations/claude/install.ts`,
`lib/agent-integrations/codex/install.ts`,
`lib/setup/steps/agent-integrations.ts`,
`lib/setup/__tests__/agent-integrations.test.ts`;
modify `lib/setup/validators/tools.ts`, `lib/setup/tools-install.ts`,
`lib/setup/steps/plugins.ts`, `lib/setup/steps/skills.ts`,
`lib/setup/steps/linear-mcp.ts`, `lib/setup/skills-link-bundled.ts`,
`lib/setup/apply.ts`, `lib/setup/contract.ts`.

**Interfaces:** `InstallAdapter.steps(): StepDef[]`,
`verify(): Promise<Outcome<Readiness>>` and
`createIntegrationSteps(enabled: HarnessId[]): StepDef[]`.
Each adapter supplies host-specific tool/auth/plugin/MCP/skill/policy operations
through existing setup result types. S4a verification reports tools/MCP/skills
readiness only, not gate/continuation policy. S4b/M6c supply those. Shared ordering and required/finish-gated
rules remain in the setup framework.

- [ ] Write `Codex-only setup has no Claude prerequisite or spawn`:
  `expect(requiredTools).not.toContain('claude')` and every executed command
  belongs to Codex/shared setup. Assert both hosts can be enabled, auth failure
  offers a remedy, repeated install is idempotent, and no unrelated host
  permission field changes.
- [ ] Run `bun test lib/setup/__tests__/agent-integrations.test.ts`; expect red.
- [ ] Extract Claude install steps and implement Codex's supported plugin/MCP
  configuration. M6b supplies policy artifacts; S4b separately owns their
  project configuration and exact-definition trust lifecycle. Select Fast Browser/Herdr host setup by
  integration rather than hardcoded Claude. Include writing-style resolution
  and required external tools. Use existing ownership state; do not set a
  global sandbox bypass to gain socket access. Verify the configured CLI/MCP
  transport works under the intended permission mode. Do not mark an operation
  update-safe until S10 establishes its restore/update behavior.
- [ ] Run setup step/validator suites and an isolated clean Codex-only setup
  using the existing VM framework. Verify tool discovery and a real rt MCP
  call; Claude executable/config/cache must be absent from this profile.
- [ ] Stage task files and setup fixtures and commit `feat: install Mattstack for selected harnesses`.

### S4b: Install reviewed Codex policy at the actual project boundary

**Files:** Create `lib/agent-integrations/codex/policy-install.ts`,
`lib/setup/__tests__/codex-policy-install.test.ts`;
modify `lib/agent-integrations/codex/install.ts`, `lib/setup/state.ts`,
`lib/setup/steps/agent-integrations.ts`.

**Interfaces:** `planCodexPolicyInstall(input: { cwd: string; profile: string }): Promise<Outcome<PolicyInstallPlan>>`;
`applyCodexPolicyInstall(plan: PolicyInstallPlan, reviewed: readonly string[]): Promise<Outcome<void>>`.
`PolicyInstallPlan` contains the actual native project boundary, exact file/key
patches with before-fingerprints, M6b's artifact revision, native hook keys/hashes,
and review IDs. `reviewed` contains IDs from this plan only, supplied by the
existing human setup flow, never by a model-written tool argument. Host-native
configuration is an installer-owned projection; preferences remain suite settings.

- [ ] Write `nested worktree trust uses actual boundary`, `existing hook entries survive`,
  `new hash requires fresh review`, `concurrent config edit refuses patch`,
  and `trust does not hot-reload an old worker`.
  Assert no `git init`, no parent trust expansion, no trust bypass, no blanket
  hooks replacement and no shared daemon restart. Trusting just a nested cwd
  cannot be reported ready when hooks/list omits the project hooks. Reject
  stale review IDs and changed script artifacts even if the native hash is unchanged.
- [ ] Run `bun test lib/setup/__tests__/codex-policy-install.test.ts`; expect red.
- [ ] Implement the proven project-layer arrangement at the actual boundary
  Codex reports for the working repository/worktree. Merge only owned entries
  into its active `.codex/hooks.json` (or existing inline representation; never
  install duplicate handlers in both). Do not invent a nested repository as in
  the disposable spike. Discover native keys/current hashes through hooks/list;
  present the exact boundary, commands and hashes in setup's existing review
  surface. Persist only approved exact trust entries with compare-before-write
  protection and ownership metadata. If project trust must precede discovery,
  use two review stages; approval of the folder is not approval of unknown hooks.
  Existing identical trusted user entries can be used but never adopted for deletion.
- [ ] Keep installation readiness separate from M6c's actual-session proof.
  A fresh owned worker is the proven loading route. For a loaded old thread,
  report not-ready/recovery needed; never terminate or replace it automatically.
  Updates keep a still-loaded old artifact available until no active session
  relies on it, but admit new work only against the selected reviewed revision.
- [ ] Rerun tests. In a clean acceptance-owned repo and an actual rt worktree,
  perform review/install/verify with the intended sandbox, exercise the real
  M6b bridge and confirm native question/Stop enforcement. Without this real
  worktree acceptance, the synthetic nested-repo spike is insufficient to
  mark production setup ready. Verify denied review leaves managed work blocked.
- [ ] Commit `feat: install reviewed Codex project policy without broad trust`.

### S5: Adopt integrations in Board workflows

**Files:** Modify `apps/board/src/herdr.ts`, `apps/board/src/skill-path.ts`,
`apps/board/bin/gate.ts`, `apps/board/bin/review-status.ts`,
`apps/board/bin/respond-status.ts`, `apps/board/src/gates/legacy-session-migration.ts`,
`apps/board/src/client/board/stage-gate.ts`;
create `apps/board/src/__tests__/harness-workflows.test.ts`.

**Interfaces:** Preserve `startAgentPane` consumers and use F6 metadata, S1
resource resolution and F4 session context. Add
`resolveAgentSkill(harness: HarnessId, skill: string): Promise<Outcome<string>>`
in `skill-path.ts`; return the selected target's installed artifact.

- [ ] Write `Codex review responds and reports without Claude` and
  `legacy migration preserves explicit native reference`.
  Assert the launch selects Codex, the resolved skill is its target artifact,
  and status/gate updates refer to the correct run/session. No Claude inventory
  subprocess is allowed in the Codex fixture.
- [ ] Run `bun test apps/board/src/__tests__/harness-workflows.test.ts`; expect red.
- [ ] Replace remaining lookup/session/form assumptions while preserving
  Board's existing shared launcher, gate data and legacy migration ownership.
  Remove native tool labels from generic UI copy. Consume normalized gate/
  question state rather than embedding another native screen parser.
- [ ] Run `bun run board:test` and `bun run board:typecheck`. Exercise review,
  respond, doctor, resume and an external gate answer in the browser for both
  harnesses; retain screenshots and worker-result evidence.
- [ ] Stage task files and commit `refactor: run Board workflows through harness integrations`.
- [ ] Mods-first Claude board panes (BOARD-52; [Claude mods design](../specs/2026-10-07-harness-integrations-claude-mods-design.md)).
  - First, an API check in a `--plugin-dir` pane: after `$.turn.abort`, can the mod end or absorb the backgrounded Bash and the wake-up turn it starts? mods-02 found the shell survives and starts a turn. Record the answer in `.harness-spike/mods-s5/report.md`.
  - Add a mod `status` tool that replaces the `status-bin` Bash calls in `apps/board/skills-src`, used where the block is live. Skills keep `status-bin` otherwise.
  - Add stand-down as a pushed `stand-down` command that runs `$.turn.abort`, then ends or absorbs the background work per the check. If neither is possible, report `stood-down-background` so the board shows "stood down; background work finishing" until it ends.
  - Write `status tool updates the run like status-bin`, `stand-down stops the turn`, and `no status-bin call in a mod session`.
  - Commit `feat: board panes report status and stand down through the Claude mod`.

### S6: Adopt metadata in Chat and Console

**Files:** Modify `apps/chat/src/app/PanePicker/NewPaneForm.tsx`,
`apps/chat/src/server/panes.ts`, `apps/chat/src/app/PanePicker/PanePicker.test.tsx`,
`apps/console/src/server/agent-models.ts`,
`apps/console/src/server/agent-models.test.ts`,
`apps/console/src/app/settings/CompositeControls.tsx`;
create `apps/chat/src/server/harness-panes.test.ts`.

**Interfaces:** Consume F6 `agentIntegrations` and existing shared launch APIs.
Integration option descriptors supply model/effort/account choices. Keep
Console's existing model API envelope; derive entries from the registry.

- [ ] Write `picker lists enabled ready harnesses and preserves explicit choice`
  and `Console models come from selected integration`.
  Assert a fixture third integration appears without adding a UI switch,
  Codex is never given a Claude-only account field, and a readiness change
  produces a clear refusal rather than silently selecting another harness.
- [ ] Run `bun run --cwd apps/chat test -- src/server/harness-panes.test.ts src/app/PanePicker/PanePicker.test.tsx`
  and `bun run --cwd apps/console test -- src/server/agent-models.test.ts`; expect new cases red.
- [ ] Replace hardcoded lists with metadata while retaining existing UI kit
  controls and settings scope. Use the shared pane API. Verify Herdr chat's
  discover/invite/jump/message operations against that API; change its Rust
  consumer only if the preserved wire contract requires it, with a separate
  reviewed task rather than an unplanned protocol break.
- [ ] Run `bun run chat:test`, `bun run console:test`, and their typecheck
  scripts. Browser-test picker creation, mixed roster, invite and jump;
  verify each action reaches the intended native session.
- [ ] Stage task files and commit `refactor: populate agent choices from integration metadata`.

### S7: Route gitq agent actions through shared launch and context

**Files:** Modify `apps/gitq/src/server/herdr.ts`,
`apps/gitq/src/cli/job-status.ts`, `apps/gitq/scripts/install-skills.ts`,
`apps/gitq/tests/board-herdr.test.ts`, `apps/gitq/tests/install-skills.test.ts`;
create `apps/gitq/tests/harness-job-status.test.ts`.

**Interfaces:** Use existing rt-client agent launch wrappers, S1/S2 target
resolution and F4 caller context. Preserve gitq's current agent-action and
job-status result contracts; do not introduce another launcher.

- [ ] Write `gitq action uses configured harness` and `job status binds actual caller`.
  Assert `expect(launch.provider).toBe('codex')`, no direct `claude` command
  is spawned, and a foreign worker cannot report another job's result.
- [ ] Run `bun test tests/board-herdr.test.ts tests/harness-job-status.test.ts tests/install-skills.test.ts`
  from `apps/gitq` (its own `bunfig.toml` only loads from that directory);
  expect new assertions red.
- [ ] Replace direct command construction and Claude env lookup; install the
  selected generated skill target through existing distribution paths.
  Preserve core Git behavior and bundled/npm release separation.
- [ ] Run the named tests and `bun run --cwd apps/gitq typecheck`; exercise a
  gitq agent action and completion report with Claude absent.
- [ ] Stage task files and commit `refactor: use shared harness launch for gitq agent actions`.

### S8: Present integration state in tray onboarding and process views

**Files:** Modify `rt-tray/Sources/Setup/Screens/WelcomeScreen.swift`,
`rt-tray/Sources/Setup/SetupCoordinator.swift`,
`rt-tray/Sources/ProcessPanelData.swift`,
`rt-tray/Sources/Settings/UninstallPane.swift`,
`rt-tray/Tests/MattstackCoreChecks/SetupFlowChecks.swift`,
`rt-tray/Tests/mattstackUITests/SetupFlowUITests.swift`.

**Interfaces:** Decode the shared setup plan/metadata; the tray does not
decide integration readiness or rewrite settings independently. Process badge
classification reads harness metadata rather than an `isClaudeCode` boolean.

- [ ] Add setup fixtures for Claude-only, Codex-only, both and no-enabled-host
  states. Assert required/finish-gated actions match the CLI plan and a missing
  optional Claude installation does not block Codex Finish. Test process labels
  for both harnesses and unknown integrations.
- [ ] Run `swift test --package-path rt-tray`; expect new fixture assertions red.
- [ ] Update decoding/copy and existing controls without adding a second
  setup decision engine. Preserve installation ownership and explain readiness
  using the daemon/setup response rather than native internal terminology.
- [ ] Run Swift checks and the existing SetupFlowUITests through
  `bash rt-tray/vm/run/xcuitest.sh --ver 26 --dmg "$HARNESS_TEST_DMG"`, with
  `HARNESS_TEST_DMG` set to the candidate built artifact. A missing Xcode/golden
  skip is blocked evidence, not a passing UI test.
  Capture onboarding/process/uninstall screens for each supported profile.
- [ ] Stage task files and commit `feat: present harness choices and readiness in onboarding`.

### S10: Preserve ownership during update restore and uninstall

**Files:** Modify `lib/setup/update.ts`, `lib/setup/uninstall.ts`,
`lib/setup/state.ts`, `lib/skills/materialize.ts`, `lib/team/create.ts`,
`lib/agent-integrations/claude/install.ts`,
`lib/agent-integrations/codex/install.ts`;
create `lib/setup/__tests__/integration-lifecycle.test.ts`.

**Interfaces:** Extend `InstallAdapter` with
`reconcile(mode: 'update' | 'restore' | 'uninstall', context: ApplyContext): Promise<StepOutcome[]>`.
Ownership records key integration/profile/resource plus the last applied value
or fingerprint. Absence of ownership never grants permission to delete a
resource; compare current content before replacing an owned value.

- [ ] Write `update preserves user-disabled plugin`, `restore without Claude`,
  and `uninstall preserves unrelated configuration`.
  Add exact project/hook trust ownership fixtures: user-owned trust survives,
  only unchanged installer-owned entries may be removed, changed definitions
  require review, and a partial install can resume without adopting other keys.
  Assert `expect(userEditedValue).toEqual(before)` after all lifecycle modes;
  Codex-only restore invokes no Claude command and completes writing-style/
  team skill materialization. Re-running each mode must have no further edits.
- [ ] Run `bun test lib/setup/__tests__/integration-lifecycle.test.ts lib/setup/__tests__/update-safe.test.ts`;
  expect new ownership cases red.
- [ ] Generalize existing ownership accounting to integration/profile keys;
  migrate known Claude ownership records without adopting unrelated files.
  Use resolver-owned settings and existing update-safe restrictions. Disabling
  excludes new assignments while active session bindings continue to reconcile;
  do not kill sessions. Retain hook executable revisions used by active
  bindings; uninstall marks new managed launches unavailable and defers artifact
  deletion until those bindings end. Never silently remove enforcement from
  an active managed worker. Native trust removal and configuration edits use
  the recorded exact ownership/fingerprint checks from S4b. Restore resolves the selected target's plugin sources
  rather than assuming the Claude cache is the source of truth.
- [ ] Run the named tests and setup/materialization suites, then clean-room
  update, interrupted-update retry, restore and uninstall for all profiles.
- [ ] Stage task files and commit `feat: preserve integration ownership across setup lifecycle`.

### S11: Port canonical workflow instructions and generated artifacts

**Files:** Modify `plugins/mattstack/attachments/gate-protocol/SKILL.md`,
`plugins/mattstack/attachments/model-tiering/SKILL.md`,
`plugins/mattstack/attachments/pipeline/work/SKILL.md`,
`plugins/mattstack/skills/review/subagent-review-loop/SKILL.md`,
`apps/board/skills-src/review/SKILL.md`,
`apps/board/skills-src/respond/SKILL.md`,
`apps/board/skills-src/doctor/SKILL.md`, `lib/mcp/tools.ts`;
create `plugins/mattstack/attachments/harness/claude.md`,
`plugins/mattstack/attachments/harness/codex.md`,
`lib/skills/__tests__/harness-workflow-artifacts.test.ts`.

**Interfaces:** S2 fragments use names `questions`, `wait`, `delegation`,
`models`, `accounts`, and `resources`. Map these names to sections in the two
canonical harness attachments through each SkillTarget. Existing shepherdr
and pipeline edits from H2/H4 consume these fragments. Explicitly classify
every remaining native-tool dependency in the audit; shared prose stays shared.

- [ ] Write `compiled workflow uses executable native sequence` for attended
  questions, unattended gates, background wait, subagent review, and model
  selection. Assert unsupported native tools/effort values are absent from
  the opposite target and required gate policy is still declared. A fixture
  changes a shared decision rule and both targets must include that change.
- [ ] Run `bun test lib/skills/__tests__/harness-workflow-artifacts.test.ts`; expect red.
- [ ] Extract native instruction fragments, preserving shared decision rules.
  Codex `questions` uses synchronous native forms only when plan-mode form
  capability is verified; default mode and unattended flows use existing
  Mattstack gate open/wait/subscription. Do not emit `request_user_input_async`
  as an authoritative gate answer path, nor claim an emitted async item means
  an answer completed. This is not a ban on optional informational async text.
  Keep native model/effort choices validated by the selected host inventory.
  Follow writing-skills behavioral checks for changed instructions. Regenerate
  harness-neutral MCP descriptions; native action instructions belong in the
  selected fragments or context-aware results, not hardcoded global tool prose.
  Regenerate
  compiled plugin and both Board targets, update `.claude-plugin/plugin.json`
  version for plugin changes, and keep generated copies traceable to source.
  Do not fork the entire skill library or silently translate arbitrary external
  pack content. Report unsupported pack requirements with source coordinates.
- [ ] Run artifact tests, `bun run skills:expand:board`, target-aware strict
  checks from S2, and affected `plugins/mattstack/tests/certify.sh` checks.
  Regenerate the MCP reference with the existing generator after tool changes.
  Run live question/wait/review/pipeline instruction scenarios on both harnesses.
- [ ] Stage canonical sources, generated artifacts and versions and commit `feat: adapt Mattstack workflows for each harness`.

### S12: Make skill authoring and maintenance host-neutral

**Files:** Modify `lib/skills/init.ts`, `lib/skills/sync.ts`,
`commands/skills-init.ts`, `commands/skills-sync.ts`,
`commands/skills-link.ts`, `commands/skills-audit.ts`,
`commands/skills-writing-style.ts`, `lib/command-tree-def.ts`;
create `commands/__tests__/skills-harness-maintenance.test.ts`.

**Interfaces:** Extend SkillAdapter with
`maintain(operation: 'init' | 'sync' | 'link', source: string): Promise<Outcome<void>>`.
Each command resolves an explicit `--harness` or configured default once, then
uses S1/S2. Skill audit launches through the shared agent launcher with that
selection; it does not require Claude authentication for a Codex audit.

- [ ] Write `Codex init sync link audit and style need no Claude` and
  `maintenance failure does not update installed-version state`.
  Assert command receipts preserve their JSON envelopes, failed host operations
  remain failed, and target paths never point into another host's cache.
- [ ] Run `bun test commands/__tests__/skills-harness-maintenance.test.ts`; expect red.
- [ ] Move native CLI calls into adapters and keep orchestration/reporting in
  current commands. Preserve source/installed drift checks, writing-style
  precedence and diagnostic wording. Add documented flags with required
  command-tree/root-confinement declarations; audit launches must retain
  supported headless/interactive result handling.
- [ ] Run the new suite and existing init/sync/link/audit/writing-style tests;
  run `bun run docs:gen`. Exercise maintenance on an isolated Codex-only pack.
- [ ] Stage task files, generated docs and commit `refactor: maintain skills through selected integrations`.

### S9: Verify distributed profiles and close the audit

**Files:** Create `scripts/acceptance/harnesses.ts`,
`scripts/acceptance/__tests__/harnesses.test.ts`,
`e2e/tests/harness-contract.test.ts`,
`lib/__tests__/no-agent-integration-boundary-leaks.test.ts`,
`docs/superpowers/evidence/harness-integrations-acceptance.json`;
modify `scripts/build-apps.ts`, `scripts/release/marketplace.sh`, `rt-tray/build.sh`,
`rt-tray/vm/run/guest/assert-team.sh`, `rt-tray/vm/run/guest/screens.sh`,
`.github/workflows/checks.yml`, `.github/workflows/e2e.yml`.

**Interfaces:** `runHarnessAcceptance(options: { profile: 'claude-only' | 'codex-only' | 'mixed'; evidence: string }): Promise<void>`.
`verifyHarnessAcceptance(evidence: string): Outcome<void>` checks the completed
matrix; the CLI exposes it as `--verify --evidence`.
Evidence records artifact commit/version, actual native versions, profile,
permission mode, hook revision/trust/proof, managed/manual launch provenance, scenario,
audit IDs, outcome `passed | failed | blocked`, and sanitized evidence paths.
Missing required scenarios are failures. Optional unsupported native async
form scenarios are recorded separately as unsupported; all required Mattstack
gate workflows must still pass through synchronous forms or gate open/wait. Local auth-dependent runs are opt-in;
unit/conformance CI does not pretend missing credentials are a pass.

- [ ] Write `matrix refuses incomplete evidence`, `fake third integration needs no core branch`,
  and `Codex-only artifact never executes Claude`.
  Require scenario IDs `hook-trust-fresh`, `hook-trust-changed`,
  `hook-script-tampered`, `hook-timeout`, `hook-repeated-stop`,
  `question-controller-reconnect`, `question-answer-race`,
  `all-clients-disconnect`, `rt-restart-after-answer`, `native-restart-pending-question`,
  `native-restart-queued-input`, `consumption-client-id`, and `default-cli-adoption`.
  Record native-form limitations separately from required gate workflow results;
  an unsupported form cannot turn a blocked required workflow into a pass.
  Assert `expect(missingScenarioResult.ok).toBe(false)` and the fixture
  integration can register, bind, deliver, complete a gate and be selected by
  shepherdr without modifying consumers. Test malformed native events,
  unsupported versions, stale generations and false capability declarations.
  Add an import-boundary guard for generic consumers: native protocol modules
  may be imported only through integration composition, with explicit legacy
  migration exceptions. This complements, rather than replaces, behavior tests.
- [ ] Run `bun test scripts/acceptance/__tests__/harnesses.test.ts`; expect red.
- [ ] Implement the acceptance runner using existing VM/e2e infrastructure;
  each disruptive case creates or targets an explicitly acceptance-owned
  service/environment and records its service identity before any stop. User
  regular HOME/auth can be used for nondisruptive owned workers; do not switch
  HOME/CODEX_HOME or restart shared services implicitly. If no authorized
  isolated service/VM is available, record blocked. Preserve sanitized before/
  after pending state and native IDs so restart tests prove the original
  operation's fate, not merely success of a replacement turn. Replayed or
  lost native input remains explicit; logical retry IDs do not prove native
  deduplication. Then add artifact selection for S2's generated targets to bundle setup without
  changing the served-app catalog. Record an explicit tested version matrix;
  do not derive ranges from one working version. Extend existing CI jobs and
  release checks rather than introducing a plugin-specific root unit shard.
  Inspect native protocol fixtures for credential/content leakage.
- [ ] Run `bun run check`, `bun run test`, affected app tests/typechecks, plugin
  certification, strict target skill checks, and the new e2e contract test via
  `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/harness-contract.test.ts`.
  Then run these commands on isolated installed artifacts; each run atomically
  updates its own profile in the shared evidence file:

  ```bash
  bun scripts/acceptance/harnesses.ts --profile claude-only --evidence docs/superpowers/evidence/harness-integrations-acceptance.json
  bun scripts/acceptance/harnesses.ts --profile codex-only --evidence docs/superpowers/evidence/harness-integrations-acceptance.json
  bun scripts/acceptance/harnesses.ts --profile mixed --evidence docs/superpowers/evidence/harness-integrations-acceptance.json
  bun scripts/acceptance/harnesses.ts --verify --evidence docs/superpowers/evidence/harness-integrations-acceptance.json
  ```

  Verification must exit 0 only for a complete passing matrix. The
  runner must cover install, skills/MCP, chat, gates, pipeline, shepherd/workers,
  Board/gitq actions, disconnects/restarts, update, restore and uninstall.
  Include both shepherd harnesses in mixed mode and every runtime state in
  the spec. Capture browser evidence for actual external gate answers.
- [ ] Re-run the dependency inventory. Map A01–A28 to passing evidence or
  explicit unresolved gaps; classify remaining native references. Remove
  transitional direct paths after migrated callers/tests pass. Do not declare
  full support with a blocked required scenario. Stage only verified code,
  sanitized evidence, docs and generated artifacts; copy the verified report
  to the listed evidence document, then commit `test: verify full harness support across distributed profiles`.

Publication is a separate release action after plan execution and review.
