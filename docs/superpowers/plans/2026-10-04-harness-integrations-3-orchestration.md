# Mixed Harness Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let either harness run shepherdr and choose mixed workers while preserving assignment ownership and workflow policy.

**Architecture:** Persist selection and attempts in the herd store; route launch and observations through foundation contracts. Pipeline, CI and worktree consumers use verified context rather than Claude environment variables.

**Tech Stack:** Bun/TypeScript, SQLite, daemon/MCP services, existing worktree infrastructure, Bun tests.

**Spec:** [Approved design](../specs/2026-10-04-harness-integrations-design.md).

## Global Constraints

Inherit the [parent plan](2026-10-04-harness-integrations.md) and all shared
types. “Shepherdr may choose each worker's harness from the user's enabled,
ready integrations. An explicit user assignment wins.” “Retries and resumes
retain that selection.” “Unknown state must remain unknown.” Required gate
and continuation policy must pass M6 before managed Codex workflows are enabled.

## Review Focus

- Crash between herd-attempt persistence and session binding (H1).
- Default/provider availability changes during a retry (H2).
- Late predecessor report or observation reaches a replacement (H1, H3).
- Two running pipelines share a working directory (H4).
- Native worktree events fire twice or name a foreign worktree (H6).

## File structure

`herd-attempts.ts` owns attempt transitions and cross-store reconciliation;
`herd-selection.ts` owns selection validation. Existing watchdog algorithms
consume normalized observations. Run attribution, CI leases and worktree
lifecycle remain separate modules and separately reviewable tasks.

### H1: Store selected harnesses and fenced job attempts

**Files:** Create `lib/daemon/herd-attempts.ts`,
`lib/daemon/__tests__/herd-attempts.test.ts`;
modify `lib/daemon/herd-store.ts`, `lib/daemon/handlers/herd.ts`,
`packages/rt-client/src/commands.ts`.

**Interfaces:** `reserveJobAttempt(input: { herd: string; job: string; selection: Selection; replaces?: string }): Outcome<JobAttempt>`;
`activateJobAttempt(attemptId: string, binding: SessionBinding): Outcome<JobAttempt>`;
`authorizeJobReport(context: CallerContext, herd: string, job: string): Outcome<JobAttempt>`.
`JobAttempt` contains `id`, `herd`, `job`, `selection`, optional `bindingKey`,
`generation`, state `reserved | active | replaced | ended`, timestamps, and
optional `replaces`. `reconcileJobAttempts(): Promise<void>` repairs interrupted
  bind/activate sequences without launching another worker.

- [ ] Write `replacement rejects old report` and `crash before activation grants no ownership`.
  Assert the predecessor receives `error.code === 'stale-binding'`, the
  replacement keeps the stored worker handle, and only matching active attempt
  plus binding authorizes a report. Close/reopen both stores between each step
  of reserve/bind/activate and assert recovery creates no duplicate attempt.
- [ ] Run `bun test lib/daemon/__tests__/herd-attempts.test.ts lib/daemon/__tests__/herd-store.test.ts`;
  expect new attempt tests red.
- [ ] Add the attempt table with one active attempt per `(herd,job)` and an
  atomic compare-and-replace transition in herds.db. Reserve before launch;
  activate only after the verified binding exists. Authorization checks both
  stores; a partial cross-store update grants neither the old nor provisional
  replacement extra authority. Preserve historical rows and worker identities.
  Resuming the same attempt refreshes its recorded binding generation through
  `activateJobAttempt`; it does not create a replacement attempt or retain the
  previous attachment's authority.
- [ ] Run both suites plus herd lifecycle tests; inject transaction failures
  and confirm selection/history survive reopening and stale reports refuse.
- [ ] Stage task files and commit `feat: persist selected harness and fenced herd attempts`.

### H2: Allow shepherdr to select enabled integrations

**Files:** Create `lib/daemon/herd-selection.ts`,
`lib/daemon/__tests__/herd-selection.test.ts`;
modify `lib/daemon/handlers/herd.ts`, `lib/mcp/herd-tools.ts`,
`commands/herd.ts`, `plugins/mattstack/attachments/orchestration/shepherdr/SKILL.md`.

