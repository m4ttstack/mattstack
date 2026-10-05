# Harness Identity and Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route existing agent launch and session ownership through extensible, verified integration contracts.

**Architecture:** Extend the existing launcher and stores. Keep native discovery inside Claude/Codex modules, with shared reservation, binding, admission, and caller-context services.

**Tech Stack:** Bun/TypeScript, bun:sqlite, rt-client, native harness APIs, Herdr, Bun tests.

**Spec:** [Approved design](../specs/2026-10-04-harness-integrations-design.md).

## Global Constraints

The [parent plan](2026-10-04-harness-integrations.md) defines shared types,
persistence decisions and all global constraints. “Unknown state must remain
unknown.” “Claude is optional on a Codex installation.” Preserve existing
agent records, chat identities, frozen output, and explicit provider settings.
Follow `docs/repo-identity.md`, `docs/settings-architecture.md`, and the root
AGENTS schema rules. Claim the next state schema version at execution time;
the planning checkout has version 15, which must not be assumed still free.

## Review Focus

- Wrong inherited pane environment must not misattribute a caller (F1, F4).
- Equal raw IDs in two profiles must remain distinct (F3).
- Launch times out after spawning: reconciliation must not spawn a duplicate (F5).
- Clear/fork invalidates old MCP context without silently borrowing another run (F4).
- An old client opening new mixed state must refuse incompatible writes (F3).

## File structure

`packages/rt-client/src/agent-integrations.ts` carries portable types.
`lib/agent-integrations/{contracts,registry,admission,context,session-store,legacy}.ts`
separates contract, selection, caller attribution and persistence. Native
modules live under `claude/` and `codex/`; runtime imports never load setup.
The existing agent/pane handlers remain dispatch entry points.

### F1: Reproduce native attribution and recovery constraints

**Files:** Create `scripts/probes/harness-integrations.ts`,
`scripts/probes/__tests__/harness-integrations.test.ts`,
`docs/superpowers/spikes/2026-10-04-harness-protocol-contracts.md`.

**Interfaces:** Produce `runIntegrationProbe(options: { live: boolean; output: string }): Promise<void>`.
The output is JSON with `versions`, `cases` (name, passed, observations), and
`cleanup` outcomes. It is evidence, not a runtime capability advertisement.

- [ ] Write test `probe requires explicit live mode` with
  `expect(runIntegrationProbe({live:false,output:out})).rejects.toThrow()`;
  assert no process launch or socket connection. Test the recorder redacts
  credentials and records a failed observation as `passed:false`.
- [ ] Run `bun test scripts/probes/__tests__/harness-integrations.test.ts`;
  expect failure because the runner does not exist.
- [ ] Implement the opt-in runner using the previous spike as a starting
  point. Inspect the installed CLI schema/code before choosing native method
  names. Exercise two concurrent Codex threads with intentionally conflicting
  inherited pane variables, each calling CLI and MCP `whoami`; inspect which
  per-request correlation data the supported transport actually supplies.
  Exercise reconnect to an already-pending synchronous and asynchronous
  question, rt restart, CLI replacement, and native-service restart in a
  disposable service instance. Do not restart the user's production service.
  Capture a transcript marker proving consumption, not only queue acceptance.
- [ ] Run the unit test, then `bun scripts/probes/harness-integrations.ts --live --output /tmp/harness-protocol-evidence.json`.
  Record observed API fields and limitations in the spike document. F4 and M5
  require a demonstrated attribution/completion path. If a case fails, repair
  the native binding approach and repeat that case; if no supported path can
  meet the spec, report the blocker and revise the design rather than invent
  a schema field. Cleanup must list only disposable resources.
- [ ] Stage the three task files and commit `test: characterize harness identity and question recovery`.

### F2: Register integrations and admit workflows by capability

