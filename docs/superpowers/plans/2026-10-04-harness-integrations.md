# Mattstack Harness Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver full Codex support through harness-neutral contracts while preserving current Claude behavior.

**Architecture:** Mattstack owns workflow state and policy; registered integrations implement native operations. Extract working Claude behavior and implement Codex against the same contracts, progressing through four coordinated plans. Integrations ship with Mattstack; Herdr remains the terminal surface.

**Tech Stack:** Bun/TypeScript, bun:sqlite, existing MCP SDK, rt-client, existing React app stacks and Swift tray, native Claude/Codex transports, Herdr, Bun tests and app-specific Vitest tests.

**Spec:** [Approved design](../specs/2026-10-04-harness-integrations-design.md).

## Global Constraints

- “Current Claude behavior is the compatibility reference, particularly for chat and gates.”
- “Claude is optional on a Codex installation.”
- “Shepherdr may choose each worker's harness from the user's enabled, ready integrations. An explicit user assignment wins.”
- “Retries and resumes retain that selection.”
- “Transport submission is not proof of consumption or action.”
- “Unknown state must remain unknown.”
- “Missing a required capability blocks that workflow with a useful reason; it does not silently weaken policy or select Claude.”
- “Secrets retain the suite's encrypted storage and existing auth ownership.”
- Preserve settings scope/version/ownership rules, serialized repo identities, frozen chat output, MCP grants, and file confinement. Read root AGENTS.md and each edited tree's instructions at execution time.
- No new production service, runtime UI framework in rt, or alternate worktree manager. No dependency additions are planned. Use repository-pinned tools; spike versions are evidence, not declared minimum versions.
- Implementation starts in an isolated worktree using the worktree skill, after plan review and execution-method selection. This plan does not authorize publication or deployment.
- Frozen bytes include `commands/__tests__/fixtures/chat-bytes.json`, `agent-verbs-bytes.json` (`gate`, `events`, `ci`, `runs`), `herd-pane-agent-bytes.json` and `herd-pane-agent-supplement-bytes.json`. Never regenerate one to make a change pass; a deliberate change is a named contract migration.
- F1 uses the regular HOME, existing authentication/services and disposable owned workers, per Matt’s 2026-10-05 instruction. No alternate-home lab or credential copy. Existing rt access is read-only; shared daemon restarts are deferred. Later destructive acceptance cases need an explicitly scoped environment or agreed disruption window during re-planning; do not run them against shared services by default.
- A test that reads source as text, or spawns `cli.ts`, is named `no-*.test.ts` so the PR scope selector runs it.

**F1 result:** [Original exit report](../spikes/2026-10-05-harness-gate-spike-report.md) plus [focused hook follow-up](../spikes/2026-10-05-codex-hooks-followup.md) prove G1/G2/G3/G5. The revised spec and plans incorporate the observed hook loading/trust lifecycle; G4 async completion and G7 restart remain explicit gaps.

## Mandatory regression baseline

[B0: regression baseline](2026-10-05-harness-integrations-0-regression-baseline.md)
precedes F2 and every production extraction. Existing test files and successful
spikes do not establish a comprehensive green baseline. B0 records actual
current-behavior assertions and run results for all A01–A28 areas, fills material
characterization gaps, and explicitly distinguishes offline/native/distributed
evidence. Follow its admission and per-task rules; unresolved required evidence
blocks the affected work. The [baseline report](../spikes/2026-10-05-harness-regression-baseline.md)
records progress, not a presumption of GREEN.

**Scoped execution update:** The user approved the independently reviewed
[F2a exception](2026-10-05-harness-integrations-b0-admission-decision.md) from
`abb49cb7e`: only disconnected contracts, registry, capability checks and tests,
in an isolated worktree. F2b and all other implementation remain blocked.
This scoped decision takes precedence over the general execution hold below.
F2a now has a [reviewed implementation checkpoint](../spikes/2026-10-05-harness-foundation-f2a.md);
the separately [approved watcher prerequisite](2026-10-05-f2a-watcher-test-proposal.md)
is applied and its tests pass. F2a is complete: on 2026-10-06 the user ruled
that the root run's three failures (an API bind case and two marketplace
timeouts, all in main-owned tests this branch never touched) are unrelated
flakes. Both files pass in isolation. The user directed work to proceed to F2b.

## Review Focus

These five failure classes receive explicit tests in the owning tasks:

1. Shared native server supplies another pane's environment: CLI and MCP must resolve the actual caller or refuse (F1, F4).
2. A disconnect follows a committed gate answer: recover native completion without losing the answer or completing a replacement's question (M4, M5).
3. A replacement worker receives delayed predecessor events: old reports cannot complete the new attempt (F3, H1, H3).
4. Upgrade finds explicit Codex settings, old Claude records, and ambiguous raw IDs together: preserve provenance and refuse guesses (F3, S3).
5. A Codex-only restore has user-edited plugins and no Claude installation: restore owned configuration without requiring Claude or undoing user choices (S4, S9).

## Reading order and dependency graph

This is the entry point. Read the spec and this file, then the relevant child
plan. The child plans inherit these constraints and the contract vocabulary.
Task IDs are unique across the package; they are implementation tasks, not
new Linear tickets.

**F1's runtime gates are complete.** Read the [original exit report](../spikes/2026-10-05-harness-gate-spike-report.md)
and [focused hook follow-up](../spikes/2026-10-05-codex-hooks-followup.md).
The four plans below are revised from that evidence on 2026-10-05. They are
implementation instructions awaiting the execution handoff, not completed work.
Preserve original spike artifacts and verdict history; do not rerun feasibility
cases merely to produce a newer timestamp.

| Plan | Deliverable | Dependencies |
| --- | --- | --- |
| [0. Regression baseline](2026-10-05-harness-integrations-0-regression-baseline.md) | Verified current-Claude protection and task-level regression gates | Unchanged production implementation; B0 admission criteria |
| [1. Foundation](2026-10-04-harness-integrations-1-foundation.md) | Registered launch/session integrations with verified identity and context | Existing `rt agent` seams; F1 native evidence |
| [2. Messaging and gates](2026-10-04-harness-integrations-2-messaging.md) | Current push behavior and authoritative gate completion through both integrations | F1–F6; S1/S2/S4 prerequisites as specified |
| [2b. Claude mods](2026-10-07-harness-integrations-2b-claude-mods.md) | Claude's side on the mattstack-mods plugin, the finished Claude adapters rebuilt on it, today's mechanisms as per-feature fallback | M1–M5c; runs before M6a ([Claude mods design](../specs/2026-10-07-harness-integrations-claude-mods-design.md)) |
| [3. Orchestration](2026-10-04-harness-integrations-3-orchestration.md) | Mixed workers, either shepherd harness, correct supervision and pipeline ownership | Foundation; messaging/policy contracts; 2b and M6d for the mods-first Claude steps |
| [4. Skills, setup, apps and release](2026-10-04-harness-integrations-4-adoption.md) | Host-adapted workflows, Codex-only lifecycle, app adoption and acceptance | Foundation; pulls early prerequisites forward; final acceptance follows all plans |

### Dependency order

The suffixes below split the original task IDs at independent review boundaries;
references to a parent ID include every subtask. Do not implement a later phase
by silently stubbing a required capability.

0. **Regression baseline:** B0.1 → B0.2 → B0.3 → B0.4; no production extraction before its admission criteria pass.
1. **Foundation:** F2 → F3 → F4 → F5a (native control) → F5b (Claude sessions)
   → F5c (Codex sessions) → F5d (shared launch) → F6. Bootstrap launches have
   no managed-work admission; they exist to bind/test native sessions.
2. **Installation and artifacts:** S3 and S1 → S2/S11 together (compiler plus
   its first real fragments) → S4a (tools/MCP) → S4b (reviewed native policy
   configuration). S4b consumes the M6b hook executable/manifest; implement
   and test M6a/M6b before final S4b verification. No trust writer lives in F5.
