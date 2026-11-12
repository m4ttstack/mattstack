# Board Auto-Doctor on GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `bin/triage.ts` run the auto-doctor on a GitHub team, owning PRs as the team record's username, and prove the pipeline-red, new-push and needs-rebase edges from GitHub-shaped rows.

**Architecture:** A pure forge plan in `src/triage/forge-plan.ts` replaces the single GitHub skip flag; `bin/triage.ts` reads it for its identity and for which passes run. The edge code, memory and state.db are unchanged: GitHub's `github:run:<n>` ids already parse. A small pure helper names red PRs whose id cannot parse (statuses-only CI). The GitHub fixture gains the rows that prove it.

**Tech Stack:** Bun, TypeScript, `bun:test`, `@mattstack/rt-client`.

**Spec:** `docs/superpowers/specs/2026-11-12-board-auto-doctor-github-design.md`

## Global Constraints

- GitLab behaviour does not change: same identity source, same passes, no new log line.
- No change to the triage memory shape (`lastHandledPipelineId: number | null`), `memory.identity`, or the board's state.db schema.
- No new poll, interval or forge call; GitHub identity is `activeTeam().username`, a local read.
- Do not touch `src/client/board/row-actions.ts`, `CommentsDrawer`, the mr action or merge routes in `server.ts`, `skills-src/`, `lib/`, `packages/`, `plugins/`.
- Write only under `apps/board/src/triage/`, `apps/board/bin/triage.ts`, `apps/board/src/__tests__/`, `apps/board/tests/fixture-github/`, `docs/superpowers/`.
- No em or en dashes in code, comments, fixtures or commit messages. Comments state only a constraint the code cannot show.
- Run tests from `apps/board` (`bun test <file>`); a root `bun test` skips the board preload.
- Fixture content is invented (public repo): names, handles, ids, URLs.

## Review Focus

1. A GitHub team with no recorded username: auto-doctor skips with one line, the passes that read GitHub do not throw (Task 1 test; Task 3 wiring).
2. A red GitHub PR whose CI is commit statuses only: no edge, one line naming the PR (Task 2 test).
3. A new push on an already-handled red PR: the new run id fires again (Task 4 test).
4. Peer mode on a GitHub team keeps declining respond asks exactly as today (Task 3: peer paths read no plan field).
5. A recorded username whose case differs from the PR author: ownership still holds; fix-class licensing stays exact-match as today (Task 4 test).

---

### Task 1: The triage forge plan

**Files:**
- Create: `apps/board/src/triage/forge-plan.ts`
- Delete: `apps/board/src/triage/forge-skip.ts` (`git rm`)
- Modify: `apps/board/src/__tests__/forge-door.test.ts` (replace the `triageForgeSkip` describe)

**Interfaces:**
- Produces:
  ```ts
  export interface TriageForgePlan {
    /** 'gitlab-token': resolve from the GitLab token as today.
        { recorded }: own PRs as this username. null: own nothing. */
    identity: 'gitlab-token' | { recorded: string } | null;
    /** The non-peer respond-ask (nudge) and re-review latch passes run. */
    asksAndLatch: boolean;
    /** Logged once per non-peer run, in order. */
    lines: string[];
  }
  export function triageForgePlan(
    config: Pick<BoardConfig, 'forge'>,
    recordedUsername: () => string | null
  ): TriageForgePlan;
  export const GITHUB_ASKS_LATCH_SKIP: string;
  export const GITHUB_NO_USERNAME: string;
  ```

- [ ] **Step 1: Write the failing tests** in `forge-door.test.ts`, replacing the `triageForgeSkip` describe with `describe('triageForgePlan')`:
  - `'runs every pass on a GitLab team and never reads the recorded username'`: with a `recordedUsername` spy that throws, expect `{ identity: 'gitlab-token', asksAndLatch: true, lines: [] }`.
  - `'owns PRs as the recorded username on a GitHub team'`: `() => 'mkeller'` gives `{ identity: { recorded: 'mkeller' }, asksAndLatch: false, lines: [GITHUB_ASKS_LATCH_SKIP] }`.
  - `'owns nothing on a GitHub team with no recorded username'`: `() => null` gives `{ identity: null, asksAndLatch: false, lines: [GITHUB_ASKS_LATCH_SKIP, GITHUB_NO_USERNAME] }`.
  - `'names the skips in plain words'`:
    ```ts
    expect(GITHUB_ASKS_LATCH_SKIP).toBe('triage: respond asks and the re-review latch skip GitHub teams for now');
    expect(GITHUB_NO_USERNAME).toBe('triage: no forge username is recorded for this team, so auto-doctor owns no PRs');
    ```