**Files:** Create `packages/rt-client/src/agent-integrations.ts`,
`lib/agent-integrations/contracts.ts`, `lib/agent-integrations/registry.ts`,
`lib/agent-integrations/admission.ts`,
`lib/agent-integrations/__tests__/registry.test.ts`;
modify `packages/rt-client/src/index.ts`, `lib/agent-argv/types.ts`.

**Interfaces:** Implement `createRegistry(items: readonly HarnessIntegration[]): IntegrationRegistry`
with `get(id: HarnessId): HarnessIntegration | undefined` and
`list(): readonly HarnessIntegration[]`;
`admit(report: CapabilityReport, required: readonly Capability[]): Outcome<void>`.
`HarnessIntegration` exposes `id`, `label`,
`capabilities(mode: Mode): Promise<CapabilityReport>`,
`validateOptions(options: AgentOptions): Outcome<AgentOptions>`, and a
`sessions: SessionAdapter`. It also exposes
`options(): Promise<OptionDescriptor[]>`, where an OptionDescriptor has
`name: keyof AgentOptions`, `kind: 'text' | 'boolean' | 'choice'`, and optional
`choices: string[]`. Declare these optional lazy factories with the adapter
interfaces defined in M1/M4/M6/S1/S4/S10/S12:
`loadMessaging(): Promise<MessageAdapter>`,
`loadQuestions(): Promise<QuestionAdapter>`,
`loadPolicy(): Promise<PolicyAdapter>`,
`loadSkills(): Promise<SkillAdapter>`, and
`loadInstall(): Promise<InstallAdapter>`.
Absent factories cannot advertise the corresponding capabilities. Declare
the complete final interface shapes in this task so later tasks implement
them without creating imports from nonexistent implementation files.

`SessionAdapter` has `launch(request: LaunchRequest): Promise<Outcome<NativeLaunch>>`,
`resume(ref: NativeSessionRef, request: LaunchRequest): Promise<Outcome<NativeLaunch>>`,
`discover(): Promise<NativeLaunch[]>`, and
`observe(binding: SessionBinding): Promise<Outcome<Observation>>`.
`LaunchRequest` contains `reservationId`, `cwd`, `mode`, `selection`, optional
`prompt`, and validated `access: { readRoots: string[] }`.
`NativeLaunch` contains a verified `native` reference and `attachment` without
generation; the shared store assigns the generation. A launch that cannot
yet establish a native reference returns an ambiguous outcome, not a fake ID.

- [ ] Write `unknown harness refuses and fake harness registers` and
  `missing gate policy refuses admission`:
  `expect(registry.get('fixture')).toBe(fake)` and
  `expect(admit(launchOnly,['gate-policy'])).toMatchObject({ok:false,error:{code:'unsupported'}})`.
  Assert duplicate IDs reject, a not-ready report refuses, and extra native
  options cannot bypass validation.
- [ ] Run `bun test lib/agent-integrations/__tests__/registry.test.ts`; expect red.
- [ ] Implement the shared types, immutable registry and admission function.
  Register built-ins at one composition root; remove the closed provider union
  from generic argv types without weakening runtime ID validation. Keep wire
  `provider` naming compatible where already published.
- [ ] Run the test and `bun run --cwd packages/rt-client build`; expect green
  and generated declarations matching source. Check runtime imports do not
  pull in installer or skill-compiler modules.
- [ ] Stage task files and commit `feat: add harness registry and capability admission`.

### F3: Persist identities and fenced session attachments

**Files:** Create `lib/agent-integrations/session-store.ts`,
`lib/agent-integrations/legacy.ts`,
`lib/agent-integrations/__tests__/session-store.test.ts`;
modify `lib/state/db.ts`, `lib/state/agents-store.ts`, `lib/chat-session.ts`.

