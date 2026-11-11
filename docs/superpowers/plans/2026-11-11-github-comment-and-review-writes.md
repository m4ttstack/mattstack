# GitHub Through the Daemon, Plan B: Comment, Thread and Review Writes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mr_threads`, `mr_comment`, `mr_comment_inline`, `mr_reply_thread`, `mr_resolve_thread`, `mr_update_note` and `mr_review_submit` work on a GitHub repo, through glance write methods on `GitProvider` and the daemon's forge router.

**Architecture:** glance gains forge-neutral comment, reply, edit, delete and whole-review methods on `GitProvider`: the GitLab side wraps today's `NoteMutator` calls and the moved draft-note review flow, the GitHub side uses Octokit. GitHub thread reads gain review summaries, correct sides and old paths, and a bot mark. The daemon's thread handlers stop building `NoteMutator` and reading `gitlabToken`; they take the provider from `getRepoContext`. The MCP thread tools then accept a GitHub target.

**Tech Stack:** TypeScript, Bun, `@mattstack/glance` (Octokit, gitbeaker, `NoteMutator`), the rt daemon, the rt MCP server.

**Spec:** `docs/superpowers/specs/2026-11-10-daemon-forge-router-design.md`, sections 6 and 7 and the third Delivery item. Plan A (`docs/superpowers/plans/2026-11-10-github-daemon-reads-and-router.md`) is merged; its "Carried into PR 2" facts hold here.

## Global Constraints

- GitLab behaviour must not change: same success replies, same error strings, same request counts and order for every GitLab input. Two stated differences, both from one cause: glance's GitLab write methods address the project by its URL-encoded path (`/projects/group%2Fproj/...`) where the daemon used the numeric id (same endpoint, same request count, same replies), so `fetchDiffRefs`'s rare `merge request !<iid> in project <project> has no diff_refs yet` names the path instead of the number.
- glance uses Octokit for GitHub. No new raw `fetch`: the GitLab side reuses `NoteMutator` (allowed raw HTTP) and the daemon's GitLab diffs read goes through `GitLabProvider.restRequest`.
- A token only ever goes to its own forge's host: the handlers get providers from `getRepoContext`, never from `loadSecrets`.
- Every GitHub write sends `retries: 0` (the client forces it centrally for non-GET verbs; tests prove it) and an abort signal: 15 s per comment write and 60 s for the review POST, set by new `GitHubProvider` constructor options `writeTimeoutMs` and `reviewTimeoutMs` (those defaults). A timed-out write throws an error whose message says GitHub may still have applied it and to check the pull request before retrying.
- Daemon reply shapes do not change. `noteId` stays a number on both forges. `mr:review-submit` keeps its two outcomes (`comment`, `approve`).
- No live forge calls and no live conformance run. Tests stub `fetch` or the provider. Never stage or print `packages/glance/harness_credentials.json`; nothing points at `m4ttheweric/gitq-test-sandbox`.
- `packages/glance`: `bun test`, `bun run check-types`, `bun run check:node` clean before every commit, run from `packages/glance`; `bun run build` there after any `src` change a later rt test consumes.
- rt-root tests run from the repo root (`bun test <file>`), only the files a task touches. Never run rt, the daemon or a built binary against the real HOME.
- No em or en dashes in code, comments, docs or copy. A comment states a constraint the code cannot show. Refusal wording follows `rt:ui-copy`.
- One commit per task, prefixed `glance:`, `daemon:` or `mcp:`, ending with a `Co-Authored-By:` line naming the model that wrote it. Stage named files only.
- Write fence: only the paths the job brief lists plus the ones Matt adds through the fence gate (Task 0). Leave `mr_upload`, `evidence_attach`, `lib/daemon/handlers/mr.ts`, `lib/daemon/handlers/project-mrs.ts` and `lib/daemon/handlers/mr-upload.ts` alone. Keep edits to `lib/mcp/tools.ts`, `.claude/rules/mcp-and-gates.md`, the mcp-tools reference and the plugin version small: the gh-evidence lane edits them too.

## Where this plan departs from the spec

Each is a builder's call the spec leaves open, or a fact the spec missed. The final report lists them.

1. **`repositoryId` on GitHub is `github:<owner>/<repo>`**, from a function `repositoryIdFor(ctx)`, not a context field. GitHub `fetchMRDiscussions` with the numeric form reads `GET /repositories/{id}` on every call, so the spec's cost line ("two paged REST lists and one GraphQL call") was one request short. The numeric form keeps working for other callers.
2. **`CommentAnchor.line` is optional** (one of `line`, `oldLine` is required). The spec's "a comment with only an old line goes on side LEFT" needs an anchor with no new line.
3. **`InlineCommentResult` adds `anchored` and `noteType`**, and glance exports `EmptyDiscussionError`. GitLab's degrade-and-retry stays in the daemon with today's exact copy, and needs both.
4. **`NoteRef.kind` adds `"review"`**: review summaries become notes in this same change, and `mr:review-submit` returns one as `summaryNoteId`.
5. **The GitLab diffs read stays a daemon REST read**, through `GitLabProvider.restRequest` so the handler no longer reads the token. gitbeaker would change its error text, which no Decided item accepts. GitHub gets `fetchPullRequestDiffs`.
6. **A GitHub approve on one's own PR** (GitHub answers 422) posts the review as a comment and reports `approved: false` with `approveError`, the result GitLab gives for a refused approval.
7. **Reply failures in a GitHub review** come back in an optional `replyErrors` field (spec: "each failure is reported per reply"); GitLab never sets it.
8. **Live cases are written, not run.** The job forbids a live run; the report asks for one before 0.30.0 publishes.

