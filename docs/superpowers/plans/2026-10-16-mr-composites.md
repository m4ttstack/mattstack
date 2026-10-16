# MR Composite Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add composite MR tools: `respond_post_execute`, `mr_posted_since`, `mr_resolve_branch`, the `mr_threads` human filter, `mr_create {ifExists}`, live `mr_map`, `mr_rebase {wait}`, and drop `mr_view`'s `maxAgeMs`. The review and forge skills can then stop drawing outward-action bookkeeping.

**Architecture:** A new `lib/mcp/mr-composite-tools.ts` holds the pure helpers and `mrCompositeToolDefs(deps)`. Every daemon, git, run-db and gate call goes through an injected `MrCompositeDeps`, so tests need no daemon. `mr_create` and `mr_rebase` stay in `lib/mcp/tools.ts` and call helpers from the new file. `mr_map` moves into it. The run db is reached only through the existing `runToolDefs()` handlers, which keeps runDb confinement.

**Tech Stack:** Bun, TypeScript, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-10-16-mr-composites-design.md` (read it with this plan).

## Global Constraints

- **Write fence:** only these paths:
  - `lib/mcp/mr-read-tools.ts`, `lib/mcp/mr-target.ts`,
    `lib/mcp/forge-read-tools.ts`, `lib/mcp/mr-composite-tools.ts`, `lib/mr-map.ts`;
  - the MR handlers in `lib/mcp/tools.ts`, with one contiguous registration
    `...mrCompositeToolDefs()`;
  - the `__tests__` beside them, `docs/superpowers/`, `.superpowers/`;
  - plus `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated)
    and the version line of `plugins/mattstack/.claude-plugin/plugin.json`
    (patch bump), both in Task 9 only.
- **No skill edits.** No file under `plugins/mattstack` except the two
  above. Not `mr_retry`, `mr_upload` or `run-tools.ts`.
- Run `bun test` from the worktree root, and only on the files touched.
- Every tool description starts `GitLab only.`. Every repo-taking tool appends `REPO_NAME_RULE`.
- **GitHub refusal:** each new or changed path refuses a `github.com`
  identity before any call. The error is `GitLab only: <tool> does not speak
  GitHub; <gh move>`, using the gh moves in the spec's GitHub table.
- **Comments:** only a comment that states a constraint the code cannot show (clean-code rule).
- **Commits:** imperative and short, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No ticket ids.

## Review Focus

- **A pane dies mid-batch and the call re-runs.** No reply posts twice. The
  posted-already read finds it (Task 8 test
  `re-run after a partial pass posts nothing twice`).
- **A posted note differs from the due body only in trailing whitespace or
  CRLF.** It still counts as posted (Task 2 test
  `bodies match across CRLF and trailing space`).
- **Thread ids that prefix each other (`T1`, `T10`).** Picks parse at the
  first `:` and compare ids exactly (Task 7 test
  `T1 and T10 picks never cross`).
- **GitLab errors on a reply that actually landed.** The re-read before the
  retry counts it posted, with no second post (Task 8 test
  `a reply that errored but landed is counted, not retried`).
- **Branches that prefix each other (`foo-1`, `foo-10`) and two trees on one
  branch.** The join stays exact (Task 4 test
  `branches that prefix each other join exactly`).

---

### Task 1: Human-thread filter and `mr_view` without `maxAgeMs`

**Files:**
- Modify: `lib/mcp/mr-read-tools.ts` (`mr_threads`, `mr_view`)
- Test: `lib/mcp/__tests__/mr-read-tools.test.ts`

**Interfaces:**
- Produces:
  - `export function isBotUsername(username: string): boolean`
  - `export function filterHumanThreads(discussions: Discussion[]): { discussions: Discussion[]; dropped: { resolved: number; system: number; bot: number } }`

  `Discussion` is from `packages/glance/src/types.ts`, via rt-client's export.

