# Board one rebase action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the row menu's "rebase on target" and "rebase locally" with one **rebase** item that runs forge rebase, then local `rt sync`, then the rebase-only doctor, all shown in the sync drawer.

**Architecture:** Two new pure-ish modules carry the logic with injected deps: `src/forge-rebase.ts` (ask the forge, wait for its answer with no clock) and `src/rebase-chain.ts` (the three steps and their state writes). The `/doctor` `mode: 'rebase'` handler in `src/server.ts` calls the chain. The doctor state row gains a `forge` field the drawer reads to draw a first step above Fetch / Back up / Rebase / Push.

**Tech Stack:** Bun, TypeScript, React (board client), `@mattstack/glance` 0.31.0 (glance-gaps), `@mattstack/rt-client` daemon verbs (`mr:action`, `mr:get`).

**Spec:** `docs/superpowers/specs/2026-11-12-board-one-rebase-design.md`

## Global Constraints

- No clock ends the forge wait: it ends on the forge's answer or a cancel. Step 2 keeps `LOCAL_SYNC_TIMEOUT_MS` and rt sync's ceiling unchanged.
- Step 1 is chosen by capability (`canRebase`), never by forge name.
- The board reads and writes GitHub only through the daemon (`rtCommand`), never its own provider.
- GitLab calls go through #1103's single GitLab accessor (name it as #1103 lands it).
- One `LOCAL_SYNCS` lock per MR covers the whole chain.
- Live forge runs: Matt approves each, `m4ttheweric/glance-conformance` only, never PR #177, never read/copy/stage the harness credentials file, tell justin (`rt chat dm justin.xjdp`) before running.
- UI copy follows `rt:ui-copy`; no `·` separators; tokens per `docs/apps/ui-authoring.md`.
- Run board tests from `apps/board` (`bun test <file>`); targeted tests only, CI runs the rest.
- No mattstack ticket ids in code or comments outside this repo's docs (fine here, it is a mattstack repo).

## Review Focus

