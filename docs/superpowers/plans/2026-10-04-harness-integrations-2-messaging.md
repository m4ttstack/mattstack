# Harness Messaging and Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve current Claude chat and gate behavior through shared services and two native implementations.

**Architecture:** Chat/gate stores retain authority; adapters perform native delivery and question completion. Persist delivery evidence separately from logical state and reconcile uncertain outcomes before retry.

**Tech Stack:** Bun/TypeScript, SQLite, existing daemon/MCP services, native sockets and question protocols, Bun tests.

**Spec:** [Approved design](../specs/2026-10-04-harness-integrations-design.md).

## Global Constraints

Inherit the [parent plan](2026-10-04-harness-integrations.md), its types and
F1–F6. **Provisional:** re-planned from the F1 gating spike's exit report
before execution. M1 and M3 absorb RT-408's delivery router as the Claude
messaging mechanism; there is one delivery path per harness. “Current Claude behavior is the compatibility reference, particularly
for chat and gates.” “Transport submission is not proof of consumption or
action.” “Neither integration promises exactly-once model action.”
Read the root AGENTS chat/gate instructions and referenced identity, delivery
and gate specs before editing. Do not regenerate frozen chat byte fixtures.

## Review Focus

- Receiver accepted input but connection closed before acknowledgement (M2).
- Answer committed before a waiter starts or while two surfaces answer (M4).
- Reconnected question ID belongs to an obsolete attachment (M5).
- Foreground is idle but background work remains active (M1, M6).
- Multiple questions, free text, cancellation and self-answers must preserve semantics (M4, M5).

## File structure

`lib/agent-integrations/{claude,codex}/messaging.ts` owns native submissions;
`codex/control.ts` owns transport lifecycle. Shared `delivery.ts` and
`delivery-store.ts` own retry evidence. `questions.ts` and native question
modules bridge gate decisions. `policy.ts` and native policy modules enforce
workflow requirements without owning gate decisions.

### M1: Extract Claude delivery and implement the Codex transport

**Files:** Create `lib/agent-integrations/claude/messaging.ts`,
`lib/agent-integrations/codex/control.ts`,
`lib/agent-integrations/codex/messaging.ts`,
`lib/agent-integrations/__tests__/messaging.test.ts`;
modify `lib/daemon/inbox.ts`, `lib/agent-integrations/contracts.ts`.

**Interfaces:** `MessageAdapter.submit(binding: SessionBinding, input: PeerInput): Promise<Outcome<DeliveryReceipt>>`;
optional `reconcile(binding: SessionBinding, inputId: string): Promise<Outcome<DeliveryReceipt | null>>`.
Produce `createClaudeMessaging(): MessageAdapter`, `createCodexMessaging(): MessageAdapter`.
`CodexControl.request(method: string, params: unknown): Promise<unknown>` and
`subscribe(listener: (event: unknown) => void): () => void` remain private to
the Codex implementation; validate native messages at that boundary.

- [ ] Write shared tests `idle delivery starts input`, `busy delivery submits immediately`,
  and `transport success is not consumption`:
  `expect(claudeReceipt.evidence).toBe('submitted')` and
  `expect(codexReceipt.evidence).not.toBe('consumed')` without an observed
  consumption event. Assert peer provenance, sender identity and logical ID
  survive translation, and no ordinary chat delivery sends Escape.
- [ ] Run `bun test lib/agent-integrations/__tests__/messaging.test.ts`; expect red.
- [ ] Wrap the existing inbox writer, adding an optional supplied transport
  message ID without changing its frame semantics. Implement the native Codex
  transport proven by F1/spike, including its framing, version/capability
  negotiation, timeouts, disconnect cleanup and subscriptions. Native queue
  methods stay private; unknown protocol data cannot become a successful receipt.
  Use current configured inbound permission behavior for Claude.
- [ ] Run the tests and F1 live idle/busy/question-blocked cases; verify
  transcript markers, not just transport replies. Repeat foreground-idle with
  background activity to ensure submission does not cancel unrelated work.
