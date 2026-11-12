# Board writes and identity follow the team's forge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GitHub team's board can merge (queue-aware), arm and cancel auto-merge, flip draft and post held doctor notes through daemon verbs, knows its own forge username, and closes BOARD-68's small gaps.

**Architecture:** A new `apps/board/src/forge-writes.ts` holds every MR write behind one result type, with a GitLab side (today's glance calls moved out of `server.ts`) and a GitHub side over `rtCommand` (`mr:action`, `mr:comment`, `mr:get`). Routes pick the side by the board's forge. A small `forge-self.ts` answers who the board is. The client un-hides the GitHub items and words the new outcomes.

**Tech Stack:** Bun, TypeScript 7, React (board client), `@mattstack/rt-client`, `@mattstack/glance`, bun test with happy-dom for DOM tests.

**Spec:** `docs/superpowers/specs/2026-11-12-board-writes-follow-forge-design.md`

## Global Constraints

- GitLab behaviour does not change: same glance calls, requests, error text and HTTP status for every GitLab input. `src/__tests__/server-own-mr.test.ts` stays green unmodified, including its three mixed-forge cases (a GitHub row on a GitLab board answers 400 `Not available on GitHub yet` after the row lookup).
- Routes pick the write side by the board's forge (`config.forge.kind`), never by the row; a row whose forge differs from the board's keeps today's post-lookup `FORGE_NOT_YET` refusal.
- Unanswered reasons (the client prints `no answer for #N; <reason>`): merge `the merge may still land`; rebase, set and cancel auto-merge, draft toggle `it may still apply`; note `the note may have posted`.
- The board never builds a GitHub client or reads a GitHub token; every GitHub read and write is a daemon verb through `rtCommand`.
- No new poll, interval or background read.
- Write only under `apps/board/` except `src/triage/`, `bin/triage.ts`, `skills-src/` and `skills/`; the one exception is one `plainReason` case in `src/triage/nudge.ts` (Task 10).
- No test, fixture or browser check reaches a real PR, MR or the live daemon. Fixture mode refuses every non-GET with 501.
- `FORGE_WRITE_TIMEOUT_MS = 120_000`, above `mr:action`'s 90 s budget (PR #1110).
- UI copy by rt:ui-copy; no em or en dashes; no dot separators in new UI text; no coloured border with a border radius.
- Run tests from `apps/board` (`bun test <file>`); the board's root-level preload only loads there. Type check: `bun run typecheck` in `apps/board`. Never run rt, the daemon or a built binary against the real HOME.
- Stage named files only. Commit per task. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A queue-protected GitHub merge must never read as merged: toast says it joined the queue, the row's "merging…" hold releases. (Task 3 server test, Task 6 runner test.)
- A merge or note post with no daemon answer must not read as failed or invite a blind retry: merge keeps its hold, note stays held with a "check the PR" toast. (Task 1 unit, Task 3 server test, Task 6 runner test.)
- Another author's GitHub PR must still be refused before any daemon write. (Task 3 server test.)
- A seat set to a name other than the team record's username must own nothing on GitHub. (Task 4 unit test.)
- A GitHub discussion id of an unknown shape must give the PR URL with no anchor, and `gh-review-thread-` must not be read as `gh-review-`. (Task 7 unit test.)

---

### Task 1: `forge-writes.ts`, result type and GitHub side

**Files:**
- Create: `apps/board/src/forge-writes.ts`
- Test: `apps/board/src/__tests__/forge-writes.test.ts`

**Interfaces:**
- Consumes: `rtCommand`, `DAEMON_UNREACHABLE_PREFIX` from `@mattstack/rt-client`; `MrAction` from `./mr-action.ts`.
- Produces:
  ```ts
  export const FORGE_WRITE_TIMEOUT_MS = 120_000;
  export type MergeQueued = { position: number | null; state: string };
  export type ForgeWriteResult =
    | { kind: 'done'; mergeQueued?: MergeQueued; sourceBranchNotDeleted?: string;
        noteId?: number; title?: string; recovered?: boolean; verified?: false }
    | { kind: 'refused'; reason: string }
    | { kind: 'unanswered'; reason: string }
    | { kind: 'failed'; message: string };
  type Command = typeof rtCommand;
  export function githubMrWrite(repoName: string, iid: number, action: MrAction, command?: Command): Promise<ForgeWriteResult>;
  export function githubSetDraft(repoName: string, iid: number, draft: boolean, command?: Command): Promise<ForgeWriteResult>;
  export function githubPostNote(repoName: string, iid: number, body: string, command?: Command): Promise<ForgeWriteResult>;
  export function forgeReason(error: string): string;
  ```

- [ ] **Step 1: Write the failing tests** with a fake `command` that records `(cmd, payload, opts)` and answers from a queue:
  - `githubMrWrite('remote:x', 7, 'merge', fake)` sends `['mr:action', {repoName:'remote:x', iid:7, action:'merge', args:[]}, {timeoutMs: 120_000}]` and answers `{kind:'done'}` on `{ok:true}`.
  - a merge reply `{ok:true, data:{queued:{position:2, state:'QUEUED'}}}` gives `{kind:'done', mergeQueued:{position:2, state:'QUEUED'}}`; `data.sourceBranchNotDeleted: 's'` passes through.
  - `{ok:false, error:'Error: mergePullRequest failed: 405 Pull Request is not mergeable'}` gives `{kind:'refused', reason:'405 Pull Request is not mergeable'}`.
  - merge with `{ok:false, error:'rt daemon unreachable at /s (timed out)'}` then `mr:get` answering `{ok:true, data:{mr:{state:'merged'}}}` gives `{kind:'done'}`; with `state:'opened'` gives `{kind:'unanswered', reason:'the merge may still land'}`; the `mr:get` payload is `{repoName, iid, refresh:true}`; exactly one `mr:get`.
  - `setAutoMerge` unanswered gives `{kind:'unanswered', reason:'it may still apply'}` with no `mr:get`; `githubSetDraft` unanswered gives the same reason.
  - `githubSetDraft('remote:x', 7, true, fake)` sends `mr:action {action:'toggleDraft', args:[true]}`.
  - `githubPostNote('remote:x', 7, 'hi', fake)` sends `mr:comment {repoName, iid:7, body:'hi', resolvable:false}` and answers `{kind:'done', noteId: 55}` from `data.noteId`; unanswered gives `{kind:'unanswered', reason:'the note may have posted'}`.
  - `forgeReason('Error: setAutoMerge failed: x')` is `'x'`; a message with neither prefix is unchanged.

- [ ] **Step 2: Run** `bun test src/__tests__/forge-writes.test.ts` from `apps/board`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** the module. `forgeReason` strips a leading `Error: `, then a leading `<word> failed: `. Every call passes `{ timeoutMs: FORGE_WRITE_TIMEOUT_MS }`. Comment on the constant: it must stay above the daemon's own `mr:action` budget. A reply's error starting with `DAEMON_UNREACHABLE_PREFIX` is unanswered; never retry.

- [ ] **Step 4: Run** the test file. Expected: PASS.

- [ ] **Step 5: Commit** `board: forge-writes GitHub side over daemon verbs`.

### Task 2: GitLab side moves into `forge-writes.ts`

**Files:**
- Modify: `apps/board/src/forge-writes.ts`
- Modify: `apps/board/src/server.ts` (`/mr/action` ~3994-4075, `/draft` ~3682-3806, `/drafts` post ~3649-3680)
- Test: `apps/board/src/__tests__/forge-writes.test.ts`; regression: `apps/board/src/__tests__/server-own-mr.test.ts` (unmodified)

**Interfaces:**
- Consumes: Task 1's types; `runMrAction`, `mergeRefusalReason`, `MrActionProvider` from `./mr-action.ts`; `NoteMutator`, `ReadBackFailedError`, `GitLabProvider` from `@mattstack/glance`.
- Produces:
  ```ts
  export function gitlabMrWrite(provider: MrActionProvider, path: string, iid: number, action: MrAction, onError?: (message: string) => void): Promise<ForgeWriteResult>;
  export function gitlabSetDraft(provider: Pick<GitLabProvider, 'updatePullRequest' | 'fetchSingleMR'>, path: string, iid: number, draft: boolean, onError?: (message: string) => void): Promise<ForgeWriteResult>;
  export function gitlabPostNote(mutator: Pick<NoteMutator, 'createNote'>, projectId: number, iid: number, body: string): Promise<ForgeWriteResult>;
  ```

- [ ] **Step 1: Write the failing tests** with fake providers:
  - `gitlabMrWrite` merge whose provider throws an error carrying `detailedMergeStatus="not_approved"` gives `{kind:'refused', reason:'not approved yet'}`; any other throw gives `{kind:'failed', message}`; a `ReadBackFailedError` with `writeApplied` gives `done`.
  - `gitlabSetDraft` covers today's four `/draft` outcomes: success `{kind:'done', title}`; update throws, read-back shows the flip: `{kind:'done', title, recovered:true}`; read-back fails but the error is `ReadBackFailedError` with `writeApplied`: `{kind:'done', recovered:true, verified:false}`; otherwise `{kind:'failed', message}`.
  - `gitlabPostNote` gives `{kind:'done', noteId}` and `{kind:'failed', message}`.

- [ ] **Step 2: Run** `bun test src/__tests__/forge-writes.test.ts`. Expected: the new cases FAIL.

- [ ] **Step 3: Implement** the three functions by moving the route bodies' current try/catch logic, then make the three routes' GitLab paths call them and map results to today's responses byte for byte: `refused` 409 `{reason}` (merge only), `failed` `gitlab ${action} failed: ${message}` 502, `gitlab update failed: ${message}` 502, `note post failed: ${message}` 502; `/draft` done bodies `{ok, draft, title}` / `{ok, draft, title, recovered}` / `{ok, draft, recovered, verified:false}`. `onError` is called exactly where each route's `console.error` runs today, and the route passes a closure that logs today's line (`mr action ${action} failed for !${iid}: ${message}`, `draft update failed for !${iid} (draft=${draft}): ${message}`). `cache.invalidate()` stays in the routes, on every result that invalidates today.

- [ ] **Step 4: Run** `bun test src/__tests__/forge-writes.test.ts src/__tests__/server-own-mr.test.ts src/__tests__/mr-action.test.ts`. Expected: PASS, with `server-own-mr.test.ts` unmodified.

- [ ] **Step 5: Commit** `board: GitLab writes go through forge-writes, unchanged`.

### Task 3: Routes take the GitHub side

**Files:**
- Modify: `apps/board/src/server.ts` (the same three routes)
- Test: `apps/board/src/__tests__/server-github-team.test.ts`

**Interfaces:**
- Consumes: Task 1's GitHub functions; `repoIdentityField`, `onGitHub`.
- Produces (the key is `mergeQueued`, not `queued`: `ActionResult.body.queued` is already the ask relay's boolean): route replies the client reads (Task 6): `200 {ok:true, mergeQueued?, sourceBranchNotDeleted?}` (`/mr/action`), `200 {ok:true, draft}` (`/draft`), `200 {ok:true, posted:true, noteId}` (`/drafts`), `409 {reason}` refused, `504 {reason}` unanswered.

- [ ] **Step 1: Rewrite the failing tests.** In the fake daemon, add own PRs `fakePr(8, ALICE)`, `fakePr(9, ALICE)`, `fakePr(10, ALICE)` and answer by iid, recording write payloads:
  - `mr:action` merge: 7 `{ok:true}`, 8 `{ok:true, data:{queued:{position:2, state:'QUEUED'}}}`, 9 `{ok:false, error:'Error: mergePullRequest failed: 405 Pull Request is not mergeable'}`, 10 `{ok:false, error:'rt daemon unreachable at /x (timed out)'}`; `mr:get` for 10 answers `state:'opened'`. Other actions `{ok:true}`. `mr:comment` answers `{ok:true, data:{noteId:555, discussionId:null, resolvable:false, url:'u', mrUrl:'m'}}`.
  - The `/data.json` test's expected rows become `[prUrl(10), prUrl(20), prUrl(7), prUrl(8), prUrl(9)]` sorted as strings.
  - Replace "merge, draft and held-draft post refuse a GitHub PR" with:
    - `merge #7` answers 200 `{ok:true}`; the daemon saw `mr:action` with `{iid:7, action:'merge', args:[]}` and a non-empty `repoName`.
    - `merge #8` answers 200 with `mergeQueued: {position:2, state:'QUEUED'}`.
    - `merge #9` answers 409 `{reason:'405 Pull Request is not mergeable'}`.
    - `merge #10` answers 504 `{reason:'the merge may still land'}`.
    - `setAutoMerge` and `cancelAutoMerge` on #7 reach `mr:action` with that action.
    - `/draft` `{draft:true}` on #7 sends `toggleDraft` with `args:[true]` and answers `{ok:true, draft:true}`.
    - `/drafts` post on a held #7 note sends `mr:comment` `{iid:7, body:'the cache key changed', resolvable:false}`, answers `{ok:true, posted:true, noteId:555}`, and the draft reads `posted` with `postedNoteId: 555`.
    - `merge #20` (Bob's) answers 403 `not your MR` and sends no write.
    - no response body in this file reads `gitlab token not configured` (on a GitHub team `getGitlabToken()` answers null whatever the env, so an ungated token check fails the cases above).

- [ ] **Step 2: Run** `bun test src/__tests__/server-github-team.test.ts`. Expected: FAIL (400 `Not available on GitHub yet`).

- [ ] **Step 3: Implement.** Remove the `config.forge.kind === 'github'` `FORGE_NOT_YET` return before each token check, and narrow the post-lookup `onGitHub(mr)` return to `onGitHub(mr) !== (config.forge.kind === 'github')`. Gate each GitLab token check on `config.forge.kind === 'gitlab'` in its current position. On a GitHub board, after the row lookup and the existing iid and ownership checks, a row with no `repoIdentityField(mr.rtRepo)` answers 400 `this MR has no rt repo`; otherwise call `server.timeout(req, 0)` and the GitHub function, then map: `done` 200 (fields above), `refused` 409 `{reason}`, `unanswered` 504 `{reason}`, then `cache.invalidate()` on `done`. `/drafts` writes `{status:'posted', postedNoteId}` on `done` and leaves the draft `held` otherwise.

- [ ] **Step 4: Run** `bun test src/__tests__/server-github-team.test.ts src/__tests__/server-own-mr.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `board: merge, auto-merge, draft and note post on GitHub PRs`.

### Task 4: Identity on a GitHub team

**Files:**
- Create: `apps/board/src/forge-self.ts`
- Modify: `apps/board/src/server.ts` (`actingSeat` ~1804, `/data.json` `tokenUser` ~2437, `/doctor` identity ~3394, `reloadConfig` ~6263)
- Test: `apps/board/src/__tests__/forge-self.test.ts`, `apps/board/src/__tests__/server-github-team.test.ts`

**Interfaces:**
- Consumes: `activeTeam` from `@mattstack/rt-client`; `effectiveSeat` from `./view.ts`.
- Produces:
  ```ts
  export interface ForgeSelfDeps {
    forge: () => 'gitlab' | 'github';
    fixture: boolean;
    memoryUsername: () => string | null;
    teamUsername: () => string | null;
  }
  export function createForgeSelf(deps: ForgeSelfDeps): { get(): string | null; reset(): void };
  /** The manual doctor launch's identity: GitHub answers self() and never calls gitlab(). */
  export function launchIdentity(forge: 'gitlab' | 'github', self: () => string | null, gitlab: () => Promise<string | null>): Promise<string | null>;
  ```

- [ ] **Step 1: Write the failing tests** (`forge-self.test.ts`):
  - GitLab: `get()` returns `memoryUsername()` on every call (re-read each time).
  - GitHub: returns `teamUsername()`, reads it once until `reset()`, then reads again.
  - fixture: returns null and calls neither reader.
  - `effectiveSeat('alice', createForgeSelf({forge:()=>'github', fixture:false, memoryUsername:()=> 'alice', teamUsername:()=> 'bob'}).get())` is null.
  - `launchIdentity('github', () => 'alice', gitlab)` is `'alice'` and never calls `gitlab`; `launchIdentity('gitlab', self, async () => 'bob')` is `'bob'`.
  - In `server-github-team.test.ts`, at module top before `bootBoardServer` (the GitHub answer is memoized at first use): write `~/.mattstack/rt/teams/testteam.json` `{"forgeUsername":"alice"}`, give both `mattstack.roster` entries `teams: ['web']` (a known username makes `activeTeam()` look the user up in the roster; without `teams` the active team turns null), and change the memory identity to `zed`. `/data.json`'s `tokenUser` is `alice`, it still lists the same PRs, and Task 3's own-PR writes still succeed.

- [ ] **Step 2: Run** both files. Expected: FAIL.

- [ ] **Step 3: Implement** `createForgeSelf`, then in `server.ts` build one instance (`forge: () => config.forge.kind`, `fixture: !!FIXTURE_DIR`, `memoryUsername: () => readMemory().identity?.username ?? null`, `teamUsername: () => activeTeam().username`), use `forgeSelf.get()` in `actingSeat()` and for `tokenUser`, call `forgeSelf.reset()` in `reloadConfig`, and in `/doctor` take `await launchIdentity(config.forge.kind, forgeSelf.get, () => resolveDispatchIdentity(identityRead, async () => (await gitlab()).validateToken()))` (GitLab behaviour unchanged).

- [ ] **Step 4: Run** both files plus `src/__tests__/server-own-mr.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `board: know the board's own user on a GitHub team`.

### Task 5: The menu, status line, DraftModal and refresh on GitHub rows

**Files:**
- Modify: `apps/board/src/client/board/row-actions.ts:623-713`, `apps/board/src/client/board/row-status.ts:218-229`, `apps/board/src/client/board/DraftModal.tsx:97`, `apps/board/src/client/board/action-runner.ts` (refresh spec ~252)
- Test: `apps/board/src/client/board/__tests__/row-actions.test.ts`, `row-status.test.ts`, `draft-modal-dom.test.tsx`, `action-runner.test.ts`

**Interfaces:**
- Consumes: `forgeWord`, `mrRef` from `mr-ref.ts`.
- Produces: no new names.

- [ ] **Step 1: Flip the failing tests:**
  - "a GitHub own MR keeps only open in github" becomes: the forge section of `ghOwnIdle` holds every `FORGE_WRITES` key that a GitLab own row with the same state holds, and `refresh-mr` is labelled `refresh from github`.
  - "auto-merge never leads the menu on a GitHub MR" becomes: it leads (`top:setAutoMerge`) on GitHub as on GitLab.
  - "bulk actions over GitHub rows offer no merge, auto-merge or draft entry" becomes: they offer `merge` and `setAutoMerge` when every row offers them.
  - row-status: a GitHub own approved mergeable row's verbs include `{kind:'merge', label:'merge'}`.
  - draft-modal: "a held draft on a GitHub row offers only dismiss" becomes `['dismiss', 'post']` for the author, and `['dismiss']` plus "only the author posts" for someone else.
  - action-runner: refresh's pending toast for a GitHub row is `refreshing #12 from github…`; a GitLab row keeps `from gitlab`.

- [ ] **Step 2: Run** the four files. Expected: the flipped cases FAIL.

- [ ] **Step 3: Implement:** drop `&& !github` from the forge-writes block and the refresh push (label `refresh from ${forgeWord(mrx)}`) and delete the then-unused `github` local, drop `!onGitHub(mr) &&` from `canMerge`, drop the `onGitHub(mr) ? null :` arm in `DraftModal`, and word refresh's pending toast with `forgeWord(mr)`.

- [ ] **Step 4: Run** the four files and `src/client/board/__tests__/bulk-menu-dom.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit** `board: GitHub rows offer merge, auto-merge, draft, post and refresh`.

### Task 6: Merge, draft and note outcomes in the client

**Files:**
- Modify: `apps/board/src/client/api.ts` (`ActionResult.body`), `apps/board/src/client/board/action-runner.ts` (`post`, `postSpec` mr and draft cases, `MR_WORDING.merge` many-done), `apps/board/src/client/board/DraftModal.tsx` (`act`'s failure branch and its inline message)
- Test: `apps/board/src/client/board/__tests__/action-runner.test.ts`, `draft-modal-dom.test.tsx`

**Interfaces:**
- Consumes: Task 3's route replies.
- Produces: `ActionResult.body.mergeQueued?: { position: number | null; state: string }`.

- [ ] **Step 1: Write the failing tests:**
  - single merge with body `{mergeQueued:{position:2, state:'QUEUED'}}`: toast `#7 joined the merge queue at position 2`; with `position:null`: `#7 joined the merge queue`; `merging.fail` called once (hold released).
  - single merge answered 504 `{reason:'the merge may still land'}`: toast `no answer for #7; the merge may still land`; `merging.fail` not called.
  - single `cancelAutoMerge` answered 504 `{reason:'it may still apply'}`: toast `no answer for #7; it may still apply`.
  - `/draft` answered 504 `{reason:'it may still apply'}`: toast `no answer for #7; it may still apply` (no "couldn't").
  - single merge answered 409 `{reason:'not approved yet'}`: today's `couldn't merge !7: not approved yet`, `merging.fail` called (GitLab unchanged).
  - bulk merge over #7 (merged), #8 (queued) and #10 (504): summary contains `merge accepted on #7`, `#8 joined the merge queue` and `no answer for #10`, and no `couldn't`.
  - `/draft` answered 409 `{reason:'x'}`: `couldn't mark #7 draft: x`.
  - `DraftModal` post answered 504 `{reason:'the note may have posted'}`: the inline message reads `no answer; the note may have posted, check the PR` (not today's "nothing was sent" line), and the post button is still offered; any other failure keeps today's message.

- [ ] **Step 2: Run** both files. Expected: FAIL.

- [ ] **Step 3: Implement.** In `post()`, release the hold when `result.ok ? !!result.body?.mergeQueued : result.status !== 504`. The merge `done` wording reads `mergeQueued`. The mr and draft `fail` wordings answer `no answer for ${mrRef(mr)}; ${r.body.reason}` when `r.status === 504`; `/draft`'s other failures use `r.body?.reason` when present. The merge `manyDone` splits done rows into merged and queued lists. `runMany` puts a 504 result in an `unanswered` group, worded `no answer for <list>`, beside done and failed.

- [ ] **Step 4: Run** both files. Expected: PASS.

- [ ] **Step 5: Commit** `board: say when a merge queued or got no answer`.

### Task 7: Comment links land on the comment

**Files:**
- Modify: `apps/board/src/mr-ref.ts`, `apps/board/src/client/board/CommentsDrawer.tsx:103,430`
- Test: `apps/board/src/__tests__/mr-ref.test.ts` (create if absent), `apps/board/src/client/board/__tests__/comments-drawer-dom.test.tsx`

**Interfaces:**
- Produces: `export function commentUrl(mr: MrLinkTarget, discussionId: string, noteId: number): string | null` (null when the MR has no `webUrl`).

- [ ] **Step 1: Write the failing tests:**
  - GitLab `!12`, any id: `<url>#note_301`.
  - GitHub: `gh-issue-comment-9` with note 9 gives `<pr>#issuecomment-9`; `gh-review-thread-40` with note 41 gives `<pr>#discussion_r41`; `gh-review-77` with note 77 gives `<pr>#pullrequestreview-77`; `fx-thread-1` gives `<pr>` with no `#`.
  - drawer: on a GitHub row whose thread id is `gh-review-thread-3001`, the note time link's `href` ends `#discussion_r3001` and the thread's "open" link likewise; the GitLab drawer test's `#note_` hrefs are unchanged.

- [ ] **Step 2: Run** both files. Expected: FAIL.

- [ ] **Step 3: Implement** `commentUrl` (test `gh-review-thread-` before `gh-review-`) and pass each thread's or comment's `discussionId` to both links.

- [ ] **Step 4: Run** both files. Expected: PASS.

- [ ] **Step 5: Commit** `board: GitHub comment links jump to the comment`.

### Task 8: Bots do not count as reviewers

**Files:**
- Modify: `apps/board/src/discussions.ts:41-62`, `apps/board/src/data.ts` (`buildBoard`, after `getMRDashboardProps`)
- Test: `apps/board/src/__tests__/discussions.test.ts`, the existing `buildBoard` test file (`grep -l buildBoard src/__tests__`)

**Interfaces:**
- Consumes: `isBotAuthor` (gains a `bot?: boolean` on its author param).
- Produces: none new beyond the widened param.

- [ ] **Step 1: Write the failing tests:**
  - `isBotUsername('coderabbitai[bot]')` and `isBotUsername('dependabot[bot]')` are true; `isBotUsername('abbott')` stays false.
  - `isBotAuthor({username:'helper', bot:true}, new Set())` is true; `isBotAuthor({username:'helper'}, new Set())` is false.
  - `summarizeDiscussions` drops a GitHub thread whose only non-author participant is `coderabbitai[bot]`.
  - `buildBoard` on a GitHub PR whose reviewers are `[{username:'coderabbitai[bot]', reviewState:'REVIEWED'}, {username:'tobrandt', reviewState:'UNREVIEWED'}]` keeps only `tobrandt` and `totalAssigned` 1; the same reviewers on a GitLab PR are kept as served.

- [ ] **Step 2: Run** both files. Expected: FAIL.

- [ ] **Step 3: Implement:** add `/\[bot\]$/i` to `isBotUsername`, the `bot === true` check to `isBotAuthor`, and, in `buildBoard` for `props.provider === 'github'` (glance's `PullRequest` has no `provider`), filter `props.reviews.reviewers` through `isBotAuthor(r, configBots)` and set `totalAssigned` to the kept count.

- [ ] **Step 4: Run** both files. Expected: PASS.

- [ ] **Step 5: Commit** `board: GitHub bots never count as reviewers`.

### Task 9: Slack sees multi-PR posts

**Files:**
- Modify: `apps/board/src/slack.ts:79-85`
- Test: `apps/board/src/__tests__/slack.test.ts`

- [ ] **Step 1: Write the failing tests** in `describe('extractMrUrls')`: `<https://github.com/acme/webapp/pull/12|#12> and <https://github.com/acme/webapp/pull/13|#13>` gives both URLs; a repeated PR URL collapses to one; the existing GitLab cases pass unchanged.

- [ ] **Step 2: Run** `bun test src/__tests__/slack.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement:** a second pattern `https://<host>/<owner>/<repo>/pull/<n>` (each segment `[^\s<>|/]+`), both matched, deduplicated; doc comment says "MR or PR URLs".

- [ ] **Step 4: Run** the file. Expected: PASS.

- [ ] **Step 5: Commit** `board: count GitHub PR links in a Slack post`.

### Task 10: The refused respond ask says why

**Files:**
- Modify: `apps/board/src/triage/nudge.ts` (`plainReason` only; shepherd-granted exception)
- Test: `apps/board/src/__tests__/triage-nudge.test.ts`

- [ ] **Step 1: Write the failing test** in `describe('plainReason')`: `plainReason(FORGE_NOT_YET, cfg)` is `Replies on GitHub aren't supported yet`.

- [ ] **Step 2: Run** `bun test src/__tests__/triage-nudge.test.ts`. Expected: FAIL (`Held back by a board limit`).

- [ ] **Step 3: Implement:** import `FORGE_NOT_YET` from `../config.ts` and add `case FORGE_NOT_YET:` with that sentence. Nothing else in `src/triage/` changes.

- [ ] **Step 4: Run** the file. Expected: PASS.

- [ ] **Step 5: Commit** `board: a refused GitHub respond ask says why`.

### Task 11: GitHub fixture and the browser check

**Files:**
- Modify: `apps/board/tests/fixture-github/data.json`, `discussions.json`, `README.md` (and `meta.json` only if the review modal needs a lane entry there)
- Evidence: screenshots under the session scratchpad, not committed

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Extend the fixture** (all invented): `discussions.json` ids take glance's shapes (`gh-review-thread-<id>`, `gh-issue-comment-<id>`); one row carries a finished review lane so the review modal opens from `review-report.md`; one row carries `slack.status: 'found'` with two or more posts so the Slack posts modal opens; one own row is approved and mergeable so merge, auto-merge and the draft toggle all show; one own row carries a held `drafts` entry so `DraftModal` opens with its post control. Update the README's table and drop its "client hides merge..." sentence.

- [ ] **Step 2: Boot** `PORT=<free port> BOARD_FIXTURE=$(pwd)/tests/fixture-github bun run src/server.ts` from `apps/board` (fixture mode: no tokens, no daemon, writes refused).

- [ ] **Step 3: Fast Browser check, light and dark,** through the `fast-browser:browser-driver` agent (`haiku`, `medium`): the own row's right-click menu (merge, auto-merge, draft toggle, `refresh from github`), the comments drawer's links (hrefs end in `#discussion_r` / `#issuecomment-`), the review modal title `#N`, the Slack posts modal title `#N`, and `DraftModal`'s post control. Fire no write. Look at every screenshot and record what reads wrong.

- [ ] **Step 4: Run the gates:** `bun test` from `apps/board`, `bun run typecheck` from `apps/board`, `bun run purity` from the worktree root. Expected: all pass.

- [ ] **Step 5: Commit** `board: GitHub fixture opens both modals and shows the writes`.
