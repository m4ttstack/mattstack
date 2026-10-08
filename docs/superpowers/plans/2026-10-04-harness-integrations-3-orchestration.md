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
**Re-planned 2026-10-07:** H3, H4 and H6 each gain a mods-first Claude step
([Claude mods design](../specs/2026-10-07-harness-integrations-claude-mods-design.md));
they need the [mods package](2026-10-07-harness-integrations-2b-claude-mods.md)
and M6d. **Re-planned 2026-10-05:** use the revised F4/F5 and M5/M6 contracts;
managed assignments require session-specific policy proof, not inventory alone. `rt herd` output is pinned by `herd-pane-agent-bytes.json` and its
supplement; `rt runs` and `rt ci` by `agent-verbs-bytes.json`.

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
  Include `activation failure sends no work` and `first worker call sees active ownership`.
  Assert native submission count stays zero after activation failure and an
  immediate report from the submitted worker is authorized by the active attempt.
  Assert the predecessor receives `error.code === 'stale-binding'`, the
  replacement mints a fresh worker identity, preserving predecessor DM separation
  as current `herd-handlers.test.ts` requires; resuming the same worker retains
  its identity. Only the matching active attempt
  plus binding authorizes a report. A current M6c proof must precede activation;
  `expect(activateWithoutProof.ok).toBe(false)` even if hooks/list is trusted. Close/reopen both stores between each step
  of reserve/bind/activate and assert recovery creates no duplicate attempt.
- [ ] Run `bun test lib/daemon/__tests__/herd-attempts.test.ts lib/daemon/__tests__/herd-store.test.ts`;
  expect new attempt tests red.
- [ ] Add the attempt table with one active attempt per `(herd,job)` and an
  atomic compare-and-replace transition in herds.db. Reserve before launch;
  activate only after the verified binding and required M6c policy proof exist.
  Call F5d `launchBoundAgent` to prepare the binding, `activateJobAttempt` to
  commit authority, then `startBoundWork` with an authorizer that rechecks the
  exact active attempt/generation. Never send the work prompt before activation.
  An activation failure retains an unready/unassigned session for reconciliation
  without running the job; an ambiguous submission retains the active attempt
  and stable work input ID rather than spawning a replacement. Authorization checks both
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
  Claude fragments. Show harness/model in status using the output layer, only on the blocks
  drawn for a person; the off-terminal bytes in `herd-pane-agent-bytes.json`
  stay identical (add fields to `--json` additively).
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
  and idle foreground plus active background returns active. Add the actual
  Codex sequence DONE → blocked Stop → CONTINUED → allowed Stop → turn complete;
  neither DONE nor a hook error can mark the job completed. Job completion still
  requires its authorized report and existing pipeline/result checks. Verify native
  confirmed death still triggers the existing recovery action. Unsupported
  async questions create attention/unknown state, never an inferred gate answer.
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
- [ ] Mods-first Claude producer (RT-395, RT-397; [Claude mods design](../specs/2026-10-07-harness-integrations-claude-mods-design.md)).
  - Add `plugins/mattstack-mods/src/blocks/observe.ts`. From the hub's lifecycle events it reports turn start and end, a question form on screen, background work running, and session end, as `session:report { event: "observation", observation }`. The daemon writes these into the shared observation store `observeJob` reads.
  - A Claude session without the `observe` block keeps today's herdr and screen observations.
  - Watchdog nudges to a session with the block live go out as `pushModCommand(sessionId, "nudge", { text })`, and the mod answers with `$.prompt.submit`. On no ack within 5 s, fall back once to `poke`.
  - Write `mod observation wins over the screen reading`, `a worker waiting on background work is never nudged`, and `an unacked nudge falls back to poke once`.
  - Live-check a worker pane under the plugin: no keys typed, the nudge arrives as a plugin message.
  - Commit `feat: Claude mod reports observations and receives nudges`.

### H4: Bind pipeline ownership and continuation to verified sessions

**Files:** Modify `lib/runs/resolve-db.ts`, `lib/runs/store.ts`,
`lib/runs/start.ts`, `lib/runs/identity.ts`, `lib/runs/write.ts`,
`lib/runs/attention.ts`, `lib/runs/liveness.ts`,
`lib/mcp/run-tools.ts`;
create `lib/runs/__tests__/harness-attribution.test.ts`.