**Interfaces:** `createSessionStore(db: Database): SessionStore`, with
`reserve(input: { identity: string; agentId?: string; attemptId?: string }): string`,
`bind(reservationId: string, native: NativeSessionRef, attachment: Omit<Attachment,'generation'>): Outcome<SessionBinding>`,
`get(key: string): SessionBinding | null`,
`find(native: NativeSessionRef): SessionBinding | null`, and
`replaceAttachment(key: string, expectedGeneration: number, attachment: Omit<Attachment,'generation'>): Outcome<SessionBinding>`.
`resolveLegacySession(raw: string, harness?: HarnessId): Outcome<SessionBinding>`
uses stored aliases and provenance, not directory heuristics.

- [ ] Write `native tuple prevents collisions`, `resume keeps identity`,
  `stale generation cannot replace attachment`, and `migration preserves explicit Codex`.
  Assert `expect(resumed.identity).toBe(original.identity)`,
  `expect(otherProfile.key).not.toBe(original.key)`, and stale replacement
  returns `error.code === 'stale-binding'`. Add old-Claude, explicit-Codex,
  ambiguous raw-ID and unknown-provenance fixtures, plus old-reader refusal.
- [ ] Run `bun test lib/agent-integrations/__tests__/session-store.test.ts lib/state/__tests__/agents-store.test.ts`;
  expect new assertions red.
- [ ] Add `agent_session_reservations`, `agent_session_bindings`, and
  `agent_session_aliases` tables in state.db. Use transactions and unique native
  tuple constraints; persist generation changes before exposing them.
  Preserve original agent/chat fields through compatibility reads. Mint opaque
  session keys, never filenames from native IDs/paths. Migrate proven legacy
  Claude bindings, preserve explicit Codex, and leave ambiguous rows unbound.
  Use the state version guard so older CLI writers refuse the new schema.
- [ ] Run the named tests plus `bun test lib/state lib/__tests__/chat-session.test.ts`;
  expect green, preserved history/IDs, and no real-home writes.
- [ ] Stage task files and schema fixtures and commit `feat: persist harness session bindings and generations`.

### F4: Resolve CLI and MCP callers through the same binding

**Files:** Create `lib/agent-integrations/context.ts`,
`lib/agent-integrations/__tests__/context.test.ts`;
modify `commands/mcp.ts`, `lib/mcp/redact.ts`, `lib/mcp/shared.ts`,
`lib/mcp/whoami-tool.ts`, `lib/chat-session.ts`.

**Interfaces:** `resolveCallerContext(input: CallerEvidence): Promise<Outcome<CallerContext>>`.
`CallerEvidence` contains optional native reference, connection-bound session
key, observed process/pane hints and requested assignment; trusted transport
correlation is constructed at the server boundary, never from tool arguments.
Add an optional `context` argument to the existing `callTool` dispatcher and
tool execution context; do not change public tool arguments to accept authority.

- [ ] Write `shared server resolves two callers independently`,
  `inherited pane is only a hint`, and `cleared session cannot reuse MCP owner`.
  Assert `expect(a.binding.key).not.toBe(b.binding.key)` and an uncorrelated
  call returns `{ok:false,error:{code:'ambiguous'}}`, even with a valid job ID
  and a matching working directory.
- [ ] Run `bun test lib/agent-integrations/__tests__/context.test.ts lib/mcp/__tests__/whoami-tool.test.ts`;
  expect attribution tests red.
- [ ] Implement the F1-proven correlation path and one resolver shared by CLI
  and MCP. Preserve supported explicit CLI session lookup; reject ambiguous
  raw IDs. Bind per-process stdio only when F1 proves it represents one native
  session; otherwise use proven per-request metadata or an isolated supported
  launch/MCP configuration. Stop if neither is possible. Migrate
  `requireWorkerEnv`/`requireChatHandle` consumers to resolved context, keeping
  compatibility wrappers only while their callers migrate.
- [ ] Run context, whoami, and `bun test lib/mcp/__tests__/chat-tools.test.ts lib/mcp/__tests__/herd-tools.test.ts`.
  Repeat F1's simultaneous real CLI/MCP attribution case; both must pass.