- [ ] Stage task files and commit `feat: implement harness message transports`.

### M2: Track delivery evidence and bounded retries

**Files:** Create `lib/agent-integrations/delivery.ts`,
`lib/agent-integrations/delivery-store.ts`,
`lib/agent-integrations/__tests__/delivery.test.ts`;
modify `lib/state/db.ts`, `lib/daemon/handlers/chat.ts`.

Also modify `lib/daemon.ts` and `lib/daemon/lifecycle.ts` to construct the
delivery service and run bounded recovery on startup/reconnect with shutdown
cancellation; persisted pending rows must have an actual recovery consumer.

**Interfaces:** `deliverPeerInput(binding: SessionBinding, input: PeerInput): Promise<Outcome<DeliveryReceipt>>`;
`reconcileDeliveries(now: number): Promise<{ retried: number; ambiguous: number }>`.
Store `(input_id, recipient, session_key, generation, state, native_id,
attempts, next_attempt_at)` in `agent_deliveries`; state distinguishes pending,
submitted, queued, consumed, ambiguous and refused. The chat message ID and
recipient determine a stable logical delivery ID; batched frames carry the
constituent IDs rather than replacing them with a new logical identity.

- [ ] Write `disconnect after submission remains ambiguous`,
  `definite failure retries same ID`, and `restart retains pending delivery`.
  Assert `expect(retry.id).toBe(first.id)`, ambiguous delivery is not counted
  consumed, and the room message remains present regardless of delivery failure.
  Inject a clock and preserve the current policy: one immediate retry after
  300 ms; the existing 30-second sweep starts backing off after five consecutive
  failures and caps at 120 ticks. Assert `expect(backoffTicks).toBe(120)` at
  saturation, retries still occur after that interval, and a newer message
  resets the failure streak. Bounded means throttled work per sweep, not
  permanently giving up on the recipient.
- [ ] Run `bun test lib/agent-integrations/__tests__/delivery.test.ts lib/daemon/__tests__/chat-delivery.test.ts`;
  expect new recovery cases red.
- [ ] Implement persistent receipts around the existing recipient/batching
  logic and `createChatDeliverySweep`, retaining its scheduling and serialization
  rather than starting a second sweep. Reconcile native receipts when supported; otherwise retain ambiguity
  and use bounded redelivery with stable IDs. Preserve Claude's existing visible
  read/delivery cursor behavior; internal evidence must not relabel it consumed.
  Avoid a second room log or a new urgency setting.
- [ ] Run both suites, then restart the isolated daemon with pending and
  ambiguous deliveries; verify stored messages and bounded retries survive.
- [ ] Stage task files and commit `feat: persist harness delivery evidence and recovery`.

### M3: Migrate chat identity and presence consumers

**Files:** Modify `commands/chat.ts`, `lib/mcp/chat-tools.ts`,
`lib/daemon/handlers/chat.ts`, `lib/state/presence-store.ts`,
`lib/state/chat-store.ts`, `lib/daemon/inject.ts`,
`marketplace/plugins/chat/hooks/hooks.json`;
create `lib/daemon/__tests__/chat-harness-continuity.test.ts`.

**Interfaces:** Consume F4 `resolveCallerContext` (which already moved the
`chat_post`/`chat_dm` tools in `lib/mcp/tools.ts` onto it) and M2 `deliverPeerInput`.
Produce `applySessionPresence(binding: SessionBinding, event: 'start' | 'resume' | 'compact' | 'end'): Promise<void>`
in `lib/agent-integrations/presence.ts` (create). Sign-in still uses the
existing chat identity store and authorized continuation paths.

- [ ] Write `same thread resume keeps identity but reused pane does not`:
  `expect(resumed.handle).toBe(original.handle)` and
  `expect(fresh.handle).not.toBe(original.handle)`. Assert compact retains
  identity, fork/clear creates fresh identity, self-posts do not become unread,
  and stale lifecycle events cannot sign out a replacement attachment.
