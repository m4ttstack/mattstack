# Shared Settings Sync Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (Native, or its Native with reviews variant) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Console shows whether org and team settings changes have left this Mac, live, with Push now and push on save.

**Architecture:** The daemon's team snapshot engine reports which store keys are waiting (`pending`), keeps `lastPushAt` across restarts, gains a push-now path, and emits `team-snapshot-updated` on the events bus. `rt team status --json` and a new `rt team push` expose it. Console's server derives one pill state per org from `rt team status --json`, relays the event as the `settings-sync` topic, and the client keeps a live query and pushes after an org or team save. The pill UI is the final, hand-built task.

**Tech Stack:** Bun + TypeScript (rt, daemon, rt-client), Hono + React + TanStack Query + Mantine via `@mattstack/app-kit` (Console), Vitest (Console), `bun test` (rt).

**Spec:** `docs/superpowers/specs/2026-11-23-settings-sync-status-design.md`

## Global Constraints

- Org store file: `mattstack/org/settings.org.jsonc`; team store: `mattstack/teams/<team>/settings.team.jsonc`.
- Event topic `team-snapshot-updated`, payload `{ slug }`; Console relay topic `settings-sync`.
- Daemon verb `team:snapshot-run { slug }`; CLI `rt team push [--team <slug>] [--json]`.
- An older daemon's status has no `pending`: readers treat it as unknown, never as nothing waiting.
- "Can't reach the org repo" when `lastPullAt` is older than `2 * pullIntervalSec` (default 300s) or `lastPullError` is set.
- The pill and the save follow-up compare only against this Mac's own `lastPushAt`, never origin's tip time.
- Push now and push on save never bypass the org-store guard, role ownership or the approved-branch check: they run the engine's own round.
- Console never runs git. It reads `rt team status --json` and runs `rt team push --json` through `runRt` (`src/server/rt-bin.ts`).
- Design fixture refuses Push now (`the design fixture is read-only`).
- Run `bun test` from the repo root only; built binaries only under an isolated HOME (root `AGENTS.md`).
- Every rt output line follows `.claude/rules/output-layer.md` and `.claude/rules/output-agent-verbs.md`; the command description follows `.claude/rules/command-tree.md`.
- Comments state only constraints the code cannot show.

## Review Focus

1. A push that fails while the save follow-up is showing "pushing": the row must land on the stuck reason, never on "pushed". (Task 7 test `save follow-up ends on stuck after a failed push`.)
2. A token that stopped working with nothing waiting: the pill must read stuck "Can't reach the org repo", not "Pushed". (Task 6 test `stale pull reads stuck`.)
3. Two saves within a second: one push round, both keys leave `pending`. (Task 2 test `concurrent pushNow calls share one round`.)
4. A save to a repo override (`repos.<identity>.<key>`) on a team row: `pending` names the repo and key, so the row matches. (Task 1 test `reports a key inside repos.<identity>`.)
5. Daemon restart with nothing new pushed: the pill still reads "Pushed Nm ago" from the restored record. (Task 2 test `restores lastPushAt from the persisted push record`.)

---

### Task 1: rt-client store key diff

**Files:**
- Create: `packages/rt-client/src/settings/store-diff.ts`
- Modify: `packages/rt-client/src/index.ts` (export)
- Test: `packages/rt-client/src/settings/__tests__/store-diff.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PendingKey { key: string; repo?: string; change: "added" | "changed" | "removed" }
  export function diffStoreKeys(file: string, before: string | null, after: string | null): PendingKey[]
  ```
  `before` is the file at origin's tip (null when absent there), `after` the working tree (null when deleted). Uses `parseStoreText` from `stores.ts`; deep compare per top-level key in `global` and per key inside each `repos[identity]`. Sorted by repo (global first), then key. A malformed side reads as empty (parseStoreText already warns).

- [ ] **Step 1: Write the failing tests**

  - `reports an added, a changed and a removed global key` → `[{key:"a",change:"added"},{key:"b",change:"changed"},{key:"c",change:"removed"}]`.
  - `ignores a reformatted or recommented file` → `[]` for the same values with different whitespace and comments.
  - `reports a key inside repos.<identity>` → before `{"repos":{"gh/acme/web":{"x":1}}}`, after `{"repos":{"gh/acme/web":{"x":2}}}` → `[{key:"x",repo:"gh/acme/web",change:"changed"}]`.
  - `a file new at origin reads every key as added` (before null).
  - `a deleted file reads every key as removed` (after null).
  - `a nested object change reports its top-level key once` (`board.slack.emoji.looking` change → `[{key:"board.slack",change:"changed"}]`).

