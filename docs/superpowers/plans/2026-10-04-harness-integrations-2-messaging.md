# Harness Messaging and Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve current Claude chat and gate behavior through shared services and two native implementations.

**Architecture:** Chat/gate stores retain authority; adapters perform native delivery and question completion. Persist delivery evidence separately from logical state and reconcile uncertain outcomes before retry.

**Tech Stack:** Bun/TypeScript, SQLite, existing daemon/MCP services, native sockets and question protocols, Bun tests.

**Spec:** [Approved design](../specs/2026-10-04-harness-integrations-design.md).

## Global Constraints

Inherit the [parent plan](2026-10-04-harness-integrations.md), its types and
F1–F6. **Re-planned 2026-10-05** against the two spike reports. Native
async answer completion and restart survival remain explicit acceptance gaps. M1 and M3 absorb RT-408's delivery router as the Claude
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
`codex/control.ts` from F5a owns transport lifecycle. Shared `delivery.ts` and
`delivery-store.ts` own retry evidence. `questions.ts` and native question
modules bridge gate decisions. `policy.ts` and native policy modules enforce
workflow requirements without owning gate decisions.

### M1: Extract Claude delivery and implement the Codex transport

**Files:** Create `lib/agent-integrations/claude/messaging.ts`,
`lib/agent-integrations/codex/messaging.ts`,
`lib/agent-integrations/__tests__/messaging.test.ts`;
modify `lib/daemon/inbox.ts`, `lib/agent-integrations/contracts.ts`.

**Interfaces:** `MessageAdapter.submit(binding: SessionBinding, input: PeerInput): Promise<Outcome<DeliveryReceipt>>`;
optional `reconcile(binding: SessionBinding, inputId: string): Promise<Outcome<DeliveryReceipt | null>>`.
Produce `createClaudeMessaging(): MessageAdapter`, `createCodexMessaging(control: CodexControl): MessageAdapter`.
Consume F5a's `CodexControl` and validated `CodexEvent` without redefining
its transport lifecycle or event type. Native methods stay private to `codex/`.

- [ ] Write shared tests `idle delivery starts input`, `busy delivery submits immediately`,
  and `transport success is not consumption`:
  `expect(claudeReceipt.evidence).toBe('submitted')` and
  `expect(codexReceipt.evidence).not.toBe('consumed')` without an observed
  consumption event. Add missing/mismatched `clientId`, wrong generation and
  duplicate `item/started` fixtures; assert no false consumption. Assert peer provenance, sender identity and logical ID
  survive translation, and no ordinary chat delivery sends Escape.
- [ ] Run `bun test lib/agent-integrations/__tests__/messaging.test.ts`; expect red.
- [ ] Wrap the existing inbox writer, adding an optional supplied transport
  message ID without changing its frame semantics. Implement the Codex submission on F5a's control connection. Use
  `thread/queue/add.clientUserMessageId` for the stable logical ID, and promote
  to consumed only when an owned `item/started` userMessage carries that exact
  `item.clientId` and matching thread/turn/item identity. Queue acknowledgements
  produce queued receipts only. Do not infer persistence or deduplication from
  that echo. Session generation fences every event; later replies on a replaced
  attachment cannot promote a receipt. Native queue
  methods stay private; unknown protocol data cannot become a successful receipt.
  Use current configured inbound permission behavior for Claude.
- [ ] Run the tests and adapter acceptance for idle/busy/question-blocked cases; verify
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
  `definite failure retries same ID`, and `rt restart retains pending delivery without claiming native queue survival`.
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
- [ ] Run both suites, then restart only the acceptance-owned rt daemon with pending and
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
`QuestionAdapter.complete(binding: SessionBinding, question: QuestionBinding, row: GateRow): Promise<Outcome<'completed' | 'pending' | 'gone' | 'conflict'>>`.
Add `gate_native_questions` and `gate_native_completion` tables to gates.db;
store durable thread/turn/item/question IDs and generation separately from
  the authoritative answer. Connection IDs and numeric RPC request IDs remain
  in memory and never authorize completion after a restart. Completion intent
  stores a fingerprint of the winning gate answer; `conflict` preserves that
  answer while surfacing divergent or unverifiable native resolution.