- [ ] **Step 1: Write the failing tests**
  - `isBotUsername`:
    - true for `project_12_bot_ab12cd`, `GROUP_3_BOT`, `ghost`,
      `renovate-bot`, `danger_bot` and `dependabot[bot]`;
    - false for `abbot`, `robot`, `bottomley`, `alice` and `bot-maker`.
  - `filterHumanThreads`, on fixtures:
    - It drops a `resolved: true` discussion, one whose first note has
      `system: true`, and one whose first note's author is `renovate-bot`.
    - It keeps a non-resolvable human comment and an unresolved human thread.
    - Inside a kept thread it drops a system note.
    - `dropped` equals `{resolved: 1, system: 1, bot: 1}`.
  - `mr_threads {repoName: ID, iid: 2, filter: "unresolved-human"}` returns
    the filtered discussions plus `dropped`.
  - `mr_threads` with `filter: "all"` errors: `"filter" must be unresolved-human`.
  - The `mr_view` schema has no `maxAgeMs` property.
  - `mr_view {repoName: ID, iid: 2, maxAgeMs: "x"}` still succeeds and does
    not send `maxAgeMs`, because undeclared keys pass through Claude Code.

- [ ] **Step 2: Run, expect FAIL**

  Run `bun test lib/mcp/__tests__/mr-read-tools.test.ts`. The new tests should fail.

- [ ] **Step 3: Implement**
  - Bot rule:
    `/^(project|group)_\d+_bot/i`, or `/^ghost$/i`, or `/[-_]bot$/i`, or `/\[bot\]$/i`.
  - Add `filter: { type: "string", enum: ["unresolved-human"] }` to `mr_threads`.
  - Remove `maxAgeMs` from `mr_view`'s schema and its `checkOptional`.
  - Update the existing "old maxAgeMs and refresh arguments" test. `mr_view`
    no longer type-checks `maxAgeMs`; `mr_list` and `mr_pipeline` still do.

- [ ] **Step 4: Run, expect PASS** (same command)

- [ ] **Step 5: Commit**

  `mr_threads: unresolved-human filter with the username bot rule; mr_view drops maxAgeMs`

---

### Task 2: Composite file, GitHub refusal, `mr_posted_since`

**Files:**
- Create: `lib/mcp/mr-composite-tools.ts`
- Modify: `lib/mcp/tools.ts` (import and spread `...mrCompositeToolDefs()` once, beside `...mrReadToolDefs()`)
- Test: create `lib/mcp/__tests__/mr-composite-tools.test.ts`. Modify `lib/mcp/__tests__/tools.test.ts` to add `mr_posted_since` to `NAMES`.

**Interfaces:**
- Consumes: `resolveRepoTarget` and `resolveMrTarget` (`mr-target.ts`), and `ok`/`err`/`MR_TARGET_PROPS`/`REPO_NAME_RULE` (`shared.ts`).
- Produces:
  ```ts
  export interface MrCompositeDeps {
    command: typeof rtCommand;
    readMrCache: typeof readProjectMRs;
    runTool: (name: "run_snapshot" | "run_decision" | "run_field_set", input: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<ToolResult>;
    git: GitRunner;                 // from git-tools.ts
    guard: TreeGuardDeps;           // from tree-guard.ts
    status: (path: string) => Promise<string>;   // git status --porcelain stdout
    sleep: (ms: number) => Promise<void>;
  }
  export const realMrCompositeDeps: MrCompositeDeps
  export function mrCompositeToolDefs(deps?: MrCompositeDeps): McpToolDef[]
  export function githubRefusal(identity: string, tool: string, ghMove: string): string | null
  export function normalizeBody(s: string): string           // CRLF to LF, trim each line's trailing spaces, trim ends
  export async function selfUsername(deps: MrCompositeDeps, identity: string): Promise<{ ok: true; username: string } | { ok: false; error: string }>
  export function postedMatch(discussions: Discussion[], q: { by: string; since: number; threads?: Array<{ discussionId: string; body?: string }>; items?: Array<{ id: string; body?: string; contains?: string; path?: string; line?: number }> }): { threads: ThreadPosted[]; items: ItemPosted[]; notes: PostedNote[] }
  ```
  - `ThreadPosted = { discussionId; found: boolean; posted: boolean; noteId: number | null; via: "body" | "author" | null }`.
  - `ItemPosted = { id; posted: boolean; noteId: number | null; discussionId: string | null }`.
  - `PostedNote = { noteId; discussionId; createdAt; path: string | null; line: number | null; body }`, with `body` cut at 2000 characters.
  - `realMrCompositeDeps` wires:
    - `runTool` to `runToolDefs()`'s handler of that name;
    - `git` to `realGitRunner`, and `guard` to `realTreeGuardDeps`;
    - `status` to `statusPorcelainAsync`, and `sleep` to `Bun.sleep`.
  - `selfUsername` sends `forge:get {repoName, path: "user"}` and reads `data.body.username`.
  - `githubRefusal` returns the error string when `parseIdentity(identity)` is a remote whose id starts `github.com/`, else null.

