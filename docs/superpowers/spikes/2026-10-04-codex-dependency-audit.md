# Mattstack Codex dependency audit

**Date:** 2026-10-04. **Checkout:** `7538cfe5c`.
**Purpose:** input to the Superpowers architectural brainstorm following the
[runtime spike](2026-10-04-codex-compatibility-spike.md).

The follow-up [integration design](../specs/2026-10-04-harness-integrations-design.md)
maps every register row to a proposed disposition and acceptance requirement.

The user confirmed the target is full Codex support: Codex can run shepherdr,
workers and ordinary Mattstack workflows, with Claude optional. Mixed herds and
Herdr as the terminal surface remain part of that target. This is an audit
record, not an approved design or implementation plan.

The user additionally requires harness-neutral abstractions: Claude and Codex
are the first implementations, with room for other harnesses. Herdr's
integrations illustrate the desired software philosophy; the user explicitly
clarified that this is not a requirement to depend heavily on those integrations.
Mattstack's abstraction boundaries should follow its own responsibilities.
A harness is distinct from a model vendor; model and account choices belong
to that harness's capabilities.

The user confirmed that current Claude chat delivery behavior is the target,
rather than introducing a new queue-versus-interrupt preference. The current
socket-first contract attempts delivery immediately for eligible recipients;
idle sessions start a turn and busy sessions receive input between tool calls.
Gate completion remains a separate operation, preserving the authoritative
stored answer and the existing conditional form-dismissal behavior through
each harness's own mechanisms. Native transport acceptance must not be
represented as proof that an agent has consumed or acted on a message.

## Coverage and limits

The inventory enumerated 6,385 tracked paths, searched readable regular text
files for provider names, session variables, model aliases, hook events and
native tool names, and followed important launch, supervision, setup, skill,
MCP and application call paths. It included hidden tracked plugin manifests.
Binary files, symlinks and lock/dependency payloads were excluded from the broad
text pass; `rt-tray/deps.lock` was inspected separately for integration scope.

The broad classifier found 284 candidate files outside its documentation,
test and board-generated buckets. That is **not a blocker count**: candidates
include comments, examples, design assets, provider implementations and some
tests not recognized by the filename rules. Eleven board-generated skill files
were counted separately. Tests and documentation were searched too, to identify
contracts and compatibility assertions.

The register below records confirmed dependencies and existing abstractions.
It does not establish that every workflow has run successfully in Codex, or
that keyword search can prove the absence of further assumptions. The spike
proves only its listed runtime scenarios. Third-party dependencies, installed
team packs, every external repo and every version combination have not been
fully audited. Local Fast Browser host modules were inspected at their
integration boundary; its Codex support does not make Mattstack's installer
host-neutral automatically.

Herdr's local source and versioned 0.9.3 integration documentation were also
inspected. Its common agent API covers prompting, waiting and reading, while
integrations report native session references and some also report lifecycle
state. Claude and Codex state detection is described as screen-based. Herdr's
`AgentSessionRef` supports an ID or path; reported resume commands provide an
extension mechanism beyond its built-in integrations. These are useful
existing boundaries, but the inspected API does not by itself provide rt's
chat delivery semantics, gate authority or pipeline policy. They are possible
implementation mechanisms, not required foundations for Mattstack's contracts.
The spike's missing Codex session report remains a concrete integration issue
to investigate whichever session-binding implementation the design selects.

## Dependency register