3. **Messaging and gates:** M1 → M2 → M3; M4 → M5a/M5b; M6a (shared policy)
   → M6b (Codex hook bridge) → M6c (session readiness and confinement).
   F5d defines the optional policy seam up front; M6c activates it only after
   S4b and M5 tests pass. Bootstrap capability is not full managed readiness.
   **Re-planned 2026-10-07:** M1–M5c are done. The Claude mods package runs
   next, C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8 → C9 → C10 → C11 → C12,
   then M6a → M6b → M6c → M6d (the mod's policy enforcement).
4. **Orchestration:** H1 → H2/H3; H4/H5 after F4 and M6c; H6 after S1/M1/M6c.
5. **Adoption and lifecycle:** S5/S6/S7/S8/S10/S12 after their stated interfaces;
   S9 is last and cannot waive blocked required scenarios.

Test code may fake native transport or setup seams. Production admission must
never accept those fixtures as evidence. Missing credentials/resources make a
live scenario blocked, not passed. Shared-home daemon restart remains outside
ordinary verification: run it only in the explicit S9 acceptance environment.

Each task ends in a commit limited to its listed implementation, tests and
required generated artifacts. Run the named test red before implementation
and green after. Test snippets express required assertions; use existing
repository fixtures, extending the test-local fixture with the inputs named
in the task. Never satisfy a test by widening production permissions or
loosening a frozen-output fixture.

## Contract vocabulary

F2 creates `packages/rt-client/src/agent-integrations.ts` for portable types,
exports it from `src/index.ts`, and creates
`lib/agent-integrations/contracts.ts` for runtime interfaces. Keep native
protocol types private to the corresponding implementation. The following
names and shapes are shared across all tasks:

```ts
type HarnessId = string; // validated registered ID, not a Claude/Codex union
type Mode = "herdr" | "headless";
type Capability = "launch" | "resume" | "caller-context" | "observe"
  | "peer-idle" | "peer-working" | "questions-form" | "questions-wait"
  | "question-recovery" | "questions-async" | "gate-policy"
  | "continuation-policy" | "background-state" | "skills" | "worktrees";
type FaultCode = "unsupported" | "not-ready" | "refused" | "transient"
  | "stale-binding" | "ambiguous" | "invalid";
type Outcome<T> = { ok: true; data: T }
  | { ok: false; error: { code: FaultCode; message: string } };
type NativeSessionRef = {
  harness: HarnessId; profile: string; kind: "id" | "path"; value: string;
};
type Attachment = {
  generation: number; mode: Mode; pane?: string; socket?: string; pid?: number;
};
type SessionBinding = {
  key: string; identity: string; native: NativeSessionRef;
  attachment: Attachment; agentId?: string; attemptId?: string;
};
type CallerContext = {
  binding: SessionBinding; assignment?: { herd: string; job: string; attemptId: string };
};
type Observation = {
  connectivity: "connected" | "disconnected" | "unknown";
  execution: "idle" | "working" | "blocked" | "dead" | "unknown";
  background: "active" | "inactive" | "unknown";
  observedAt: number; source: string; generation: number;
};
type AgentOptions = {
  model?: string; effort?: string; account?: string; extraArgs?: string;
  yolo?: boolean;
};
type Selection = { harness: HarnessId; options: AgentOptions };
type Readiness = { ready: boolean; reason?: string; version?: string };
type CapabilityReport = {
  readiness: Readiness; supported: Capability[]; mode: Mode;
};
type PeerInput = { id: string; body: string; sender: string; recipient: string };
type DeliveryReceipt = {
  id: string; evidence: "submitted" | "queued" | "consumed";
  nativeId?: string; turnId?: string; itemId?: string;
};
type QuestionBinding = {
  gateId: string; sessionKey: string; generation: number;
  nativeThread?: string; nativeTurn?: string; nativeItem?: string;
  nativeQuestions?: string[]; // durable question IDs, not connection-local RPC ids
  presentation: "form" | "wait";
};
```

`SessionBinding.identity` references the existing chat identity; it does not
create a second display-name system. Unbound reservations are separate rows,
not SessionBindings containing fake native IDs. A controller reconnect alone
does not replace the session attachment or advance its generation; the native
request connection handle changes independently. A new pane/process attachment
or worker replacement does advance generation. `profile` identifies the
installation/auth namespace without carrying a credential. `generation`
fences an attachment; `attemptId` fences an assignment. All public operations
return explicit outcomes rather than coercing unknown into success or death.

Runtime-only types live in `lib/agent-integrations/contracts.ts`:

```ts
type WorkInput = { id: string; text: string };
type LaunchRequest = {
  reservationId: string; cwd: string; mode: Mode; selection: Selection;
  required: readonly Capability[]; prompt?: string;
  access: { readRoots: string[] };
};
type PreparedPolicy = {
  id: string; harness: HarnessId; profile: string; cwd: string; revision: string;
}; // opaque native preparation reference; no caller-controlled args or grants
type PolicyProof = {
  sessionKey: string; generation: number; revision: string;
  verified: Capability[]; observedAt: number;
};
type ActiveQuestionHandle = {
  connection: string; requestId: string | number;
  threadId: string; turnId: string; itemId: string;
}; // in-memory only; reconnect replaces it after matching the durable binding
```

`questions-form`/`question-recovery` initially describe synchronous Codex plan-mode
forms. `questions-wait` describes Mattstack's gate wait/subscription contract.
`questions-async` is absent for Codex until separately proved; consumers never
infer it from `questions-form`. Capabilities are checked at the actual operation,
including its native collaboration mode, not just the display metadata's Mode.

`PolicyAdapter.prepare(request: LaunchRequest): Promise<Outcome<PreparedPolicy>>`
is a read-only preflight, not a trust installer.
`verify(binding: SessionBinding, prepared: PreparedPolicy): Promise<Outcome<PolicyProof>>`
checks the actual session. The shared service records proof only for the current
generation/revision; H1 activation and managed operations recheck it. Revision covers the native definition hashes, installed script artifact
fingerprints, native version and profile. Native configuration and probe
details stay inside the implementation.

`launchBoundAgent` returns a prepared/verified binding without submitting work.
Managed callers then activate H1's attempt and call `startBoundWork` with its
active-attempt authorizer. The required sequence is reserve → create/resume →
bind → verify policy → activate attempt → submit work. Activation failure sends
no work. Ordinary callers use the same separate submission phase with their
existing caller authorization; no public API accepts an authorization callback.

`GateRow`, `GateAnswer`, `GateQuestion`, `StepDef`, `ApplyContext`,
`CompileResult`, and `PluginListEntry` retain their existing definitions.
Tasks import them rather than invent lookalikes. Test dependencies are
structural interfaces derived from the operations the task consumes; do not
introduce a general service container.

## Persistence and public compatibility decisions

- F3 adds session reservation/binding/legacy-alias tables to existing
  `state.db`, using the current additive schema convention. Bindings have a
  unique native tuple and a monotonically increasing attachment generation.
  Namespace serialization is internal; public legacy session fields keep
  their bytes until a named wire migration changes them.
- H1 adds a `herd_job_attempts` table to `herds.db`, including selected options,
  binding reference, state and timestamps. The active attempt is selected
  transactionally there. Cross-store writes reconcile after crashes; no code
  assumes a transaction spans `state.db` and `herds.db`.
- M4 adds native question bindings/completion outcomes to `gates.db` as
  separate tables. Answer state and delivery/completion state remain distinct.
- H4 adds a `session-key` run field. Read `claude-session` only through the
  migration resolver. Read-only discovery may show directory matches, but a
  directory match never authorizes a run write.
- S3 adds `agent.integrations`, a replace-merged string-array preference at
  user/machine scopes, with no registry default. A dated `MigrationDef`
  writes it once on an existing installation as `["claude"]` plus the
  configured `agent.provider` when that differs (order kept, no duplicates).
  `agent.provider` alone is never the enabled set: it only chooses the
  `rt agent` default, while Claude runs herds, chat, gates and Board today.
  Until the migration runs, an absent value reads as that same union. Fresh
  setup writes the chosen list and default. An explicit empty list enables
  none. Installed binaries do not imply enablement. Existing provider option
  keys stay valid.
- Extend wire types additively where permitted; use an explicit versioned
  operation where frozen output prevents extension. F6 defines a new
  `agent:integrations` read operation; apps do not query Claude's inventory.

## Audit to task mapping

| Audit | Implementation tasks |
| --- | --- |
| A01 agent abstraction | F2, F5, F6 |
| A02 permissions/context | F1, F4, M6, S4 |
| A03 shepherd ownership | F4, H1, H2 |
| A04 herd persistence | H1, H2 |
| A05 watchdog | H3 |
| A06 background/recovery | F5, H3 |
| A07 session identity | F1, F3, F4, F5 |
| A08 chat continuity | F3, M3 |
| A09 delivery | M1, M2, M3 |
| A10 pane APIs | F6, S6 |
| A11 gate presentation | M4, M5, S5 |
| A12 gate enforcement | M6 |
| A13 pipeline attribution | F4, H4 |
| A14 continuation | M6, H4 |
| A15 CI leases | H5 |
| A16 file confinement | M6, S1 |
| A17 skill compilation | S1, S2, S11 |
| A18 skill maintenance | S1, S12 |
| A19 delegation | S11, H2 |
| A20 installation | S3, S4, S9 |
| A21 external tools | M6, S4 |
| A22 restore/uninstall | S3, S10, S9 |
| A23 Board | S5 |
| A24 Chat/Herdr chat | F6, S6 |
| A25 gitq | S7 |
| A26 Console/tray | S3, S6, S8 |
| A27 worktrees | H6 |
| A28 release | S9 |

## Existing work and completion

**Re-planned 2026-10-07.** The Claude side is built on the Claude Code mod,
per the [Claude mods design](../specs/2026-10-07-harness-integrations-claude-mods-design.md),
with today's mechanisms as the per-feature fallback. It replaces the
2026-10-05 mapping in which Claude adapters first wrapped today's mechanisms
and mods swapped in later. Evidence: [mods-01](../spikes/2026-10-07-mods-01-results.md)
(RT-383) and [mods-02](../spikes/2026-10-07-mods-02-results.md). The rule
stays: where a mods ticket implements a contract this plan makes shared, the
daemon-side store, feed or policy is the shared one, and the mod is the
Claude producer or enforcer behind it.

| Ticket | What it gives Claude | Task |
| --- | --- | --- |
| RT-384 core mod | The plugin and its core hub | C1, C3 |
| RT-405 `session:*` handlers | Link registry on F3's store | C2 |
| RT-406 daemon link and context | Link, heartbeat, rounds, `/clear` continuation | C3, C5 |
| RT-407 tool-call policy layer | Hub rules; shared policy enforcement | C1, M6d |
| RT-408 delivery router | Consumed evidence for Claude deliveries | C6 |
| RT-409 display kit | Fallback form pane; quiet-gate pane | C9, C11 |
| RT-410 prompt sections | Fixed per-conversation sections | C7 |
| RT-386 hidden chat rows | Rows hidden, still read | C6 |
| RT-390 reply rule once | Always-on section, Claude-only tail trimmed | C7 |
| RT-389 presence from events | Shared presence service | C8 |
| RT-387 sign-in through the session | Shared caller context | C8 |
| RT-385 mod owns the gate form | Claude question adapter rebuilt | C9 |
| RT-402 wait gates | Wake by `$.prompt.submit` | C10 |
| RT-458 quiet gate from the waiting pane | Answer in the worker's pane | C11 |
| RT-391 shell hooks | Spill note as a section; stop hook kept as the backstop; announce replaced | M6d, H6 |
| RT-395 session state feed | Observation producer | H3 |
| RT-397 watchdog reads the feed | Nudges through the mod | H3 |
| RT-396 run liveness, stop gate, runDb | Run ownership through the mod | H4, M6d |
| RT-400 relocation in session | `tool.check` by registered path | H6 |
| BOARD-52 board status and stand-down | Status tool; stand-down | S5 |

Out of scope, kept as optional work in the mods project: RT-388, RT-392,
RT-393, RT-399, RT-401, RT-403, RT-404, SKILLS-96. RT-398 was canceled
(Flock's hover card was removed); RT-394 is a duplicate. RT-383 is done.
Re-read a ticket and the governing Linear documents linked from
`docs/architecture.md` immediately before its task starts.

Run focused checks after each task. Run `bun run check`, `bun run test`, the
affected app/package checks, plugin certification, and the complete live
acceptance matrix after integration. S9 specifies the live evidence artifact
and release gate. Record failures as gaps; do not mark a task complete merely
because the interface exists or a fake passes.

**Planning status:** F1 executed on 2026-10-05 with regular HOME and existing
services. See the [exit report](../spikes/2026-10-05-harness-gate-spike-report.md)
and [original evidence](../spikes/2026-10-05-harness-gate-spike-evidence.json), plus
the [focused hook follow-up](../spikes/2026-10-05-codex-hooks-followup.md) and its
[evidence](../spikes/2026-10-05-codex-hooks-evidence.json). G1/G2/G3/G5/G6 are
proven; G4/G7 are partial. The spec and revised package plans incorporate
the proven hook loading/trust lifecycle and exact native protocol contracts. G7 restart coverage remains
deferred acceptance work. F2a is complete (checkpoint linked above). F2b is next; F2b onward is
not yet implemented.


**Reference refresh limit (2026-10-05):** The available authenticated Linear
connection did not resolve the three governing document links in
`docs/architecture.md`, including after paginated document lookup. This re-plan
preserves the approved suite boundaries and existing RT-384 ticket mapping;
it makes no claim to have refreshed those external documents or ticket states,
and makes no Linear edits. Reconcile externally changed scope before implementing
a task that overlaps it; repository/spec/spike evidence drives this revision.


## Re-plan review and verification — 2026-10-05

The existing plan reviewer re-read the revised spec, this index and all four
package plans. Round 1 identified an activation race: a worker could receive
its prompt before H1 established assignment authority. The corrected contract
separates bound-session preparation from work submission, orders policy proof
and activation before submission, and tests both failed activation and an
immediate worker report. Round 2 returned **Status: Approved**, with no
remaining issues. The external-reference refresh limitation above remains an
explicit handoff obligation, not a claim of refreshed Linear state.

Self-review checked specification coverage, interface/type consistency, task
steps and the Review Focus tests. Document checks passed: local relative links,
balanced fences, unique task IDs, file/interface/checklist sections for all
implementation tasks, and A01–A28 mapping. `git diff --check` passed. This
revision changes documents only; runtime tests were not rerun and no F2+
implementation or acceptance scenario was executed.