- [ ] **Step 1: Write the failing tests** (fake `command` recording calls, as in `mr-read-tools.test.ts`)
  - `bodies match across CRLF and trailing space`:
    `normalizeBody("a  \r\nb\r\n") === normalizeBody("a\nb")`.
  - `postedMatch` on threads:
    - A body-equal note by any author, at any time, reads `via: "body"`.
    - Otherwise a note by `by` with `createdAt` after `since` reads
      `via: "author"`.
    - A note by `by` before `since` does not count.
    - An unknown discussion id reads `found: false, posted: false`.
  - `postedMatch` on items:
    - `contains` matches a summary note by `by` after `since`.
    - `path`/`line` must equal the note's `position.newPath`/`newLine`.
    - A system note never matches.
  - The `mr_posted_since` handler:
    - With `by` omitted, it sends `forge:get` with `path: "user"`, then
      `discussions:refresh`.
    - `since` accepts `1792000000000` or `"2026-10-16T10:00:00Z"`, and
      refuses `"yesterday"`.
    - It refuses a call with neither `threads` nor `items`.
    - A GitHub identity (`remote:github.com%2Facme%2Fapp`) errors with
      `GitLab only: mr_posted_since does not speak GitHub` before any command.
    - A `discussions:refresh` error passes through verbatim.

- [ ] **Step 2: Run, expect FAIL**

  Run `bun test lib/mcp/__tests__/mr-composite-tools.test.ts lib/mcp/__tests__/tools.test.ts`.

- [ ] **Step 3: Implement** the file, the `mr_posted_since` tool and its registration. The schema is `{...MR_TARGET_PROPS, since, by, threads, items}`. `shellForms: { none: "..." }`.

- [ ] **Step 4: Run, expect PASS** (same command)

- [ ] **Step 5: Commit**

  `mcp: add mr-composite-tools with mr_posted_since and the GitHub refusal`

---

### Task 3: `mr_resolve_branch`

**Files:** Modify `lib/mcp/mr-composite-tools.ts`, `lib/mcp/__tests__/mr-composite-tools.test.ts`, `lib/mcp/__tests__/tools.test.ts` (`NAMES`).

**Interfaces:** Produces the tool `mr_resolve_branch {...MR_TARGET_PROPS}`, which returns `{iid, state, title, author: username, sourceBranch, targetBranch, webUrl, trees: [{name, path}]}`.

- [ ] **Step 1: Failing tests**
  - `mr:get` returns `sourceBranch: "feat-x"`. `worktree:list` returns trees
    on `feat-x`, `feat-x-2` and `main`. `trees` must equal the `feat-x` tree
    only.
  - Two trees on `feat-x` return both.
  - No tree returns `trees: []`.
  - The `worktree:list` payload is `{repoName: ID}`.
  - A merged MR still resolves, with `state: "merged"`.
  - GitHub refuses with `gh pr view <n> --json headRefName`.
  - A `mr:get` error passes through.
- [ ] **Step 2: Run, expect FAIL**

  Run `bun test lib/mcp/__tests__/mr-composite-tools.test.ts`.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

  `mcp: add mr_resolve_branch (MR to branch and registered trees)`

---

### Task 4: Live `mr_map`

**Files:**
- Modify: `lib/mr-map.ts`, `lib/mcp/mr-composite-tools.ts` (the tool moves here)
- Modify: `lib/mcp/tools.ts`: delete the `mr_map` entry and `resolveRepoIdentity`. Drop now-unused imports (`repoLabel`, `reverseLookupByName`, `joinMrsToWorktrees`, `parseIdentity` if unused).
- Test: `lib/__tests__/mr-map.test.ts` (extend), `lib/mcp/__tests__/mr-composite-tools.test.ts`, and `lib/mcp/__tests__/tools.test.ts`. That file's `mr_map` `field: "repo"` row becomes `field: "repoName"`; the roster keeps `mr_map`.