| Area | Evidence in this checkout | Consequence for full support |
| --- | --- | --- |
| Existing agent abstraction | `lib/agent-argv/types.ts`, `lib/agent-argv/index.ts`, `lib/daemon/handlers/agent.ts` | Both providers already exist. Extend this contract rather than adding a second launcher. Codex session capture is delayed and the daemon-down fallback skips it. |
| Launch permissions and context | `lib/agent-argv/types.ts`, `lib/agent-argv/codex.ts`, `lib/daemon/handlers/agent.ts` | Some invocation fields, including added read directories and Claude settings, are intentionally Claude-only. Audit the required capability rather than copying flags. The spike also found shared-server pane environment mismatches. |
| Shepherd ownership and worker reporting | `lib/mcp/herd-tools.ts`, `lib/mcp/shared.ts`, `commands/herd.ts` | Shepherd authorization and worker context use `CLAUDE_CODE_SESSION_ID`. A Codex shepherd fails before worker selection matters. |
| Herd spawn and persistence | `lib/daemon/handlers/herd.ts`, `lib/daemon/herd-store.ts` | Spawn explicitly pins Claude. Provider selection must persist across retries, resume and job reporting. |
| Watchdog and death detection | `lib/daemon/herd-watchdog-adapters.ts:85`, `lib/daemon/handlers/herd.ts:242` | The watchdog treats a non-Claude agent as dead; herd status also assumes Claude. This is a prerequisite for enabling Codex workers. |
| Background activity and recovery | `lib/daemon/herd-watchdog-adapters.ts:47`, `lib/daemon/trust-dialog.ts`, `lib/daemon/trust-accept.ts` | Background-work detection parses Claude's footer; trust and relocation handling parse its dialogs. Codex needs native state/capability handling without applying Claude keystrokes to it. |
| Session registry and identity | `lib/claude-registry.ts`, `lib/daemon/pane-process-session.ts`, `lib/chat-session.ts`, `lib/mcp/whoami-tool.ts` | Discovery, process fallback and caller identification need provider-aware bindings. Rebind panes separately from retaining a provider session's identity. |
| Chat presence and continuity | `commands/chat.ts`, `lib/mcp/chat-tools.ts`, `lib/daemon/handlers/chat.ts`, `marketplace/plugins/chat/hooks/` | Sign-in, liveness and session lifecycle hooks assume Claude. Validate fresh start, resume, compact, fork, clear, disconnect and sign-out semantics. |
| Inbox delivery and pane injection | `lib/daemon/inbox.ts`, `lib/daemon/inject.ts` | Claude inbox frames and composer handling belong behind adapters. Injection currently rejects non-Claude panes. Accepted transport input is not proof of consumption. |
| Pane discovery and creation | `lib/daemon/handlers/pane.ts:217`, `lib/daemon/handlers/pane.ts:87` | Pane lists filter for Claude and pane creation builds Claude/cswap commands. Codex can be absent from the UI even when Herdr detects it. |
| Gate identity and presentation | `commands/gate.ts`, `lib/mcp/tools.ts`, `lib/daemon/gate-push.ts`, `lib/daemon/question-form.ts` | Session fields, question-tool instructions, background waits and form detection are provider-specific. The spike proved native question completion but not reconnect recovery. |
| Gate enforcement | `lib/agent-hooks.ts`, `scripts/hooks/gate-fork.sh`, `commands/gate.ts` | Enforcement uses a Claude `PreToolUse` hook on `AskUserQuestion`. Full support must preserve the gate rule, not merely reproduce question rendering. |
| Pipeline ownership and attention | `lib/runs/resolve-db.ts:69`, `lib/runs/store.ts`, `lib/runs/attention.ts` | Run lookup and liveness use `claude-session`. Falling back to the newest run in a worktree can conceal missing session attribution. Stored data needs a migration strategy. |
| Pipeline continuation policy | `plugins/mattstack/hooks/pipeline-gate-stop.sh`, `plugins/mattstack/attachments/pipeline/work/SKILL.md` | Stop enforcement relies on Claude hook input, exit semantics and session fields. Initial run decisions and wait instructions also name Claude tools. |
| CI lease ownership | `lib/mcp/ci-tools.ts:35` | Lease owners derive from `CLAUDE_CODE_SESSION_ID`; Codex cannot acquire the same session-owned lease through the existing path. |
| MCP file and upload confinement | `lib/mcp/temp-root-guard.ts`, `lib/daemon/upload-guard.ts:60` | Built-in temporary roots are `/tmp/claude-<uid>` variants; installed read roots come through Claude plugin discovery. Codex briefs, generated input files and uploads need equally narrow valid roots. |
| Skill discovery and compilation | `lib/skills/sources.ts`, `lib/skills/packs.ts`, `lib/skills/installed-plugins.ts`, `lib/skills/compile.ts`, `lib/skills/expand.ts` | Discovery reads Claude inventory/settings/cache; emitted paths and allowed-tool declarations use `${CLAUDE_SKILL_DIR}`. Distinguish a shared manifest format from host-specific expansion and installation. |
| Skill authoring and maintenance | `lib/skills/init.ts`, `lib/skills/sync.ts`, `commands/skills-link.ts`, `commands/skills-audit.ts`, `lib/skills/writing-style-sources.ts` | Init/sync/list/update/link/audit/style flows can require Claude even if runtime skills load in Codex. `skills audit` directly launches Claude. |
| Skill behavior and delegation | `plugins/mattstack/attachments/model-tiering/SKILL.md`, `plugins/mattstack/attachments/cswap-accounts/`, `plugins/mattstack/skills/review/subagent-review-loop/SKILL.md` | Model/effort guidance, account selection, native subagent messaging and question/wait instructions need provider-specific bindings. Preserve canonical sources and regenerate compiled copies. |
| Installation and authentication | `lib/setup/validators/tools.ts:141`, `lib/setup/steps/plugins.ts`, `lib/setup/tools-install.ts` | Claude is a required tool; plugin installation invokes its CLI. Herdr setup installs the Claude integration, and Fast Browser setup explicitly passes `--host claude`. Codex-only installation must be tested from a clean machine. |
| Permissions and external tools | `lib/setup/steps/claude-permissions.ts`, `lib/setup/base-permissions.ts`, `lib/setup/steps/linear-mcp.ts` | Setup seeds Claude permission settings and writes Linear into Claude configuration. Define Codex installation/permissions without treating the existing Claude grant as portable. |
| Settings, team restore and uninstall | `packages/rt-client/src/settings/registry-defs.ts`, `lib/skills/materialize.ts`, `lib/team/create.ts`, `lib/setup/uninstall.ts` | Agent provider defaults already exist. Plugin restore/materialization and uninstall still follow Claude stores and CLI operations. Preserve ownership and scope rules while adding Codex lifecycle support. |
| Board workflows | `apps/board/src/herdr.ts`, `apps/board/src/skill-path.ts`, `apps/board/bin/gate.ts`, `apps/board/bin/review-status.ts`, `apps/board/bin/respond-status.ts` | Fresh launches already use `startAgentPane`; this is partial adoption, not a wholly Claude-only launcher. Skill resolution, status/session capture and gate instructions still depend on Claude. Legacy resume code must be classified separately from current paths. |
| Chat application and Herdr chat plugin | `apps/chat/src/app/PanePicker/NewPaneForm.tsx`, `apps/chat/src/server/panes.ts`, `plugins/herdr-chat/src/rt.rs` | New-pane UI assumes Claude models/accounts and uses daemon pane APIs. Herdr chat delegates to rt, so its transitive dependency matters even without Claude literals in its Rust implementation. |
| Gitq agent actions | `apps/gitq/src/server/herdr.ts:112`, `apps/gitq/src/cli/job-status.ts:46`, `apps/gitq/skills/` | Agent command construction directly invokes Claude; job status reads its session variable. Skills also need host adaptation. Core git operations are a separate, reusable concern. |
| Console, tray and onboarding | `apps/console/src/server/agent-models.ts`, `apps/console/src/app/settings/`, `rt-tray/Sources/Setup/Screens/WelcomeScreen.swift`, `rt-tray/Sources/ProcessPanelData.swift` | Console already has both provider settings/model handling. Plugin wiring copy, onboarding, uninstall copy and process badges have Claude assumptions. Avoid rebuilding working provider support. |
| Worktree hooks | `lib/worktree/claude-hook.ts`, `lib/claude-settings.ts`, `commands/worktree-hook.ts`, `lib/daemon/relocation-announce.ts` | The pool is reusable; Claude-native create/remove/relocation integration is not automatically portable. Decide how Codex enters and leaves rt-owned worktrees and grants the required access. |
| Release and clean-room verification | `scripts/release/marketplace.sh`, `rt-tray/vm/run/guest/assert-team.sh`, `rt-tray/vm/run/guest/screens.sh`, `e2e/tests/claude-plugin-contract.test.ts` | Current checks exercise Claude catalog/configuration and installation. Add Codex-only and mixed-provider acceptance coverage, including update, restore and uninstall. |