- [ ] Write `answer survives failed completion`, `answer before wait`,
  `first answer wins`, and `closed is not answered`.
  Assert `expect(store.get(id).answer).toEqual(winningAnswer)` after native
  failure and `expect(completion.state).toBe('pending')`. Cover multiple
  questions, free-text values, divergent native replies and existing authorized override behavior using
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

### M5a: Preserve Claude question notification and dismissal

**Files:** Create `lib/agent-integrations/claude/questions.ts`,
`lib/agent-integrations/__tests__/claude-questions.test.ts`;
modify `lib/daemon/gate-push.ts`, `lib/daemon/gate-escape.ts`,
`lib/daemon/question-form.ts`.

**Interfaces:** `createClaudeQuestions(): QuestionAdapter` from M4. Consume
shared gate state and current binding; no native screen parser lives in M4.

- [ ] Write `dismiss only matching blocked form after submitted notification`.
  Assert zero Escape calls for idle, working, failed delivery, self-answer or
  stale binding, and exactly one for the current matching blocked form.
- [ ] Run `bun test lib/agent-integrations/__tests__/claude-questions.test.ts lib/daemon/__tests__/gate-escape.test.ts`;
  expect red.
- [ ] Extract the current conditional behavior unchanged; retain self-answer
  suppression, gate-store reread guidance and existing ownership validation.
- [ ] Rerun those suites and gate-push tests; expect unchanged Claude behavior.
- [ ] Commit `refactor: extract Claude question completion`.

### M5b: Complete synchronous Codex questions on the current connection

**Files:** Create `lib/agent-integrations/codex/questions.ts`,
`lib/agent-integrations/__tests__/codex-questions.test.ts`;
modify `lib/agent-integrations/questions.ts` and
`lib/agent-integrations/codex/protocol.ts`.

**Interfaces:** `createCodexQuestions(control: CodexControl): QuestionAdapter`.
`bindCodexQuestion(binding: SessionBinding, event: CodexQuestionRequest): Outcome<QuestionBinding>`
translates the validated event to M4's durable binding. `CodexQuestionRequest`
is the F5a union member for `item/tool/requestUserInput`. Persist native
thread/turn/item and every question ID; keep `ActiveQuestionHandle` in memory.

- [ ] Write `reconnect answers replay, never stale request`, `request zero is valid`,
  `numeric id reused on another connection refuses`, `multiple answers preserve IDs`,
  `cancelled gate sends no answer`, and `native resolution is not proof of winning answer`.
  Assert a new connection's matching thread/turn/item receives exactly the
  committed `answers: { [questionId]: { answers: string[] } }`; a different
  item/generation receives nothing. A resolved event before our reply is a
  conflict/reconciliation case, never an inferred successful delivery.
- [ ] Run `bun test lib/agent-integrations/__tests__/codex-questions.test.ts lib/agent-integrations/__tests__/questions.test.ts`;
  expect red.
- [ ] Subscribe before thread resume, buffer early replay, match the durable
  tuple and replace the transient handle. Send the response on that handle's
  connection. Correlate `serverRequest/resolved` by thread/request/connection;
  keep per-request submission and resolution states distinct. A write or a
  closed socket is not confirmation. If native history cannot establish the
  committed answer won a race, retain pending/conflict and surface recovery
  rather than infer it from free-form model prose. Native turn completion and
  a controlled worker marker are additional live acceptance evidence, not a
  production answer parser. Never answer a replacement item to repair an old one.
- [ ] Advertise synchronous form support only for verified plan-mode operation.
  An async `agentMessage` with questions/delivery async is emission, not an
  answerable request; leave `questions-async` absent and return unsupported
  without steering, queueing an answer, or claiming dismissal. Codex default
  mode and unattended skills use Mattstack gate open/wait (S11), which must
  still complete the required workflow. Unexpected async presentation creates
  an attention condition and cannot count as an answered gate.