**Interfaces:**
- Produces:
  ```ts
  export interface MrMapRow { ref: string; iid: number; title: string; author: string | null; sourceBranch: string; targetBranch: string;
    draft: boolean; stacked: boolean | null; worktree: string | null; dirty: boolean | null; mrState: string; ciStatus: string | null }
  export function joinMrsToWorktrees(
    mrs: Array<{ iid: number; title: string; author: string | null; sourceBranch: string; targetBranch: string; draft: boolean; state: string }>,
    trees: Array<{ path: string; branch: string | null }>,
    opts: { defaultBranch: string | null; ciStatus: (iid: number) => string | null },
  ): Omit<MrMapRow, "dirty">[]
  ```
  The tool is `mr_map {repoName | mrUrl | repo (legacy), author?}` and returns `{rows: MrMapRow[], complete: boolean}`.

- [ ] **Step 1: Failing tests**
  - Join:
    - `branches that prefix each other join exactly`: `foo-1` must not join
      `foo-10`. With two trees on one branch the last one wins, as today.
    - `stacked` is null when `defaultBranch` is null, and false when
      `targetBranch === defaultBranch`.
  - Tool:
    - It sends `mr:list-live {repoName: ID, state: "opened", limit: 200,
      author: "me"}` when `author: "me"` is passed.
    - `complete` is `!truncated`.
    - `forge:get {path: "projects/:id"}` gives `default_branch`. When that
      read fails, `stacked` is null and the call still succeeds.
    - `dirty` is true for porcelain output `" M x"` and false for `""`. It is
      null when `status` throws, and null for a row with no tree.
    - `ciStatus` comes from a `readMrCache` hit, and is null on a miss or a
      cache error.
    - `{repo: ID}` works like `{repoName: ID}`. Passing both refuses with
      `pass repoName, not both repoName and repo`.
    - GitHub refuses with `gh pr list --author @me`.
- [ ] **Step 2: Run, expect FAIL**

  Run `bun test lib/__tests__/mr-map.test.ts lib/mcp/__tests__/mr-composite-tools.test.ts lib/mcp/__tests__/tools.test.ts`.
- [ ] **Step 3: Implement.** The description says the read is live, carries
  every author unless `author` is passed, and that `complete: false` means
  more than 200 open MRs.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

  `mr_map: live read with author, targetBranch, stacked, dirty and complete; repoName input`

---

### Task 5: `mr_create {ifExists: "return"}`

**Files:** Modify `lib/mcp/mr-composite-tools.ts` (helper), the `mr_create` handler in `lib/mcp/tools.ts`, and `lib/mcp/__tests__/mr-composite-tools.test.ts` and `tools.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export async function findOpenMrForBranch(deps: Pick<MrCompositeDeps, "command">, identity: string, sourceBranch: string):
    Promise<{ ok: true; mr: { iid: number; url: string | null; targetBranch: string; draft: boolean; title: string } | null } | { ok: false; error: string }>
  export const EXISTING_MR = /already exists/i   // GitLab's 409 text inside "createPullRequest failed: 409 ..."
  ```
  The handler accepts `ifExists: { type: "string", enum: ["return"] }`.

- [ ] **Step 1: Failing tests**
  - Helper tests use a fake `command` answering `mr:live-by-branch`.
  - Handler tests (`tools.test.ts`, the `mock.module` transport pattern
    already used for `mr_create`):
    - An open MR exists: returns `{iid: 7, url, existing: true, targetBranch,
      draft, title, applied: false}` and never sends `mr:create`.
    - None exists: sends `mr:create`, and the result adds `existing: false`.
    - `mr:create` fails with
      `Error: createPullRequest failed: 409 Conflict — Another open merge request already exists for this source branch: !7`:
      it reads again and returns `existing: true`.
    - A lookup error: returns the error and sends no `mr:create`.
    - Without `ifExists`, the calls are byte-identical to today.
    - GitHub refuses with `gh pr create / gh pr view`.
- [ ] **Step 2: Run, expect FAIL**

  Run `bun test lib/mcp/__tests__/mr-composite-tools.test.ts lib/mcp/__tests__/tools.test.ts`.
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

  `mr_create: ifExists return hands back the open MR on the source branch`

---

### Task 6: `mr_rebase {wait: true}`