1. GitLab clears `rebase_in_progress` but nothing else changed (rt's `unchanged`): the chain must go to step 2, never loop forever. Pinned in Task 2.
2. A cancel while waiting must not start `rt sync` (a local push would race GitLab's). Pinned in Task 3.
3. A board restart mid forge wait leaves no `forge-rebasing` row stuck spinning. Pinned in Task 4.
4. A tab with no doctor skill reaches step 2 and stops at "paused on conflicts" with the tree named, instead of the old up-front 409. Pinned in Task 3 and Task 4.
5. A GitHub row after a successful forge rebase shows fresh state, not the daemon store's stale copy. Pinned in Task 4.

---

### Task 0: Live check of GitHub's rebase mutation (gated)

Not code. Decides whether GitHub needs a wait at all.

- [ ] **Step 1:** Ask Matt for the go-ahead with the exact plan: in `m4ttheweric/glance-conformance`, push a throwaway branch one commit behind `main`'s tip, open a PR, call glance-gaps' `GitHubProvider.rebasePullRequest` once, then close the PR and delete the branch. Wait for his yes.
- [ ] **Step 2:** `rt chat dm justin.xjdp` that the run is starting; wait for his all-clear.
- [ ] **Step 3:** Run it with a scratch script in the session scratchpad that loads credentials the way glance's live tests do (never print them). Record old head oid, the mutation's returned `headRefOid`, and a re-read's `headRefOid` immediately after.
- [ ] **Step 4:** Close the PR, delete the branch, tell justin it is done.
- [ ] **Step 5:** Outcome:
  - Returned oid moved: append "GitHub mutation verified synchronous (date, oids)" to the spec's GitHub section; commit `docs: record GitHub rebase mutation is synchronous`.
  - Did not move: **stop the plan** and bring the result to Matt.

### Task 1: Take #1103

- [ ] **Step 1:** Confirm #1103 merged: `gh pr view 1103 --json state --jq .state` prints `MERGED`. If not, wait; Tasks 5 and 6 conflict without it.
- [ ] **Step 2:** `git fetch origin main && git merge origin/main`; resolve conflicts keeping both sides.
- [ ] **Step 3:** From the merged code, note the GitLab accessor's name and the GitHub refusal helper on the server routes (search `onGitHub` and the route refusal); write both names into this plan's Task 2 and Task 4 Interfaces before continuing.
- [ ] **Step 4:** `bun test src/__tests__/local-sync.test.ts src/client/board/__tests__/row-actions.test.ts` from `apps/board`: PASS. Commit the merge.

### Task 2: `forgeRebase` with a clockless wait

**Files:**
- Create: `apps/board/src/forge-rebase.ts`
- Test: `apps/board/src/__tests__/forge-rebase.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ForgeKind = 'gitlab' | 'github';
  export type ForgeRebaseResult =
    | { kind: 'rebased'; sha: string | null }
    | { kind: 'current' }
    | { kind: 'unclear' }                        // flag cleared, nothing moved, no error
    | { kind: 'failed'; reason: string; conflicts: boolean }
    | { kind: 'cannot' }                         // forge lacks canRebase
    | { kind: 'cancelled' };
  export interface ForgeRebaseRead {
    sha: string | null; rebaseInProgress: boolean; mergeError: string | null;
    conflicts: boolean; divergedCommitsCount: number | null;
  }
  export interface ForgeRebaseDeps {
    forge: ForgeKind;
    canRebase: boolean;
    read: () => Promise<ForgeRebaseRead>;        // one MR read; throws on failure
    rebase: () => Promise<void>;                 // throws with the forge's message
    sleep: (ms: number) => Promise<void>;
    signal: AbortSignal;
    pollMs?: number;                             // default 5_000 (rt's REBASE_POLL_MS)
  }
  export function forgeRebase(deps: ForgeRebaseDeps): Promise<ForgeRebaseResult>;
  export function gitlabRebaseDeps(...): Omit<ForgeRebaseDeps,'signal'|'sleep'>;  // via #1103's GitLab accessor, fetchSingleMR
  export function githubRebaseDeps(repoName: string, iid: number, command = rtCommand): Omit<ForgeRebaseDeps,'signal'|'sleep'>; // mr:action rebase, mr:get refresh:true
  ```

- [ ] **Step 1: Write failing tests** in `forge-rebase.test.ts`, each with a scripted `read` queue and a no-op `sleep`:
  - `cannot rebase returns cannot without calling rebase`: `canRebase: false` → `{kind:'cannot'}`, `rebase` not called.
  - `sha moved after the flag clears is rebased`: reads `[{sha:'a'}, {sha:'a',rebaseInProgress:true}, {sha:'b',rebaseInProgress:false}]` → `{kind:'rebased', sha:'b'}`.
  - `merge error once settled is failed`: final read `{sha:'a', rebaseInProgress:false, mergeError:'Rebase failed: conflict'}` → `{kind:'failed', reason:'Rebase failed: conflict', conflicts:false}`.
  - `conflicts once settled is failed with conflicts`: → `conflicts: true`.
  - `not behind once settled is current`: `divergedCommitsCount: 0` → `{kind:'current'}`.
  - `settled with nothing moved and unknown behind is unclear`: `divergedCommitsCount: null` → `{kind:'unclear'}` after ONE settled read (no second confirming read; step 2 decides).
  - `keeps waiting while the flag is set, with no limit`: 50 reads with `rebaseInProgress: true` then a moved sha → `rebased`; asserts `sleep` called 50 times.
  - `rebase call error is failed`: `rebase` throws `Error('403 Forbidden')` → `{kind:'failed', reason:'403 Forbidden', conflicts:false}`.
  - `a failed read keeps waiting`: one read throws, the next settles → result from the next.
  - `abort while waiting is cancelled`: abort the signal inside `sleep` → `{kind:'cancelled'}`; no further reads.
  - `GitHub returns after one read-back`: forge `github`, `rebase` resolves, read-back shows moved sha → `rebased` with `sleep` never called.
- [ ] **Step 2:** `bun test src/__tests__/forge-rebase.test.ts`: FAIL (module missing).
- [ ] **Step 3: Implement.** Read sha before `rebase()`. GitLab: loop read → if `sha` moved return `rebased`; if `!rebaseInProgress` settle (`mergeError`/`conflicts` → failed, `divergedCommitsCount === 0` → current, else unclear); else `sleep(pollMs)`; check `signal.aborted` before each read and after each sleep. GitHub: one read-back after `rebase()` and settle the same way (moved → rebased; else unclear). A thrown `rebase()` is `failed` with `err.message`, except `CannotRebaseError` (exported from this file), which returns `cannot`. `githubRebaseDeps` sets `canRebase: true` (the board cannot see the daemon's provider) and throws `CannotRebaseError` when `mr:action` answers `{ok:false}` with the daemon's `canRebase` refusal ("GitHub cannot rebase a pull request…", `lib/daemon/handlers/mr.ts`); any other `{ok:false}` throws a plain `Error(error)`. Add the test `daemon canRebase refusal is cannot`.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `board: forgeRebase asks the forge and waits for its answer`.

### Task 3: `runRebaseChain`

**Files:**
- Create: `apps/board/src/rebase-chain.ts`
- Modify: `apps/board/src/doctor-state.ts` (add `'forge-rebasing'` to `DoctorStatus`; add `forge?: ForgeStep` to the state shape; `failOrphanedSyncs` also fails `forge-rebasing`)
- Test: `apps/board/src/__tests__/rebase-chain.test.ts`, `apps/board/src/__tests__/doctor-state.test.ts`

**Interfaces:**
- Consumes: Task 2's `forgeRebase`, `ForgeRebaseResult`, `ForgeKind`; `syncBranchLocally`, `LocalSyncOutcome` from `local-sync.ts`.
- Produces:
  ```ts
  export interface ForgeStep {
    forge: ForgeKind;
    state: 'running' | 'done' | 'failed' | 'skipped';
    detail?: string;            // 'rebased' | 'already current' | forge reason | 'conflicts already known' | 'GitHub cannot rebase'
  }
  export type RebaseChainEnd =
    | { kind: 'forge-done'; message: string }
    | { kind: 'synced'; message: string }
    | { kind: 'stopped'; message: string }
    | { kind: 'cancelled' }
    | { kind: 'paused'; tree: string; doctor: boolean };
  export interface RebaseChainDeps {
    forge: () => Promise<ForgeRebaseResult>;      // already bound with signal
    forgeKind: ForgeKind;
    skipForge: boolean;                           // blockers.hasConflicts
    sync: () => Promise<LocalSyncOutcome>;
    write: (patch: Partial<DoctorState>) => void; // writeDoctorState bound to the MR
    hasDoctor: boolean;
  }
  export function runRebaseChain(deps: RebaseChainDeps): Promise<RebaseChainEnd>;
  ```

- [ ] **Step 1: Write failing tests** with fake deps recording `write` patches:
  - `forge rebased skips sync`: forge → `rebased`; `sync` not called; end `forge-done` "rebased on GitLab"; writes `status:'forge-rebasing', forge:{state:'running'}` then `status:'synced', forge:{state:'done', detail:'rebased'}`.
  - `forge current skips sync`: end `forge-done`, detail `already current`.
  - `forge failed runs sync`: forge `failed` reason "Rebase failed: conflict"; `sync` called; forge step `failed` with that reason.
  - `forge unclear runs sync`: forge step `state:'failed', detail:'no clear answer from GitLab'`; sync called.
  - `cannot rebase runs sync with the step skipped`: detail `GitHub cannot rebase`.
  - `known conflicts skip the forge`: `skipForge: true` → `forge` not called; step `skipped` "conflicts already known"; sync called.
  - `cancel ends the chain`: forge → `cancelled`; `sync` NOT called; end `cancelled`; writes `status:'sync-stopped', message:'cancelled; the forge may still be rebasing'`.
  - `sync conflict with a doctor pauses for the doctor`: sync → `conflict`; end `{kind:'paused', doctor:true}`; writes `status:'queued', pausedTree`.
  - `sync conflict without a doctor stops on the tree`: `hasDoctor:false` → end `{kind:'paused', doctor:false}`; writes `status:'sync-stopped', pausedTree: tree, message: 'paused in <tree>; no doctor on this tab'`.
  - doctor-state test: `failOrphanedSyncs fails a forge-rebasing row` → `sync-stopped`, message `the board restarted during the rebase`.
- [ ] **Step 2:** `bun test src/__tests__/rebase-chain.test.ts src/__tests__/doctor-state.test.ts`: FAIL.
- [ ] **Step 3: Implement.** Sync-outcome writes reuse today's handler writes verbatim (move them out of `server.ts` lines ~3249-3283 into the chain). Keep `syncLog` handling where it is: the chain's `sync` dep returns the outcome with its log, and the write includes `syncLog` as today.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `board: runRebaseChain escalates forge, sync, doctor`.

### Task 4: Server wiring

**Files:**
- Modify: `apps/board/src/server.ts` (`/doctor` `mode: 'rebase'` branch; new `POST /rebase/cancel`; #1103's GitHub refusal)
- Modify: `apps/board/src/doctor-state.ts` (`parseDoctorRequestBody` unchanged)
- Test: `apps/board/src/__tests__/server-rebase-chain.test.ts` (use the `board-server.ts` harness the other `server-*.test.ts` files use)

**Interfaces:**
- Consumes: Task 3's `runRebaseChain`; Task 2's `gitlabRebaseDeps`, `githubRebaseDeps`.
- Produces: `POST /rebase/cancel` body `{ mrUrl: string }` → 200 `{ok:true, cancelled:boolean}`; local requests only. `REBASE_ABORTS: Map<string, AbortController>` keyed by MR url, set for the chain's life.

- [ ] **Step 1: Write failing tests:**
  - `rebase mode with no doctor skill no longer refuses up front`: POST `/doctor {mode:'rebase'}` on a tab with no doctor skill reaches the chain (fake sync returns clean) → 200 `synced`.
  - `no doctor skill stops at the paused tree`: fake sync returns conflict → 200 `{ok:true, stopped:'paused in /trees/x; no doctor on this tab'}`, no `launchDoctor`.
  - `cancel aborts a running forge wait`: start a chain whose forge read never settles, POST `/rebase/cancel` → `cancelled:true`, the `/doctor` request resolves `{ok:true, cancelled:true}`, state `sync-stopped`.
  - `cancel with nothing running`: → `cancelled:false`.
  - `a GitHub MR is not refused on rebase mode`: a GitHub-row fixture through `/doctor {mode:'rebase'}` → 200 (other routes still refuse, per #1103's tests).
  - `a GitHub forge rebase re-reads the PR`: fake daemon records `mr:get` with `refresh:true` after `mr:action rebase`, and the cache is invalidated.
  - `server start fails an orphaned forge-rebasing row`: seed state `forge-rebasing`, boot → `sync-stopped`.
- [ ] **Step 2:** `bun test src/__tests__/server-rebase-chain.test.ts`: FAIL.
- [ ] **Step 3: Implement.** Move the "no doctor skill" 409 below the chain: only the `paused` end with `doctor:true` continues into today's `launchDoctor` path. Pick deps by the row's forge (#1103's forge value): GitHub → `githubRebaseDeps(repo, iid)`; GitLab → `gitlabRebaseDeps(...)`. `skipForge = !!mr.blockers?.hasConflicts`. After `forge-done` call `cache.invalidate()`. Hold the `AbortController` in `REBASE_ABORTS` inside the existing `LOCAL_SYNCS` try/finally.
- [ ] **Step 4:** Tests PASS, plus `bun test src/__tests__/server-doctor-ring.test.ts src/__tests__/server-own-mr.test.ts`.
- [ ] **Step 5:** Commit `board: /doctor rebase mode runs the forge-first chain`.

### Task 5: Drawer shows the forge step

**Files:**
- Modify: `apps/board/src/client/board/sync-steps.ts`, `SyncSteps.tsx`, `StatusLine.tsx`, `apps/board/src/client/types.ts` (expose `doctor.forge`)
- Modify: `apps/board/src/client/api.ts` (add `cancelRebase(mrUrl)` → POST `/rebase/cancel`)
- Test: `apps/board/src/client/board/__tests__/sync-steps.test.ts`, `status-line-dom.test.tsx`
- Stories: `apps/board/src/client/board/SyncStatus.stories.tsx`

**Interfaces:**
- Consumes: Task 3's `ForgeStep`; Task 4's `/rebase/cancel`.
- Produces: `syncSteps(lines, running, forge?: ForgeStep): SyncView` where `StepKey` gains `'forge'` and the forge step is first when `forge` is given; `SyncView.outcome` gains `'forge-done'` and `'cancelled'`.

- [ ] **Step 1: Write failing tests** in `sync-steps.test.ts`:
  - `forge running leads the steps`: `syncSteps([], true, {forge:'gitlab', state:'running'})` → `steps[0]` `{key:'forge', label:'GitLab rebase', state:'running'}`, title `Rebasing on GitLab`, phase word `rebasing`, detail `on GitLab`.
  - `forge done skips the local steps`: forge `done` detail `rebased`, no lines, not running → outcome `forge-done`, title `Rebased on GitLab`, the four local steps `skipped`.
  - `forge failed then local steps run`: forge `failed` "Rebase failed: conflict" plus today's fetch/rebase lines → forge step `failed` with that detail, rest as today.
  - `no forge keeps today's four steps`: `syncSteps(lines, false)` equals today's output (regression).
  - status-line DOM: `cancel shows while the forge step runs` and calls `cancelRebase`; `GitHub note shows on a GitHub forge step` with text `Re-runs checks; can drop the PR from a merge queue`; `no-doctor stop names the tree`.
- [ ] **Step 2:** Run both files: FAIL.
- [ ] **Step 3: Implement.** Forge label `GitLab rebase` / `GitHub rebase`. Cancel uses the existing `tui-syncsteps-action` button. Add `SyncStatus.stories.tsx` stories: forge waiting, forge done, forge failed into local sync, cancelled, no doctor paused, GitHub waiting.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `board: drawer leads with the forge rebase step`.

### Task 6: One rebase item in the menu

**Files:**
- Modify: `apps/board/src/client/board/row-actions.ts`, `action-runner.ts`, `run-guard.ts`, `Board.tsx`, `RowMenu.stories.tsx`, `row-stories.fixtures.tsx`
- Test: `apps/board/src/client/board/__tests__/row-actions.test.ts`, `action-runner.test.ts`

**Interfaces:**
- Consumes: Task 4's `/doctor {mode:'rebase'}` reply shape (`synced | stopped | cancelled`).
- Produces: `LaunchFlow` value `'rebase'` replaces `'rebase-local'`; the forge-section `rebase` `MrAction` item is removed from the menu (`MrAction` keeps `'rebase'` for `/mr/action`).

- [ ] **Step 1: Write failing tests:**
  - `own behind MR shows one rebase item`: `behindTarget: 3` → exactly one item with key `rebase` and label `rebase`; no `rebase-local`, no forge-section `rebase`.
  - `shows for conflicts, the GitLab button, and needs-rebase readiness`: each of `blockers.hasConflicts`, `rebaseButton.visible`, `readiness.reasons: ['behind']` alone shows it.
  - `shows on a GitHub row`: (un-hides #1103's hidden rebase).
  - `shows on a tab with no doctor skill`: `doctorSkillTabs: ['other']` still shows it.
  - `blocked while running`: doctor status `forge-rebasing` or `syncing` → blocked `rebasing`.
  - `hidden on an up-to-date MR and on others' MRs`.
  - `bulk targets only MRs needing a rebase`: action-runner bulk over three rows, one up to date → two posts with `{mode:'rebase'}`.
- [ ] **Step 2:** Run both files: FAIL.
- [ ] **Step 3: Implement.** Item in the agent section, `notable: true`, `bulk: 'rebase'`. Toasts: single done uses the server's message (`rebased on GitLab`, `rebased and pushed`, …), bulk `rebase ran on N`. `run-guard.ts` `DOCTOR_FLOWS` swaps `rebase-local` for `rebase`. `Board.tsx` case `'rebase'` keeps today's `startSyncLines` call.
- [ ] **Step 4:** Tests PASS. Then `bun run board:typecheck` and `bun run skills:check:board` from the repo root: PASS.
- [ ] **Step 5:** Commit `board: one rebase item replaces the two`.

### Task 7: See it

- [ ] **Step 1:** `bun run storybook` from the repo root; through Fast Browser (`fast-browser:browser-driver`), screenshot each new `SyncStatus` story and the row menu story in light and dark at 1280 and 600 wide.
- [ ] **Step 2:** Open the screenshots for Matt (`open`), and say plainly what looks wrong.
- [ ] **Step 3:** `bun run capture:compare` in `apps/board`; regenerate baselines with `capture:baseline` only for the intended menu change. Commit `board: capture baselines for the one rebase item`.