- [ ] Rerun suites, then live-test external Console answer, multiple/free-text
  questions, self-answer/cancel, pending controller reconnect and an answer
  race with the native TUI. Record unresolved race confirmation as blocked
  native-form acceptance. Separately verify gate open/wait in default mode.
  Native daemon restart belongs to S9, not a shared-service test here.
- [ ] Commit `feat: bind synchronous Codex questions to authoritative gates`.

### M6a: Extract shared gate and continuation policy

**Files:** Create `lib/agent-integrations/policy.ts`,
`lib/agent-integrations/claude/policy.ts`,
`lib/agent-integrations/__tests__/policy.test.ts`;
modify `lib/agent-hooks.ts`, `commands/gate.ts`,
`scripts/hooks/gate-fork.sh`, `plugins/mattstack/hooks/pipeline-gate-stop.sh`.

**Interfaces:** `createClaudePolicy(): PolicyAdapter` implements the parent
prepare/verify contract using the existing Claude hook injection plus correlated
execution receipts; the native session adapter consumes its prepared revision.
`authorizeWorkflowAction(context: CallerContext, action: 'ask' | 'continue' | 'complete', subject: string): Promise<Outcome<void>>`;
`evaluateStop(context: CallerContext): Promise<Outcome<'allow' | 'continue'>>`.
Reuse actual gate fork-check and run validators; a native tool name is not
part of shared policy. A hook's unavailable decision is distinct from allow.

- [ ] Characterize current fork-check rules and Stop cases: no owned run,
  running/open stage, current hold, current waiting gate, stale hold, ended run,
  foreign/ambiguous ownership and unavailable rt. Assert running/open asks for
  continuation, held/waiting allows a turn to end without completing the run,
  and every ownership-sensitive mutation still refuses a foreign caller.
- [ ] Run `bun test lib/agent-integrations/__tests__/policy.test.ts` and
  `sh plugins/mattstack/hooks/tests/test-pipeline-gate-stop.sh`; expect new
  adapter tests red while existing characterizations remain green.
- [ ] Move decision logic to shared services using F4 context and existing
  state readers. Preserve Claude's hook output and failure/timeout escape
  behavior; do not turn the migration into an indefinite Stop loop. Policy
  unavailability records attention/unready state, never a completed run.
  Keep legacy shell entry points forwarding until H4 migrates run fields.
- [ ] Rerun named tests and existing fork-check tests; regenerate affected
  plugin artifacts/version under the plugin contract.
- [ ] Commit `refactor: share gate and continuation decisions across harnesses`.

### M6b: Translate Codex hook events into the shared policy

**Files:** Create `lib/agent-integrations/codex/policy.ts`,
`lib/agent-integrations/codex/hook-manifest.ts`,
`commands/agent-policy-hook.ts`,
`lib/agent-integrations/__tests__/codex-policy.test.ts`;
modify `lib/command-tree-def.ts` and `build.sh` if a bundled helper is needed.

**Interfaces:** `createCodexPolicy(): PolicyAdapter` (parent contract);
`codexPolicyManifest(input: { executable: string; installationId: string }): { revision: string; hooks: unknown }`;
`handleCodexHook(input: unknown): Promise<{ exitCode: 0 | 2; stdout: string; stderr: string }>`.
Add a hidden internal `rt agent policy-hook` command as the stable compiled
entry point; it reads native stdin, validates it and calls shared policy. It
is not an agentSafe mutation or a new arbitrary command executor. Output is
the native protocol payload through the existing output seam.

- [ ] Write `native IDs resolve exact binding`, `refused question exits two`,
  `stop delegates running hold and wait decisions`, and `malformed or foreign hook cannot mutate state`.
  Assert `session_id` plus `turn_id` match the current profile/binding;
  `request_user_input` translates to ask; native Stop translates to evaluateStop.
  A native denial is exit 2 with bounded feedback, not an answer written to
  a gate. Other tools and unmanaged sessions are no-op unless existing policy
  requires a decision. An unverified async native path cannot advertise policy.