- [ ] Stage task files and commit `refactor: resolve agent callers through session bindings`.

### F5: Adapt launch, resume and native observations

**Files:** Create `lib/agent-integrations/claude/sessions.ts`,
`lib/agent-integrations/codex/sessions.ts`,
`lib/agent-integrations/launch.ts`,
`lib/agent-integrations/__tests__/sessions.test.ts`;
modify `lib/agent-argv/index.ts`, `lib/daemon/handlers/agent.ts`,
`commands/agent-fallback.ts`, `lib/daemon/agent-status-poller.ts`.

**Interfaces:** `createClaudeSessions(): SessionAdapter`,
`createCodexSessions(): SessionAdapter`, and
`launchBoundAgent(request: LaunchRequest): Promise<Outcome<SessionBinding>>`.
Consumes F2 registry/F3 store. Native adapters return observations; only the
shared launch service reserves/binds identity and changes store ownership.

- [ ] Write `launch timeout reconciles without duplicate spawn`,
  `resume reapplies persisted options`, and `disconnect does not mean dead`.
  Assert a timed-out native bind causes `spawnCount === 1`, subsequent discovery
  binds that process, changed defaults do not alter resumed `yolo`, and
  disconnected observations retain `execution:'unknown'` unless death is proven.
- [ ] Run `bun test lib/agent-integrations/__tests__/sessions.test.ts lib/daemon/__tests__/agent-handlers.test.ts`;
  expect new assertions red.
- [ ] Extract existing argv, registry, trust-dialog and observation mechanics
  into adapters; reuse current utilities. Implement Codex identity/observation
  using F1's evidence. Integrate interactive/headless paths with reservations;
  headless IDs come from validated events. Persist launch correlation before
  spawn. Daemon-down fallback may keep its existing limited launch behavior but
  must disclose unavailable managed capabilities and never impersonate a bound
  herd worker. No native parser remains in generic watchdog consumers.
- [ ] Run the named tests and
  `bun test lib/__tests__/agent-argv.test.ts lib/__tests__/agent-argv-codex.test.ts commands/__tests__/agent-fallback.test.ts`; execute live start/resume in both
  supported modes. Readiness remains capability-specific, not full-support.
- [ ] Stage task files and commit `refactor: launch and observe agents through integrations`.

### F6: Expose integrations and migrate pane discovery

**Files:** Create `lib/daemon/handlers/agent-integrations.ts`,
`lib/daemon/__tests__/agent-integrations.test.ts`;
modify `lib/daemon.ts`, `lib/daemon/handlers/pane.ts`,
`lib/daemon/pane-process-session.ts`, `packages/rt-client/src/commands.ts`,
`packages/rt-client/src/index.ts`.

**Interfaces:** `listAgentIntegrations(mode: Mode): Promise<IntegrationSummary[]>`
returns ID, label, enabled flag, readiness, capability list, and validated
option descriptors. Add daemon command `agent:integrations` and rt-client
wrapper `agentIntegrations({mode}: {mode: Mode})` using the existing response
envelope. Pane methods retain their existing API and use the registry internally.

- [ ] Write `pane discovery includes both harnesses and fixture integration`:
  `expect(panes.map(p=>p.provider).sort()).toEqual(['claude','codex','fixture'])`.
  Assert pane creation calls the shared launcher once, unknown IDs refuse,
  and metadata loading does not import setup modules.
- [ ] Run `bun test lib/daemon/__tests__/agent-integrations.test.ts`; expect red.
- [ ] Wire registry metadata through the existing daemon dispatcher, preserving
  logging/auth seams. Remove the Claude filter and direct pane launch path;
  route process fallback through integration discovery. Export portable types
  and wrappers without importing runtime code into rt-client.
- [ ] Run the new test, `bun test packages/rt-client`, and
  `bun run --cwd packages/rt-client build`; expect green and current dist.
- [ ] Stage task files and commit `feat: expose integration metadata and neutral pane APIs`.