**Re-planned 2026-10-07:** `pipeline-gate-stop.sh` stays unchanged as the
Stop backstop ([Claude mods design](../specs/2026-10-07-harness-integrations-claude-mods-design.md)),
so `rt runs find --session <claude session id> --running` and
`rt runs snapshot` must keep resolving runs after the `session-key`
migration. Its test script must stay green, unmodified.

**Interfaces:** `resolveOwnedRun(context: CallerContext, explicitDb?: string): Outcome<{ db: string; runId: string }>`
in `resolve-db.ts`; `bindRunSession(db: string, binding: SessionBinding): void`
in `store.ts`. Ownership-sensitive callers use these operations; existing
read-only discovery may keep a separately named directory search.

- [ ] Write `recordIdentity writes the bound session, not inherited env`:
  `recordIdentity` (called from `start.ts` and `write.ts`) today writes
  `claude-session` and `herdr-pane` straight from the environment, and the
  spike saw a Codex worker inherit the controller's `HERDR_PANE_ID`. Under a
  context whose binding names pane `w1:p2` while the env says `w9:p9`, assert
  the stored `herdr-pane` is `w1:p2` and `session-key` is the binding key.
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
  pipeline with each harness, including pause/gate/owned-rt-restart/resume and attempted
  premature stop. Keep native-daemon restart in S9's explicit acceptance
  environment, never restart a shared service for this test. All required state transitions must match current behavior.
- [ ] Stage task files and required plugin artifacts and commit `refactor: bind pipeline ownership to harness sessions`.
- [ ] Mods-first Claude path (RT-396).
  - Run liveness reads mod observations (H3), so a working session is never marked stale.
  - Add a hub `fill` rule in `plugins/mattstack-mods/src/blocks/policy.ts` that adds the owned run's `runDb` to `run_*` calls, from `resolveOwnedRun` through a `runs:owned { sessionId }` verb. Never use a path the caller supplied.
  - A session end reported by the link marks that session's running stage abandoned.
  - Write `run_* without runDb resolves the owned run`, `a foreign run is never filled`, and `session end abandons only the owned running stage`.
  - Commit `feat: run ownership and liveness through the Claude mod`.

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
- [ ] Run `bun test commands/__tests__/agent-verbs-bytes.test.ts`; the `ci-*`
  cases stay byte-identical.
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
  The spike did not prove Codex native worktree hooks: select the explicit rt
  lifecycle path initially rather than inventing native events.
  Preserve pool claims, repo identity, hydrate stamps and volume rules. If a
  native hook is unavailable, use the shared explicit rt worktree operation
  in the Codex workflow and test that path; do not emulate unverified events.
- [ ] Run both suites and live enter/relocate/leave under each harness;
  verify current directory, session association, access and exactly one authorized
  disposition of the claimed member.
- [ ] Stage task files and commit `refactor: adapt worktree lifecycle through harness integrations`.
- [ ] Mods-first Claude relocation (RT-400, RT-391's announce; proven in mods-02).
  - Add `plugins/mattstack-mods/src/blocks/relocation.ts`: a hub `permit` rule on `EnterWorktree` (`tool.check`) asks `worktree:registered { path }`, a new verb answered by `findTreeByPath`, and allows a registered path. Any other path passes through, so Claude Code's prompt still shows.
  - For sessions with the `relocation` block live, the three key-pressing seams stand down: the herd watchdog's `acceptRelocationModal`, the reconciler's `driveRelocationAccept`, and `createRelocationWatcher`. `trust-dialog.ts` and those seams stay for every other session.
  - `relocation-announce.sh` and `rt worktree announce-relocation` are not changed. The daemon handler that verb reaches, `pane:announce-relocation` (`commands/worktree-hook.ts:253`), checks `modPath(binding, "relocation")` and returns without arming the watcher when the block is live; otherwise it runs as today.
  - Write `a registered path enters with no prompt and no key press`, `an unregistered path keeps the prompt`, and `the seams stand down only for sessions with the block live`.
  - Live-check attended, herd and unattended panes.
  - Commit `feat: answer worktree relocation inside the Claude session`.