- [ ] **Step 2: Run** `cd apps/board && bun test src/__tests__/forge-door.test.ts`. Expected: FAIL, cannot resolve `../triage/forge-plan.ts`.
- [ ] **Step 3: Implement `triageForgePlan`** in `forge-plan.ts`; call `recordedUsername` only when `config.forge.kind === 'github'`. Delete `forge-skip.ts`.
- [ ] **Step 4: Run** the same test. Expected: PASS. (`bin/triage.ts` still imports `forge-skip.ts` until Task 3; do not typecheck yet.)
- [ ] **Step 5: Commit** `forge-plan.ts`, the deletion, and the test: `triage: forge plan replaces the GitHub skip flag`.

### Task 2: Name red PRs whose pipeline id cannot parse

**Files:**
- Modify: `apps/board/src/triage/forge-plan.ts`
- Test: `apps/board/src/__tests__/forge-door.test.ts`

**Interfaces:**
- Consumes: `OwnMrFacts` from `src/triage/edge.ts`.
- Produces: `export function unparsedRedLines(mrs: OwnMrFacts[]): string[]`, one line per MR with `pipelineState === 'failed' && pipelineId === null`, in input order:
  `triage: <mrUrl> has no workflow run id (commit statuses only), auto-doctor skips it`

- [ ] **Step 1: Write the failing test** `'names a red PR with no parsed pipeline id and nothing else'`: three facts (failed with id `null`; failed with id `7004106`; passed with id `null`) give exactly one line, for the first, equal to the template above with its URL.
- [ ] **Step 2: Run** the test file. Expected: FAIL, `unparsedRedLines` is not exported.
- [ ] **Step 3: Implement `unparsedRedLines`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: `triage: name red PRs with no workflow run id`.

### Task 3: Wire the plan into `bin/triage.ts`

**Files:**
- Modify: `apps/board/bin/triage.ts` (imports; the `forgeSkip` block at about 192-195; `runTriage` gate at about 249; `nudgeReady` at about 286; `latchToken` and the latch gate at about 366-367)

