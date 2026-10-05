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

**Re-planned 2026-10-05:** F1 plus the focused hook follow-up determine the
contracts below. This is an execution handoff, not a claim that F2–F6 ran. `rt agent` and `rt pane` output is pinned by
`herd-pane-agent-bytes.json` and its supplement; F5 and F6 keep those bytes.

## Review Focus

- Wrong inherited pane environment must not misattribute a caller (F1, F4).
- Equal raw IDs in two profiles must remain distinct (F3).
- The Claude Code mod's daemon link (RT-405/406) registers into F3's store and
  F4's resolver; there is never a second session registry (F3, F4).
- Launch times out after spawning: reconciliation must not spawn a duplicate (F5).
- Clear/fork invalidates old MCP context without silently borrowing another run (F4).
- An old client opening new mixed state must refuse incompatible writes (F3).

## File structure

`packages/rt-client/src/agent-integrations.ts` carries portable types.
`lib/agent-integrations/{contracts,registry,admission,context,session-store,legacy}.ts`
separates contract, selection, caller attribution and persistence. Native
modules live under `claude/` and `codex/`; runtime imports never load setup.
The existing agent/pane handlers remain dispatch entry points.

### F1: Gating spike (separate plan)

F1 was executed from its own plan,
[2026-10-05-harness-integrations-0-gate-spike.md](2026-10-05-harness-integrations-0-gate-spike.md).
It reused the October 4 evidence and tested only the remaining questions
(G1 to G7) using regular HOME and owned workers on existing services. Shared
daemon restart is deferred acceptance work. Its exit report combines prior
and new evidence. G1/G2/G3/G5 are proven; G4/G7 remain partial. F5 is split
below so native transport, each session implementation and shared admission
can be reviewed independently.

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
the adapter interfaces with the exact operations in the parent vocabulary
and M1/M4/M6/S1/S4. Type-only imports may refer to contracts declared here;
never import a runtime setup module to satisfy a type. Initially omit unbuilt
factories and their capabilities instead of supplying throwing stubs. Test a
fixture implementation of each declared operation when adding its factory.


`SessionAdapter` has `launch(request: LaunchRequest): Promise<Outcome<NativeLaunch>>`,
`resume(ref: NativeSessionRef, request: LaunchRequest): Promise<Outcome<NativeLaunch>>`,
`discover(): Promise<NativeLaunch[]>`, and
`observe(binding: SessionBinding): Promise<Outcome<Observation>>`, and
`startWork(binding: SessionBinding, input: WorkInput): Promise<Outcome<DeliveryReceipt>>`.
`WorkInput` is `{ id: string; text: string }`; its stable ID identifies this
initial work submission across acknowledgement ambiguity, not native deduplication.
`LaunchRequest` contains `reservationId`, `cwd`, `mode`, `selection`, optional
`prompt`, `required: readonly Capability[]`, and validated
`access: { readRoots: string[] }`. Use the parent definition verbatim; prompt
is deferred work and must not be submitted inside native launch/resume.
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
`lib/mcp/whoami-tool.ts`, `lib/mcp/tools.ts`, `lib/chat-session.ts`.

`lib/mcp/tools.ts` reads `CLAUDE_CODE_SESSION_ID` directly in `gate_ask`
(session owner), `chat_post`, `chat_dm` and `herd_answer`; those four move to
the resolved context in this task, not later.

**Interfaces:** `resolveCallerContext(input: CallerEvidence): Promise<Outcome<CallerContext>>`.
`CallerEvidence` contains optional native reference, connection-bound session
key, observed process/pane hints and requested assignment; trusted transport
correlation is constructed at the server boundary, never from tool arguments.
Add an optional `context` argument to the existing `callTool` dispatcher and
tool execution context; do not change public tool arguments to accept authority.

- [ ] Add `gate_ask, chat_post, chat_dm and herd_answer take the resolved session`:
  under a fixture context with no `CLAUDE_CODE_SESSION_ID`, each sends the
  bound session key's native reference, and an unresolved caller refuses.
- [ ] Write `shared server resolves two callers independently`,
  `inherited pane is only a hint`, and `cleared session cannot reuse MCP owner`.
  Assert `expect(a.binding.key).not.toBe(b.binding.key)` and an uncorrelated
  call returns `{ok:false,error:{code:'ambiguous'}}`, even with a valid job ID
  and a matching working directory.
- [ ] Run `bun test lib/agent-integrations/__tests__/context.test.ts lib/mcp/__tests__/whoami-tool.test.ts`;
  expect attribution tests red.