## Review Focus

1. A GitHub write that times out or loses its response: exactly one request goes out, and the error says the comment may have landed. (Task 2)
2. `mr_update_note` on GitHub with a `noteId` from another PR in the same repo and no known kind: refused, nothing edited. (Task 2)
3. `mr_review_submit` with `outcome: "approve"` on a GitHub PR the token's user authored: one review posts, `approved: false`, `approveError` carries GitHub's reason, never two reviews. (Task 3)
4. A GitHub review whose reply targets a PR-level comment or a review summary: refused before anything posts. (Task 3)
5. A new GitHub comment by the signed-in user, by a bot, or by a deleted user: no notification for the first two, no crash for the third. (Task 4, Task 6)

---

## Task 0: Widen the write fence (done)

Answered by the shepherd on 2026-11-11: all of the files below are in the fence. In every rewritten GitLab thread test, each expected reply and error string stays byte for byte what the file asserts today; any that has to change is reported with its before and after.

- `lib/daemon/review-submit.ts` (`submitReview` moves to glance; parsing and anchoring stay).
- `lib/daemon/__tests__/discussions-comment-inline.test.ts`, `discussions-comment.test.ts`, `discussions-diffs.test.ts`, `discussions-note-update.test.ts`, `discussions-review-submit.test.ts`, `review-submit.test.ts`, `discussions-file-store.test.ts`, `freshness-forge-router.test.ts`, and new files `discussions-github.test.ts`, `discussions-notify-forge.test.ts` there.
- `apps/gitq/tests/forge-sync.test.ts`, `apps/gitq/tests/integration/network-failure.test.ts`, `apps/gitq/tests/integration/forge-sync-smoke.test.ts`, `apps/gitq/tests/integration/drift-reconciliation-smoke.test.ts` (their full `GitProvider` mocks need the new members and flags).

---

## Glance: comment and review writes, thread fidelity (0.30.0)

### Task 1: Shared types, capabilities, path-addressed `NoteMutator`, GitHub diffs read

**Files:**
- Modify: `packages/glance/src/types.ts`, `src/errors.ts`, `src/index.ts`, `src/NoteMutator.ts`, `src/GitHubProvider.ts`, `src/GitLabProvider.ts` (capabilities only), `src/GitProvider.ts` (`fetchPullRequestDiffs?` only)
- Modify: `packages/glance/tests/live/expectations.ts`, `tests/live-expectations.test.ts`, the four gitq mocks (Task 0)
- Test: `packages/glance/tests/note-mutator.test.ts`, `tests/gh-pr-diffs.test.ts` (new), `tests/forge-reads-interface.test.ts`

**Interfaces, produced:**

```ts
// types.ts
export interface CommentAnchor { path: string; line?: number; oldPath?: string; oldLine?: number } // at least one of line, oldLine
export type NoteKind = 'general' | 'diff' | 'review';
export interface NoteRef { id: number; kind?: NoteKind }
export interface NoteWriteResult { noteId: number; discussionId: string | null; resolvable: boolean; url: string }
export interface InlineCommentResult extends NoteWriteResult { discussionId: string; anchored: boolean; noteType: string | null }
export interface ReviewComment extends CommentAnchor { body: string }
export interface ReviewReply { discussionId: string; body?: string; resolve: boolean }
export interface ReviewSubmission { outcome: 'comment' | 'approve' | 'request_changes'; summary: string; comments: ReviewComment[]; replies: ReviewReply[] }
export type ReviewSubmitResult =
  | { published: false; reason: 'pending-drafts'; pending: { count: number; firstLines: string[] } }
  | { published: false; reason: 'bad-anchors'; badAnchors: Array<{ index: number; path: string; line: number }> }
  | { published: true; comments: number; replies: number; repliedTo: string[]; resolved: string[]; approved: boolean;
      approveError?: string; resolveErrors: Array<{ discussionId: string; error: string }>;
      replyErrors?: Array<{ discussionId: string; error: string }>; reviewId: number | null; reviewerState: string | null };
export interface PullRequestFileDiff { newPath: string; oldPath?: string; diff: string; collapsed?: boolean; tooLarge?: boolean }
// NoteAuthor gains: bot?: boolean   (GitHub sets it; GitLab leaves it absent)

// errors.ts
export class EmptyDiscussionError extends Error { readonly discussionId: string } // GitLab created a discussion with no notes

// ProviderCapabilities gains: canReplyToGeneralComments, canRequestChanges, canFetchPullRequestDiffs
// GitProvider gains (optional):
fetchPullRequestDiffs?(projectPath: string, mrIid: number, options?: { signal?: AbortSignal }): Promise<{ diffs: PullRequestFileDiff[]; truncated: boolean }>;
```