- [ ] **Step 2: Run to see them fail**

  Run: `bun test packages/rt-client/src/settings/__tests__/store-diff.test.ts`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement `diffStoreKeys` in `store-diff.ts` and export it from `packages/rt-client/src/index.ts`**

- [ ] **Step 4: Run to see them pass**

  Run: `bun test packages/rt-client/src/settings/__tests__/store-diff.test.ts`
  Expected: PASS. Then rebuild rt-client's `dist/` per `.claude/rules/workspace-packages.md` so Console sees the export.

- [ ] **Step 5: Commit** `rt-client: add diffStoreKeys for waiting settings keys`

---

### Task 2: Engine push-now path and restored last push

**Files:**
- Modify: `lib/daemon/home-snapshot.ts` (`SnapshotStatus`, `HomeSnapshotHandle`, start-up state load near the `persistState` read at :366, `doPush` at :1297)
- Test: `lib/daemon/__tests__/home-snapshot.test.ts`

**Interfaces:**
- Consumes: `readHomePushRecord(db, ns)` from `lib/home/push-record.ts`.
- Produces:
  ```ts
  export interface PushNowResult { committed: boolean; pushed: boolean; error: string | null; skipped: string | null }
  // HomeSnapshotHandle gains:
  pushNow(): Promise<PushNowResult>;
  ```
  `pushNow` runs `runNow("manual")`, cancels `pushTimer` and `pushRetryTimer`, resets `pushRetryAttempt`, then awaits `doPush()` and reports from `lastPushError` / `pushPending`. A disabled engine, a conflict or a layout hold returns `pushed:false` with `skipped` set to the existing reason string. Concurrent callers share the in-flight round (reuse `pushInFlight` / `pushAgainRequested`).
  At start-up, a persisted record with `ok:true` seeds `lastPushAt`; `ok:false` seeds `lastPushError` with its `error`.