- [ ] Run `bun test lib/daemon/__tests__/chat-harness-continuity.test.ts lib/daemon/__tests__/chat-identity-incident.test.ts`;
  expect new harness cases red.
- [ ] Replace registry/env assumptions with shared context and integration
  lifecycle observations. Keep Claude hooks as native entry points feeding the
  common service; Codex lifecycle wiring comes from its session implementation.
  Preserve existing room rules, welcome/catch-up, DMs, claims, reply hints,
  viewer route contract and CLI bytes. Bump the affected chat plugin version
  in its manifest as required by its release contract.
  Route invite/pane injection through the selected integration; keep Claude's
  composer preservation inside its adapter. Unsupported blocked-state input
  remains an explicit refusal, not a paste into a native question form.
- [ ] Run both suites, `bun test lib/mcp/__tests__/chat-tools.test.ts`, and the
  existing chat command byte tests. Live-test bidirectional Claude/Codex chat
  including resume, sign-out and a new session in the same pane.
- [ ] Stage task files, affected hook scripts and manifest and commit `refactor: bind chat presence to harness sessions`.

### M4: Persist native question bindings and authoritative completion

**Files:** Create `lib/agent-integrations/questions.ts`,
`lib/agent-integrations/question-store.ts`,
`lib/agent-integrations/__tests__/questions.test.ts`;
modify `lib/daemon/gates-store.ts`, `lib/daemon/handlers/gate.ts`,
`lib/daemon/gate-push.ts`, `lib/daemon.ts`, `lib/daemon/lifecycle.ts`.

**Interfaces:** `bindGateQuestion(binding: QuestionBinding): Outcome<void>`;
`completeGateQuestion(gateId: string): Promise<Outcome<void>>`;
`recoverGateQuestions(): Promise<{ completed: number; pending: number }>`.
`QuestionAdapter.complete(binding: SessionBinding, question: QuestionBinding, row: GateRow): Promise<Outcome<'completed' | 'pending' | 'gone'>>`.
Add `gate_native_questions` and `gate_native_completion` tables to gates.db;
store request references/generation separately from the authoritative answer.

- [ ] Write `answer survives failed completion`, `answer before wait`,
  `first answer wins`, and `closed is not answered`.
  Assert `expect(store.get(id).answer).toEqual(winningAnswer)` after native
  failure and `expect(completion.state).toBe('pending')`. Cover multiple
  questions, free-text values and existing authorized override behavior using
  the existing gate validators rather than flattening answers to one string.
- [ ] Run `bun test lib/agent-integrations/__tests__/questions.test.ts lib/daemon/__tests__/gates-store.test.ts`;
  expect new completion-state assertions red.
- [ ] Implement commit/read/complete sequencing through the existing gate
  handler. A failed completion never rolls back an answer. Persist completion
  intent before native side effects; after reconnect reconcile current native
  state and attachment before retry. Existing gate subscriptions/waits remain
  authoritative and self-answer notification suppression remains intact.
  Wire recovery at daemon startup and native reconnect, and cancel in-flight
  recovery on shutdown so it cannot apply a result to a newer attachment.
- [ ] Run the suites plus `bun test lib/daemon/__tests__/gate-push.test.ts`;
  restart the isolated daemon between answer commit and native completion and
  assert recovery uses the stored winning row.
- [ ] Stage task files and commit `feat: persist native gate question completion`.

### M5: Implement Claude and Codex question completion

**Files:** Create `lib/agent-integrations/claude/questions.ts`,
`lib/agent-integrations/codex/questions.ts`,
`lib/agent-integrations/__tests__/native-questions.test.ts`;
modify `lib/daemon/gate-push.ts`, `lib/daemon/gate-escape.ts`,
`lib/daemon/question-form.ts`.