- `badAnchors[].line` is the comment's `line ?? oldLine`.
- Flags: `canReplyToGeneralComments` GitLab true, GitHub false; `canRequestChanges` true on both; `canFetchPullRequestDiffs` GitHub true, GitLab false (its read stays in the daemon, departure 5). gitq mocks get all three as `false`.
- `NoteMutator`: every `projectId: number` parameter becomes `project: number | string`; a string is a project path, sent as `encodeURIComponent(project)`. A number builds the exact URL it builds today.
- `fetchPullRequestDiffs` on GitHub: one `GET /repos/{o}/{r}/pulls/{n}/files` with `per_page: 100` (no paging; `truncated` when 100 rows come back, GitLab's rule), `request: { signal }`. Row: `newPath` = `filename`, `oldPath` = `previous_filename` (absent when not renamed), `diff` = `patch ?? ''`, `tooLarge: true` when `patch` is absent. Errors through `forgeRead`.

- [ ] **Step 1:** In `note-mutator.test.ts`, add: `createNote('group/proj', 7, 'b')` posts to `/api/v4/projects/group%2Fproj/merge_requests/7/notes`, and `createNote(42, 7, 'b')` still posts to `/projects/42/...`. Write `gh-pr-diffs.test.ts` with `stubForge`: mapping of a renamed file and a binary file (no `patch`), 100 rows give `truncated: true`, 99 give false, exactly 1 request, an aborted signal rejects. In `forge-reads-interface.test.ts`, assert the three new flags per provider and that `fetchPullRequestDiffs` is a function exactly where its flag is true.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement the types, error class, flags, `NoteMutator` widening and the GitHub read; add the expectations entry and the `OPTIONAL` entry for GitLab's absent `fetchPullRequestDiffs`; add the flags to the gitq mocks.
- [ ] **Step 4:** Run the glance suite, `check-types`, `check:node`, `bun run build`, then `bun run check-types` in `apps/gitq`. Expected: PASS.
- [ ] **Step 5:** Commit `glance: types, capabilities and a GitHub diffs read for comment writes`.

### Task 2: Comment, inline, reply, edit and delete on both forges

**Files:**
- Modify: `packages/glance/src/GitProvider.ts`, `src/GitLabProvider.ts`, `src/GitHubProvider.ts`, `src/githubNotes.ts` (new: anchor-to-side mapping, note resolution, write error translation), the expectations, the gitq mocks
- Test: `packages/glance/tests/gitlab-note-writes.test.ts` (new), `tests/gh-note-writes.test.ts` (new)

**Interfaces, produced (required `GitProvider` members):**

```ts
createComment(projectPath: string, mrIid: number, body: string, options?: { resolvable?: boolean }): Promise<NoteWriteResult>;
createInlineComment(projectPath: string, mrIid: number, body: string, anchor: CommentAnchor): Promise<InlineCommentResult>;
replyToDiscussion(projectPath: string, mrIid: number, discussionId: string, body: string): Promise<NoteWriteResult>;
updateComment(projectPath: string, mrIid: number, note: NoteRef, body: string): Promise<void>;
deleteComment(projectPath: string, mrIid: number, note: NoteRef): Promise<void>;
// GitLabProvider only (not on the interface):
fetchReviewerStates(projectPath: string, mrIid: number): Promise<ReviewerState[]>;
// GitHubProvider constructor options gain: writeTimeoutMs?: number (default 15_000), reviewTimeoutMs?: number (default 60_000)
```

GitLab (a private `NoteMutator` built in the constructor from `baseURL`, `token` and `onRequest`; every `NoteMutator` error passes through untouched):

- `createComment`: `resolvable === false` calls `createNote` and returns `discussionId: null`, `resolvable: created.resolvable === true`; otherwise `createDiscussion`, first note, `EmptyDiscussionError(id)` when it has none. `url` = `${baseURL}/${projectPath}/-/merge_requests/${iid}#note_${noteId}`.
- `createInlineComment`: `fetchDiffRefs` then `createPositionedDiscussion` with the position `buildTextPosition` builds today (moved from `handlers/discussions.ts`; an anchor with no `line` builds `{old_path, old_line}` only). Returns `anchored: note.type === 'DiffNote'`, `noteType: note.type`; no notes throws `EmptyDiscussionError`. No retry here.
- `replyToDiscussion`: `createNote` with the discussion id. `updateComment`, `deleteComment`: `updateNote`, `deleteNote` (`kind` ignored).

GitHub (Octokit, `request: { retries: 0, signal: AbortSignal.timeout(this.writeTimeoutMs) }` on every write):

- `createComment`: `POST /repos/{o}/{r}/issues/{n}/comments`; `discussionId` `gh-issue-comment-<id>`, `resolvable: false` whatever the option says, `url` the comment's `html_url`.
- `createInlineComment`: one `GET /pulls/{n}` for `head.sha`, then `POST /pulls/{n}/comments` with `commit_id`, `path`, and `line` + `side: 'RIGHT'` when `anchor.line` is set, else `line: anchor.oldLine` + `side: 'LEFT'`. Returns `discussionId` `gh-review-thread-<id>`, `resolvable: true`, `anchored: true`, `noteType: 'DiffNote'`.
- `replyToDiscussion`: only `gh-review-thread-<root>` ids: `POST /pulls/{n}/comments/{root}/replies`. Any other id throws, before a request, `replyToDiscussion: <id> is a pull request comment with no thread on GitHub; post a new comment instead`.
- `updateComment` / `deleteComment`: `kind: 'diff'` patches or deletes `pulls/comments/{id}`, `'general'` `issues/comments/{id}`, `'review'` `PUT /pulls/{n}/reviews/{id}` (delete of a review throws `GitHub cannot delete a submitted review`). With no `kind`: `GET pulls/comments/{id}`, on 404 `GET issues/comments/{id}`, on 404 throw `no comment <id> on <path>#<n>`; a found comment whose `pull_request_url` or `issue_url` does not end in `/<n>` throws `comment <id> belongs to another pull request`, before any write.
- Failures: `forgeWrite(op, fn)` in `githubNotes.ts` does what `forgeRead` does (rate limit to `RateLimitedError`, HTTP to `ForgeHttpError`) and appends GitHub's `errors` entries to `message` in the detail, joined by `; `. GitHub sends both shapes, and both must be handled: plain strings (the reviews endpoint: `{"message":"Unprocessable Entity","errors":["Can not approve your own pull request"]}`), appended as they are; and objects (comment creation: `{"message":"Validation Failed","errors":[{"resource":"PullRequestReviewComment","code":"custom","field":"pull_request_review_thread.line","message":"pull_request_review_thread.line must be part of the diff"}]}`), appended as their `message`, else `<field> <code>`. Every later check on a GitHub failure reads this full detail, never `data.message` alone. An abort throws the timeout message from Global Constraints, prefixed by `op`.

- [ ] **Step 1:** `gitlab-note-writes.test.ts` with stubbed fetch: each method's request sequence (method, path with `group%2Fproj`, JSON body) equals today's `NoteMutator` sequence; `createComment` both ways; `EmptyDiscussionError` with the discussion id; a 403 from `updateNote` rejects with exactly `updateNote failed: 403 Forbidden`; an inline note of type `null` returns `anchored: false, noteType: null`. `gh-note-writes.test.ts` with `stubForge`: each method's route, body and result; LEFT for an old-line-only anchor, RIGHT otherwise; a 502 on `POST issues/{n}/comments` rejects after exactly 1 request; with `writeTimeoutMs: 50` and the test's own `globalThis.fetch` stub that never answers and rejects when `init.signal` aborts, a POST rejects with the may-have-landed message after exactly 1 request; a 422 with the object-shaped `errors` body above surfaces `must be part of the diff` in the error; reply to `gh-issue-comment-5` and to `gh-review-9` rejects with zero requests; update with no `kind` on a comment whose `pull_request_url` ends `/pulls/8` while `n` is 7 rejects and sends no PATCH; the 404 fallback sends GET diff, GET general, PATCH general.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement; add the members to the interface, expectations (supported on both), and `reject('not implemented')` stubs to the gitq mocks.
- [ ] **Step 4:** Run the glance suite, type checks, `check:node`, build, gitq `check-types`. Expected: PASS.
- [ ] **Step 5:** Commit `glance: comment, reply, edit and delete writes on both forges`.

### Task 3: Whole reviews on both forges

**Files:**
- Create: `packages/glance/src/gitlabReview.ts` (moved from `lib/daemon/review-submit.ts`), `packages/glance/tests/gitlab-review.test.ts` (moved cases)
- Modify: `packages/glance/src/GitProvider.ts`, `src/GitLabProvider.ts`, `src/GitHubProvider.ts`, `src/githubNotes.ts`, the expectations, the gitq mocks
- Test: `packages/glance/tests/gh-review-submit.test.ts` (new)

**Interfaces, produced:**

```ts
submitReview(projectPath: string, mrIid: number, review: ReviewSubmission): Promise<ReviewSubmitResult>; // required GitProvider member
// gitlabReview.ts: today's submitReview, pure over its deps
export interface GitLabReviewDeps { mutator: Pick<NoteMutator, 'fetchDiffRefs' | 'listDraftNotes' | 'createDraftNote' | 'deleteDraftNote' | 'publishDraftNotes'>; project: number | string; iid: number; approve(): Promise<void>; resolve(discussionId: string): Promise<void> }
export function submitGitLabReview(deps: GitLabReviewDeps, review: ReviewSubmission): Promise<ReviewSubmitResult>;
export function buildTextPosition(anchor: CommentAnchor, refs: DiffRefs): TextPosition;
```

GitLab: move `submitReview` and its helpers verbatim; step order, rollback and every error string unchanged. `request_changes` publishes with `reviewerState: 'requested_changes'` and does not approve. The published result adds `reviewId: null, reviewerState: null`. `GitLabProvider.submitReview` wires its `NoteMutator`, `projectPath`, `approvePullRequest` and `resolveDiscussion`.

GitHub, in this order:

1. Every reply's `discussionId` must be `gh-review-thread-<n>`; otherwise throw, before any request, `review not posted: replies[<i>]: <id> has no thread on GitHub; post a new comment instead`.
2. Paginate `GET /pulls/{n}/reviews`. A review in state `PENDING` (only the token's own are visible) returns `pending-drafts`: one `GET /pulls/{n}/reviews/{id}/comments`, `count` = its comment count or 1 when it has none, `firstLines` from the comment bodies (or the review body), the GitLab helper's first-line rule, at most 5.
3. One `POST /pulls/{n}/reviews` with `body`, `event` (`COMMENT`, `APPROVE`, `REQUEST_CHANGES`) and `comments[]` mapped with Task 2's side rule, under `reviewTimeoutMs`. Every 422 check reads `forgeWrite`'s full detail (Task 2). On 422: a detail matching `/own pull request/i` with `approve` retries once as `COMMENT` and records `approveError` (GitHub's detail) with `approved: false`; with `request_changes` it throws `review not posted: <detail>`. A 422 whose detail matches `/\b(line|path|position|diff[ _]hunk)\b/i` while comments are present returns `bad-anchors` listing every comment (GitHub does not say which). The `COMMENT` retry gets the same anchor check and otherwise throws `review not posted: <detail>`; there is never a third POST. Any other failure throws `review not posted: <detail>`. A timeout throws `publish failed and its outcome is unknown: the review request timed out; look at the pull request before retrying` (the `publish failed` prefix is what `REVIEW_SEQUENCE_ERROR` in `lib/mcp/tools.ts` matches, so the tool does not wrap it twice).
4. Each reply with a body: `POST .../comments/{root}/replies`; a failure goes to `replyErrors`, is not counted in `replies` or `repliedTo`, and that reply's resolve is skipped. Then each `resolve: true` reply: `resolveDiscussion`; a failure goes to `resolveErrors`.
5. Result: `reviewId` the created review's id, `reviewerState` from its state (`APPROVED` to `approved`, `CHANGES_REQUESTED` to `requested_changes`, `COMMENTED` to `reviewed`), `replyErrors` only when non-empty.

- [ ] **Step 1:** Move the 20 `submitReview` cases from `lib/daemon/__tests__/review-submit.test.ts` into `gitlab-review.test.ts` against `submitGitLabReview` with the same fake mutator (`project` replaces `projectId`); every expected call order and error string unchanged. Add a `request_changes` case. Write `gh-review-submit.test.ts`: the happy path makes exactly reviews-list, review POST, one reply POST, then the resolve's GraphQL pair, and the POST body carries both sides correctly; pending review returns `pending-drafts` with zero writes; a bad reply id throws with zero requests; own-PR approve 422 (body exactly `{"message":"Unprocessable Entity","errors":["Can not approve your own pull request"]}`) then COMMENT gives `approved: false` and an `approveError` containing `own pull request`, exactly 2 POSTs; a position 422 (body exactly `{"message":"Unprocessable Entity","errors":["Line could not be resolved"]}`) gives `bad-anchors` with every index; the same position 422 on the COMMENT retry gives `bad-anchors` after 2 POSTs; a 502 on the POST throws after 1 POST; a POST that outlives `reviewTimeoutMs: 50` (fetch stub as in Task 2) throws the `publish failed and its outcome is unknown` message after 1 POST; a failed reply lands in `replyErrors`, is absent from `repliedTo`, and its resolve is not attempted.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement; interface member, expectations, gitq mock stub. Do not touch the daemon yet (Task 9 deletes its copy).
- [ ] **Step 4:** Run the glance suite, type checks, `check:node`, build, gitq `check-types`. Expected: PASS.
- [ ] **Step 5:** Commit `glance: whole reviews on both forges; the GitLab draft flow moves in`.

### Task 4: GitHub thread fidelity (GLANCE-47) and read cost

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts`
- Test: `packages/glance/tests/gh-discussions.test.ts`, `tests/gh-fill-cost.test.ts`

**Interfaces, produced:** `fetchMRDiscussions('github:<owner>/<repo>', n)` reads that repo with no `/repositories` call; `github:<digits>` behaves as today.

- Review summaries: paginate `GET /pulls/{n}/reviews` alongside the two comment lists. Each non-`PENDING` review with a non-blank body becomes `{id: 'gh-review-<id>', resolvable: false, resolved: null, notes: [note]}`, note `id` the review id, `createdAt` `submitted_at`, `type: 'DiscussionNote'`, `resolvable: null`, `position: null`. Order: PR-level comments, review summaries, review threads.
- Position: `side: 'LEFT'` gives `newLine: null, oldLine: line ?? original_line ?? null`; otherwise `newLine: line ?? original_line ?? null, oldLine: null`. GitHub sends `line: null` on an outdated comment, which falls back to `original_line` on its own side. `oldPath` is the file's `previous_filename` when the PR renamed it, else `path`. Renames come from paginating `GET /pulls/{n}/files`.
- The files read and the GraphQL thread-state read run only when there is at least one review comment.
- Bot mark: `author.bot = user.type === 'Bot'`. A null user maps to `{id: 'github:user:ghost', username: 'ghost', name: 'ghost', avatarUrl: null, bot: false}`.
- Delete the private `graphql()` (no callers).

- [ ] **Step 1:** In `gh-discussions.test.ts`: a review summary appears as `gh-review-<id>`; an empty-body review and a pending review do not; a LEFT comment reports `oldLine` and `newLine: null`; a RIGHT comment reports `newLine` and `oldLine: null`; an outdated comment (`line: null`, `original_line: 12`) reports 12 on its side; a comment on a renamed file reports the old path; a bot author has `bot: true`; a null user does not throw; the `owner/repo` form makes no `/repositories` request. In `gh-fill-cost.test.ts`: a thread read with one review comment is exactly 5 requests (4 REST, 1 GraphQL); with none it is 3 REST and no GraphQL.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the glance suite and type checks. Expected: PASS.
- [ ] **Step 5:** Commit `glance: GitHub threads carry review summaries, sides, old paths and a bot mark`.

### Task 5: Live cases, docs, 0.30.0

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts`, `CHANGELOG.md`, `README.md`, `package.json`

- [ ] **Step 1:** Add live cases for every new method on both forges in `runWriteConformance`'s style (create, inline, reply, update, delete on the fixture PR; a comment-only review), each asserting values. They are type-checked here and not run (departure 8).
- [ ] **Step 2:** Bump to `0.30.0`; CHANGELOG: the new writes, `fetchPullRequestDiffs`, the thread fidelity changes, each a behaviour change (review summaries now appear in `fetchMRDiscussions` on GitHub; a LEFT comment's line moves from `newLine` to `oldLine`; a RIGHT comment's `oldLine` is now null where it carried `original_line`; an outdated comment's line falls back to `original_line`), the `owner/repo` repositoryId form, the `NoteMutator` string project, the bot mark. Update the README method list.
- [ ] **Step 3:** Run the glance suite, `check-types`, `check:node`, `bun run build`. Expected: PASS.
- [ ] **Step 4:** Commit `glance: 0.30.0, comment and review writes`.

---

## Daemon and tools: threads and reviews on GitHub (RT-541)

### Task 6: Forge-aware thread reads and new-comment notifications

**Files:**
- Modify: `lib/daemon/freshness.ts`, `lib/daemon/discussions-store.ts`, `lib/daemon/discussions-poller.ts` (header comment only)
- Test: `lib/daemon/__tests__/freshness-forge-router.test.ts`, `lib/daemon/__tests__/discussions-notify-forge.test.ts` (new); `discussions-file-store.test.ts` unchanged and green

**Interfaces, produced (`freshness.ts`):**

```ts
export function repositoryIdFor(ctx: RepoContext): string; // "gitlab:<projectId>" | "github:<owner>/<repo>"
export function getSelfUserId(ctx: RepoContext): Promise<number | null>;
```

- `getSelfUserId`: GitLab returns `getCurrentUserId()` with no request, as today. GitHub calls `provider.validateToken()` once per provider instance (a `WeakMap<GitHubProvider, number>`, so a changed token's new provider reads it again) and returns the numeric tail; a failure logs a warning, returns null and is not cached.
- `refreshDiscussions` resolves `getRepoContext(repo, repoPath)` once when no `fetchDiscussions` override is given and uses it for `fetchMRDiscussions(repositoryIdFor(ctx), iid)`, for `currentUserId` (the override still wins; with a `fetchDiscussions` override and no `currentUserId`, it stays `getCurrentUserId()` as today) and for the forge. New override `forge?: "gitlab" | "github"`.
- `isBot(n)` is `n.author.bot === true || BOT_USERNAME.test(username)`.
- The `!<iid>` in the notification title and the meta title fallback reads `#<iid>` on GitHub; GitLab unchanged.
- This turns the 5-minute poller on for GitHub repos granted the "discussions" cache, with no further switch, as the spec intends. Measured cost (Task 4): per open PR per sweep, 4 REST and 1 GraphQL when it has review comments, 3 REST otherwise, plus one `/user` per provider. Say so in the poller's header comment.

- [ ] **Step 1:** Router tests: `repositoryIdFor` per forge; `getSelfUserId` on GitHub reads `/user` once across two calls and again after the token changes; on GitLab it makes no request. One end-to-end case in `discussions-notify-forge.test.ts`, built like `freshness-forge-router.test.ts` (temp git repo with a github.com origin, `spyOn` on `loadSecrets` and `fetch`, no `fetchDiscussions` or `currentUserId` override): `refreshDiscussions` on that repo requests the PR's review comments, issue comments and reviews under `repos/<owner>/<repo>`, makes no `/repositories` request, reads `/user` once across two refreshes, and stores the discussions in the given file store. `discussions-notify-forge.test.ts`, through `refreshDiscussions` with overrides `{fetchDiscussions, fileStore, projectStore, currentUserId: 42, forge: "github", notify}`, second fetch adding three notes on the user's own PR: one by `github:user:42` (no notification), one by a bot with `bot: true` (none), one by `github:user:7` (one notification titled `New comment on #5`). A GitLab case with the same shape still titles `!5`.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both, `discussions-file-store.test.ts`, `discussions-semantics.test.ts`, every `freshness-*.test.ts`, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `daemon: thread reads and new-comment alerts follow the repo's forge`.

### Task 7: Reply, comment, edit, resolve and diffs through the router

**Files:**
- Modify: `lib/daemon/handlers/discussions.ts`, `packages/rt-client/src/commands.ts` (doc comments only)
- Test: `lib/daemon/__tests__/discussions-comment.test.ts`, `discussions-note-update.test.ts`, `discussions-diffs.test.ts` (rewritten onto the new seams, every expected reply and error string unchanged), `discussions-github.test.ts` (new)

**Interfaces, produced:**

```ts
export type ThreadProvider = { baseURL: string } & Pick<GitProvider, 'createComment' | 'createInlineComment' | 'replyToDiscussion' | 'updateComment'
  | 'deleteComment' | 'submitReview' | 'resolveDiscussion' | 'unresolveDiscussion'>
  & Partial<Pick<GitHubProvider, 'fetchPullRequestDiffs'>> & Partial<Pick<GitLabProvider, 'restRequest' | 'fetchReviewerStates'>>;
export interface ThreadContext { forge: 'gitlab' | 'github'; provider: ThreadProvider; projectPath: string }
export async function fetchMrDiffs(ctx: ThreadContext, iid: number, opts?: { reqSignal?: AbortSignal; timeoutMs?: number }): Promise<{ diffs: MrDiffRow[]; truncated: boolean }>;
// DiscussionHandlerSeams: repoContext(repoName, repoPath?) => Promise<ThreadContext>, diffs(ctx, iid, opts), warn, refresh, readCached, selfUsername.
// gitlabToken, mutator, commentMutator, reviewMutator and reviewActions are removed.
```

- Every handler takes its context from `seams.repoContext`, default `getRepoContext`. A missing `forge` reads as GitLab.
- `fetchMrDiffs` on GitLab: `provider.restRequest('GET', '/projects/<enc>/merge_requests/<iid>/diffs?per_page=100', undefined, 'fetchMrDiffs', { signal })`, the same signal composition and timeouts as today, non-ok throws `GitLab diffs API: <status>`. On GitHub: `fetchPullRequestDiffs(projectPath, iid, { signal })`.
- `discussions:reply`: `replyToDiscussion`; reply data unchanged.
- One helper `mrWebUrl(ctx: ThreadContext, iid: number): string` builds every `mrUrl` in this file: today's `${baseURL}/${projectPath}/-/merge_requests/${iid}` on GitLab, `${baseURL}/${projectPath}/pull/${iid}` on GitHub.
- `mr:comment`: `createComment`; an `EmptyDiscussionError` answers `GitLab created discussion <id> with no notes`. `url` comes from the result.
- `mr:note-update`: `updateComment`. On GitHub `kind` comes from the cached threads (`readCached`), testing the prefixes in this order: `gh-review-thread-` is `diff`, `gh-issue-comment-` `general`, `gh-review-` `review`; absent or ambiguous sends no kind.
- `discussions:resolve`, `discussions:refresh`, `discussions:read` run on both forges.
- Delete the `loadSecrets`, `NoteMutator` and `getGitLabContext` imports.

- [ ] **Step 1:** Rewrite the three files' stubs as a `ThreadContext` whose provider records calls (`createNote` args `[99, 7, ...]` become `replyToDiscussion` / `createComment` args `["group/proj", 7, ...]`); every reply and error assertion stays as it is. `discussions-github.test.ts`: on a GitHub context, reply, comment (`resolvable: false`, `mrUrl` ends `/pull/7`), note-update with kind from the cache (one case each for a review-thread note, a PR-level note and a review-summary note) and with none, resolve, and diffs each return mapped data; reply to a PR-level comment returns `ok: false` with glance's message; the GitLab diffs read sends exactly one `restRequest` with the path above.
- [ ] **Step 2:** Run the four files. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the four files plus `discussions-handlers.test.ts`, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `daemon: replies, comments, edits, resolves and diffs on GitHub`.

### Task 8: Inline comments through the router

**Files:**
- Modify: `lib/daemon/handlers/discussions.ts`
- Test: `lib/daemon/__tests__/discussions-comment-inline.test.ts` (rewritten, assertions unchanged), `discussions-github.test.ts`

- GitLab: the same anchoring step, then `createInlineComment`; when `anchored` is false, `deleteComment` and one retry, with every message the handler builds today (`note <noteId> type <noteType>`, `could not delete stray note`, `first attempt degraded ... retry failed: ` plus `withAnchorHint`, `GitLab dropped the position twice`). `EmptyDiscussionError` on the first post answers `GitLab created a discussion with no notes`, on the retry `GitLab created a retry discussion with no notes`.
- GitHub: the anchoring step on `fetchPullRequestDiffs`, with `GitHub` in place of `GitLab` in its two refusals. A caller-passed `oldLine` sends `{path, oldLine, oldPath}` (LEFT); otherwise `{path, line, oldPath}` (RIGHT), ignoring the old line anchoring fills. No degrade loop. Reply `{discussionId, noteId, verified: true}`.

- [ ] **Step 1:** Rewrite the existing file onto a provider stub: a degraded result is `{anchored: false, noteType: null}`, and the counts of `createInlineComment` and `deleteComment` calls replace today's `fetchDiffRefs` / `createPositionedDiscussion` counts; every error string assertion stays. Add GitHub cases: RIGHT for an unchanged context line (the anchoring step fills its `oldLine`, and the provider still receives `{path, line}` with no `oldLine`), LEFT for a caller `oldLine`, the `GitHub cannot anchor` refusal for a line outside the diff, and no `deleteComment` call ever.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `daemon: inline comments on GitHub; GitLab keeps its degrade retry`.

### Task 9: Review submit through the router

**Files:**
- Modify: `lib/daemon/handlers/discussions.ts`, `lib/daemon/review-submit.ts`, `packages/rt-client/src/commands.ts`
- Test: `lib/daemon/__tests__/discussions-review-submit.test.ts` (rewritten), `review-submit.test.ts` (keeps the parser cases), `discussions-github.test.ts`

**Interfaces:** `ReviewSubmitData`'s published variant gains `replyErrors?: Array<{ discussionId: string; error: string }>`. `review-submit.ts` keeps `parseReviewSubmit` and `anchorComments` and drops `submitReview`, `ReviewMutator`, `ReviewSubmitDeps`.

- Both forges: parse, anchor (diffs through `seams.diffs`), then `provider.submitReview(projectPath, iid, input)`. An unpublished result answers `{...result, mrUrl}`. The reply never carries `reviewId`.
- GitLab after publish: today's refresh, summary search by body and `getSelfUsername`, and reviewer state from `provider.fetchReviewerStates` (its failure logs and yields null, as today).
- GitHub after publish: refresh (best effort), `summaryNoteId` = `reviewId`, `reviewerState` from the result.
- GitHub comments: `anchorComments` runs only to find bad anchors. The list sent to `submitReview` is built from the parsed comments before anchoring: a caller-passed `oldLine` sends `{body, path, oldLine, oldPath}` (LEFT), otherwise `{body, path, line, oldPath}` (RIGHT). An `oldLine` the anchoring step filled in never reaches GitHub. GitLab sends the anchored list, as today.
- `mrUrl` comes from Task 7's `mrWebUrl` on both forges.
- Rebuild `packages/rt-client` after the type change.

- [ ] **Step 1:** Rewrite `discussions-review-submit.test.ts` onto a provider stub returning glance results; the success reply object, the pending-drafts and bad-anchors replies, the publish-failure error and the warn text stay exactly as asserted today. Drop the moved `submitReview` cases from `review-submit.test.ts`. GitHub cases: `summaryNoteId` equals `reviewId`; `mrUrl` ends `/pull/7`; `replyErrors` passes through; an own-PR approve reports `approved: false` with `approveError`; with one context-line comment (anchoring fills its `oldLine`) and one caller-`oldLine` comment, the provider receives `{path, line}` without `oldLine` for the first and `{path, oldLine}` without `line` for the second.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement; `bun run build` in `packages/rt-client`.
- [ ] **Step 4:** Run the three files, `packages/rt-client/test/dist-freshness.test.ts`, `lib/daemon/__tests__/rt-client-commands.test.ts`, `bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `daemon: whole reviews on GitHub through glance`.

### Task 10: MCP tools stop refusing GitHub, docs, plugin

**Files:**
- Modify: `lib/mcp/tools.ts` (the six thread, comment, note and review tools), `lib/mcp/mr-read-tools.ts` (`mr_threads`), `.claude/rules/mcp-and-gates.md`, `plugins/mattstack/attachments/mcp-tools/reference.md` (regenerated), `plugins/mattstack/.claude-plugin/plugin.json`, recompiled skills
- Test: `lib/mcp/__tests__/tools.test.ts`, `lib/mcp/__tests__/mr-read-tools.test.ts`

- The seven tools pass `{ github: true }` to `resolveMrTarget`. Read each handler first: any GitLab-built URL or GitLab wording in its result comes from the daemon reply instead.
- Descriptions drop `GitLab only.`, end with `PR_URL_NOTE` (the GitHub-capable description tests require it), and say what differs on GitHub in one clause each: `mr_comment` posts a comment that cannot be resolved; `mr_reply_thread` replies only to review threads; `mr_review_submit` posts one review in one request. `mr_threads` stops saying "fetched from GitLab", and the `mr-read-tools.ts` header comment stops saying it reads GitLab only. Other wording waits for RT-549.
- `respond_post_execute`, `mr_posted_since`, `mr_map`, `mr_upload` and `mr_rebase` keep their refusals.
- `mcp-and-gates.md`: the composites, forge reads and `mr_*` paragraphs say the thread, comment and review tools work on both forges.
- Load `mattstack:editing-skills` and follow it: regenerate the reference (`bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`, isolated HOME), bump the plugin version one past main, recompile, and keep the engine-floor line for the PR body.

- [ ] **Step 1:** In `tools.test.ts`, the "keep refusing" loop keeps only `mr_rebase`; the six tools join the case that asserts the daemon verb is called with the GitHub identity from a PR URL; the description test drops them from its `GitLab only.` list and adds them to the `PR_URL_NOTE` check; the `mr_reply_thread` case near line 405 that pins `GitLab only.` follows. In `mr-read-tools.test.ts`, `mr_threads` with a PR URL calls `discussions:refresh` with the GitHub identity, and its description no longer starts `GitLab only.`
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement, then the plugin steps.
- [ ] **Step 4:** Run both files, `bun run typecheck`, `bun run purity`, `bun run docs:check`, `plugins/mattstack/tests/test-mcp-tools-reference.sh`. Expected: PASS.
- [ ] **Step 5:** Commit `mcp: thread, comment and review tools work on GitHub`.

## Shipping

One PR, `glance and daemon: comment, thread and review writes on GitHub (0.30.0)`, against `main`, after the final whole-branch review. Before pushing: fetch `main`; if the gh-evidence lane merged first, rebase and bump the plugin version one past `main` again. Run the brief's full verification list. Push with `git_push`, open with `gh pr create` (body per the MR writing style, the departures above, the engine-floor line, the unrun live cases), wait for CodeRabbit and CI, fix what they find, report the links. Never merge.
