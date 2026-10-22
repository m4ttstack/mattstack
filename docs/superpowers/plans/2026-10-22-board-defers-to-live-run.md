# Board Defers to a Live Work Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the board would launch a doctor on an MR whose branch (or an ancestor's) a live work run owns, it rings that worker's Claude session instead of launching.

**Architecture:** Run summaries gain `session` and `mr`. A new daemon verb pair (`inbox:ring`, `inbox:probe`) pushes a framed message into one session's inbox, the same transport the gate doorbell uses. Board triage finds the live owning run before dispatch (candidates filtered by inbox reachability), rings it, and records a handoff per edge kind on triage memory; each pass re-checks open handoffs and re-arms the edge when the worker is gone. The manual doctor click gets a confirm dialog and a `ring` mode on `POST /doctor`; the snapshot learns owners from a background refresh.

**Tech Stack:** Bun, TypeScript, bun:test, React + `@mattstack/tui-kit` (board client), rt daemon over unix socket via `@mattstack/rt-client`.

**Spec:** `docs/superpowers/specs/2026-10-22-board-defers-to-live-run-design.md`

## Global Constraints

- The ring never injects keystrokes or Escape into a pane: inbox frame only.
- No change to the CI lease, its owners or its TTLs; an attended lease still wins first in triage.
- New daemon handlers log no outcome of their own (`handleCommand` does it).
- Rebuild `packages/rt-client` after touching it: `bun run --cwd packages/rt-client build`.
- rt unit tests run from the repo root (`bun test <path>`); board tests run as `bun run --cwd apps/board test <path>`, never `bun test apps/board` from the root.
- A run's `repo` is an opaque `repos/<slug>` key: compare it only with `boardRepoSlug(gitlabHost, projectPath)` (`apps/board/src/manifest-bindings.ts`), never with `repoForMr`'s serialized identity.
- Work runs only: a run whose `work_type` is `review` or `receive-review` never owns an MR.
- The board's request path never waits on the daemon (snapshot ownership comes from a background refresh).
- Board UI follows `docs/apps/ui-authoring.md`; copy follows `rt:ui-copy`.
- Public repo: invented names only in fixtures and stories.
- If the run lookup fails, the board behaves exactly as today (doctor launches).

## Review Focus

- **A run that is `running` but whose session is dead** (crashed pane, never closed): never chosen as owner, never shown as active, and a live run behind it (older, or on the parent) still wins. Pinned in Tasks 3 and 5.
- **Two running runs on one MR**: the most recent live one wins. Pinned in Task 3.
- **MR url with a trailing slash** in the run's `mr` field vs. the board's url. Pinned in Task 3.
- **A handoff whose pipeline went green, then red with a new pipeline id**: old handoff drops, the new edge rings again. Pinned in Task 5.
- **`listRuns` fails mid-pass**: no owner logic, open handoffs kept, doctors dispatch as today. Pinned in Task 5.

---

### Task 1: Run summaries carry `session` and `mr`

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (`RunSummary`, ~line 411)
- Modify: `lib/runs/store.ts` (placeholder row ~line 75, `withAttention` ~line 160, the second summary builder ~line 228)
- Test: `lib/runs/__tests__/store.test.ts`