- [ ] Implement Codex CLI extraction from `CODEX_THREAD_ID` and MCP extraction
  from `request.params._meta.threadId` in `commands/mcp.ts`, before dispatch.
  Supply transport-owned profile/connection provenance separately; never copy
  `arguments.threadId` into that evidence. A shared MCP environment has no
  per-call Codex session ID. Resolve both through F3's native tuple and current
  generation/assignment. Preserve metadata through the pinned SDK handler;
  do not trust an arbitrary caller merely because it supplies an `_meta` key.
  Add fixtures for missing/foreign-profile metadata, zero/empty IDs, conflicting
  env/metadata and a caller-supplied lookalike. Keep compatibility branches in
  native extractors, not generic tools. Preserve supported explicit CLI session lookup; reject ambiguous
  raw IDs. Bind per-process stdio only when F1 proves it represents one native
  session; otherwise use proven per-request metadata or an isolated supported
  launch/MCP configuration. Stop if neither is possible. Migrate
  `requireWorkerEnv`/`requireChatHandle` consumers to resolved context, keeping
  compatibility wrappers only while their callers migrate.
- [ ] Run context, whoami, and `bun test lib/mcp/__tests__/chat-tools.test.ts lib/mcp/__tests__/herd-tools.test.ts`.
  Repeat only the simultaneous CLI/MCP attribution acceptance against the
  implemented server; compare each exact native ID and reject a cross-worker
  ownership attempt. Prior spike success does not validate new server code.
- [ ] Stage task files and commit `refactor: resolve agent callers through session bindings`.

### F5a: Own the native Codex control connection

**Files:** Create `lib/agent-integrations/codex/control.ts`,
`lib/agent-integrations/codex/protocol.ts`,
`lib/agent-integrations/__tests__/codex-control.test.ts`.

**Interfaces:** `connectCodexControl(options: { socketPath: string; profile: string }): Promise<CodexControl>`.
`CodexControl.request(method: string, params: unknown): Promise<unknown>`;
`subscribe(listener: (event: CodexEvent) => void): () => void`;
`respond(handle: ActiveQuestionHandle, answers: Record<string,{answers:string[]}>): Outcome<void>`;
`close(): void`. `CodexEvent` is the validated native union for the methods
used by F5c/M1/M5b/M6b; it stays private to `codex/`. Dependencies inject a
socket factory and clock; production discovers the existing native endpoint.

- [ ] Write `buffers early owned events`, `request zero survives`,
  `old connection cannot answer replay`, `foreign events never escape`, and
  `method allowlist cannot be bypassed by adding threadId`. Assert no listener
  receives a foreign thread event and `respond(oldHandle,answer).ok === false`.
  A pending request must reject on close/timeout; a duplicate response refuses.
- [ ] Run `bun test lib/agent-integrations/__tests__/codex-control.test.ts`; expect red.
- [ ] Adapt the spike's initialize/initialized, buffering, request correlation
  and disconnect cleanup into production types. Keep an explicit operation
  allowlist: read discovery, owned-cwd thread creation and owned-thread methods
  actually needed by these tasks. A separate owned launch reservation tracks a
  new thread before its first turn. Reject malformed events and unsupported
  fields required by an operation; negotiate experimental queue capability.
  Filter before recording, do not log full messages, and never start/restart
  the shared native daemon implicitly. Inspect the installed schema against
  saved sanitized fixtures for the release version.
- [ ] Rerun the suite; expect green and all socket/timer resources closed.
- [ ] Commit `feat: add owned Codex control transport`.

### F5b: Extract the existing Claude session behavior

**Files:** Create `lib/agent-integrations/claude/sessions.ts`,
`lib/agent-integrations/__tests__/claude-sessions.test.ts`;
modify `lib/agent-argv/index.ts`, `lib/daemon/agent-status-poller.ts`.

**Interfaces:** `createClaudeSessions(): SessionAdapter` from F2. Native argv,
registry discovery, trust-dialog handling and screen/process parsing stay here;
normalized observations carry current generation, source and timestamp.

- [ ] Characterize fresh/resume/headless argv and current observation fixtures.
  Assert persisted model/account/effort/yolo options survive changed defaults;
  a disconnected transport does not produce `execution: 'dead'`.
- [ ] Run `bun test lib/agent-integrations/__tests__/claude-sessions.test.ts lib/__tests__/agent-argv.test.ts`;
  expect new adapter assertions red.
- [ ] Wrap the current mechanisms without changing their semantics. Keep
  compatibility exports until F5d moves their consumers; do not add another
  registry or a dependency on the future Claude mod API.
- [ ] Rerun the named suites and existing status-poller tests; expect green.
- [ ] Commit `refactor: extract Claude session integration`.

### F5c: Implement Codex session creation, resume and observations

**Files:** Create `lib/agent-integrations/codex/sessions.ts`,
`lib/agent-integrations/__tests__/codex-sessions.test.ts`;
modify `lib/agent-argv/codex.ts`.

**Interfaces:** `createCodexSessions(control: CodexControl): SessionAdapter`.
Consumes F5a and returns F2 `NativeLaunch`; this adapter never assigns a herd
job or mutates shared session generations.