- [ ] **Step 1: Write the failing tests** (fake exec, fake timers, as the file's existing push tests do)

  - `pushNow commits and pushes without waiting for pushDelaySec` → one `git push` exec before any timer advance; result `{committed:true,pushed:true,error:null,skipped:null}`.
  - `pushNow cancels the scheduled push` → advancing timers by `pushDelaySec` afterwards runs no second push.
  - `concurrent pushNow calls share one round` → two calls, one commit and one push exec, both resolve `pushed:true`.
  - `pushNow on a failed push reports the redacted error` → `pushed:false`, `error` with no credentials.
  - `pushNow while conflicted pushes nothing` → `skipped` non-null, no push exec.
  - `restores lastPushAt from the persisted push record` → seed kv `{at:1000,ok:true}` in `spec.kvNamespace`; `status().lastPushAt === 1000` before any round.
  - `restores lastPushError from a failed record` → `status().lastPushError` equals the stored error.

- [ ] **Step 2: Run to see them fail**

  Run: `bun test lib/daemon/__tests__/home-snapshot.test.ts`
  Expected: the new tests FAIL (`pushNow` is not a function; `lastPushAt` is 0).

- [ ] **Step 3: Implement `pushNow` and the start-up restore in `home-snapshot.ts`**

- [ ] **Step 4: Run to see them pass**

  Run: `bun test lib/daemon/__tests__/home-snapshot.test.ts lib/daemon/__tests__/home-snapshot-rewrite.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** `home-snapshot: push now on request, restore last push after restart`

---

### Task 3: Waiting keys in the team snapshot status

**Files:**
- Create: `lib/daemon/team-pending.ts`
- Modify: `lib/daemon/home-snapshot.ts` (`SnapshotSpec.pendingOf?`, `SnapshotStatus.pending?`, refresh at end of each round and on a debounced watcher wake), `lib/daemon/home-snapshot.ts` `teamSnapshotSpec` (:510, pass `pendingOf`)
- Test: `lib/daemon/__tests__/team-pending.test.ts`, `lib/daemon/__tests__/home-snapshot.test.ts`

**Interfaces:**
- Consumes: `diffStoreKeys` (Task 1).
- Produces:
  ```ts
  export type PendingEntry =
    | { store: "org" | `team:${string}`; repo?: string; key: string; change: "added" | "changed" | "removed" }
    | { path: string; heldBack?: true };
  export async function readPending(repoDir: string, exec: SnapshotDeps["exec"], opts: { unowned: string[]; heldBack: string[] }): Promise<PendingEntry[]>
  // SnapshotSpec: pendingOf?: (exec) => Promise<PendingEntry[]>
  // SnapshotStatus: pending?: PendingEntry[]   (absent for the home spec and before the first read)
  ```
  `readPending` lists changed paths under the team scope roots from `git status --porcelain=v1 -uall -z` plus `git diff --name-only -z @{u}...HEAD`; for each store file it reads `git show @{u}:<path>` (missing → null) and the working file, and maps `diffStoreKeys` results to entries. Paths in `unowned` are left out. Other paths become `{ path }`, with `heldBack: true` when in `heldBack`. No upstream (`@{u}` fails) → compare against the empty tree. A git failure throws; the engine keeps the previous `pending` and logs once.

- [ ] **Step 1: Write the failing tests** (`team-pending.test.ts`, fake exec)

  - `maps a changed team store to its keys` → `[{store:"team:claimview",key:"board.slack",change:"changed"}]`.
  - `maps an org store change` → `store:"org"`.
  - `counts commits ahead of origin, not just the working tree`.
  - `leaves out paths this Mac may not push` (in `unowned`).
  - `marks a held-back marketplace path` → `{path:".claude-plugin/marketplace.json",heldBack:true}`.
  - `nothing waiting reads as an empty list`.
  - In `home-snapshot.test.ts`: `status carries pending after a round for a spec with pendingOf` and `home spec status has no pending`.

- [ ] **Step 2: Run to see them fail**

  Run: `bun test lib/daemon/__tests__/team-pending.test.ts lib/daemon/__tests__/home-snapshot.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement `readPending`, the spec hook and the refresh**

- [ ] **Step 4: Run to see them pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit** `team snapshot: report waiting settings keys`

---

### Task 4: The event and the `team:snapshot-run` verb

**Files:**
- Modify: `lib/daemon/team-snapshots.ts` (deps `emitEvent?`, handle `pushNow(slug)`), `lib/daemon/handlers/team-snapshot.ts`, `lib/daemon.ts` (wire `emitEvent` with the `eventsBus.emitAt` + `emit("event", …)` pattern at :775), `packages/rt-client/src/daemon-api/routes.ts` (describe the topic)
- Test: `lib/daemon/__tests__/team-snapshots.test.ts`, `lib/daemon/__tests__/handlers-team-snapshot.test.ts`

**Interfaces:**
- Consumes: `HomeSnapshotHandle.pushNow()` (Task 2), `status().pending` (Task 3).
- Produces:
  - `TeamSnapshotsDeps.emitEvent?: (topic: string, payload: unknown) => void`
  - `TeamSnapshotsHandle.pushNow(slug: string): Promise<PushNowResult>`; unknown slug throws the same `UserActionableError("no-team")` as `pullNow`.
  - Handler `"team:snapshot-run"`: `{ slug }` → `{ ok: true, data: PushNowResult }`, or `{ ok:false, failure:{code,message} }` for a `UserActionableError`.
  - `team-snapshot-updated { slug }` fires after a commit, a push success, a push failure, a conflict set or cleared, and a `pending` change (compare by JSON). Not on a no-op round.

- [ ] **Step 1: Write the failing tests**

  - `team-snapshots.test.ts`: `emits team-snapshot-updated after a commit and after a push`, `does not emit on a round with nothing new`, `emits when pending changes`, `pushNow on an unknown slug throws no-team`.
  - `handlers-team-snapshot.test.ts`: `team:snapshot-run returns the push result`, `team:snapshot-run maps no-team to a failure`.

- [ ] **Step 2: Run to see them fail**

  Run: `bun test lib/daemon/__tests__/team-snapshots.test.ts lib/daemon/__tests__/handlers-team-snapshot.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement the dep, the handle method, the handler and the `daemon.ts` wiring**

- [ ] **Step 4: Run to see them pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit** `daemon: team:snapshot-run verb and team-snapshot-updated event`

---

### Task 5: `rt team push` and the sync fields in `rt team status --json`

**Files:**
- Modify: `commands/team.ts` (`TeamSyncFields`, `readTeamSyncFields` at :1218, new `teamPush` beside `teamPull` at :604), `lib/command-tree-def.ts` (entry beside `pull` at :3594)
- Test: `commands/__tests__/team-status.test.ts`, `commands/__tests__/team.test.ts`

**Interfaces:**
- Consumes: `team:snapshot-run` (Task 4), `pending` (Task 3).
- Produces:
  - `rt team status --json` envelope gains, beside the existing sync fields: `pending: PendingEntry[] | null` (null when the daemon is unreachable or predates it), `lastPushError`, `lastCommitError`, `lastPullError: string | null`, `layoutHold: boolean`, `unownedDirty: string[]`, `heldBack: string[]`, `pullIntervalSec: number`.
  - `export async function teamPush(args: string[], ctx?: CommandContext, deps?: TeamDeps): Promise<void>`; `--json` prints `envelope({ slug, committed, pushed, error, skipped })`; a `pushed:false` result exits non-zero with `team-push-failed` (error) or `team-push-skipped` (skipped), message from the daemon. Daemon down → the same `daemon-unreachable` error `teamPull` throws. Timeout: `PULL_TIMEOUT_MS`.
  - Tree entry: `push`, description `"Push your waiting org and team settings changes now, instead of waiting for the next automatic push"`, args `--team` and `SETUP_JSON_ARG`.

- [ ] **Step 1: Write the failing tests**

  - `team-status.test.ts`: `json carries pending and the error fields from the daemon`; `json pending is null when the daemon predates it`; `json pending is null when the daemon is unreachable`.
  - `team.test.ts`: `team push --json prints the push result`; `team push exits with team-push-failed on a failed push`; `team push exits with team-push-skipped while conflicted`; `team push without a daemon throws daemon-unreachable`.

- [ ] **Step 2: Run to see them fail**

  Run: `bun test commands/__tests__/team-status.test.ts commands/__tests__/team.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement the fields, `teamPush` and the tree entry**

- [ ] **Step 4: Run to see them pass**, plus the command-tree conformance tests

  Run: `bun test commands/__tests__/team-status.test.ts commands/__tests__/team.test.ts lib/__tests__/command-tree*.test.ts`
  Expected: PASS. Also run any e2e file that snapshots `rt team status --json` (`grep -rl "team status" e2e/`).

- [ ] **Step 5: Commit** `rt team push, and waiting keys in team status --json`

---

### Task 6: Console server sync routes, relay and fixture

**Files:**
- Create: `apps/console/src/shared/settings-sync.ts`, `apps/console/src/server/settingsSync.ts`, `apps/console/src/server/fixtures/design/syncFixture.ts`
- Modify: `apps/console/src/server/routes.ts` (mount), `apps/console/src/server/index.ts` (relay), `apps/console/AGENTS.md` (one paragraph under Routes and chrome)
- Test: `apps/console/src/shared/settings-sync.test.ts`, `apps/console/src/server/settingsSync.test.ts`

**Interfaces:**
- Consumes: `rt team status --team <slug> --json` and `rt team push --team <slug> --json` (Task 5).
- Produces:
  ```ts
  export type StuckReason = "conflict" | "push-failed" | "commit-failed" | "unreachable" | "trial" | "layout-hold";
  export type SyncState =
    | { kind: "pushed"; lastPushAt: number | null }
    | { kind: "waiting"; count: number }
    | { kind: "stuck"; reason: StuckReason; detail: string | null }
    | { kind: "unknown" };
  export interface OrgSync { org: string; state: SyncState; pending: PendingEntry[]; cantPush: string[]; lastPushAt: number | null; pullIntervalSec: number; trialBranch: string | null }
  export function deriveSyncState(status: TeamStatusJson | null, now: number): SyncState
  ```
  Precedence: null status or `pending === null` → unknown; conflict → push error → commit error → unreachable (`lastPullError`, or `lastPullAt` older than `2 * pullIntervalSec`) → trial → layout hold → `pending.length > 0` → waiting → pushed.
  Routes: `syncRoutes({ runRt, orgs, fixture }: SyncDeps)`, `GET /api/settings/sync` → `{ orgs: OrgSync[] }`; `POST /api/settings/sync/push` `{ org }` → `{ ok: true, result }` or the rt failure message with status 409; fixture → 403 `the design fixture is read-only`. One push per org at a time (409 `A push for this org is still running`).
  Relay entry: `{ match: t => t === 'team-snapshot-updated', topic: 'settings-sync' }`.
  Fixture: `CONSOLE_FIXTURE_SYNC` = `pushed` (default) | `waiting` | `stuck` | `unknown`, read by `syncFixture.ts`; `waiting` lists `board.slack` and `mattstack.directory` on team `web` of org `acme`.

- [ ] **Step 1: Write the failing tests**

  - `settings-sync.test.ts`: one test per precedence step, including `stale pull reads stuck`, `pending null reads unknown`, `nothing waiting reads pushed with lastPushAt`, `a trial branch reads stuck trial even with nothing waiting`.
  - `settingsSync.test.ts`: `GET returns one entry per org from rt team status`, `GET reads unknown when rt team status fails`, `POST runs rt team push for the org`, `POST maps a failed push to 409 with rt's message`, `POST refuses in the fixture`, `a second POST for the same org while one runs gets 409`.

- [ ] **Step 2: Run to see them fail**

  Run: `(cd apps/console && bunx vitest run settings-sync settingsSync)`
  Expected: FAIL.

- [ ] **Step 3: Implement the shared types, the routes, the fixture and the relay; add the AGENTS.md paragraph**

- [ ] **Step 4: Run to see them pass**

  Run: `(cd apps/console && bunx vitest run settings-sync settingsSync) && bun run console:typecheck && bun run console:lint`
  Expected: PASS.

- [ ] **Step 5: Commit** `console: settings sync routes, relay and fixture`

---

### Task 7: Console client data, live updates and push on save

**Files:**
- Create: `apps/console/src/app/settings/useSettingsSync.ts`
- Modify: `apps/console/src/app/runs/useRuns.ts` (`useRunEvents`: route a `settings-sync` frame to `['settings-sync']` only, keep runs and gates surfaces on their own topics), `apps/console/src/app/settings/useRowSave.ts`
- Test: `apps/console/src/app/settings/useSettingsSync.test.tsx`, `apps/console/src/app/settings/useRowSave.test.tsx` (create if absent)

**Interfaces:**
- Consumes: the Task 6 routes and types.
- Produces:
  ```ts
  export function useSettingsSync(): { orgs: OrgSync[]; loading: boolean }
  export function usePushSettings(): { push: (org: string) => Promise<string | null>; pending: boolean }
  export type FollowUp = "saved" | "pushing" | "pushed" | { stuck: StuckReason; detail: string | null };
  export function followUpFor(sync: OrgSync | undefined, save: { key: string; repo?: string; store: string; at: number }): FollowUp
  ```
  `useRowSave` gains `followUp: FollowUp | null` (null for user and machine saves) and, after a successful org or team save, calls `push(org)` once (errors surface through `followUp`, not `error`). `followUpFor`: stuck state → stuck; key still in `pending` → pushing; key gone and `lastPushAt >= at` → pushed; otherwise saved.
  First check how the `/ws` frame names its topic (`packages/server` relay); if it carries none, invalidate `['settings-sync']` on every frame alongside the others.

- [ ] **Step 1: Write the failing tests**

  - `useSettingsSync.test.tsx`: `refetches on a settings-sync frame`, `a runs frame does not refetch sync` (skip if frames carry no topic, and say so in the commit).
  - `useRowSave.test.tsx`: `a team save calls push once`, `a user save does not push`, `followUpFor` cases: `pushing while the key is pending`, `pushed once it leaves pending after the save`, `save follow-up ends on stuck after a failed push`, `a repo override matches by repo and key`.

- [ ] **Step 2: Run to see them fail**

  Run: `(cd apps/console && bunx vitest run useSettingsSync useRowSave)`
  Expected: FAIL.

- [ ] **Step 3: Implement the hooks and the `useRowSave` change**

- [ ] **Step 4: Run to see them pass**

  Run: `(cd apps/console && bunx vitest run useSettingsSync useRowSave) && bun run console:typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit** `console: live settings sync data, push on save`

---

### Task 8 (handoff, outside the task loop): Pill, popover, save note and row marks

Built live with Matt, not by a subagent:

1. Mock in pen.dev: `SyncPill` in `SettingsContextBar` for all four states, the popover (waiting keys as `?explain=<key>` links, "Can't push from this Mac", stuck reason with its fix, Push now with its inline result), the save note's saved → pushing → pushed steps, and the row's "not pushed" mark.
2. Build from the mock with the kit (`docs/apps/ui-authoring.md`), using `useSettingsSync`, `usePushSettings` and `useRowSave().followUp`.
3. Check in Fast Browser under `CONSOLE_FIXTURE=design` with each `CONSOLE_FIXTURE_SYNC` value, light and dark, then live against this Mac's org.
4. Update the UI tests that iteration broke, once the look is settled.