**Interfaces:**
- Consumes: `triageForgePlan`, `unparsedRedLines` (Tasks 1, 2); `activeTeam` from `@mattstack/rt-client` (its `.username` is the team record's `forgeUsername`).

- [ ] **Step 1: Replace the skip flag.** `const plan = triageForgePlan(boardConfig, () => activeTeam().username);`. In non-peer mode only: log each `plan.lines` entry with `console.log`, then set `username` to `await resolveUsername()` when `plan.identity === 'gitlab-token'`, to `plan.identity.recorded` when it is an object, and leave it `''` when null.
- [ ] **Step 2: Gate the passes.** Define `const asksAndLatch = peerMode || plan.asksAndLatch;` and use it everywhere `!forgeSkip` stood (`nudgeReady`, `latchToken`, the latch `if`). Run `runTriage` when `!peerMode && plan.identity !== null`. Peer-mode behaviour must read exactly as before: `asksAndLatch` is true there, as `!forgeSkip` was.
- [ ] **Step 3: Log the unparsed reds.** Pass `runTriage` a `fetchOwnMrs` that awaits the existing `fetchOwnMrs`, logs each `unparsedRedLines(mrs)` line, and returns `mrs`. Leave the nudge pass's own `fetchOwnMrs` call unwrapped.
- [ ] **Step 4: Verify** `cd apps/board && bun run typecheck` passes and `grep -rn "forge-skip\|triageForgeSkip" apps/board` finds nothing.
- [ ] **Step 5: Run** `cd apps/board && bun test src/__tests__/forge-door.test.ts src/__tests__/triage-run.test.ts src/__tests__/triage-edge.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit**: `triage: run the auto-doctor on GitHub teams as the recorded username`.

### Task 4: GitHub fixture rows and the edge proof

**Files:**
- Modify: `apps/board/tests/fixture-github/data.json`, `apps/board/tests/fixture-github/README.md`
- Modify: `apps/board/src/__tests__/fixture-github.test.ts`
- Create: `apps/board/src/__tests__/triage-github-edges.test.ts`

**Interfaces:**
- Consumes: `ownMrFacts` (`src/run-owner-io.ts`), `observe`, `detectEdges`, `markHandled` (`src/triage/edge.ts`), `triageOwns` (`src/triage/seat.ts`), `composeFixClasses` (`src/triage/run.ts`), `unparsedRedLines` (Task 2).

- [ ] **Step 1: Move the fixture to the 0.31 id shape.** Pipeline ids: #4101 `github:run:7004101`, #4102 `github:run:7004102`, #4103 `github:run:7004103`, #4105 `github:run:7004105`. #4104 becomes statuses-only: id `github:checks:https://github.com/acme/webapp/pull/4104`, job ids `github:status:<name>`.
- [ ] **Step 2: Add two seat-owned rows**, copied from #4105's shape with new iids, titles, branches and `WEB-` ids:
  - #4106 (mkeller): pipeline `github:run:7004106`, status `failed`, one failed job; `pipelineState: "failed"`, `blockers.pipelineFailing: true`, `blockers.any: true`, `status: "blocked"`.
  - #4107 (mkeller): pipeline `github:run:7004107`, status `success`; `blockers.needsRebase: true`, `blockers.any: true`, `rebaseButton.visible: true`, `behindTarget: null`, `pipelineState: "passed"`, `status: "blocked"`.
  - `members` and `allMembers`: mkeller `count` 3 becomes 5.
  - README: add both rows to the table; the #4104 line says its checks are commit statuses; replace "which none here do" with "which #4107 does".
- [ ] **Step 3: Extend `fixture-github.test.ts`** with `'every pipeline id is a glance 0.31 GitHub id'`: each row's `pipeline.id` matches `/^github:run:\d+$/` or equals `github:checks:${row.webUrl}`, and at least one row has each form.
- [ ] **Step 4: Write `triage-github-edges.test.ts`** over the fixture rows (read and parse `data.json` as `BoardMR & { webUrl: string }`):
  - `'the seat owns only its own PRs as the recorded username'`: filtering with `triageOwns(row, 'mkeller', 'mkeller')` gives iids `[4102, 4103, 4105, 4106, 4107]`.
  - `'a red PR fires pipeline-red with its workflow run id'`: after `observe` and `detectEdges` over the owned facts (day `'2026-11-12'`), the edges are exactly `[{ iid: 4106, kind: 'pipeline-red', pipelineId: 7004106 }, { iid: 4107, kind: 'needs-rebase', pipelineId: 7004107 }]` (compare with `toMatchObject` per edge).
  - `'a handled run stays quiet and a new push fires again'`: `markHandled` the 4106 edge; `detectEdges` gives no 4106 edge; replace that row's pipeline id with `github:run:7004199`; it fires `pipeline-red` with `pipelineId: 7004199`.
  - `'a behind PR fires needs-rebase once until it is clean'`: `markHandled` the 4107 edge; no 4107 edge; `observe` with `needsRebase: false` then `true` again fires it again.
  - `'statuses-only CI gives no edge and is named'`: `ownMrFacts` of #4104 has `pipelineId: null` and `pipelineState: 'failed'`; `detectEdges` over it (after `observe`) gives no `pipeline-red`; `unparsedRedLines` names `https://github.com/acme/webapp/pull/4104`.
  - `'a recorded username in another case still owns the PR'`: `triageOwns(row4106, 'mkeller', 'MKeller')` is true; `composeFixClasses({ retryFlake: true, inheritedNoteDraft: false, cleanApiRebase: false, mechanicalLint: true, codeFix: true }, 'mkeller', 'mkeller')` includes `code-fix` and `mechanical-lint`.
- [ ] **Step 5: Run** `cd apps/board && bun test src/__tests__/triage-github-edges.test.ts src/__tests__/fixture-github.test.ts`. Expected: PASS. (These prove existing edge code against the new rows, so they pass once the fixture lands; confirm each test can fail by temporarily breaking one expected value, then restore it.)
- [ ] **Step 6: Commit**: `board: GitHub fixture rows prove the auto-doctor edges`.

### Task 5: Whole-branch verification

- [ ] **Step 1:** `cd apps/board && bun test` passes (report the count).
- [ ] **Step 2:** `cd apps/board && bun run typecheck` passes.
- [ ] **Step 3:** from the worktree root, `bun run purity` passes.
- [ ] **Step 4:** `git diff main --stat` touches only the write paths in Global Constraints.