**Files:** Modify `lib/mcp/mr-composite-tools.ts` (helper), the `mr_rebase` handler in `lib/mcp/tools.ts`, and the tests as in Task 5.

**Interfaces:**
- Produces:
  ```ts
  export type RebaseWaitResult =
    | { status: "rebased"; sha: string | null; previousSha: string | null }
    | { status: "failed"; mergeError: string | null; conflicts: boolean; sha: string | null }
    | { status: "current" | "unchanged"; sha: string | null }
    | { status: "pending"; sha: string | null; rebaseInProgress: boolean; lastError?: string };
  export async function waitForRebase(deps: Pick<MrCompositeDeps, "command" | "sleep">, target: { identity: string; iid: number },
    previousSha: string | null, opts: { maxWaitMs: number; pollMs: number; signal?: AbortSignal; progress?: () => void }): Promise<RebaseWaitResult>
  export const REBASE_POLL_MS = 5_000; export const REBASE_DEFAULT_WAIT_S = 90; export const REBASE_MAX_WAIT_S = 600;
  ```
  - The handler accepts `wait: boolean` and `maxWaitSeconds: number` (an
    integer from 1 to 600).
  - With `wait`, it reads `mr:get` for `previousSha`, sends `mr:action
    rebase`, then calls `waitForRebase`, passing the handler's `signal` and
    `progress`.

- [ ] **Step 1: Failing tests** (`waitForRebase` with a scripted `mr:get` sequence and a `sleep` that records calls)
  - `[inProgress, sha changed]` gives `rebased`.
  - `[mergeError "conflict"]` gives `failed`.
  - Unchanged sha, `divergedCommitsCount: 0` and not in progress gives
    `current`.
  - `divergedCommitsCount: null` and unchanged for two polls gives `unchanged`.
  - `divergedCommitsCount: 3` unchanged until the budget runs out gives
    `pending`.
  - A poll error then a sha change gives `rebased`. A poll error at the end
    of the budget gives `pending` with `lastError`.
  - An aborted signal stops early with `pending`.
  - `progress` is called once per poll.
  - Handler:
    - Without `wait` it is unchanged (`{rebased: true}`).
    - `maxWaitSeconds: 601` refuses.
    - GitHub refuses with `no server-side rebase on GitHub`.
- [ ] **Step 2: Run, expect FAIL**

  Run `bun test lib/mcp/__tests__/mr-composite-tools.test.ts lib/mcp/__tests__/tools.test.ts`.
- [ ] **Step 3: Implement.** "Unchanged" means `sha === previousSha`. The
  `unchanged` status needs two consecutive settled reads.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

  `mr_rebase: wait polls the MR until it rebased, failed, was current or the budget ran out`

---

### Task 7: `respond_post_execute`, the decision reader (pure)

**Files:** Modify `lib/mcp/mr-composite-tools.ts`. Test: create `lib/mcp/__tests__/respond-post-plan.test.ts`.

**Interfaces:**
- Consumes: the snapshot JSON shape the run tools return:
  - `run.started_at`;
  - `fields[{key, value, at}]`;
  - `decisions[{contract, scope, selection: JSON string, decided_by, decided_at}]`.

  It also consumes `GateRow` (`packages/rt-client/src/commands.ts`).
- Produces:
  ```ts
  export interface PostAction { threadId: string; verb: "fix" | "override" | "reply"; post: boolean; resolve: boolean; body: string | null }
  export interface RespondPostPlan {
    mrUrl: string; branch: string | null; startedAt: number;
    actions: PostAction[];             // offered threads in open order, then reply rows in plan order
    postDecision: { selection: Record<string, unknown>; decidedBy: string } | null;
    heldResume: string[] | null;       // the record's prior held list, when present
  }
  export function gateSourceField(fields: SnapshotField[], scope: "respond-plan" | "respond-post"): { gate: string | null; source: { questions: unknown[] }; at: number } | null
  export function planRespondPost(snapshot: RunSnapshot, gates: { plan: GateRow | null; post: GateRow | null }):
    { ok: true; plan: RespondPostPlan } | { ok: false; error: string }
  ```
  - `gates.plan`/`gates.post` are the registry rows the caller fetched for
    the source fields' gate ids (null for `gate: null`).
  - A source field whose gate is non-null but whose row could not be read
    never reaches this function; the executor refuses first.