**Interfaces:**
- Produces: optional `RunSummary.session?: string | null` (the run's `claude-session` field) and `RunSummary.mr?: string | null` (the latest `mr` field row, by `at`, whose `mrRole(produced_by, work_type)` from `lib/runs/outcome.ts` is `"own"` and whose value is an http(s) url; else null). Optional like `agent?`, so the console's `RunSummary` fixtures and `lib/daemon/__tests__/agent-status-poller.test.ts` keep compiling.

- [ ] **Step 1: Write the failing tests** in `store.test.ts`, using the file's run-db fixture helpers:
  - `summary carries the recorded claude session and own mr url`: `claude-session=sess-1`, `mr=https://gitlab.example.com/acme/app/-/merge_requests/7` produced by `ship` → `session === "sess-1"`, `mr` is that url.
  - `an mr recorded by review is not the run's own mr` (produced by `receive-review`) → `mr === null`.
  - `a cleared mr field reads as null` (`mr` then `-`, both by `ship`).
  - `a run with neither field has null session and mr`.
- [ ] **Step 2:** `bun test lib/runs/__tests__/store.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Implement in both summary builders; `null` in the placeholder row.
- [ ] **Step 4:** `bun test lib/runs/__tests__/` → PASS. Rebuild rt-client; `bun test packages/rt-client/test/dist-freshness.test.ts` → PASS; `bun run console:typecheck` → clean.
- [ ] **Step 5: Commit** `runs: summaries carry the run's claude session and own mr url`

### Task 2: Daemon verbs `inbox:ring` and `inbox:probe`

**Files:**
- Create: `lib/daemon/handlers/inbox.ts`
- Modify: `lib/daemon/command-router.ts` (spread `createInboxHandlers()` into `handlers`)
- Modify: `packages/rt-client/src/commands.ts` (two `Commands` entries + `COMMAND_NAMES` ~line 1392)
- Modify: `packages/rt-client/src/client.ts`, `packages/rt-client/src/index.ts` (wrappers)
- Test: `lib/daemon/__tests__/inbox-handlers.test.ts`; parity: `lib/daemon/__tests__/rt-client-commands.test.ts`

**Interfaces:**
- Produces (rt-client `Commands`):
  - `"inbox:ring": { payload: { session: string; label: string; text: string }; data: { delivered: boolean; reason?: "no-session" | "failed" } }`
  - `"inbox:probe": { payload: { session: string }; data: { reachable: boolean; name?: string } }` (`name` is the session's `InboxBinding.name`, set only when reachable and `nameSource === "user"`; a derived name is never returned)
- Produces (rt-client): `inboxRing(payload, o?: RtClientOptions)`, `inboxProbe(payload, o?: RtClientOptions)`, returning `Promise<RtResponse<…data>>`, timeout 5000ms.
- Produces (daemon): `createInboxHandlers(deps?: { resolve: (session: string) => InboxBinding | null; deliver: typeof deliverToInbox; probe: typeof probeInboxReachability })`, defaults `resolveLiveInbox` (`lib/claude-registry.ts`), `deliverToInbox`, `probeInboxReachability` (`lib/daemon/inbox.ts`). Ring body is `wrapCrossSession(label, text)`.

- [ ] **Step 1: Write the failing tests** with injected deps:
  - `ring delivers the wrapped frame to the resolved socket` (deliver called with the binding's `socketPath`; body contains label and text; `delivered: true`).
  - `ring reports no-session when the session does not resolve` (deliver not called).
  - `ring reports failed when delivery fails`.
  - `ring rejects a payload without session, label or text` → `ok: false`.
  - `probe is reachable only for a live binding whose socket accepts` (no binding / `unreachable` / `reachable`); `probe returns a user-chosen session name`; `probe omits a derived session name`.
- [ ] **Step 2:** `bun test lib/daemon/__tests__/inbox-handlers.test.ts` → FAIL.
- [ ] **Step 3:** Implement (model on `lib/daemon/handlers/herdr.ts`), register, add `Commands` entries, `COMMAND_NAMES` rows and wrappers.
- [ ] **Step 4:** `bun test lib/daemon/__tests__/inbox-handlers.test.ts lib/daemon/__tests__/rt-client-commands.test.ts` → PASS. Rebuild rt-client.
- [ ] **Step 5: Commit** `daemon: inbox:ring and inbox:probe push a frame into one session's inbox`

### Task 3: Board run-owner lookup and ring frames

**Files:**
- Create: `apps/board/src/run-owner.ts`
- Test: `apps/board/src/__tests__/run-owner.test.ts`

**Interfaces:**
- Consumes: `RunSummary` (Task 1), `normalizeMrUrl` (`apps/board/src/gates/run-mr.ts`).
- Produces:
  ```ts
  export interface RunOwner { runId: string; session: string; stage: string | null; name?: string }
  export type SessionProbe = (session: string) => Promise<{ reachable: boolean; name?: string }>;
  /** Query by MR url (own-MR match) and/or by repo slug + branch (pre-ship match). */
  export interface OwnerQuery { mrUrl?: string; repoSlug: string; branch: string }
  /** Matching work runs, most recently active first. Pure: no liveness. */
  export function ownerCandidates(q: OwnerQuery, runs: readonly RunSummary[]): RunOwner[];
  /** First candidate whose session probes reachable, with the probe's name, or null. */
  export async function firstLiveOwner(
    candidates: readonly RunOwner[],
    probe: SessionProbe
  ): Promise<RunOwner | null>;
  export type RingFrame =
    | { kind: 'pipeline-red'; iid: number; pipelineId: number | null }
    | { kind: 'needs-rebase'; iid: number; targetBranch: string }
    | { kind: 'downstream'; childIid: number; childEdge: 'pipeline-red' | 'needs-rebase'; pipelineId: number | null };
  export const BOARD_RING_LABEL = 'board';
  export function ringText(f: RingFrame): string;
  ```
- Candidate rule: `status === 'running'`, `session` set, `work_type` not `review`/`receive-review`, and either (`q.mrUrl` set and `normalizeMrUrl(run.mr) === normalizeMrUrl(q.mrUrl)`) or (`!run.mr && run.repo === q.repoSlug && run.branch === q.branch`). Sorted by `last_event_at` descending.

- [ ] **Step 1: Write the failing tests:**
  - `matches a running work run by mr url`; `ignores trailing slashes on either url`.
  - `matches by repo slug and branch only while the run has no mr`; `a run whose mr names another MR does not match on branch`; `matches a branch-only query (parent outside the board)`.
  - `skips finished runs, runs with no session, and review or receive-review runs`.
  - `orders two matching runs most recent first`.
  - `firstLiveOwner skips a dead newer run for a live older one`; `returns null when none probe live`.
  - `ringText`: pipeline-red contains `!<iid>`, the pipeline id and "no doctor was launched"; needs-rebase contains the target branch; downstream contains `!<childIid>` and "stacked on your branch", and for `childEdge: 'needs-rebase'` says "needs a rebase" and never "failing CI". Assert substrings only.
- [ ] **Step 2:** `bun run --cwd apps/board test src/__tests__/run-owner.test.ts` → FAIL.
- [ ] **Step 3:** Implement (Bun-free; IO only through the injected probe).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `board: find the live work run that owns an MR, and the frames to ring it with`

### Task 4: Triage memory records handoffs per edge kind; edges can re-arm

**Files:**
- Modify: `apps/board/src/triage/memory.ts`, `apps/board/src/triage/edge.ts`, `apps/board/src/triage/memory-store.ts`
- Test: `apps/board/src/__tests__/triage-edge.test.ts`, `apps/board/src/__tests__/triage-memory-store.test.ts`

**Interfaces:**
- Produces (memory.ts, stays Bun-free):
  ```ts
  export type HandoffKind = 'pipeline-red' | 'needs-rebase';
  export interface Handoff {
    runId: string; session: string; stage: string | null;
    pipelineId: number | null;
    /** The MR whose run was rung: this MR, or an ancestor for a stacked child. */
    viaMr: string | null;   // null when the parent sits outside the board (matched by branch)
    viaBranch: string;      // the branch the owning run is on
    at: number;
  }
  // MrMemory gains: handoffs?: Partial<Record<HandoffKind, Handoff>>
  /** Only the handoffs whose edge still holds (pipeline-red: failed and same
      pipeline id; needs-rebase: still needs it). Pure; used by the snapshot
      and by triage's re-check. */
  export function liveHandoffs(
    mem: MrMemory | undefined,
    facts: { pipelineId: number | null; pipelineFailed: boolean; needsRebase: boolean }
  ): Partial<Record<HandoffKind, Handoff>>;
  ```
- Produces (edge.ts): `rearm(mem: DispatchMemory, mrUrl: string, kind: EdgeKind): void` — `pipeline-red` clears `lastHandledPipelineId` to null; `needs-rebase` sets `lastNeedsRebase` false.
- Produces (memory-store.ts):
  - `writeHandoff(mrUrl: string, kind: HandoffKind, handoff: Handoff | null, opts?: { markHandled?: { pipelineId: number | null } }, db?: Database): void` — fresh read and write in one transaction like `writeStandDown`; `null` deletes that kind; `markHandled` sets `lastHandledPipelineId` (pipeline-red) or `lastNeedsRebase` (needs-rebase).
  - `clearHandoffs(mrUrl: string, db?: Database): void`.
  - Both document, like `writeStandDown`, that a server caller holds `tryClaimCron` around them.

- [ ] **Step 1: Write the failing tests:** `rearm lets the same red pipeline fire again`; `rearm lets a held rebase fire again`; `rollDay keeps handoffs`; `two kinds keep two handoffs`; `liveHandoffs drops a pipeline-red handoff once the pipeline id changes or goes green`; `writeHandoff marks the edge handled when asked`; `clearHandoffs removes both kinds`.
- [ ] **Step 2:** Run the two test files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS.
- [ ] **Step 5: Commit** `triage: memory records worker handoffs per edge kind; edges can re-arm`

### Task 5: Triage defers to a live run

**Files:**
- Modify: `apps/board/src/triage/run.ts`, `apps/board/bin/triage.ts` (wiring)
- Test: `apps/board/src/__tests__/triage-run.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces (`TriageRunDeps`, all optional; absent = feature off, as `attendants` is today):
  ```ts
  /** null = the lookup failed; owner logic stands aside for this pass. */
  listRuns?(): Promise<RunSummary[] | null>;
  ring?(session: string, text: string): Promise<boolean>;
  probe?: SessionProbe;
  /** boardRepoSlug(gitlabHost, projectPathFromWebUrl(mrUrl)). */
  repoSlugForMr?(mrUrl: string): string;
  ```
- Audit reasons added: `run-active` and `upstream-run-active` (outcome `run <id> stage <stage>`; for upstream also the ancestor MR url or branch), `ring-failed` (outcome = run id), `handoff-lapsed` (outcome = run id), `handoff-cleared`.

Order inside `runTriage`: `observe` → `listRuns` once → **handoff re-check** → `detectEdges` → per-edge loop. The owner check sits after the stood-down, doctor-in-flight, lease and `upstreamBlocker` checks and before `decide` (a ring spends no budget).

Handoff re-check, per MR memory entry, per handoff kind:
- MR not in `mrs`, or not in `liveHandoffs(...)` for its current facts → delete it, audit `handoff-cleared`.
- `runs === null` → keep.
- `handoff.runId` is no longer among `ownerCandidates` for its `viaMr`/`viaBranch`, or `probe(handoff.session)` is not `reachable` → delete it, `rearm`, audit `handoff-lapsed`.

Per edge, when `runs !== null` and `ring`, `probe`, `repoSlugForMr` are wired, try in order and stop at the first delivered ring:
1. This MR: `firstLiveOwner(ownerCandidates({ mrUrl, repoSlug, branch: sourceBranch }))`, frame `pipeline-red` or `needs-rebase` (target = the facts' `targetBranch`). Delivered → `handoffs[kind]` with `viaMr` = this MR, `markHandled`, audit `run-active`, `continue`.
2. Each ancestor in `chainOf(mrs, mrUrl).ancestors`, nearest first, by its mr url and branch; then, if `unresolvedParentBranch` is set, a branch-only query on it. Frame `downstream` with `childEdge` = this edge's kind. Delivered → handoff with `viaMr` = ancestor url (null for the unresolved parent) and `viaBranch`, `markHandled`, audit `upstream-run-active`, `continue`.
3. A ring that fails at any step is audited `ring-failed` and the walk continues. No delivered ring → today's dispatch.

Wiring in `bin/triage.ts`: `listRuns` → rt-client `listRuns()` (`res.ok ? res.data.runs : null`, throws → null); `ring` → `inboxRing({ session, label: BOARD_RING_LABEL, text })`, true only on `ok && data.delivered`; `probe` → `inboxProbe`, `{ reachable: ok && data.reachable, name: data.name }`; `repoSlugForMr` from `boardConfig.gitlabHost` and `projectPathFromWebUrl`.

- [ ] **Step 1: Write the failing tests** (fake deps, the file's existing style):
  - `a live run on the branch is rung and no doctor launches` (launchDoctor not called; `handoffs['pipeline-red'].runId` set; audit `run-active` with the stage; ring text has the pipeline id).
  - `a needs-rebase edge rings the rebase frame`; `both edges in one pass keep both handoffs`.
  - `a dead own run is passed over for a live parent run` (probe false for own) → parent rung with a `downstream` frame, audit `upstream-run-active`.
  - `an undelivered ring with no other owner launches the doctor and audits ring-failed`.
  - `a stacked child that needs a rebase rings the parent with a rebase downstream frame`.
  - `a parent outside the board is matched by branch`.
  - `the MR's own run wins over a parent's run`.
  - `a review run on the MR does not block the doctor`.
  - `a ring spends no attempt budget`; `an attended lease still skips before any ring`.
  - `listRuns returning null dispatches as today and keeps open handoffs`.
  - `a handoff lapses when its run finishes and the same pipeline is still red` (re-armed; doctor launches this pass; audit `handoff-lapsed`).
  - `a handoff lapses when the run is running but its session probe fails`.
  - `a handoff clears when the pipeline goes green`; `a new red pipeline after that rings again`.
- [ ] **Step 2:** `bun run --cwd apps/board test src/__tests__/triage-run.test.ts` → new tests FAIL, existing PASS.
- [ ] **Step 3:** Implement; wire `bin/triage.ts`.
- [ ] **Step 4:** Same → PASS; `bun run board:typecheck` → clean.
- [ ] **Step 5: Commit** `triage: ring a live work run instead of launching a doctor`

### Task 6: Board server: ring on request; owner and handoff on the snapshot

**Files:**
- Create: `apps/board/src/run-owner-refresh.ts`
- Modify: `apps/board/src/doctor-state.ts` (`parseDoctorRequestBody` accepts `ring?: true`)
- Modify: `apps/board/src/server.ts` (`case '/doctor'`, snapshot assembly ~line 987)
- Modify: `apps/board/src/client/types.ts` (`BoardMRWithReview`)
- Test: `apps/board/src/__tests__/run-owner-refresh.test.ts`, `apps/board/src/__tests__/server-doctor-ring.test.ts` (model on `server-stand-down.test.ts`), `apps/board/src/__tests__/doctor-state.test.ts`

**Interfaces:**
- Produces (client types):
  ```ts
  activeRun?: { runId: string; stage: string | null; name?: string; viaIid?: number }; // viaIid when the owner is an ancestor's run
  handoffs?: Partial<Record<HandoffKind, Handoff>>; // only live ones (liveHandoffs)
  ```
- Produces (`run-owner-refresh.ts`), modelled on the `RunMrResolver` in `gates/run-mr.ts` (background, never awaited by a request):
  ```ts
  export interface RunOwnerRefresher {
    /** Kick a background refresh if the last one is older than ttlMs; never awaits. */
    poke(): void;
    /** Last known live owner per MR url (own run first, else nearest ancestor's). */
    ownerFor(mrUrl: string): { runId: string; stage: string | null; name?: string; viaIid?: number } | undefined;
  }
  export function createRunOwnerRefresher(io: {
    listRuns(): Promise<RunSummary[] | null>;
    probe: SessionProbe;
    mrs(): OwnMrFacts[]; repoSlugForMr(mrUrl: string): string; now(): number;
  }, ttlMs?: number /* 10_000 */): RunOwnerRefresher;
  export function attachActiveRuns<T extends { webUrl?: string | null }>(rows: T[], r: RunOwnerRefresher): Array<T & { activeRun?: … }>;
  ```
- The snapshot attaches `activeRun` (via the refresher) and live `handoffs` (`liveHandoffs` against the row's pipeline and rebase state).
- `POST /doctor` with `ring: true` always does a fresh `listRuns` + probe (own MR, then ancestors). It picks the edge kinds from the MR's current facts, never from the button: a failed pipeline → `pipeline-red`; needs a rebase or has conflicts → `needs-rebase`; both → both. `mode: 'rebase'` limits it to `needs-rebase`. It rings one frame per kind (`downstream` with that `childEdge` when the owner is an ancestor's). Each delivered frame → `writeHandoff(..., { markHandled })` for its kind; answer `{ ok: true, rung: true, runId }` when at least one was delivered (an undelivered kind stays unhandled, so the next triage pass rings or doctors it). No live owner → 409 `no work run is active on this MR`. Nothing delivered → 409 `the worker's session did not answer`, nothing written.
- The snapshot's `liveHandoffs` facts pass `needsRebase: needsRebase || hasConflicts` (glance keeps them as separate blockers), so a conflicts-only handoff shows on the row. Triage's own facts are unchanged. Without `ring` (Launch anyway) the route launches as today and calls `clearHandoffs(mrUrl)`.
- Every server-side `writeHandoff` / `clearHandoffs` runs while holding `tryClaimCron`, exactly as the stand-down route does around `writeStandDown`. A transaction alone does not stop an in-flight triage pass's final `writeMemory` from overwriting it.

- [ ] **Step 1: Write the failing tests:**
  - refresher: `poke never blocks and ownerFor fills after the refresh resolves`; `a dead session is not an owner`; `an ancestor's live run shows with viaIid`; `listRuns null keeps the last known owners`.
  - `parseDoctorRequestBody accepts ring: true and rejects other ring values`.
  - server: `ring with a live owner rings, records the handoff and marks the edge handled`; `ring on a conflicted MR with green CI sends only the rebase frame`; `ring on a red and conflicted MR sends both frames and records both handoffs`; `a half-delivered ring records only the delivered kind`; `a conflicts-only handoff shows on the snapshot`; `ring with no live owner is a 409`; `ring whose delivery fails is a 409 and writes nothing`; `a launch without ring clears handoffs and launches as today`; `the snapshot carries activeRun and only live handoffs`.
- [ ] **Step 2:** Run the three test files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; `bun run board:typecheck` → clean.
- [ ] **Step 5: Commit** `board: POST /doctor can ring the active worker; rows carry the active run and handoffs`

### Task 7: Board client: confirm before a manual doctor; the handoff line

**Files:**
- Create: `apps/board/src/client/board/run-guard.ts`, `apps/board/src/client/board/RunActiveConfirmDialog.tsx`
- Modify: `apps/board/src/client/board/Board.tsx` (`guardedLaunch`, a `ringWorker` action posting `/doctor` with `ring: true`), `apps/board/src/client/board/action-runner.ts` (`runBulk`: the bulk skip, beside the presence skip, with a `RunnerDeps` hook if presence uses one), `apps/board/src/client/board/row-status.ts` (`doctorLine`)
- Test: `apps/board/src/client/board/__tests__/run-guard.test.ts`, the existing row-status tests

**Interfaces:**
- Produces: `activeRunConfirmFor(flow: LaunchFlow, opts: LaunchOpts, mr: BoardMRWithReview): NonNullable<BoardMRWithReview['activeRun']> | null` — non-null only for flows that POST `/doctor` (`doctor`, and `rebase-local` if it does), not for `focus`, and only when `mr.activeRun` is set. Mirrors `presenceConfirmFor`.
- Bulk doctor launch (`quiet: true`): MRs with `activeRun` are skipped and named in a note, as the bulk review launch does for presence.
- Dialog: tui-kit `ConfirmDialog`, `intent="accent"`. Title names the worker when `name` is set, else the MR ("Pip's run is active on this branch" / "A work run is active on !4127"). Confirm = **Ring worker**; cancel = **Cancel** (holds focus, so Enter backs out). The body states the stage (and the parent MR when `viaIid` is set) and holds a subtle **Launch doctor anyway** button that runs today's launch.
- `doctorLine`: no doctor in flight and any `mr.handoffs` → `{ tone: 'quiet', word: 'handed to worker', detail: <stage, or "parent's worker" when `viaMr` is not this MR>, verbs: [] }`. Stand-down and an in-flight doctor both outrank it.

- [ ] **Step 1: Write the failing tests:** guard null for review flows, for `focus`, and with no `activeRun`; returns the owner for `doctor`; bulk skips MRs with an owner. Row-status: `handoff shows handed to worker`; `parent handoff says parent's worker`; `an in-flight doctor outranks a handoff`; `stand-down outranks a handoff`.
- [ ] **Step 2:** Run them → FAIL.
- [ ] **Step 3:** Implement; render the dialog beside `PresenceConfirmDialog`. Add stories for the dialog (named and unnamed worker) and the handoff row, invented data.
- [ ] **Step 4:** Tests PASS; `bun run board:typecheck` clean; `bun run --cwd apps/board capture:compare` passes or differs only by the new line/dialog.
- [ ] **Step 5: UI validation (mandatory):** render the dialog and a "handed to worker" row in Fast Browser (Storybook or a fixture board by raw port, never a `*.mattstack` url). Screenshot light and dark; say plainly anything that reads wrong.
- [ ] **Step 6: Commit** `board: confirm before a manual doctor on a live run; show the worker handoff`

### Task 8: Worker pipeline rule for `[board]` frames

**Files:**
- Modify: `plugins/mattstack/attachments/pipeline/work/SKILL.md` (and the plugin version per `mattstack:editing-skills`)

Before editing, load `mattstack:editing-skills`, `superpowers:writing-skills` and `mattstack:process-digraphs` (the work skill is a digraph orchestrator). Follow writing-skills' RED/GREEN.

- [ ] **Step 1: RED:** a baseline subagent run of the current skill, handed a `[board]` CI-failure frame mid-implement; record what it does.
- [ ] **Step 2:** Add the rules from spec §6: own-MR CI failure → fix before the stage ends; own-MR rebase → rebase before the stage ends; no separate fix loop, no hand-off; downstream failing CI → check whether its change caused it, fix on its own branch if so, else note it in the run; downstream rebase → note it in the run and carry on; in watch-ci an own-MR frame changes nothing. Shape it as the digraph handles out-of-band input (a node, not prose) if the skill calls for it.
- [ ] **Step 3: GREEN:** rerun the scenario; the worker folds the fix in.
- [ ] **Step 4:** run the plugin checks `.claude/rules/build-and-plugin.md` names → clean; bump the plugin version.
- [ ] **Step 5: Commit** `work: fold a board CI or rebase frame into the current stage`