**Interfaces:** Produce `createClaudeQuestions(): QuestionAdapter` and
`createCodexQuestions(): QuestionAdapter`; consume M4 bindings and M1 CodexControl.

- [ ] Write `Claude dismisses only matching blocked form after successful submission`
  and `Codex completion rejects obsolete request generation`.
  Assert `expect(escapeCalls).toBe(0)` for idle, working, failed notification,
  self-answer and stale binding; assert the current native request receives
  exactly the committed answer shape. Duplicate completion after confirmed
  native completion must not answer another pending question.
- [ ] Run `bun test lib/agent-integrations/__tests__/native-questions.test.ts lib/daemon/__tests__/gate-escape.test.ts`;
  expect new adapter cases red.
- [ ] Extract current Claude behavior unchanged. Implement each supported
  Codex question mode using F1 evidence, with explicit request/question IDs and
  state reconciliation. Do not equate steering an async wait with dismissing its
  form. If reconnect lacks a supported discovery path, keep completion pending
  and surface recovery needs; full support remains blocked until resolved.
- [ ] Run both suites and live synchronous/async question, multi-question,
  cancellation, self-answer and reconnect cases. Click an external answer in
  Console and verify the worker continues with that answer. Capture both native
  completion and final worker marker.
- [ ] Stage task files and commit `feat: complete gate questions through native integrations`.

### M6: Enforce policy and constrain integration resources

**Files:** Create `lib/agent-integrations/policy.ts`,
`lib/agent-integrations/claude/policy.ts`,
`lib/agent-integrations/codex/policy.ts`,
`lib/agent-integrations/__tests__/policy.test.ts`;
modify `lib/agent-hooks.ts`, `commands/gate.ts`,
`lib/agent-integrations/launch.ts`, `lib/daemon/handlers/agent.ts`,
`lib/mcp/temp-root-guard.ts`, `lib/daemon/upload-guard.ts`,
`plugins/mattstack/hooks/pipeline-gate-stop.sh`.

**Interfaces:** `PolicyAdapter.prepare(request: LaunchRequest): Promise<Outcome<{ env: Record<string,string>; args: string[] }>>`;
`PolicyAdapter.verify(mode: Mode): Promise<Outcome<Capability[]>>`.
Shared `authorizeWorkflowAction(context: CallerContext, action: 'ask' | 'continue' | 'complete', subject: string): Promise<Outcome<void>>`
uses existing gate/run state. Resource roots come from S1's validated inventory
and integration-owned temporary directories, not caller-supplied grants.

- [ ] Write `ungated unattended action refuses`, `stop cannot bypass pending gate`,
  and `foreign temporary path remains refused`.
  Assert `expect(result).toMatchObject({ok:false,error:{code:'refused'}})` for
  a foreign subject, missing required decision or obsolete attempt. Test real
  directory ownership, traversal, symlink escape and correct Codex input roots.
- [ ] Run `bun test lib/agent-integrations/__tests__/policy.test.ts lib/mcp/__tests__/temp-root-guard.test.ts lib/daemon/__tests__/upload-guard.test.ts`;
  expect the new Codex policy cases red.
- [ ] Preserve Claude enforcement through the extracted adapter. Implement
  Codex enforcement only through tested native/tool/state-transition mechanisms;
  verify that direct native question/stop actions cannot bypass required policy.
  Wire preparation into the shared launch service before spawning; the selected
  session adapter applies only its own validated native policy arguments/env.
  A prompt instruction alone cannot advertise enforcement. Keep the server's
  agentSafe grant, root settings and existing hook/fork-check semantics intact.
  Supply setup changes through S4 and skill wording through S2; regenerate
  plugin artifacts and bump the plugin version in the same change.
- [ ] Run the named tests plus existing gate fork-check and run-policy tests.
  Live-test attempted bypasses in an unattended Codex worker and ordinary
  allowed operation. Advertise policy capabilities only after evidence passes.
- [ ] Stage task files and required generated/version artifacts and commit `feat: enforce workflow policy across harnesses`.