- [ ] Write `create thread before remote attach`, `remote resume omits permission overrides`,
  `ready history is not user work`, and `resume cannot silently replace a thread`.
  Assert the returned native ID is exactly `thread/start.thread.id`; capture
  cwd/runtime roots/sandbox at creation. Assert remote resume argv has neither
  `--add-dir`, `-s` nor `-a`; no second startup prompt is submitted by the TUI.
  An async-form event must not advertise synchronous request completion.
- [ ] Run `bun test lib/agent-integrations/__tests__/codex-sessions.test.ts lib/__tests__/agent-argv-codex.test.ts`;
  expect red.
- [ ] Configure permissions at `thread/start`, preserve the selected native
  approval/sandbox settings, persist one harmless initialization turn to make
  the new thread resumable, then attach Herdr with explicit remote resume.
  Use the same owned API thread without a terminal for headless mode. Reconcile
  a launch timeout against its reservation; never spawn a second worker to
  repair an unknown result. Resume the exact persisted thread and options;
  changed policy readiness is handled by M6c, not a new conversation.
  Map native turn/status/background events to observations; missing channels
  remain unknown. An `agentMessage` saying DONE cannot mark execution idle or
  a job complete; require native turn/status evidence.
- [ ] Rerun the suites. Live-check fresh/resume in both modes with the actual
  sandbox response and, for Herdr, a captured interactive prompt/history.
  A folder trust prompt is blocked attachment, not successful launch readiness.
- [ ] Commit `feat: implement bound Codex sessions`.

### F5d: Route the shared launcher through reservation and readiness

**Files:** Create `lib/agent-integrations/launch.ts`,
`lib/agent-integrations/__tests__/launch.test.ts`;
modify `lib/daemon/handlers/agent.ts`, `commands/agent-fallback.ts`,
`lib/agent-argv/index.ts`, `lib/daemon/agent-status-poller.ts`,
`lib/state/db.ts`, `lib/agent-integrations/session-store.ts`.

**Interfaces:** `launchBoundAgent(request: LaunchRequest): Promise<Outcome<SessionBinding>>`;
`startBoundWork(binding: SessionBinding, input: WorkInput, authorize: () => Promise<Outcome<void>>): Promise<Outcome<DeliveryReceipt>>`.
The authorization callback is trusted server code, never a public tool argument.
For managed work H1 supplies an active-attempt check; for ordinary launches the
agent handler supplies its existing caller authorization. No callback means
no submission. `launchBoundAgent` prepares a binding only; it never sends work.
Consumes F2/F3/F5b/F5c. Optional policy factories are invoked only when the
request requires gate/continuation policy; no absent factory can satisfy that
requirement. M6c implements this seam's native readiness proof.

- [ ] Write `timeout reconciles without duplicate spawn`, `failed policy does not activate assignment`,
  and `resume preserves selection`. Assert `spawnCount === 1` after a bind
  timeout and reconciliation, and no work prompt is submitted before readiness.
  Add `activation fails without sending work` and `immediate report sees active attempt`:
  failed activation/authorization gives `startWorkCalls === 0`; a synchronous
  test report from inside the submission sees the active binding/attempt.
  Missing policy factories refuse managed requests while ordinary launch works.
- [ ] Run `bun test lib/agent-integrations/__tests__/launch.test.ts lib/daemon/__tests__/agent-handlers.test.ts`;
  expect red.
- [ ] Persist the reservation before native creation. If required, prepare
  installed policy read-only; create/resume through the selected session
  adapter; bind the native result; verify required policy on that binding;
  only then return a ready binding. For managed work the caller must activate
  the reserved attempt through H1, then call `startBoundWork`; that operation
  rechecks the current generation/proof and invokes the mandatory authorization
  callback immediately before native submission. Ordinary agent handlers also
  use this explicit submission phase. Persist the work input ID and outcome;
  an ambiguous send is reconciled, never used to spawn or blindly submit twice.
  Add `agent_work_submissions` in state.db keyed by binding/generation/input ID,
  with attempt ID, state (`pending | submitting | submitted | queued | consumed |
  ambiguous | refused`), native correlation IDs and timestamps. Persist
  `submitting` before the native side effect; crash recovery treats that state
  as ambiguous, not safely unsent. Reconcile against native evidence before
  any retry. Keep failed
  verification bound but unready for recovery; never activate a herd attempt.
  Generation changes invalidate proof. Daemon-down fallback retains its
  limited existing behavior and cannot impersonate a managed bound worker.
- [ ] Rerun the named tests plus `bun test commands/__tests__/agent-fallback.test.ts`
  and agent frozen-byte fixtures. Expect no native parsing in generic callers.
- [ ] Commit `refactor: route agent launches through verified integrations`.

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