## Findings that materially expand the spike scope

The most consequential newly traced dependencies are the non-Claude-is-dead
watchdog rule, the separate Claude-only pane API, CI lease ownership, MCP path
confinement, pipeline continuation enforcement, and the Claude-required
installer. These are behavioral dependencies; changing names or adding a
provider dropdown does not resolve them.

Existing abstractions reduce the work: `rt agent` already selects a provider,
Board's fresh launches use it, Console has provider settings, Herdr chat
delegates to rt, and gate/chat storage is reusable. A `.claude-plugin` filename
alone is not proof of incompatibility. Historical docs, generated skill
copies, sample session paths and intentional Claude adapter code should not
be counted as separate features to port.

## Proposed completeness criteria for the design

Each register row should receive an explicit disposition in the design:
shared behavior, provider adapter, provider-specific feature, migration,
or acceptance-only verification. An intentionally unsupported capability must
be visible and explained; it cannot silently select Claude.

In the design, these adapter dispositions should become explicit harness
contracts and registered implementations. Core orchestration and app workflows
should consume capabilities, not branch on Claude/Codex names. Installation,
skill/tool adaptation, messaging, question completion and execution policy
need distinct contracts where their lifecycles differ. Choose use of Herdr's
public APIs inside implementations according to the capability needed, without
exposing its integration internals as Mattstack's core model. A minimal
fake third integration and common conformance tests can check the extension
boundary without promising another production harness in the first release.

The strongest acceptance test is a clean machine with Codex available and
Claude absent: install Mattstack, load the skills and MCP tools, run a pipeline,
run shepherdr, exchange chat messages, answer gates externally, use Board and
gitq agent actions, recover from restarts, update and uninstall successfully.
Run the same applicable workflows with Claude only and with mixed workers to
protect existing behavior. A second runtime matrix must cover idle, working,
question-blocked, background work, disconnect, resumed and dead sessions.

This audit has not run those acceptance suites. It supplies their coverage
register and the confirmed source dependencies for the brainstorm.