- [ ] Run `bun test lib/agent-integrations/__tests__/codex-policy.test.ts`; expect red.
- [ ] Implement native translation and narrow hook receipts to the shared
  daemon using an owned installation/profile reference, never inherited pane
  env or arbitrary run paths. The manifest uses PreToolUse and Stop with fixed
  absolute versioned commands. S4b owns installation/review; prepare only
  inspects it. Hook proof receipts carry session/turn/event/revision and a
  controller-issued diagnostic nonce; model tool arguments cannot mint proof.
  The diagnostic policy may only exercise the same translators and read-only
  policy checks, never grant a real gate answer or workflow transition.
- [ ] Rerun tests; live-test actual gate fork refusal plus running/open Stop,
  held/waiting allowed Stop, service unavailable, cancellation and repeated
  refusals on owned workers. Record native events as in G5, with exact IDs.
  Bound repeated refusal to the characterized Claude escape behavior; if Codex
  cannot reproduce it, continuation readiness stays false until resolved.
- [ ] Commit `feat: enforce shared policy through Codex hooks`.

### M6c: Verify session policy and confine native resources

**Files:** Create `lib/agent-integrations/policy-readiness.ts`,
`lib/agent-integrations/__tests__/policy-readiness.test.ts`;
modify `lib/agent-integrations/launch.ts`, `lib/agent-integrations/session-store.ts`,
`lib/daemon/handlers/agent.ts`, `lib/mcp/temp-root-guard.ts`,
`lib/daemon/upload-guard.ts`.

**Interfaces:** `recordPolicyProof(binding: SessionBinding, proof: PolicyProof): Outcome<void>`;
`requirePolicyProof(binding: SessionBinding, required: readonly Capability[], revision: string): Outcome<void>`.
Persist proof revision/generation/time separately from settings in state.db.
F5d verifies the actual binding; H1 cannot activate before this check passes.

- [ ] Write `trusted inventory without executed receipts is not ready`,
  `old loaded worker cannot reuse new revision`, `stale or forged proof refuses`,
  and `foreign temporary path remains refused`. Assert a proof from another
  session, generation, diagnostic nonce or script fingerprint never enables
  policy; traversal and symlink escapes stay refused.
- [ ] Run `bun test lib/agent-integrations/__tests__/policy-readiness.test.ts lib/mcp/__tests__/temp-root-guard.test.ts lib/daemon/__tests__/upload-guard.test.ts`;
  expect red.
- [ ] Implement fresh-session verification through native hook events and
  diagnostic receipts before submitting actual work. A check turn executes a
  harmless native no-op shell command and ends, exercising the manifest's
  unfiltered PreToolUse entry and Stop entry. Match native `hook/completed`
  events to the installed command/revision and receipts for the exact owned
  thread/turn and controller's diagnostic challenge. Diagnostics only record
  health; they never override gate/run decisions. Test question denial and
  Stop continuation in M6b acceptance using the same artifact. This avoids
  presenting a diagnostic user form during routine managed launch. Run harmless check turns
  only on new owned sessions. An existing resumed session needs retained,
  still-current proof plus observed health or an explicit check agreed for
  that session; never inject a diagnostic user question into unrelated work.
  Changed/missing trust, artifacts, profile/version or attachment invalidates
  proof; missing health gives not-ready. Validate S1 resource roots and owned
  temporary roots without broadening agentSafe tools, sandbox or grants.
- [ ] Rerun suites and live readiness tests with hooks absent/untrusted/changed,
  an old loaded worker, a fresh worker and a foreign attempted policy receipt.
  Verify unchanged sandbox and no work/assignment before readiness. Tampering
  detection and actual policy-service failure are required acceptance cases;
  the spike's synthetic policy does not satisfy them.
- [ ] Commit `feat: require verified session policy before managed work`.
