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

**F1 is a gate, and the four package plans are provisional.** F1 runs as its
own [gating spike plan](2026-10-05-harness-integrations-0-gate-spike.md) and
reuses the October 4 spike and produces a verdict for each remaining runtime
question. Previously proven cases run again only as necessary controls. Native
daemon restart is explicitly unobserved in the regular-home follow-up and
remains acceptance work. Its exit report decides which interfaces below survive. After F1, each package plan is re-planned to
bite-sized tasks with concrete code, starting with plan 1. Do not execute any
F2+ task from these provisional plans.

| Plan | Deliverable | Dependencies |
| --- | --- | --- |
| [1. Foundation](2026-10-04-harness-integrations-1-foundation.md) | Registered launch/session integrations with verified identity and context | Existing `rt agent` seams; F1 native evidence |
| [2. Messaging and gates](2026-10-04-harness-integrations-2-messaging.md) | Current push behavior and authoritative gate completion through both integrations | F1–F6; S1/S2/S4 prerequisites as specified |
| [3. Orchestration](2026-10-04-harness-integrations-3-orchestration.md) | Mixed workers, either shepherd harness, correct supervision and pipeline ownership | Foundation; messaging/policy contracts |
| [4. Skills, setup, apps and release](2026-10-04-harness-integrations-4-adoption.md) | Host-adapted workflows, Codex-only lifecycle, app adoption and acceptance | Foundation; pulls early prerequisites forward; final acceptance follows all plans |

Execute the F1 gating spike first and stop for its exit report and re-plan.
Then F2–F6, S1, S2 and S3–S4 as needed to install the tested
tool/policy paths and S11's question/wait fragments; M1–M6; H1–H6; S10/S12
and the remaining app tasks; S9 last. S2 compiles fragments from S11, while
M6 supplies enforcement. Neither depends on
declaring the other fully supported: their integration tests pass together
before gated Codex workflows are admitted. This order avoids postponing
required authentication, skill availability, or socket access to release day.

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
  | "question-recovery" | "gate-policy"
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
  nativeId?: string;
};
type QuestionBinding = {
  gateId: string; sessionKey: string; generation: number;
  nativeRequest?: string | number; nativeQuestions?: string[];
  presentation: "form" | "wait";
};
```

`SessionBinding.identity` references the existing chat identity; it does not
create a second display-name system. Unbound reservations are separate rows,
not SessionBindings containing fake native IDs. `profile` identifies the
installation/auth namespace without carrying a credential. `generation`
fences an attachment; `attemptId` fences an assignment. All public operations
return explicit outcomes rather than coercing unknown into success or death.

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

RT-405, RT-406 and RT-408 (Backlog, "Claude Code mods" project, parent
RT-384) describe an in-session Claude Code mod with its own daemon link. They
are Claude-native mechanisms, not the shared services. Decision (2026-10-05):
the mod becomes part of the Claude integration. Its `session:*` handlers
(RT-405) register Claude sessions into F3's session store rather than keeping a
second registry; its session context record (RT-406) is the Claude side of
F4's caller attribution, feeding the shared resolver; its delivery router
(RT-408) is a Claude messaging mechanism behind M1's adapter. Before F3 is
re-planned, rewrite those three tickets to say so (PM-shaped) and link them to
this plan.

The rest of the mods project (P-MAT-25) splits three ways. The rule: where a
mods ticket implements a contract this plan makes shared, the daemon-side
store, feed or policy is the shared one and the mod is the Claude producer or
enforcer behind it; generic consumers never read a Claude-only feed.

| Mods ticket | Harness contract it implements on Claude | Task |
| --- | --- | --- |
| RT-384 core mod (parent) | The Claude integration's in-session component | F2 |
| RT-383 mods spike | Companion to F1: Claude-side capability evidence | F1 |
| RT-407 tool-call policy layer | `PolicyAdapter` enforcement for Claude | M6 |
| RT-395 session state feed | `Observation` producer; the feed is the shared observation API | F5, H3 |
| RT-397 watchdog reads the feed | Supervision through normalized observations | H3 |
| RT-396 run liveness, stop gate, runDb | Run ownership and continuation policy | H4, M6 |
| RT-385 mod owns the gate form | Claude `QuestionAdapter` completion without Escape | M5 |
| RT-402 wait gates without `rt gate wait` | Claude `wait` fragment and question waits | M5, S11 |
| RT-389 presence from session events | `applySessionPresence` lifecycle events | M3 |
| RT-387 sign in through the session | Caller context for chat sign-in | F4, M3 |
| RT-400 relocation dialog in-session | Claude worktree lifecycle adapter | H6 |
| RT-391 port shell hooks | Stop gate, relocation announce (shared files with M6, H4, H6) | M6, H4, H6 |
| BOARD-52 board status through the mod | Board status and session capture | S5 |

Partial overlap, decided when the owning task is re-planned: RT-398 (Flock
reads the shared observation API, not a Claude feed), RT-403 (gate push
carrying the gate row; if the daemon adds it, both harnesses get it),
SKILLS-96 (writing style at skill load; must not replace S12's resolver).

Claude-only extras with no harness contract, left in the mods project as
optional native features: RT-386, RT-388, RT-392 (notes H2's harness and
model per job), RT-393, RT-404, RT-409, RT-410. RT-394 is a duplicate.

Punted on 2026-10-05, to revisit when the named task is re-planned:

- RT-390 (M1): the per-delivery reply line has a shared half (who and how to
  reply, with the sender's id) and a Claude-only half ("never SendMessage").
  Trimming it must stay in Claude's delivery path so Codex deliveries keep the
  shared half.
- RT-399 (M6): the text guard could be a shared policy rule, enforced on Codex
  through `preToolUse` hooks.
- RT-401 (F5): Codex can compact or switch model natively over its control
  socket, so self-commands could become an agent-neutral session operation.

Sequencing: the Claude adapters first wrap today's outside-in mechanisms
(Escape, screen reads, shell hooks), so harness work never waits on the
early-access mods API. A mods ticket in the table later swaps the Claude
adapter's internals behind the same contract and tests. Re-read them and the governing Linear documents linked from
`docs/architecture.md` immediately before each re-plan. No new Linear tickets
are created by writing this plan.

Run focused checks after each task. Run `bun run check`, `bun run test`, the
affected app/package checks, plugin certification, and the complete live
acceptance matrix after integration. S9 specifies the live evidence artifact
and release gate. Record failures as gaps; do not mark a task complete merely
because the interface exists or a fake passes.

**Planning status:** F1 executed on 2026-10-05 with regular HOME and existing
services. See the [exit report](../spikes/2026-10-05-harness-gate-spike-report.md)
and [evidence](../spikes/2026-10-05-harness-gate-spike-evidence.json). G1/G2/G3/G6
are proven; G4/G7 are partial; G5 is blocked at scoped hook loading. Revise the
spec before package re-planning. G7 restart coverage remains deferred acceptance
work. F2 onward is provisional and unexecuted.