- [ ] **Step 1: Failing tests**

  Fixtures are built from the shapes in
  `plugins/mattstack/attachments/review/receive-review/tests/fixtures/plan-source.json`
  and `post-source.json`. Copy the shapes into the test file; never import
  from `plugins/`.
  - Happy path: plan `{T1: fix, T2: reply}`, post `{T1: {post, resolve}}`.
    The actions are the T1 fix (body = card `reply@1.text`), then the T2
    reply (body = plan card `reply.text`, kind verbatim, resolve false).
  - Edited text: post entry `text` wins over the card text. Plan
    `texts[T2]` wins over the card.
  - Freshness:
    - A plan decision with `decided_at` before the plan gate row's
      `openedAt` refuses with `respond-plan has no decision recorded since
      its gate opened`.
    - With `gate: null`, the threshold is the field's `at`.
  - Nothing offered: there is no respond-post field, or one written before
    the plan decision. The result is reply rows only and
    `postDecision: null`.
  - A respond-post field newer than the plan decision, with no respond-post
    decision, refuses.
  - The registry cross-check refuses on each of these:
    - the post row is not `answered`;
    - `next` is `hold`;
    - the answer picks `["post:T1"]` but the decision has `resolve: true`;
    - the answer `{value: ["post:T1"], text: "X"}` but the decision text
      differs;
    - the plan answer is `reply:T2` but the decision says `skip`.
  - `T1 and T10 picks never cross`: the answer `["post:T10"]` with decision
    `{T1: {post: false}, T10: {post: true}}` is accepted.
  - Missing entries and unseen words refuse:
    - an offered thread with no selection entry refuses as a mismatch;
    - a reply row whose card `reply.kind` is `direction`, with no
      `texts[id]` and not in `overrides`, refuses naming the thread;
    - when the source names a gate, a card text absent from the registry
      row's question context refuses.
  - The retired shape (`replies`, or no `threads`) refuses.
  - A run with no `extra.gate-source.respond-plan` refuses with an error
    naming `gate_open {runDb}`.
  - There is no `mr` field, or `mr` is a `github.com/.../pull/3` URL: each
    refuses (the GitHub one with the `gh` reply/resolve wording).
  - The held resume: a post decision with `held: ["T1"]` gives
    `heldResume: ["T1"]`.
- [ ] **Step 2: Run, expect FAIL**

  Run `bun test lib/mcp/__tests__/respond-post-plan.test.ts`.
- [ ] **Step 3: Implement.**
  - Unwrap a pick `{value, note, text}` to `value`, and a string to a
    one-element array.
  - Split each value at the first `:`.
  - Key every comparison by the thread id in the value, never by the
    question id.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

  `respond_post_execute: read and check the recorded respond-plan and respond-post decisions`

---

### Task 8: `respond_post_execute`, the executor and the tool

**Files:** Modify `lib/mcp/mr-composite-tools.ts` and `lib/mcp/__tests__/tools.test.ts` (`NAMES`). Test: create `lib/mcp/__tests__/respond-post-execute.test.ts`.

**Interfaces:**
- Consumes: `planRespondPost` (Task 7); `selfUsername`, `postedMatch` and `normalizeBody` (Task 2); `checkRegisteredTree`, `currentBranch` and `gitPush`.
- Produces:
  ```ts
  export interface RespondPostResult { mr: string; pushed: { branch: string } | null; posted: string[]; alreadyPosted: Array<{ threadId: string; noteId: number }>;
    resolved: string[]; alreadyResolved: string[]; held: Array<{ threadId: string; kind: "read" | "mismatch" | "push" | "reply" | "resolve"; error: string }>;
    recorded: boolean; hold: "held" | null }
  export async function executeRespondPost(deps: MrCompositeDeps, input: { runDb: string; tree: string; stage: string }, env: NodeJS.ProcessEnv): Promise<ToolResult>
  ```
  The tool is `respond_post_execute {runDb, tree, stage}` (all required strings).