**Interfaces:** `selectWorker(input: { explicit?: Selection; proposed?: Selection; fallback: Selection; enabled: HarnessId[]; mode: Mode; required: Capability[] }): Promise<Outcome<Selection>>`.
Use explicit assignment, then shepherd proposal, then configured default.
All three paths validate enabled/readiness/capabilities/options; none silently
substitutes a different harness. Retry reads H1's selection instead of calling
this function again.

- [ ] Write `explicit assignment wins`, `shepherd can mix enabled harnesses`,
  and `retry ignores changed defaults`.
  Assert `expect(chosen.harness).toBe('codex')` when explicit Codex competes
  with proposed Claude; a disabled/unsupported proposal refuses instead of
  falling back; retry options equal the persisted original.
- [ ] Run `bun test lib/daemon/__tests__/herd-selection.test.ts lib/mcp/__tests__/herd-tools.test.ts`;
  expect selection tests red.
- [ ] Add optional harness selection to herd spawn inputs through a deliberate
  API extension, propagate verified shepherd context from F4, and route launch
  through F5/H1. Update canonical shepherdr instructions to inspect integration
  metadata and select valid models/options. Preserve cswap guidance only in
  Claude fragments. Show harness/model in status using the output layer.
  Regenerate skill/MCP references and bump the plugin version as S2 requires.
- [ ] Run both suites and herd handler tests. Live-test Claude shepherd with
  mixed workers and Codex shepherd with mixed workers through report and close;
  missing prerequisites must refuse before creating worktrees/workers.
- [ ] Stage task files and generated artifacts and commit `feat: allow mixed harness worker assignments`.

### H3: Supervise workers using normalized observations

**Files:** Modify `lib/daemon/herd-watchdog-adapters.ts`,
`lib/daemon/herd-watchdog.ts`, `lib/daemon/herd-lifecycle.ts`,
`lib/daemon/handlers/herd.ts`, `lib/daemon/agent-status-poller.ts`;
create `lib/daemon/__tests__/herd-harness-observation.test.ts`.

**Interfaces:** `observeJob(attempt: JobAttempt): Promise<Outcome<Observation>>`
in `herd-watchdog-adapters.ts` consumes F5 and H1.
`classifyJobObservation(attempt: JobAttempt, observation: Observation, now: number): 'active' | 'blocked' | 'dead' | 'unknown'`
preserves existing watchdog thresholds; a stale generation or stale observation
cannot declare the current worker dead.

- [ ] Write `non-Claude is not dead`, `background activity preserves liveness`,
  `stale observation cannot kill replacement`, and `lost transport remains unknown`.
  Assert `expect(classifyJobObservation(job,disconnected,now)).toBe('unknown')`
  and idle foreground plus active background returns active. Verify native
  confirmed death still triggers the existing recovery action.
- [ ] Run `bun test lib/daemon/__tests__/herd-harness-observation.test.ts lib/daemon/__tests__/herd-watchdog.test.ts`;
  expect new cases red.
- [ ] Replace provider-name checks and generic Claude screen parsing with
  integration observations. Keep native screen parsing inside Claude's adapter
  where needed. Separate connectivity, execution and background state; preserve
  source/freshness and generation in cached observations. Do not invent a new
  timeout policy as part of this port.
- [ ] Run both suites and existing watchdog-adapter tests. Live-test busy,
  blocked, idle-with-background, disconnected, resumed and dead workers for
  both integrations; no inappropriate Escape or trust acceptance may occur.
- [ ] Stage task files and commit `refactor: supervise workers through integration observations`.

### H4: Bind pipeline ownership and continuation to verified sessions

**Files:** Modify `lib/runs/resolve-db.ts`, `lib/runs/store.ts`,
`lib/runs/start.ts`, `lib/runs/attention.ts`, `lib/runs/liveness.ts`,
`lib/mcp/run-tools.ts`, `plugins/mattstack/hooks/pipeline-gate-stop.sh`;
create `lib/runs/__tests__/harness-attribution.test.ts`.

**Interfaces:** `resolveOwnedRun(context: CallerContext, explicitDb?: string): Outcome<{ db: string; runId: string }>`
in `resolve-db.ts`; `bindRunSession(db: string, binding: SessionBinding): void`
in `store.ts`. Ownership-sensitive callers use these operations; existing
read-only discovery may keep a separately named directory search.