- [ ] **Step 1: Failing tests** (a fake deps object: scripted `command` per verb, `runTool` over an in-memory snapshot that records decision and field writes, a scripted `git`, and `guard` admitting `/w`)
  - Reading:
    - It reads `run_snapshot {runDb}`, then `gate:wait {id, waitMs: 0}`
      for each non-null gate id.
    - A `gate:wait` returning `{status: "timeout"}` refuses with `gate
      <id> is still open`.
  - Push, when the fix row is picked:
    - Both git reads match, so it pushes once. `pushed: {branch: "feat-x"}`
      and the replies post.
    - `@{push}` prints `upstream/feat-x`, so T1 is held with kind
      `mismatch` and both outputs in `error`. The T2 reply still posts and
      no push is sent.
    - The push fails twice, so T1 is held with kind `push` and git's text.
      The push fails then succeeds, so it is pushed.
    - With no fix row picked, `git` is never called.
  - Replies:
    - `a reply that errored but landed is counted, not retried`: the first
      `discussions:reply` errors, and the re-read shows a note whose body
      matches. The result is `posted` with one reply sent.
    - The reply errors twice, so the thread is held with kind `reply` and
      its resolve is skipped.
    - The resolve errors twice, so the thread is held with kind `resolve`.
    - The read showed the thread resolved, so it counts as
      `alreadyResolved` and no resolve is sent.
  - `re-run after a partial pass posts nothing twice`: the read shows T1 and
    T2 already carrying their bodies. The result is `alreadyPosted` both,
    with zero `discussions:reply`.
  - The read fails: every thread is held with kind `read`. No push, reply,
    resolve or decision write happens, and `run_field_set {key: "hold",
    value: "held", stage}` is written.
  - Record:
    - After a held pass, `run_decision` re-records scope `respond-post`
      with the same `decidedBy` and `held: ["T1"]`.
    - A clean pass re-records with no `held` key.
    - With no post decision, there is no `run_decision` call.
  - Held resume: a record with `held: ["T2"]` acts on T2 only and pushes
    only when T2 is a fix row.
  - It never writes a `hold:` scoped decision, and never clears `hold`.
  - It refuses before any outward call when a push is due and the tree is
    unregistered.
- [ ] **Step 2: Run, expect FAIL**

  Run `bun test lib/mcp/__tests__/respond-post-execute.test.ts lib/mcp/__tests__/tools.test.ts`.
- [ ] **Step 3: Implement the executor and register the tool.**
  - The description states, in this order:
    - it acts only on the recorded and checked decisions;
    - pushes, replies and resolves are each retried once;
    - `held[]` and the hold field come back for the skill's off-script
      gates;
    - it is GitLab only.
  - `shellForms: { none: "composes git_push, mr_reply_thread and mr_resolve_thread; no single shell command is equivalent" }`.
  - Call `progress?.()` after each outward call.
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit**

  `mcp: add respond_post_execute (push, reply, resolve on the recorded decision; held[] back)`

---

### Task 9: Reference, version and full verification

**Files:** Modify `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated) and the `version` line of `plugins/mattstack/.claude-plugin/plugin.json` (patch +1). Add `.superpowers/report-draft.md`.

- [ ] **Step 1: Regenerate the reference**

  Run `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`.

  Expected: the diff touches only the tools this plan added or changed.
- [ ] **Step 2: Bump the patch version** in `plugin.json` (0.31.6 to 0.31.7 today; if main has moved, take the next patch above main's). Nothing else in the
  file changes.
- [ ] **Step 3: Run the verification set** (each must pass):

  ```
  bun test lib/mcp/__tests__/mr-read-tools.test.ts lib/mcp/__tests__/mr-target.test.ts lib/mcp/__tests__/forge-read-tools.test.ts lib/mcp/__tests__/tools.test.ts lib/mcp/__tests__/no-unredacted-mcp-output.test.ts
  bun test lib/mcp/__tests__/mr-composite-tools.test.ts lib/mcp/__tests__/respond-post-plan.test.ts lib/mcp/__tests__/respond-post-execute.test.ts lib/__tests__/mr-map.test.ts
  bun run check
  bun run purity
  sh plugins/mattstack/tests/test-mcp-tools-reference.sh
  ```

  `test-mcp-tools-reference.sh` uses the `rt` on PATH; it is allowed to
  skip, because CI's `bun cli.ts` step is the gate.
- [ ] **Step 4: Commit**

  `mattstack plugin: regenerate the MCP tool reference and bump the patch version`