- [ ] Write `two runs in one directory cannot borrow ownership`,
  `explicit database does not bypass ownership`, and `legacy Claude field migrates by provenance`.
  Assert unresolved ownership returns `ok:false` even if one run is newest;
  explicit foreign RT_RUN_DB refuses; the migrated run retains all stages,
  decisions and timestamps. Pending gates must still prevent completion.
- [ ] Run `bun test lib/runs/__tests__/harness-attribution.test.ts lib/runs/__tests__/resolve-db.test.ts`;
  expect new ownership cases red.
- [ ] Add/read the canonical `session-key` field and migrate proven
  `claude-session` references through F3. Change run tools/writes and attention
  attribution to F4/F5 context. Route continuation enforcement through M6;
  leave the existing Claude hook as its native adapter entry point. Update
  canonical pipeline skill fragments through S2, not generated copies.
- [ ] Run `bun test lib/runs lib/mcp/__tests__/run-tools.test.ts` and a live
  pipeline with each harness, including pause/gate/restart/resume and attempted
  premature stop. All required state transitions must match current behavior.
- [ ] Stage task files and required plugin artifacts and commit `refactor: bind pipeline ownership to harness sessions`.

### H5: Preserve CI lease ownership across integrations

**Files:** Modify `lib/mcp/ci-tools.ts`, `packages/rt-client/src/ci-lease.ts`;
create `lib/mcp/__tests__/ci-harness-ownership.test.ts`.

**Interfaces:** `ciLeaseOwner(context: CallerContext): string` in `ci-tools.ts`
returns a stable canonical session owner, qualified by attempt when managed.
Keep existing CI lease APIs and expiration behavior; legacy owners resolve only
through proven F3 aliases. Replacement does not silently acquire predecessor leases.

- [ ] Write `two harnesses cannot release each other's lease` and
  `replacement cannot impersonate predecessor`:
  `expect(releaseByForeign.ok).toBe(false)` and
  `expect(ownerAfterResume).toBe(ownerBeforeResume)` for the same attempt.
- [ ] Run `bun test lib/mcp/__tests__/ci-harness-ownership.test.ts lib/mcp/__tests__/ci-tools.test.ts`;
  expect new ownership assertions red.
- [ ] Replace Claude-env owner construction with F4 context, preserve
  existing lease state and explicit transfer/expiry rules, and expose useful
  stale-owner errors without logging secrets.
- [ ] Run both suites and exercise acquire/report/release from one worker
  under each harness; a competing worker remains refused.
- [ ] Stage task files and commit `refactor: resolve CI lease owners through caller context`.

### H6: Adapt native worktree lifecycle without changing the pool

**Files:** Create `lib/agent-integrations/worktrees.ts`,
`lib/agent-integrations/claude/worktrees.ts`,
`lib/agent-integrations/codex/worktrees.ts`,
`lib/agent-integrations/__tests__/worktrees.test.ts`;
modify `lib/worktree/claude-hook.ts`, `commands/worktree-hook.ts`,
`lib/claude-settings.ts`, `lib/daemon/relocation-announce.ts`.

**Interfaces:** `applyWorktreeEvent(context: CallerContext, event: { kind: 'enter' | 'leave' | 'relocate'; path: string }): Promise<Outcome<void>>`.
Native adapters validate/translate lifecycle events; the shared service calls
the existing worktree ownership operations. Directory grants are supplied by
the selected policy adapter before launch/relocation.

- [ ] Write `foreign worktree event refuses` and `duplicate leave does not dispose twice`.
  Assert `expect(disposeCount).toBe(1)` for a repeated authorized leave and
  `expect(foreign.ok).toBe(false)` for an unrelated pool member. A resumed
  session must resolve its current worktree and required read roots.
- [ ] Run `bun test lib/agent-integrations/__tests__/worktrees.test.ts lib/worktree/__tests__/claude-hook.test.ts`;
  expect native-neutral cases red.
- [ ] Extract Claude hooks, add the Codex mechanism supported by F1/native
  inspection, and route relocation through integration messaging/context.
  Preserve pool claims, repo identity, hydrate stamps and volume rules. If a
  native hook is unavailable, use the shared explicit rt worktree operation
  in the Codex workflow and test that path; do not emulate unverified events.
- [ ] Run both suites and live enter/relocate/leave under each harness;
  verify current directory, session association, access and exactly one authorized
  disposition of the claimed member.
- [ ] Stage task files and commit `refactor: adapt worktree lifecycle through harness integrations`.
