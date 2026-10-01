# Review Rounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A board review lands on GitLab as one submitted review (Comment or Approve), and every later round checks the reviewer's earlier threads, finds what is new, and keeps skipped findings out of the way.

**Architecture:** One atomic daemon command (`mr:review-submit`) builds the whole review as GitLab pending comments, publishes them with the summary and a `reviewed` state, then approves and resolves. The review skills stop posting comment by comment and make that one call. The board keeps a small per-round record (`review_rounds`) and the report json grows `threads[]` and `skipped[]`, which two shell scripts turn into the gate questions the already-built sheet reads.

**Tech Stack:** Bun, TypeScript, `bun:test`, bun:sqlite, GitLab REST (draft notes API), jq and POSIX sh (gate scripts), React + tui-kit (board client, already built), mattstack skill sources (Markdown with digraphs).

**Spec:** `docs/superpowers/specs/2026-10-01-review-rounds-design.md`. Read it before any task; this plan argues from it.

## Global Constraints

- Outcomes are `comment` and `approve` only. No Request changes on GitLab.
- `mr_review_submit` is GitLab only. `mr_comment`, `mr_comment_inline` and `mr_approve` stay as they are for their other callers.
- The submit publishes with `reviewer_state: "reviewed"`; approve is a separate `POST .../approve` after publish. Never call `PUT .../merge_requests/:iid` with `reviewer_ids`.
- A pending comment whose response has `line_code: null` is a bad anchor: GitLab drops it silently on publish. Never publish with one in place.
- Publishing publishes every pending comment the caller has on the MR, so a submit refuses when any exist before it starts.
- Board state db: `SCHEMA_VERSION` must equal `MIGRATIONS.length`; the new migration is v4 and holds only `CREATE TABLE IF NOT EXISTS`. Announce "board state db v4" in rt chat before merging; renumber if another lane took it.
- Gate copy never says "open", "unresolved" or "still open" about a finding or thread. Labels name who acts: "fixed by author", "waiting on author", "author pushed back · accept", "author pushed back · hold firm".
- A gate question carries at most four options; longer lists chunk (`findings-1..N`, `skipped-1..N`).
- No em dashes or en dashes anywhere authored (code, comments, skills, commits), and the rest of `~/.claude/rules/no-em-dashes.md` in full.
- The repo is public: every fixture, story and test uses invented names (`acme/webapp`, `pat`, `gitlab.example.com`). No employer names, no real MR numbers.
- No mattstack ticket ids (RT-, SKILLS-) in any skill source under `plugins/mattstack/attachments/` or `apps/board/skills-src/`: that text compiles into an employer-visible pack.
- Comments in code state only a constraint the code cannot show. No comments that narrate, cite this plan, or record decisions; put those in the task report.
- Skill edits follow `mattstack:editing-skills` and `superpowers:writing-skills`: baseline a fresh agent first (RED), edit, verify with a fresh agent (GREEN), run certify. Edit sources only; never edit `apps/board/skills/` or a compiled pack by hand.
- After any change under `packages/glance/src` run `bun run build` in `packages/glance`; after any change under `packages/rt-client/src` run `bun run build` in `packages/rt-client`.
- Run root tests from the repo root (`bun test <path>`), board tests from `apps/board` (`bun test <path>`), glance tests from `packages/glance`.
- Bash in this worktree: one plain command per call, no `&&`, no heredocs; `cd <absolute path>` alone first.
- Commit after every task. Trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (implementer subagents use their own model's trailer).
- Never commit `docs/apps/design/board/board.pen` (it carries an unapproved mock) and never `packages/glance/harness_credentials.json`.

## Review Focus

1. **A publish whose outcome is unknown when the review had no pending comments** (summary only, or resolve-only replies). Listing pending comments cannot settle it, because the list is empty either way. Expected: the call fails saying the outcome is unknown and to look for the summary on the MR before retrying; it never reports success and never reports "nothing posted". Test in Task 3.
2. **A rollback that cannot delete a pending comment.** Expected: the failure names how many pending comments are left on the MR, because the reviewer's next submit would otherwise be refused with no explanation. Test in Task 3.
3. **Approve refused after a successful publish** (the reviewer is the author, or approval rules forbid it). Expected: `published: true, approved: false` with the error, and nothing is published a second time on retry. Tests in Task 3 (handler) and Task 6 (skill scenario).
4. **Finding ids repeat across rounds** (`f1` in round 1 is not `f1` in round 2). Expected: a skipped finding is stored and restored under a round-qualified id (`r1-f1`), so restoring one never restores its namesake. Test in Task 8.
5. **A reviewer's earlier thread whose author never replied, or a thread on a line that no longer exists.** Expected: the card still renders ("The author hasn't replied in this thread."), the reply posts into the thread (replies need no position), and nothing tries to re-anchor it. Tests in Task 10 (script) and Task 12 (sheet).

## Phase order note

The round record's table and `review-ledger` verbs land at the start of Phase 2 (Tasks 8 and 9), as the spec's Phases section now says: Phase 2's inputs need the round number, the last reviewed commit and the `confirmed` list, which nothing else holds. In Phase 2 the record's `skipped` and `restored` are always written as `[]`; Phase 3 fills them. One migration instead of two.

## File Map

| File | Change | Responsibility |
|---|---|---|
| `packages/glance/src/NoteMutator.ts` | modify | pending-comment (draft note) REST calls, reviewer states |
| `packages/glance/src/index.ts` | modify | export `DraftNote`, `ReviewerState` |
| `packages/glance/tests/note-mutator.test.ts` | modify | unit tests for the new calls |
| `packages/glance/tests/live-review-submit.test.ts` | create | harness test against the fixture repo, gated on `GLANCE_LIVE` |
| `packages/rt-client/src/commands.ts` | modify | `mr:review-submit` command type |
| `lib/daemon/review-submit.ts` | create | payload validation and the submit sequence, no I/O of its own |
| `lib/daemon/handlers/discussions.ts` | modify | `mr:review-submit` handler wiring |
| `lib/daemon/__tests__/review-submit.test.ts` | create | sequence tests |
| `lib/daemon/__tests__/discussions-review-submit.test.ts` | create | handler tests |
| `lib/mcp/tools.ts` | modify | `mr_review_submit` tool |
| `lib/mcp/__tests__/tools.test.ts` | modify | tool tests, roster name |
| `plugins/mattstack/attachments/mcp-tools/reference.md` | regenerate | tool reference |
| `AGENTS.md` | modify | the `mr_*` paragraph |
| `plugins/mattstack/attachments/review-posting/SKILL.md` | modify | posting is one submitted review |
| `plugins/mattstack/attachments/review/review/SKILL.md` | modify | posting graph, re-review inputs, extras |
| `plugins/mattstack/attachments/review-core-body-tail/SKILL.md` | modify | report json: `threads[]`, `skipped[]`, version 3 |
| `plugins/mattstack/attachments/review/review/scripts/review-source.sh` | modify | `thread-N` and `skipped-N` questions |
| `plugins/mattstack/attachments/review/review/scripts/gate-ctx.sh` and `.../receive-review/scripts/gate-ctx.sh` | modify | accept `carryover@1`, `skipped@1` |
| `plugins/mattstack/attachments/review/review/tests/test-review-source.sh` | modify | script tests |
| `plugins/mattstack/attachments/gate-protocol/SKILL.md` | modify | the new question shapes |
| `apps/board/skills-src/review/SKILL.md` | modify | posting, re-review mode, ledger writes, resume check |
| `apps/board/skills/` | regenerate | `bun run skills:expand:board` |
| `plugins/mattstack/.claude-plugin/plugin.json` | modify | version bump per skill-changing task |
| `apps/board/src/state/db.ts` | modify | v4 `review_rounds` |
| `apps/board/src/review-rounds.ts` | create | read, write and fold the round record |
| `apps/board/bin/review-ledger.ts` | create | `review-ledger record|read` |
| `apps/board/src/subcommands.ts` | modify | register the verb |
| `apps/board/src/review-state.ts` | modify | drop rounds with the tombstone |
| `apps/board/src/discussions.ts`, `data.ts`, `view.ts`, `server.ts` | modify | the pill |
| `apps/board/src/client/board/__tests__/*` | modify/create | sheet DOM tests, script-contract test |

---

# Phase 1: real GitLab reviews

Ships alone: round 1 of a board review lands as a submitted review and the pill reads it.

### Task 1: glance pending-comment calls

**Files:**
- Modify: `packages/glance/src/NoteMutator.ts` (append methods inside the class, after `deleteNote`; add types after `UploadedFile`)
- Modify: `packages/glance/src/index.ts:156-157` (the NoteMutator type exports)
- Test: `packages/glance/tests/note-mutator.test.ts`

**Interfaces:**
- Consumes: `TextPosition`, `safeEmit`, the existing `stub()` test helper.
- Produces (later tasks rely on these exact names):

```ts
export interface DraftNote {
  id: number;
  note: string;
  discussion_id: string | null;
  /** null on a positioned draft means GitLab could not anchor it and will drop it on publish. */
  line_code: string | null;
  resolve_discussion: boolean;
}
export interface ReviewerState { username: string; state: string }

createDraftNote(projectId: number, mrIid: number, body: string,
  opts?: { position?: TextPosition; inReplyToDiscussionId?: string; resolveDiscussion?: boolean }): Promise<DraftNote>
listDraftNotes(projectId: number, mrIid: number): Promise<DraftNote[]>
deleteDraftNote(projectId: number, mrIid: number, draftId: number): Promise<void>
publishDraftNotes(projectId: number, mrIid: number,
  opts: { note: string; reviewerState: 'reviewed' | 'requested_changes'; timeoutMs?: number }): Promise<void>
fetchReviewerStates(projectId: number, mrIid: number): Promise<ReviewerState[]>
```

- [ ] **Step 1: Write the failing tests**

Append to `packages/glance/tests/note-mutator.test.ts`:

```ts
describe('draft notes', () => {
  const BASE = 'https://gitlab.example.com/api/v4/projects/42/merge_requests/9';
  const POS = {
    base_sha: 'b', start_sha: 's', head_sha: 'h',
    position_type: 'text' as const, new_path: 'src/a.ts', old_path: 'src/a.ts', new_line: 12,
  };

  test('createDraftNote posts note and a nested position', async () => {
    const calls = stub(201, { id: 7, note: 'hi', discussion_id: null, line_code: 'abc_1_12', resolve_discussion: false });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const draft = await m.createDraftNote(42, 9, 'hi', { position: POS });
    expect(draft.line_code).toBe('abc_1_12');
    expect(calls[0]!.url).toBe(`${BASE}/draft_notes`);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['PRIVATE-TOKEN']).toBe('tok');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ note: 'hi', position: POS });
  });

  test('createDraftNote normalizes an absent line_code to null', async () => {
    stub(201, { id: 7, note: 'hi', discussion_id: null, resolve_discussion: false });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    expect((await m.createDraftNote(42, 9, 'hi', { position: POS })).line_code).toBeNull();
  });

  test('createDraftNote sends a reply with its resolve flag and no position', async () => {
    const calls = stub(201, { id: 8, note: 'done', discussion_id: 'd1', line_code: null, resolve_discussion: true });
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await m.createDraftNote(42, 9, 'done', { inReplyToDiscussionId: 'd1', resolveDiscussion: true });
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      note: 'done', in_reply_to_discussion_id: 'd1', resolve_discussion: true,
    });
  });

  test('listDraftNotes gets the first hundred', async () => {
    const calls = stub(200, [{ id: 7, note: 'hi', discussion_id: null, line_code: null, resolve_discussion: false }]);
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    const drafts = await m.listDraftNotes(42, 9);
    expect(drafts.map(d => d.id)).toEqual([7]);
    expect(calls[0]!.url).toBe(`${BASE}/draft_notes?per_page=100`);
    expect(calls[0]!.method).toBe('GET');
  });

  test('deleteDraftNote deletes by id', async () => {
    const calls = stub(204, null);
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await m.deleteDraftNote(42, 9, 7);
    expect(calls[0]!.url).toBe(`${BASE}/draft_notes/7`);
    expect(calls[0]!.method).toBe('DELETE');
  });

  test('publishDraftNotes sends the summary and the reviewer state', async () => {
    const calls = stub(204, null);
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    await m.publishDraftNotes(42, 9, { note: 'summary', reviewerState: 'reviewed' });
    expect(calls[0]!.url).toBe(`${BASE}/draft_notes/bulk_publish`);
    expect(calls[0]!.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ note: 'summary', reviewer_state: 'reviewed' });
  });

  test('fetchReviewerStates flattens user and state', async () => {
    const calls = stub(200, [{ user: { id: 3, username: 'pat' }, state: 'reviewed', created_at: 'x' }]);
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    expect(await m.fetchReviewerStates(42, 9)).toEqual([{ username: 'pat', state: 'reviewed' }]);
    expect(calls[0]!.url).toBe(`${BASE}/reviewers`);
  });

  test('every draft call throws with the status on failure', async () => {
    const m = new NoteMutator('https://gitlab.example.com', 'tok');
    stub(403, { message: 'forbidden' });
    await expect(m.createDraftNote(42, 9, 'hi')).rejects.toThrow(/createDraftNote failed: 403/);
    await expect(m.listDraftNotes(42, 9)).rejects.toThrow(/listDraftNotes failed: 403/);
    await expect(m.deleteDraftNote(42, 9, 7)).rejects.toThrow(/deleteDraftNote failed: 403/);
    await expect(m.publishDraftNotes(42, 9, { note: 's', reviewerState: 'reviewed' })).rejects.toThrow(/publishDraftNotes failed: 403/);
    await expect(m.fetchReviewerStates(42, 9)).rejects.toThrow(/fetchReviewerStates failed: 403/);
  });
});
```

The existing `stub()` builds `new Response(JSON.stringify(payload), {status})`. A 204 with a body throws in `Response`'s constructor, so change the helper's return line to:

```ts
    return new Response(status === 204 ? null : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
```

- [ ] **Step 2: Run to verify failure**

Run (from `packages/glance`): `bun test tests/note-mutator.test.ts`
Expected: FAIL, `m.createDraftNote is not a function`.

- [ ] **Step 3: Implement**

In `NoteMutator.ts`, after the `UploadedFile` interface:

```ts
export interface DraftNote {
  id: number;
  note: string;
  discussion_id: string | null;
  /** null on a positioned draft means GitLab could not anchor it and will drop it on publish. */
  line_code: string | null;
  resolve_discussion: boolean;
}

export interface ReviewerState {
  username: string;
  state: string;
}

const PUBLISH_TIMEOUT_MS = 30_000;
```

Add to the header comment's endpoint list:

```
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/draft_notes
 *   GET    /api/v4/projects/:id/merge_requests/:mrIid/draft_notes
 *   DELETE /api/v4/projects/:id/merge_requests/:mrIid/draft_notes/:draftId
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/draft_notes/bulk_publish
 *   GET    /api/v4/projects/:id/merge_requests/:mrIid/reviewers
```

Inside the class, after `deleteNote`, add one private helper and the five methods:

```ts
  private async draftRequest(
    op: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<Response> {
    const started = performance.now();
    const res = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'PRIVATE-TOKEN': this.token,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(timeoutMs !== undefined ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    safeEmit(this.onRequest, {
      op: `noteMutator.${op}`,
      transport: 'rest',
      method,
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${op} failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
    }
    return res;
  }

  /**
   * Create a pending review comment, private to the token's user until
   * published. A positioned draft GitLab cannot anchor comes back with
   * `line_code: null` and is dropped without an error on publish, so the
   * caller must check it.
   */
  async createDraftNote(
    projectId: number,
    mrIid: number,
    body: string,
    opts: { position?: TextPosition; inReplyToDiscussionId?: string; resolveDiscussion?: boolean } = {},
  ): Promise<DraftNote> {
    const res = await this.draftRequest(
      'createDraftNote',
      'POST',
      `/api/v4/projects/${projectId}/merge_requests/${mrIid}/draft_notes`,
      {
        note: body,
        ...(opts.position ? { position: opts.position } : {}),
        ...(opts.inReplyToDiscussionId ? { in_reply_to_discussion_id: opts.inReplyToDiscussionId } : {}),
        ...(opts.resolveDiscussion !== undefined ? { resolve_discussion: opts.resolveDiscussion } : {}),
      },
    );
    const draft = (await res.json()) as DraftNote;
    return { ...draft, line_code: draft.line_code ?? null, discussion_id: draft.discussion_id ?? null };
  }

  /** The token user's own pending comments on the MR; nobody else's are visible. */
  async listDraftNotes(projectId: number, mrIid: number): Promise<DraftNote[]> {
    const res = await this.draftRequest(
      'listDraftNotes',
      'GET',
      `/api/v4/projects/${projectId}/merge_requests/${mrIid}/draft_notes?per_page=100`,
    );
    return (await res.json()) as DraftNote[];
  }

  async deleteDraftNote(projectId: number, mrIid: number, draftId: number): Promise<void> {
    await this.draftRequest(
      'deleteDraftNote',
      'DELETE',
      `/api/v4/projects/${projectId}/merge_requests/${mrIid}/draft_notes/${draftId}`,
    );
  }

  /**
   * Submit the review: publishes EVERY pending comment the token's user has
   * on the MR, posts `note` as a plain summary note, and sets the reviewer
   * state. Works with no pending comments.
   */
  async publishDraftNotes(
    projectId: number,
    mrIid: number,
    opts: { note: string; reviewerState: 'reviewed' | 'requested_changes'; timeoutMs?: number },
  ): Promise<void> {
    await this.draftRequest(
      'publishDraftNotes',
      'POST',
      `/api/v4/projects/${projectId}/merge_requests/${mrIid}/draft_notes/bulk_publish`,
      { note: opts.note, reviewer_state: opts.reviewerState },
      opts.timeoutMs ?? PUBLISH_TIMEOUT_MS,
    );
  }

  async fetchReviewerStates(projectId: number, mrIid: number): Promise<ReviewerState[]> {
    const res = await this.draftRequest(
      'fetchReviewerStates',
      'GET',
      `/api/v4/projects/${projectId}/merge_requests/${mrIid}/reviewers`,
    );
    const rows = (await res.json()) as Array<{ user: { username: string }; state: string }>;
    return rows.map(r => ({ username: r.user.username, state: r.state }));
  }
```

In `packages/glance/src/index.ts`, the line

```ts
export type { CreatedNote, CreatedDiscussion, UploadedFile, DiffRefs, TextPosition } from './NoteMutator.ts';
```

becomes

```ts
export type { CreatedNote, CreatedDiscussion, UploadedFile, DiffRefs, TextPosition, DraftNote, ReviewerState } from './NoteMutator.ts';
```

- [ ] **Step 4: Run to verify pass, then the package gates**

Run (from `packages/glance`): `bun test tests/note-mutator.test.ts` then `bun run check-types` then `bun run check:node` then `bun run build`.
Expected: all pass; `check:node` prints its smoke OK.

- [ ] **Step 5: Commit**

```bash
git add :/packages/glance/src/NoteMutator.ts :/packages/glance/src/index.ts :/packages/glance/tests/note-mutator.test.ts
git commit -m "glance: pending review comments and reviewer states on NoteMutator"
```

### Task 2: the `mr:review-submit` command type

**Files:**
- Modify: `packages/rt-client/src/commands.ts` (after the `"mr:comment"` entry near line 861; the name list near line 1152)

**Interfaces:**
- Produces:

```ts
export interface ReviewSubmitComment { body: string; path: string; line: number; oldPath?: string; oldLine?: number }
export interface ReviewSubmitReply { discussionId: string; body?: string; resolve: boolean }
export type ReviewSubmitData =
  | { published: false; reason: "pending-drafts"; pending: { count: number; firstLines: string[] }; mrUrl: string }
  | { published: false; reason: "bad-anchors"; badAnchors: Array<{ index: number; path: string; line: number }>; mrUrl: string }
  | {
      published: true;
      comments: number;
      replies: number;
      repliedTo: string[];
      resolved: string[];
      approved: boolean;
      approveError?: string;
      resolveErrors: Array<{ discussionId: string; error: string }>;
      reviewerState: string | null;
      summaryNoteId: number | null;
      mrUrl: string;
    };
```

- [ ] **Step 1: Add the types and the command**

Above the `Commands` interface (beside `DiscussionsWriteData`, near line 626) add the three exports above. Then after the `"mr:comment"` entry:

```ts
  /** One whole review in one call: every comment and reply becomes a
      pending comment, then one publish posts them with the summary and
      marks the caller as having reviewed; `approve` approves afterwards.
      `published: false` means nothing reached the MR and names why. A
      refused approval after a publish answers `published: true,
      approved: false`, so a caller never publishes twice. */
  "mr:review-submit": {
    payload: {
      repoName: string; iid: number; outcome: "comment" | "approve"; summary: string;
      comments: ReviewSubmitComment[]; replies: ReviewSubmitReply[];
    };
    data: ReviewSubmitData;
  };
```

Add `"mr:review-submit",` to the name array right after `"mr:comment",`.

- [ ] **Step 2: Build and typecheck**

Run (from `packages/rt-client`): `bun run build`. Then from the repo root: `bun run typecheck`.
Expected: both clean. If the build reports the name array and the `Commands` keys out of step, the array entry is missing.

- [ ] **Step 3: Commit**

```bash
git add :/packages/rt-client/src/commands.ts
git commit -m "rt-client: mr:review-submit command type"
```

### Task 3: the submit sequence and its daemon handler

**Files:**
- Create: `lib/daemon/review-submit.ts`
- Modify: `lib/daemon/handlers/discussions.ts` (imports, `DiscussionHandlerSeams`, the return type, a new handler after `"mr:comment"`)
- Test: `lib/daemon/__tests__/review-submit.test.ts`, `lib/daemon/__tests__/discussions-review-submit.test.ts`

**Interfaces:**
- Consumes: Task 1's `NoteMutator` methods, Task 2's types, `buildTextPosition` (already in `discussions.ts`), `getSelfUsername` from `lib/daemon/freshness.ts`.
- Produces:

```ts
// lib/daemon/review-submit.ts
export type ReviewMutator = Pick<NoteMutator, "fetchDiffRefs" | "listDraftNotes" | "createDraftNote" | "deleteDraftNote" | "publishDraftNotes">;
export interface ReviewSubmitInput { outcome: "comment" | "approve"; summary: string; comments: ReviewSubmitComment[]; replies: ReviewSubmitReply[] }
export function parseReviewSubmit(payload: unknown): { ok: true; input: ReviewSubmitInput } | { ok: false; error: string }
export async function submitReview(deps: ReviewSubmitDeps, input: ReviewSubmitInput): Promise<ReviewSubmitOutcome>
```

`ReviewSubmitOutcome` is `ReviewSubmitData` without `mrUrl`, `reviewerState` and `summaryNoteId`; the handler adds those.

- [ ] **Step 1: Write the failing sequence tests**

Create `lib/daemon/__tests__/review-submit.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { DraftNote } from "@mattstack/glance";
import { parseReviewSubmit, submitReview, type ReviewMutator, type ReviewSubmitDeps } from "../review-submit.ts";

const REFS = { base_sha: "b", start_sha: "s", head_sha: "h" };
const draft = (id: number, over: Partial<DraftNote> = {}): DraftNote =>
  ({ id, note: `n${id}`, discussion_id: null, line_code: `lc${id}`, resolve_discussion: false, ...over });

/** A scripted GitLab: records every call in order and keeps a pending list. */
function fake(over: Partial<ReviewMutator> = {}) {
  const log: string[] = [];
  let pending: DraftNote[] = [];
  let next = 1;
  const mutator: ReviewMutator = {
    fetchDiffRefs: async () => { log.push("refs"); return REFS; },
    listDraftNotes: async () => { log.push("list"); return [...pending]; },
    createDraftNote: async (_p, _i, body, opts = {}) => {
      const d = draft(next++, { note: body, discussion_id: opts.inReplyToDiscussionId ?? null });
      log.push(opts.inReplyToDiscussionId ? `reply:${opts.inReplyToDiscussionId}:${opts.resolveDiscussion}` : `comment:${opts.position?.new_path}:${opts.position?.new_line}`);
      pending.push(d);
      return d;
    },
    deleteDraftNote: async (_p, _i, id) => { log.push(`delete:${id}`); pending = pending.filter(d => d.id !== id); },
    publishDraftNotes: async (_p, _i, o) => { log.push(`publish:${o.reviewerState}:${o.note}`); pending = []; },
    ...over,
  };
  const deps: ReviewSubmitDeps = {
    mutator, projectId: 99, iid: 7,
    position: (c, refs) => ({ ...refs, position_type: "text", new_path: c.path, old_path: c.oldPath ?? c.path, new_line: c.line }),
    approve: async () => { log.push("approve"); },
    resolve: async (id) => { log.push(`resolve:${id}`); },
  };
  return { deps, log, seed: (d: DraftNote[]) => { pending = d; }, pending: () => pending };
}

const INPUT = {
  outcome: "comment" as const, summary: "sum",
  comments: [{ body: "c1", path: "src/a.ts", line: 3 }, { body: "c2", path: "src/b.ts", line: 9 }],
  replies: [{ discussionId: "d1", body: "fixed, thanks", resolve: true }, { discussionId: "d2", resolve: true }, { discussionId: "d3", body: "still wrong", resolve: false }],
};

describe("submitReview", () => {
  test("posts comments, then replies, publishes once, then resolves the bodiless reply", async () => {
    const f = fake();
    const out = await submitReview(f.deps, INPUT);
    expect(f.log).toEqual([
      "list", "refs", "comment:src/a.ts:3", "comment:src/b.ts:9",
      "reply:d1:true", "reply:d3:false", "publish:reviewed:sum", "resolve:d2",
    ]);
    expect(out).toEqual({
      published: true, comments: 2, replies: 2, repliedTo: ["d1", "d3"],
      resolved: ["d1", "d2"], approved: false, resolveErrors: [],
    });
  });

  test("approve runs after the publish", async () => {
    const f = fake();
    const out = await submitReview(f.deps, { ...INPUT, outcome: "approve", replies: [] });
    expect(f.log.slice(-2)).toEqual(["publish:reviewed:sum", "approve"]);
    expect(out.published && out.approved).toBe(true);
  });

  test("the caller's own pending comments refuse the review before anything is created", async () => {
    const f = fake();
    f.seed([draft(50, { note: "half a thought\nsecond line" }), draft(51, { note: "another" })]);
    const out = await submitReview(f.deps, INPUT);
    expect(out).toEqual({ published: false, reason: "pending-drafts", pending: { count: 2, firstLines: ["half a thought", "another"] } });
    expect(f.log).toEqual(["list"]);
  });

  test("a null line_code deletes everything this call created and names the anchor", async () => {
    const f = fake({});
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      const d = await create(p, i, body, opts);
      return body === "c2" ? { ...d, line_code: null } : d;
    };
    const out = await submitReview(f.deps, INPUT);
    expect(out).toEqual({ published: false, reason: "bad-anchors", badAnchors: [{ index: 1, path: "src/b.ts", line: 9 }] });
    expect(f.log).not.toContain("publish:reviewed:sum");
    expect(f.pending()).toEqual([]);
  });

  test("a create that throws rolls back and reports nothing posted", async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === "c2") throw new Error("boom");
      return create(p, i, body, opts);
    };
    await expect(submitReview(f.deps, INPUT)).rejects.toThrow(/review not posted: Error: boom/);
    expect(f.pending()).toEqual([]);
  });

  test("a rollback that cannot delete says how many pending comments are left", async () => {
    const f = fake({ deleteDraftNote: async () => { throw new Error("nope"); } });
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === "c2") throw new Error("boom");
      return create(p, i, body, opts);
    };
    await expect(submitReview(f.deps, INPUT)).rejects.toThrow(/1 pending comment could not be deleted/);
  });

  test("a publish that throws but left no pending comments counts as landed", async () => {
    const f = fake();
    const publish = f.deps.mutator.publishDraftNotes;
    f.deps.mutator.publishDraftNotes = async (p, i, o) => { await publish(p, i, o); throw new Error("timeout"); };
    const out = await submitReview(f.deps, INPUT);
    expect(out.published).toBe(true);
  });

  test("a publish that throws and left pending comments deletes them and fails", async () => {
    const f = fake({ publishDraftNotes: async () => { throw new Error("502"); } });
    await expect(submitReview(f.deps, INPUT)).rejects.toThrow(/publish failed, nothing was posted/);
    expect(f.pending()).toEqual([]);
  });

  test("a publish that throws with nothing pending to check reports an unknown outcome", async () => {
    const f = fake({ publishDraftNotes: async () => { throw new Error("timeout"); } });
    await expect(submitReview(f.deps, { outcome: "comment", summary: "sum", comments: [], replies: [{ discussionId: "d2", resolve: true }] }))
      .rejects.toThrow(/outcome is unknown.*look for the summary/);
    expect(f.log).not.toContain("resolve:d2");
  });

  test("a refused approval after the publish is reported, not thrown", async () => {
    const f = fake();
    f.deps.approve = async () => { throw new Error("401 Unauthorized"); };
    const out = await submitReview(f.deps, { ...INPUT, outcome: "approve" });
    expect(out.published && out.approved).toBe(false);
    expect(out.published && out.approveError).toContain("401");
  });

  test("a failed resolve-only is listed and the rest still resolve", async () => {
    const f = fake();
    f.deps.resolve = async (id) => { if (id === "d2") throw new Error("gone"); };
    const out = await submitReview(f.deps, { ...INPUT, replies: [{ discussionId: "d2", resolve: true }, { discussionId: "d4", resolve: true }] });
    expect(out.published && out.resolved).toEqual(["d4"]);
    expect(out.published && out.resolveErrors).toEqual([{ discussionId: "d2", error: "Error: gone" }]);
  });

  test("a summary-only review skips diff refs and publishes", async () => {
    const f = fake();
    await submitReview(f.deps, { outcome: "comment", summary: "sum", comments: [], replies: [] });
    expect(f.log).toEqual(["list", "publish:reviewed:sum"]);
  });
});

describe("parseReviewSubmit", () => {
  const base = { outcome: "comment", summary: "s", comments: [], replies: [] };
  const bad = (over: object, error: string) => expect(parseReviewSubmit({ ...base, ...over })).toEqual({ ok: false, error });

  test("accepts the minimal review", () => {
    expect(parseReviewSubmit(base)).toEqual({ ok: true, input: base });
  });
  test("refuses anything but comment or approve", () => bad({ outcome: "request_changes" }, "outcome must be comment or approve"));
  test("refuses a blank summary", () => bad({ summary: "  " }, "summary must be a non-empty string"));
  test("refuses a comment without a positive integer line", () =>
    bad({ comments: [{ body: "b", path: "a.ts", line: 0 }] }, "comments[0]: body, path and a positive integer line are required"));
  test("refuses a bad oldLine", () =>
    bad({ comments: [{ body: "b", path: "a.ts", line: 1, oldLine: -1 }] }, "comments[0]: invalid oldPath/oldLine"));
  test("refuses a reply that neither posts nor resolves", () =>
    bad({ replies: [{ discussionId: "d1", resolve: false }] }, "replies[0]: a reply needs a body or resolve: true"));
  test("refuses a blank reply body", () =>
    bad({ replies: [{ discussionId: "d1", body: " ", resolve: true }] }, "replies[0]: body must be non-empty when present"));
  test("refuses the same thread twice", () =>
    bad({ replies: [{ discussionId: "d1", resolve: true }, { discussionId: "d1", body: "x", resolve: false }] }, "replies[1]: discussion d1 appears more than once"));
  test("refuses more than 100 comments", () =>
    bad({ comments: Array.from({ length: 101 }, () => ({ body: "b", path: "a.ts", line: 1 })) }, "at most 100 comments and 100 replies per review"));
});
```

- [ ] **Step 2: Run to verify failure**

Run (repo root): `bun test lib/daemon/__tests__/review-submit.test.ts`
Expected: FAIL, cannot find module `../review-submit.ts`.

- [ ] **Step 3: Implement `lib/daemon/review-submit.ts`**

```ts
/**
 * One GitLab review as one sequence: refuse on the caller's own pending
 * comments, create every comment and reply as a pending comment, publish
 * once, then approve and resolve. Pure over its deps; the handler in
 * handlers/discussions.ts supplies the real GitLab plumbing.
 */
import type { DiffRefs, NoteMutator, TextPosition } from "@mattstack/glance";
import type { ReviewSubmitComment, ReviewSubmitData, ReviewSubmitReply } from "../../packages/rt-client/src/commands.ts";

export type ReviewMutator = Pick<
  NoteMutator,
  "fetchDiffRefs" | "listDraftNotes" | "createDraftNote" | "deleteDraftNote" | "publishDraftNotes"
>;

export interface ReviewSubmitInput {
  outcome: "comment" | "approve";
  summary: string;
  comments: ReviewSubmitComment[];
  replies: ReviewSubmitReply[];
}

export interface ReviewSubmitDeps {
  mutator: ReviewMutator;
  projectId: number;
  iid: number;
  position: (comment: ReviewSubmitComment, refs: DiffRefs) => TextPosition;
  approve: () => Promise<void>;
  resolve: (discussionId: string) => Promise<void>;
}

/** The three fields the handler adds after the sequence: it alone knows the MR url and reads GitLab back. */
type Strip<T> = T extends unknown ? Omit<T, "mrUrl" | "reviewerState" | "summaryNoteId"> : never;
export type ReviewSubmitOutcome = Strip<ReviewSubmitData>;

const MAX_ITEMS = 100;
const PENDING_PREVIEW = 5;

const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function parseReviewSubmit(
  payload: unknown,
): { ok: true; input: ReviewSubmitInput } | { ok: false; error: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const fail = (error: string) => ({ ok: false as const, error });
  if (p.outcome !== "comment" && p.outcome !== "approve") return fail("outcome must be comment or approve");
  if (!isText(p.summary)) return fail("summary must be a non-empty string");
  if (!Array.isArray(p.comments) || !Array.isArray(p.replies)) return fail("comments and replies must be arrays");
  if (p.comments.length > MAX_ITEMS || p.replies.length > MAX_ITEMS) {
    return fail(`at most ${MAX_ITEMS} comments and ${MAX_ITEMS} replies per review`);
  }
  const comments: ReviewSubmitComment[] = [];
  for (const [i, raw] of p.comments.entries()) {
    const c = (raw ?? {}) as Record<string, unknown>;
    if (!isText(c.body) || !isText(c.path) || !isPosInt(c.line)) {
      return fail(`comments[${i}]: body, path and a positive integer line are required`);
    }
    if ((c.oldLine !== undefined && !isPosInt(c.oldLine)) || (c.oldPath !== undefined && !isText(c.oldPath))) {
      return fail(`comments[${i}]: invalid oldPath/oldLine`);
    }
    comments.push({
      body: c.body, path: c.path, line: c.line,
      ...(c.oldPath !== undefined ? { oldPath: c.oldPath as string } : {}),
      ...(c.oldLine !== undefined ? { oldLine: c.oldLine as number } : {}),
    });
  }
  const replies: ReviewSubmitReply[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of p.replies.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!isText(r.discussionId) || typeof r.resolve !== "boolean") {
      return fail(`replies[${i}]: discussionId and a boolean resolve are required`);
    }
    if (r.body !== undefined && !isText(r.body)) return fail(`replies[${i}]: body must be non-empty when present`);
    if (r.body === undefined && !r.resolve) return fail(`replies[${i}]: a reply needs a body or resolve: true`);
    if (seen.has(r.discussionId)) return fail(`replies[${i}]: discussion ${r.discussionId} appears more than once`);
    seen.add(r.discussionId);
    replies.push({ discussionId: r.discussionId, resolve: r.resolve, ...(r.body !== undefined ? { body: r.body as string } : {}) });
  }
  return { ok: true, input: { outcome: p.outcome, summary: p.summary, comments, replies } };
}

function firstLine(text: string): string {
  return (text.split("\n").find(l => l.trim()) ?? "").trim().slice(0, 120);
}

function leftover(n: number): string {
  return n === 0 ? "" : `; ${n} pending comment${n === 1 ? "" : "s"} could not be deleted and ${n === 1 ? "is" : "are"} still on the MR`;
}

export async function submitReview(deps: ReviewSubmitDeps, input: ReviewSubmitInput): Promise<ReviewSubmitOutcome> {
  const { mutator, projectId, iid } = deps;

  const before = await mutator.listDraftNotes(projectId, iid);
  if (before.length > 0) {
    return {
      published: false,
      reason: "pending-drafts",
      pending: { count: before.length, firstLines: before.slice(0, PENDING_PREVIEW).map(d => firstLine(d.note)) },
    };
  }

  const created: number[] = [];
  /** How many of this call's pending comments could NOT be deleted. */
  const rollback = async (): Promise<number> => {
    let left = 0;
    for (const id of created) {
      try {
        await mutator.deleteDraftNote(projectId, iid, id);
      } catch {
        left++;
      }
    }
    return left;
  };

  const badAnchors: Array<{ index: number; path: string; line: number }> = [];
  try {
    if (input.comments.length > 0) {
      const refs = await mutator.fetchDiffRefs(projectId, iid);
      for (const [index, c] of input.comments.entries()) {
        const d = await mutator.createDraftNote(projectId, iid, c.body, { position: deps.position(c, refs) });
        created.push(d.id);
        if (d.line_code === null) badAnchors.push({ index, path: c.path, line: c.line });
      }
    }
    if (badAnchors.length === 0) {
      for (const r of input.replies) {
        if (r.body === undefined) continue;
        const d = await mutator.createDraftNote(projectId, iid, r.body, {
          inReplyToDiscussionId: r.discussionId,
          resolveDiscussion: r.resolve,
        });
        created.push(d.id);
      }
    }
  } catch (err) {
    throw new Error(`review not posted: ${String(err)}${leftover(await rollback())}`);
  }
  if (badAnchors.length > 0) {
    const left = await rollback();
    if (left > 0) throw new Error(`review not posted: ${badAnchors.length} comment anchors are outside the diff${leftover(left)}`);
    return { published: false, reason: "bad-anchors", badAnchors };
  }

  try {
    await mutator.publishDraftNotes(projectId, iid, { note: input.summary, reviewerState: "reviewed" });
  } catch (err) {
    if (created.length === 0) {
      throw new Error(`publish failed and its outcome is unknown: ${String(err)}; look for the summary on the MR before retrying`);
    }
    let remaining;
    try {
      remaining = await mutator.listDraftNotes(projectId, iid);
    } catch (listErr) {
      throw new Error(`publish failed and its outcome is unknown: ${String(err)}; listing pending comments failed too: ${String(listErr)}; look for the summary on the MR before retrying`);
    }
    if (remaining.length > 0) {
      throw new Error(`publish failed, nothing was posted: ${String(err)}${leftover(await rollback())}`);
    }
  }

  let approved = false;
  let approveError: string | undefined;
  if (input.outcome === "approve") {
    try {
      await deps.approve();
      approved = true;
    } catch (err) {
      approveError = String(err);
    }
  }

  const resolved: string[] = [];
  const resolveErrors: Array<{ discussionId: string; error: string }> = [];
  for (const r of input.replies) {
    if (!r.resolve) continue;
    if (r.body !== undefined) {
      resolved.push(r.discussionId);
      continue;
    }
    try {
      await deps.resolve(r.discussionId);
      resolved.push(r.discussionId);
    } catch (err) {
      resolveErrors.push({ discussionId: r.discussionId, error: String(err) });
    }
  }

  const posted = input.replies.filter(r => r.body !== undefined);
  return {
    published: true,
    comments: input.comments.length,
    replies: posted.length,
    repliedTo: posted.map(r => r.discussionId),
    resolved,
    approved,
    ...(approveError !== undefined ? { approveError } : {}),
    resolveErrors,
  };
}
```

The empty `catch` in `rollback` counts the failure rather than dropping it; the count reaches the thrown error. That is the whole handling, so no log line is needed there.

- [ ] **Step 4: Run the sequence tests**

Run: `bun test lib/daemon/__tests__/review-submit.test.ts`
Expected: PASS, every test in both describes.

- [ ] **Step 5: Write the failing handler tests**

Create `lib/daemon/__tests__/discussions-review-submit.test.ts`:

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb } from "../../state/index.ts";
import { createDiscussionHandlers, type DiscussionHandlerSeams } from "../handlers/discussions.ts";
import type { ReviewMutator } from "../review-submit.ts";
import { fakeStore } from "./fake-cache-store.ts";

const fakeCtx = { repoIndex: () => ({}), cache: fakeStore({}) };
const IDENTITY = "remote:gitlab.com%2Fg%2Fsub%2Frepo-tools";
const MR_URL = "https://gitlab.example.com/g/sub/repo-tools/-/merge_requests/7";
const PAYLOAD = { repoName: IDENTITY, iid: 7, outcome: "approve", summary: "sum", comments: [{ body: "c", path: "a.ts", line: 2 }], replies: [] };

function seams(over: Partial<DiscussionHandlerSeams> = {}, calls: string[] = []): DiscussionHandlerSeams {
  const mutator: ReviewMutator & { fetchReviewerStates: () => Promise<Array<{ username: string; state: string }>> } = {
    fetchDiffRefs: async () => ({ base_sha: "b", start_sha: "s", head_sha: "h" }),
    listDraftNotes: async () => [],
    createDraftNote: async (_p, _i, body, opts) => {
      calls.push(`create:${JSON.stringify(opts?.position)}`);
      return { id: 1, note: body, discussion_id: null, line_code: "lc", resolve_discussion: false };
    },
    deleteDraftNote: async () => {},
    publishDraftNotes: async () => { calls.push("publish"); },
    fetchReviewerStates: async () => [{ username: "pat", state: "approved" }],
  };
  return {
    repoContext: async () => ({ provider: { baseURL: "https://gitlab.example.com" }, projectPath: "g/sub/repo-tools", projectId: 99 }),
    gitlabToken: async () => "tok",
    reviewMutator: () => mutator,
    reviewActions: async () => ({
      approve: async (iid) => { calls.push(`approve:${iid}`); },
      resolve: async (iid, id) => { calls.push(`resolve:${iid}:${id}`); },
    }),
    selfUsername: () => "pat",
    refresh: async () => ({
      discussions: [{ id: "n1", resolved: false, notes: [{ id: 501, body: "sum", author: { username: "pat" } }] }],
      fetchedAt: 1,
    }),
    ...over,
  };
}

describe("mr:review-submit", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "rt-review-submit-")); process.env.HOME = home; closeStateDb(); });
  afterEach(() => { process.env.HOME = origHome; closeStateDb(); rmSync(home, { recursive: true, force: true }); });

  test("submits, approves, and reports reviewer state, summary note and MR url", async () => {
    const calls: string[] = [];
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams({}, calls));
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res).toEqual({
      ok: true,
      data: {
        published: true, comments: 1, replies: 0, repliedTo: [], resolved: [], approved: true, resolveErrors: [],
        reviewerState: "approved", summaryNoteId: 501, mrUrl: MR_URL,
      },
    });
    expect(calls).toEqual([
      'create:{"base_sha":"b","start_sha":"s","head_sha":"h","position_type":"text","new_path":"a.ts","new_line":2,"old_path":"a.ts"}',
      "publish", "approve:7",
    ]);
  });

  test("a pending-drafts refusal answers ok with published false and the MR url", async () => {
    const s = seams();
    const m = s.reviewMutator!("", "");
    m.listDraftNotes = async () => [{ id: 9, note: "mine", discussion_id: null, line_code: null, resolve_discussion: false }];
    const h = createDiscussionHandlers(fakeCtx, () => {}, { ...s, reviewMutator: () => m });
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res).toEqual({ ok: true, data: { published: false, reason: "pending-drafts", pending: { count: 1, firstLines: ["mine"] }, mrUrl: MR_URL } });
  });

  test("an invalid payload is refused before any network call", async () => {
    const h = createDiscussionHandlers(fakeCtx, () => {}, seams({ repoContext: async () => { throw new Error("unexpected"); } }));
    expect(await h["mr:review-submit"]({ ...PAYLOAD, outcome: "request_changes" })).toEqual({ ok: false, error: "outcome must be comment or approve" });
    expect(await h["mr:review-submit"]({ ...PAYLOAD, iid: 0 })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h["mr:review-submit"]({ ...PAYLOAD, repoName: "not-an-identity" })).toEqual({ ok: false, error: "repo must be a serialized identity" });
  });

  test("a refresh or reviewer-state failure never turns a published review into a failure", async () => {
    const s = seams({ refresh: async () => { throw new Error("refresh boom"); } });
    const m = s.reviewMutator!("", "") as ReviewMutator & { fetchReviewerStates: () => Promise<never> };
    m.fetchReviewerStates = async () => { throw new Error("states boom"); };
    const h = createDiscussionHandlers(fakeCtx, () => {}, { ...s, reviewMutator: () => m });
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res.ok && res.data.published).toBe(true);
    expect(res.ok && res.data.published && res.data.reviewerState).toBeNull();
    expect(res.ok && res.data.published && res.data.summaryNoteId).toBeNull();
  });

  test("a sequence failure is ok:false with its message", async () => {
    const s = seams();
    const m = s.reviewMutator!("", "");
    m.publishDraftNotes = async () => { throw new Error("502"); };
    m.listDraftNotes = (() => { let n = 0; return async () => (n++ === 0 ? [] : [{ id: 1, note: "c", discussion_id: null, line_code: "lc", resolve_discussion: false }]); })();
    const h = createDiscussionHandlers(fakeCtx, () => {}, { ...s, reviewMutator: () => m });
    const res = await h["mr:review-submit"](PAYLOAD);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("publish failed, nothing was posted");
  });
});
```

Run: `bun test lib/daemon/__tests__/discussions-review-submit.test.ts`
Expected: FAIL, `h["mr:review-submit"] is not a function`.

- [ ] **Step 6: Wire the handler**

In `lib/daemon/handlers/discussions.ts`:

1. Add to the header comment's verb list: ` *   mr:review-submit     - post one whole review: pending comments, one publish, approve, resolve`.
2. Imports: add `getSelfUsername` to the `../freshness.ts` import, and add
   `import { parseReviewSubmit, submitReview, type ReviewMutator } from "../review-submit.ts";`.
3. Below `CommentMutator`:

```ts
/** What mr:review-submit needs from NoteMutator; test seam. */
export type ReviewSubmitMutator = ReviewMutator & Pick<NoteMutator, "fetchReviewerStates">;
```

4. Add to `DiscussionHandlerSeams`:

```ts
  reviewMutator?: (baseURL: string, token: string) => ReviewSubmitMutator;
  reviewActions?: (repoName: string, repoPath?: string) => Promise<{
    approve: (iid: number) => Promise<void>;
    resolve: (iid: number, discussionId: string) => Promise<void>;
  }>;
  selfUsername?: () => string | null;
```

5. Add to the return type intersection:
   `& { "mr:review-submit": (payload: unknown, signal?: AbortSignal) => Promise<CommandResult<"mr:review-submit">> }`
6. Beside the other seam defaults:

```ts
  const reviewMutatorFn = seams.reviewMutator ?? ((baseURL: string, token: string) => new NoteMutator(baseURL, token, providerRequestHook()));
  const reviewActionsFn = seams.reviewActions ?? (async (repoName: string, repoPath?: string) => {
    const { provider, projectPath } = await getRepoContext(repoName, repoPath);
    return {
      approve: (iid: number) => provider.approvePullRequest(projectPath, iid),
      resolve: (iid: number, discussionId: string) => provider.resolveDiscussion(projectPath, iid, discussionId),
    };
  });
  const selfUsernameFn = seams.selfUsername ?? getSelfUsername;
```

7. The handler, after `"mr:comment"`:

```ts
    "mr:review-submit": async (payload) => {
      const p = payload as { repoName?: string; iid?: number } | undefined;
      const iid = p?.iid;
      if (!p?.repoName || typeof iid !== "number" || !Number.isInteger(iid) || iid <= 0) {
        return { ok: false, error: "missing repoName/iid" };
      }
      const parsed = parseReviewSubmit(payload);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const decoded = decodeRepo(payload);
      if (!decoded.ok) {
        return { ok: false, error: "repo must be a serialized identity" };
      }
      const repoName = decoded.repo;

      const repoPath = ctx.repoIndex()[repoName];
      try {
        const repoCtx = await repoContextFn(repoName, repoPath);
        const token = await gitlabTokenFn();
        if (!token) return { ok: false, error: "no gitlabToken in secrets" };
        const mutator = reviewMutatorFn(repoCtx.provider.baseURL, token);
        const actions = await reviewActionsFn(repoName, repoPath);
        const mrUrl = `${repoCtx.provider.baseURL}/${repoCtx.projectPath}/-/merge_requests/${iid}`;

        const outcome = await submitReview({
          mutator,
          projectId: repoCtx.projectId,
          iid,
          position: buildTextPosition,
          approve: () => actions.approve(iid),
          resolve: (discussionId) => actions.resolve(iid, discussionId),
        }, parsed.input);
        if (!outcome.published) return { ok: true, data: { ...outcome, mrUrl } };

        // Everything below describes a review that already landed, so none of
        // it may answer ok:false: the caller would submit the review again.
        const self = selfUsernameFn();
        const refreshed = await refreshFn(repoName, iid).catch((err) => {
          log.warn({ err, repoName, iid }, "mr:review-submit: post-review discussions refresh failed");
          return undefined;
        }) as { discussions?: Discussion[] } | undefined;
        let summaryNoteId: number | null = null;
        for (const d of refreshed?.discussions ?? []) {
          for (const n of d.notes) {
            if (n.body === parsed.input.summary && (!self || n.author?.username === self) && n.id > (summaryNoteId ?? 0)) {
              summaryNoteId = n.id;
            }
          }
        }
        const states = await mutator.fetchReviewerStates(repoCtx.projectId, iid).catch((err) => {
          log.warn({ err, repoName, iid }, "mr:review-submit: reviewer state read failed");
          return [];
        });
        const reviewerState = self ? states.find((s) => s.username === self)?.state ?? null : null;
        return { ok: true, data: { ...outcome, reviewerState, summaryNoteId, mrUrl } };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
```

`buildTextPosition` already takes `(payload, diffRefs)` with `{path, line, oldPath?, oldLine?}`, which is `ReviewSubmitComment` minus `body`, so it passes as `position` unchanged.

- [ ] **Step 7: Run both test files and typecheck**

Run: `bun test lib/daemon/__tests__/review-submit.test.ts lib/daemon/__tests__/discussions-review-submit.test.ts` then `bun run typecheck`.
Expected: PASS; typecheck clean. If the handler test's fake discussion fails to type as `Discussion`, cast the `refresh` return in the test with `as never` (the seam returns `Promise<unknown>`).

- [ ] **Step 8: Commit**

```bash
git add :/lib/daemon/review-submit.ts :/lib/daemon/handlers/discussions.ts :/lib/daemon/__tests__/review-submit.test.ts :/lib/daemon/__tests__/discussions-review-submit.test.ts
git commit -m "daemon: mr:review-submit posts one whole GitLab review"
```

### Task 4: the `mr_review_submit` MCP tool

**Files:**
- Modify: `lib/mcp/tools.ts` (new tool object after `mr_comment`, before `mr_create`)
- Modify: `lib/mcp/__tests__/tools.test.ts` (the `NAMES` array on line 11; a new `describe`)
- Regenerate: `plugins/mattstack/attachments/mcp-tools/reference.md`
- Modify: `AGENTS.md` (the paragraph starting "The `mr_*` tools cover what board panes and pipeline verbs write")
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (patch bump)

**Interfaces:**
- Consumes: `Commands["mr:review-submit"]`, `resolveMrTarget`, `rtCommand`, `fromResponse`, `withLandingHint`, `checkRequired`, `MR_TARGET_PROPS`, `REPO_NAME_RULE`.
- Produces: tool `mr_review_submit` with input `{mrUrl | repoName+iid, outcome, summary, comments?, replies?}`; `comments` and `replies` default to `[]`.

- [ ] **Step 1: Write the failing tests**

In `tools.test.ts`, add `"mr_review_submit"` to `NAMES` right after `"mr_comment"`. Read the existing `describe("mr write tools: mr_comment, mr_create", ...)` block (lines 356-475) and copy its `beforeEach`/`afterEach` mock of `transport.ts` into a new block:

```ts
  describe("mr_review_submit", () => {
    let calls: Array<{ cmd: string; payload: Record<string, unknown>; timeoutMs?: number }>;
    let reply: () => unknown;
    afterEach(() => {
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({ ...realTransport, rtCommand: realRtCommand }));
    });
    beforeEach(() => {
      calls = [];
      reply = () => ({ ok: true, data: { published: true, comments: 1, replies: 0, repliedTo: [], resolved: [], approved: false, resolveErrors: [], reviewerState: "reviewed", summaryNoteId: 5, mrUrl: "https://gitlab.example.com/acme/webapp/-/merge_requests/7" } });
      mock.module("../../../packages/rt-client/src/transport.ts", () => ({
        ...realTransport,
        rtCommand: async (cmd: string, payload: Record<string, unknown>, opts?: { timeoutMs?: number }) => {
          calls.push({ cmd, payload, timeoutMs: opts?.timeoutMs });
          return reply();
        },
      }));
    });
    const tool = () => mcpTools().find((t) => t.name === "mr_review_submit")!;
    const TARGET = { repoName: "remote:gitlab.example.com%2Facme%2Fwebapp", iid: 7 };

    test("schema requires outcome and summary and limits outcome to comment or approve", () => {
      const schema = tool().inputSchema as { required?: string[]; properties: Record<string, { enum?: string[] }> };
      expect(schema.required).toEqual(["outcome", "summary"]);
      expect(schema.properties.outcome!.enum).toEqual(["comment", "approve"]);
    });

    test("sends mr:review-submit with a long timeout and empty arrays by default", async () => {
      const out = await tool().handler({ ...TARGET, outcome: "comment", summary: "s" }, {});
      expect(out.ok).toBe(true);
      expect(calls).toEqual([{ cmd: "mr:review-submit", payload: { ...TARGET, outcome: "comment", summary: "s", comments: [], replies: [] }, timeoutMs: 180_000 }]);
    });

    test("refuses a bad outcome and non-array comments before calling the daemon", async () => {
      expect((await tool().handler({ ...TARGET, outcome: "request_changes", summary: "s" }, {})).ok).toBe(false);
      expect((await tool().handler({ ...TARGET, outcome: "comment", summary: "s", comments: "x" }, {})).ok).toBe(false);
      expect(calls).toEqual([]);
    });

    test("a published:false refusal is returned as data, not as an error", async () => {
      reply = () => ({ ok: true, data: { published: false, reason: "bad-anchors", badAnchors: [{ index: 0, path: "a.ts", line: 3 }], mrUrl: "u" } });
      const out = await tool().handler({ ...TARGET, outcome: "comment", summary: "s", comments: [{ body: "b", path: "a.ts", line: 3 }] }, {});
      expect(out.ok).toBe(true);
    });

    test("a timeout says the review may have landed and where to look", async () => {
      reply = () => ({ ok: false, error: "request timed out" });
      const out = await tool().handler({ ...TARGET, outcome: "comment", summary: "s" }, {});
      expect(out.ok).toBe(false);
      expect(out.error).toContain("the MR's discussions");
    });
  });
```

Match the existing block's exact `handler` call signature and target shape when copying (read lines 356-430 first); if `resolveMrTarget` needs the `repos` verb mocked, reuse the mock the "mr target resolution wiring" block uses.

Run: `bun test lib/mcp/__tests__/tools.test.ts`
Expected: FAIL, the roster test reports `mr_review_submit` missing.

- [ ] **Step 2: Implement the tool**

Near `MR_UPLOAD_TIMEOUT_MS`:

```ts
/** A review is one GitLab request per comment and reply, in sequence. */
const MR_REVIEW_SUBMIT_TIMEOUT_MS = 180_000;
```

After the `mr_comment` tool:

```ts
    {
      name: "mr_review_submit",
      description: `GitLab only. Post one whole review in one call, exactly as GitLab's "Submit your review" does: every entry in comments becomes an inline thread, every entry in replies lands in its existing thread (resolve: true resolves it; a reply with no body only resolves), summary posts as the review's summary note, and the caller is marked as having reviewed. outcome "approve" also approves. Nothing reaches the MR unless all of it can: published: false with reason "bad-anchors" lists the comments whose line is outside the diff (move those findings into summary and call again), and reason "pending-drafts" means the caller already has pending comments on the MR that a submit would publish (they submit or discard them in GitLab first). published: true with approved: false means the review is up and only the approval was refused: never call this again for that review, use mr_approve. Returns counts, repliedTo, resolved, approved, reviewerState, summaryNoteId and mrUrl. ${REPO_NAME_RULE}`,
      inputSchema: {
        type: "object",
        properties: {
          ...MR_TARGET_PROPS,
          outcome: { type: "string", enum: ["comment", "approve"] },
          summary: { type: "string" },
          comments: {
            type: "array",
            items: {
              type: "object",
              properties: { body: { type: "string" }, path: { type: "string" }, line: { type: "number" }, oldPath: { type: "string" }, oldLine: { type: "number" } },
              required: ["body", "path", "line"],
              additionalProperties: false,
            },
          },
          replies: {
            type: "array",
            items: {
              type: "object",
              properties: { discussionId: { type: "string" }, body: { type: "string" }, resolve: { type: "boolean" } },
              required: ["discussionId", "resolve"],
              additionalProperties: false,
            },
          },
        },
        required: ["outcome", "summary"],
        additionalProperties: false,
      },
      shellForms: { none: "a submitted review has no glab verb; a glab api call hits the glab catch-all on mr_view" },
      async handler(input) {
        const bad = checkRequired(input, [{ name: "outcome", type: "string" }, { name: "summary", type: "string" }]);
        if (bad) return err(bad);
        if (input.outcome !== "comment" && input.outcome !== "approve") return err("outcome must be comment or approve");
        if (input.comments !== undefined && !Array.isArray(input.comments)) return err("comments must be an array");
        if (input.replies !== undefined && !Array.isArray(input.replies)) return err("replies must be an array");
        const target = await resolveMrTarget(input);
        if (!target.ok) return err(target.error);
        const payload: Commands["mr:review-submit"]["payload"] = {
          repoName: target.identity,
          iid: target.iid,
          outcome: input.outcome,
          summary: input.summary as string,
          comments: (input.comments ?? []) as Commands["mr:review-submit"]["payload"]["comments"],
          replies: (input.replies ?? []) as Commands["mr:review-submit"]["payload"]["replies"],
        };
        const res = await rtCommand<Commands["mr:review-submit"]["data"]>("mr:review-submit", payload, { timeoutMs: MR_REVIEW_SUBMIT_TIMEOUT_MS });
        return withLandingHint(fromResponse(res), "the MR's discussions");
      },
    },
```

Element-level validation is the daemon's (`parseReviewSubmit`); the tool does not repeat it.

- [ ] **Step 3: Run tests**

Run: `bun test lib/mcp/__tests__` (the whole folder: `shell-forms.test.ts` and `no-unredacted-mcp-output.test.ts` also read the roster).
Expected: PASS.

- [ ] **Step 4: Regenerate the reference and update AGENTS.md**

Run: `bun cli.ts mcp tools --json | bun plugins/mattstack/scripts/gen-mcp-tools.ts > plugins/mattstack/attachments/mcp-tools/reference.md`

(This is a pipe with a redirect, one command; if the Bash guard refuses it, write the two halves through a scratchpad file: `bun cli.ts mcp tools --json > <scratch>/tools.json`, then `bun plugins/mattstack/scripts/gen-mcp-tools.ts < <scratch>/tools.json > plugins/mattstack/attachments/mcp-tools/reference.md`.)

In root `AGENTS.md`, in the paragraph that begins "The `mr_*` tools cover what board panes and pipeline verbs write", replace its first sentence with:

```
The `mr_*` tools cover what board panes and pipeline verbs write (notes,
whole submitted reviews, approvals, resolves, draft state, retries, rebase,
create, update, upload, merge). `mr_review_submit` posts a review the way
GitLab's own submit does: pending comments, one publish with the summary and
a reviewed state, then the approval; it refuses when the caller already has
pending comments on the MR, because a publish would post those too.
```

Bump `plugins/mattstack/.claude-plugin/plugin.json` `version` by one patch (read the current value first; it was `0.30.4` when this plan was written).

- [ ] **Step 5: Verify the plugin gates and commit**

Run: `bun test scripts/__tests__` (covers the reference diff guard) and `bun run typecheck`.
Expected: PASS.

```bash
git add :/lib/mcp/tools.ts :/lib/mcp/__tests__/tools.test.ts :/plugins/mattstack/attachments/mcp-tools/reference.md :/AGENTS.md :/plugins/mattstack/.claude-plugin/plugin.json
git commit -m "mcp: mr_review_submit, one tool call per GitLab review"
```

### Task 5: harness test against the fixture repo

**Files:**
- Create: `packages/glance/tests/live-review-submit.test.ts` (beside `tests/live-events.test.ts`; `tsconfig.tests.json` includes `tests/live-*.test.ts`, and `bun test tests` picks it up, so the skip guard below is what keeps it off CI)

**Interfaces:**
- Consumes: Task 1's methods; from `tests/live/credentials.ts`: `loadCredentials()` (null when `harness_credentials.json` is absent), `ownerUser(creds)`, `approverUsers(creds)`, `gitlabRepo(creds)` (`{web_url, path_with_namespace?, project_id?}`); the gitbeaker MR pattern `tests/live-events.test.ts` lines 85-89 uses (`Projects.show`, `Branches.create`, `Commits.create`, `MergeRequests.create`, cleanup `Branches.remove` in a `finally`). The owner opens the MR and an approver reviews it: GitLab records no reviewer state for an MR's author.

This test mutates the real GitLab fixture project. Budget ONE run. Never print or stage `harness_credentials.json`.

- [ ] **Step 1: Write the test**

```ts
/**
 * Live check of NoteMutator's pending-comment calls against the harness
 * repo. Gated: set GLANCE_LIVE=1 to run; skipped silently otherwise.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Gitlab } from '@gitbeaker/rest';
import { NoteMutator, type TextPosition } from '../src/NoteMutator.ts';
import { approverUsers, gitlabRepo, loadCredentials, ownerUser } from './live/credentials.ts';

const LIVE = !!process.env.GLANCE_LIVE;
const FILE = `live-review-submit-${Date.now()}.txt`;
const FIVE_LINES = 'one\ntwo\nthree\nfour\nfive\n';

describe.skipIf(!LIVE)('live: submitted review', () => {
  let host: string;
  let repo: string;
  let projectId: number;
  let iid: number;
  let branch: string;
  let owner: InstanceType<typeof Gitlab>;
  let reviewer: NoteMutator;
  let reviewerName: string;
  let reviewerToken: string;

  beforeAll(async () => {
    const creds = await loadCredentials();
    if (!creds) throw new Error('harness_credentials.json not found at the package root');
    const gl = gitlabRepo(creds);
    host = new URL(gl.web_url).origin;
    repo = gl.path_with_namespace ?? new URL(gl.web_url).pathname.replace(/^\//, '');
    const approver = approverUsers(creds)[0];
    if (!approver) throw new Error('harness needs one approver user');
    reviewerName = approver.username;
    reviewerToken = approver.token;
    owner = new Gitlab({ host, token: ownerUser(creds).token });
    reviewer = new NoteMutator(host, reviewerToken);

    const proj = await owner.Projects.show(repo);
    projectId = gl.project_id ?? (proj.id as number);
    branch = `live-review-submit-${Date.now()}`;
    await owner.Branches.create(repo, branch, proj.default_branch as string);
    await owner.Commits.create(repo, branch, 'live-review-submit: five lines', [
      { action: 'create', filePath: FILE, content: FIVE_LINES },
    ]);
    const mr = await owner.MergeRequests.create(repo, branch, proj.default_branch as string, `Live review submit ${branch}`);
    iid = mr.iid as number;
    // GitLab computes diff_refs a moment after the MR opens; fetchDiffRefs throws until then.
    for (let attempt = 0; ; attempt++) {
      try {
        await reviewer.fetchDiffRefs(projectId, iid);
        break;
      } catch (err) {
        if (attempt >= 10) throw err;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  });

  afterAll(async () => {
    if (!owner || !branch) return;
    try { await owner.MergeRequests.edit(repo, iid, { stateEvent: 'close' }); } catch {}
    try { await owner.Branches.remove(repo, branch); } catch {}
  });

  const pos = (refs: { base_sha: string; start_sha: string; head_sha: string }, line: number): TextPosition =>
    ({ ...refs, position_type: 'text', new_path: FILE, old_path: FILE, new_line: line });

  test('a submitted review publishes its comment, drops a bad anchor only when asked, and sets the reviewer state', async () => {
    const refs = await reviewer.fetchDiffRefs(projectId, iid);

    const good = await reviewer.createDraftNote(projectId, iid, 'harness: inline finding', { position: pos(refs, 2) });
    expect(good.line_code).not.toBeNull();

    const bad = await reviewer.createDraftNote(projectId, iid, 'harness: outside the diff', { position: pos(refs, 9999) });
    expect(bad.line_code).toBeNull();
    await reviewer.deleteDraftNote(projectId, iid, bad.id);

    expect((await reviewer.listDraftNotes(projectId, iid)).map(d => d.id)).toEqual([good.id]);

    await reviewer.publishDraftNotes(projectId, iid, { note: 'harness: summary', reviewerState: 'reviewed' });
    expect(await reviewer.listDraftNotes(projectId, iid)).toEqual([]);

    const states = await reviewer.fetchReviewerStates(projectId, iid);
    expect(states.find(s => s.username === reviewerName)?.state).toBe('reviewed');
  });

  test('a pending reply with resolve resolves the thread on publish', async () => {
    const refs = await reviewer.fetchDiffRefs(projectId, iid);
    const thread = await reviewer.createPositionedDiscussion(projectId, iid, 'harness: thread to resolve', pos(refs, 3));
    await reviewer.createDraftNote(projectId, iid, 'harness: confirmed', {
      inReplyToDiscussionId: thread.id,
      resolveDiscussion: true,
    });
    await reviewer.publishDraftNotes(projectId, iid, { note: 'harness: round two', reviewerState: 'reviewed' });

    const res = await fetch(`${host}/api/v4/projects/${projectId}/merge_requests/${iid}/discussions/${thread.id}`, {
      headers: { 'PRIVATE-TOKEN': reviewerToken },
    });
    const d = (await res.json()) as { notes: Array<{ resolved?: boolean; body: string }> };
    expect(d.notes.at(-1)!.body).toBe('harness: confirmed');
    expect(d.notes[0]!.resolved).toBe(true);
  });
});
```

The two empty `catch` blocks in `afterAll` are cleanup of a fixture that may already be gone, the same shape `live-events.test.ts` uses.

- [ ] **Step 2: Confirm it skips, typecheck, then run once live**

Run (from `packages/glance`): `bun test tests/live-review-submit.test.ts` (expected: 2 skipped, exit 0), then `bun run check-types`, then `GLANCE_LIVE=1 bun test tests/live-review-submit.test.ts`.
Expected: 2 pass. If credentials are rejected (401), stop and report: Matt refreshes the harness tokens; do not retry in a loop.

- [ ] **Step 3: Commit**

```bash
git add :/packages/glance/tests/live-review-submit.test.ts
git commit -m "glance: live harness test for a submitted review"
```

### Task 6: the skills post one submitted review

**Files:**
- Modify: `plugins/mattstack/attachments/review-posting/SKILL.md`
- Modify: `plugins/mattstack/attachments/review/review/SKILL.md` (the posting nodes and edges at roughly lines 136-149 and 296-335, the sections from "Make the recorded summary move once" to "Open the review off-script gate: mr_approve refused" at roughly 648-694, the trailing "Posting mechanics on GitLab" paragraph at roughly 796-809)
- Modify: `apps/board/skills-src/review/SKILL.md` (the generic path's posting walk in the Flow digraph, and the sections "Add the finding to the summary note", "Mark the findings and summary already posted", "Fix what the mr_comment_inline error names", "Fix what the mr_comment error names", "Fix what the mr_approve error names", and the three matching off-script gate sections)
- Regenerate: `apps/board/skills/` via `bun run skills:expand:board`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (patch bump)

**Interfaces:**
- Consumes: the `mr_review_submit` tool exactly as Task 4 describes it.
- Produces: skill text later tasks extend. Node names below are exact; Task 11 adds `replies` to the same call.

**REQUIRED SUB-SKILLS:** `mattstack:editing-skills`, `superpowers:writing-skills`, `mattstack:process-digraphs`. Follow the editing-skills pipeline to the commit; do not run the sync legs (those happen after merge).

- [ ] **Step 1: RED baseline**

Dispatch a fresh agent (general-purpose, no access to this plan) with the CURRENT compiled review skill text and this scenario; record what it does verbatim in the task report:

> You hold a decided selection `{findings: ["f1","f2","f3"], disposition: "comment"}` for MR `https://gitlab.example.com/acme/webapp/-/merge_requests/41`. f1 and f2 anchor to `src/cart.ts:12` and `src/cart.ts:40`; f3 has no file anchor. Tools available: mr_comment_inline, mr_comment, mr_approve, mr_review_submit. List, in order, every tool call you would make with its arguments. Do not call any tool.

Expected baseline (the failure): three or more calls (`mr_comment_inline` twice, `mr_comment`), no `mr_review_submit`.

Second scenario for the refusal paths, same agent type, fresh:

> Same selection, disposition `approve`. Your first posting call returned `{published: false, reason: "bad-anchors", badAnchors: [{index: 1, path: "src/cart.ts", line: 40}], mrUrl: "..."}`. What do you do next? Then: the next call returned `{published: true, approved: false, approveError: "401 Unauthorized", ...}`. What do you do next?

Expected baseline: no defined behaviour (the current skill has no such result).

- [ ] **Step 2: Edit `review-posting/SKILL.md`**

Replace the section "## Posting mechanics by disposition" with:

```markdown
## Posting mechanics by disposition

Comment and Approve execute everywhere. Request changes executes only on
GitHub (`gh pr review --request-changes`); rt's GitLab MR tools have no
Request changes. Where it is unavailable, post a blocking-framed Comment:
the summary's Assessment names the findings that block the merge and says
approval is withheld until they are fixed.

On GitLab a review is ONE submitted review: the selected findings with a
`file` and `line` as its comments, the summary as its summary note, and
the disposition as its outcome, all in a single call. Nothing posts on its
own before or after that call. The forge marks the reviewer as having
reviewed, and approves when the disposition is Approve.

A comment whose line is outside the diff cannot be placed. The call says
which ones and posts nothing: move each named finding into the summary's
issue list, exactly as a finding with no `file` anchor, and make the call
again, once.

A review that posted but whose approval was refused is posted. Approve it
on its own; never submit the review a second time.
```

In "## Summary comment", replace the first sentence with: "A review is the inline threads for the selected findings plus ONE summary, identical regardless of which disposition was chosen." Leave the rest.

In the Red flags table add two rows:

```markdown
| "I'll post the inline comments first, then the summary" | On GitLab the review is one call. Comments posted one by one never become a submitted review, and the reviewer never reads as having reviewed. |
| "The approval failed, I'll run the whole review again" | The review is already up. Approve on its own; a second submit posts every finding twice. |
```

In the Quick reference table replace the "Disposition is Approve" row with:
`| Disposition is Approve | GitLab: outcome approve on the one submit. GitHub: gh pr review --approve. |`

- [ ] **Step 3: Edit the engine's posting graph (`review/review/SKILL.md`)**

In the digraph, delete these nodes and every edge that touches them: `"Next selected finding with a file anchor?"`, `"mr_comment_inline {mrUrl, path, line, body}"`, `"mr_comment_inline result?"`, `"STOP: never post with the GitLab CLI; open the review off-script gate for the refused comment"`, `"Open the review off-script gate: mr_comment_inline refused"`, `"Inline comment off-script answer?"`, `"mr_comment {mrUrl, body, resolvable}"`, `"mr_comment result?"`, `"Open the review off-script gate: mr_comment summary refused"`, `"Summary comment off-script answer?"`, `"Make the recorded summary move once"`, `"Review disposition is approve?"`.

Keep `"mr_approve {mrUrl}"`, `"mr_approve result?"`, `"Open the review off-script gate: mr_approve refused"`, `"Approval off-script answer?"`, `"Make the recorded approval move once"` and their edges, except the edge INTO `"mr_approve {mrUrl}"` from the deleted disposition diamond.

Add these nodes (shapes per process-digraphs):

```dot
    "Compose the submitted review: comments, summary, outcome" [shape=box];
    "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [shape=plaintext];
    "mr_review_submit result?" [shape=diamond];
    "Bad anchors moved into the summary once already?" [shape=diamond];
    "Move the bad-anchor findings into the summary" [shape=box];
    "STOP: never post a review piece by piece or with the GitLab CLI; open the review off-script gate" [shape=octagon style=filled fillcolor=red fontcolor=white];
    "Open the review off-script gate: mr_review_submit refused" [shape=box];
    "Open the review off-script gate: pending comments on the MR" [shape=box];
    "Review submit off-script answer?" [shape=diamond];
    "Make the recorded review move once" [shape=box];
```

And these edges (the `"Review posting forge?"` GitLab edge is retargeted):

```dot
    "Review posting forge?" -> "Compose the submitted review: comments, summary, outcome" [label="GitLab"];
    "Compose the submitted review: comments, summary, outcome" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}";
    "mr_review_submit {mrUrl, outcome, summary, comments, replies}" -> "mr_review_submit result?";
    "mr_review_submit result?" -> "run_decision {contract: gate@1, scope: post, selection: {findings, disposition}, decidedBy}" [label="published, approved as asked: keep mrUrl"];
    "mr_review_submit result?" -> "Open the review off-script gate: mr_approve refused" [label="published, approved: false on an approve"];
    "mr_review_submit result?" -> "Bad anchors moved into the summary once already?" [label="published: false, bad-anchors"];
    "mr_review_submit result?" -> "Open the review off-script gate: pending comments on the MR" [label="published: false, pending-drafts"];
    "mr_review_submit result?" -> "Open the review off-script gate: mr_review_submit refused" [label="error"];
    "mr_review_submit result?" -> "STOP: never post a review piece by piece or with the GitLab CLI; open the review off-script gate" [label="tempted to post the pieces with mr_comment_inline, mr_comment or the GitLab CLI"];
    "STOP: never post a review piece by piece or with the GitLab CLI; open the review off-script gate" -> "Open the review off-script gate: mr_review_submit refused";
    "Bad anchors moved into the summary once already?" -> "Move the bad-anchor findings into the summary" [label="no"];
    "Bad anchors moved into the summary once already?" -> "Open the review off-script gate: mr_review_submit refused" [label="yes"];
    "Move the bad-anchor findings into the summary" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}";
    "Open the review off-script gate: mr_review_submit refused" -> "Review submit off-script answer?";
    "Open the review off-script gate: pending comments on the MR" -> "Review submit off-script answer?";
    "Review submit off-script answer?" -> "Make the recorded review move once" [label="take"];
    "Review submit off-script answer?" -> "mr_review_submit {mrUrl, outcome, summary, comments, replies}" [label="iterate here: retry with their note"];
    "Review submit off-script answer?" -> "run_decision {contract: gate@1, scope: hold:<stage>:<attempt>, selection: {reason}, decidedBy} for review" [label="hold"];
    "Review submit off-script answer?" -> "Own review run: close it as abandoned?" [label="hand back"];
    "Make the recorded review move once" -> "run_decision {contract: gate@1, scope: post, selection: {findings, disposition}, decidedBy}";
```

Replace the sections "### Make the recorded summary move once", "### Open the review off-script gate: mr_comment_inline refused" and "### Open the review off-script gate: mr_comment summary refused" with:

```markdown
### Compose the submitted review: comments, summary, outcome

One call carries the whole review. `comments` is one entry per selected
finding that has both `file` and `line`: `{body, path, line}`, `body` the
finding as the summary would state it (tier, title, what to change).
`summary` is the review-posting summary, its issue list holding every
selected finding with no `file` or no `line`. `outcome` is the
disposition: `comment` or `approve`. `replies` is empty on a first review.

### Move the bad-anchor findings into the summary

The result's `badAnchors` names comments by their index in `comments`.
Nothing posted. Take each named finding out of `comments` and add it to
the summary's issue list with its `file:line` in the text, as a finding
with no anchor. Call again with the rest unchanged. This happens once: a
second bad-anchors result is a refusal.

### Make the recorded review move once

Exactly the move the off-script gate recorded for the refused review,
once.

### Open the review off-script gate: mr_review_submit refused

Nothing is on the MR unless the error says the outcome is unknown. The
proposed move: the human posts the review in the forge UI (the summary and
every comment quoted in full in `context`), and the run records it as
posted by the human. When the error says the outcome is unknown, `context`
says so first, and the human looks for the summary on the MR before
choosing.

### Open the review off-script gate: pending comments on the MR

The reviewer already has pending comments on this MR, started in the
forge UI; a submit would publish those along with the review. `context`
quotes the count and the first lines the result gave. The proposed move:
the human submits or discards those pending comments in the forge UI, and
this gate's iterate retries the same call.
```

Change "### Open the review off-script gate: mr_approve refused" body's first sentence to: "The review is posted; only the approval failed." Add to its end: "Iterate retries `mr_approve` alone, never the review."

Replace the trailing "Posting mechanics on GitLab: ..." paragraph (after `{{include:review-posting}}`) with:

```markdown
Posting mechanics on GitLab: the review is ONE `mr_review_submit` call
(comments, summary, outcome; `replies` on a re-review). It answers
`published: true` with `mrUrl`, the link the close needs, or `published:
false` with the reason and nothing posted. The daemon checks every
comment's placement before it publishes, so never hand-build a position
payload and never post a finding with `mr_comment_inline` here. On GitHub
use `gh pr review` / `gh pr comment`: GitHub has no inline mechanism, so
every selected finding, anchored or not, rides in the one `gh pr review`
body, with its `file:line` in the text.
```

In "## What the graph cannot show", replace the bullet "On a resume, a thread or note that the latest hold's reason names as already posted is never posted again; its finding is skipped at posting." with: "On a resume, a review whose summary the latest hold's reason names as already posted is never submitted again."

Update the outcome-options row of the extras table (near line 576) to end its first sentence at "`comment` and `approve`, each described by what picking it does for this review." and keep the `request_changes` GitHub clause as is.

- [ ] **Step 4: Edit the board wrapper (`apps/board/skills-src/review/SKILL.md`)**

The generic path posts on its own. Read the Flow digraph (lines 45-498) and find its posting walk: every node naming `mr_comment_inline`, `mr_comment`, `mr_approve`, `Findings left to post (review)?`, `Summary note carries findings?`, and their fix-once and off-script nodes. Replace that walk with the same shape as Step 3, using this wrapper's naming convention (suffix ` (review)` where the wrapper's other nodes carry one):

- `"Compose the submitted review (review)"` → `"mr_review_submit {mrUrl, outcome, summary, comments, replies} (review)"` → `"mr_review_submit result (review)?"`
- published → the existing `done` status write with `--outcome`
- published, `approved: false` on an approve → the existing mr_approve fix-once and off-script nodes (keep them)
- bad-anchors → `"Bad anchors moved once already (review)?"` → `"Move the bad-anchor findings into the summary (review)"` → the submit again
- pending-drafts → `"review off-script gate: pending comments on the MR"`
- error → `"Fixed the mr_review_submit call once already?"` → `"Fix what the mr_review_submit error names"` → the submit again; second error → `"review off-script gate: mr_review_submit refused"`

Replace sections:

- "### Add the finding to the summary note": last sentence becomes "The summary posts once, as the `summary` of the one `mr_review_submit` call."
- "### Mark the findings and summary already posted" becomes:

```markdown
### Mark the review already posted

The Posted already rule, on a resumed pane (`--resumed-gate` given) before
anything posts. A review posts whole or not at all, so one fact settles
it: in the `mr_threads` result, a top-level note carrying this review's
summary, written by the account this pane posts as after the verdict's
`answeredAt` (from the resumed wait on a `review-post` resume, from the
verdict line on an escalation resume). When it is there the review landed:
skip the submit and go on to the approval check. When it is not, nothing
landed: submit. A `review-escalation-mark:` line in `--report` saying the
human posted the review counts the same as the note. Approval has no
read: on an approve verdict `mr_approve` runs unless a mark says it was
approved by hand; approving an approved MR is harmless.
```

- Replace "### Fix what the mr_comment_inline error names" and "### Fix what the mr_comment error names" with one section:

```markdown
### Fix what the mr_review_submit error names

`mr_review_submit` refused the call itself. Correct what the error names:
`mrUrl` the MR's https URL; `outcome` exactly `comment` or `approve`;
`summary` non-empty; each comment a `body`, a `path` and a positive
integer `line`; each reply a `discussionId` and a boolean `resolve`, with
a `body` or `resolve: true`. An error that names no input has nothing to
correct: call again unchanged, once, and the off-script gate follows. An
error that says the outcome is unknown is never retried: it goes straight
to the off-script gate. An error is never a reason to post the findings
one by one.
```

- Replace the two off-script sections for `mr_comment_inline` and `mr_comment` with "### review off-script gate: mr_review_submit refused" and "### review off-script gate: pending comments on the MR", bodies as in Step 3 but in this wrapper's off-script format (read "## Off-script step" at line ~1236 and the existing "### review off-script gate: mr_approve refused" for the exact shape, origin naming and escalation-mark wording, and mirror them).
- Update every cross-reference to the renamed sections ("Escalation marks" text, `Record the resumed take's mark in --report (review)`): a take at a posting origin now writes one mark for the review, not per finding.

- [ ] **Step 5: Expand and compile**

Run (repo root): `bun run skills:expand:board`. Then compile the checkout's sources per `mattstack:editing-skills` "Compile the checkout's sources on Bash".
Expected: both exit 0; `git status` shows `apps/board/skills/review/SKILL.md` changed.

- [ ] **Step 6: GREEN**

Re-run both Step 1 scenarios with fresh agents against the NEW compiled text. Expected: scenario 1 answers one `mr_review_submit` with two `comments`, f3 in `summary`, `outcome: "comment"`, `replies: []`. Scenario 2 answers: move f2 into the summary and call again; then on `approved: false` open the approval off-script gate and never call `mr_review_submit` again. If an agent still reaches for `mr_comment_inline`, revise against its transcript (at most 3 craft rounds, then report).

- [ ] **Step 7: Certify, bump, verify, commit**

Run certify per editing-skills on each edited skill dir, then `bun cli.ts skills check --strict`, then `bun test scripts/__tests__` and (from `apps/board`) `bun test src/__tests__/skills-review-open-gate.test.ts src/__tests__/skills-resolve.test.ts`.
Expected: all pass. Bump `plugin.json` patch version.

```bash
git add :/plugins/mattstack :/apps/board/skills-src/review :/apps/board/skills
git commit -m "review skills: a GitLab review posts as one submitted review"
```

### Task 7: the pill reads a submitted review

**Files:**
- Modify: `apps/board/src/discussions.ts` (new export after `threadsOpenedBy`)
- Modify: `apps/board/src/data.ts` (`BoardMR`, after `generalComments`)
- Modify: `apps/board/src/view.ts` (`statusBucket`, plus a helper above it)
- Modify: `apps/board/src/server.ts` (`enrichReviewerComments`, near line 700)
- Test: `apps/board/src/__tests__/discussions.test.ts`, `apps/board/src/client/board/__tests__/row-status.test.ts`

**Interfaces:**
- Produces:

```ts
// discussions.ts
export function hasQuietReview(detail: MRDetail, comments: GeneralComment[], author: string | null, members: ReadonlySet<string>): boolean
// data.ts, on BoardMR
quietReview?: boolean;
```

- [ ] **Step 1: Write the failing tests**

Append to the `statusPhrase` describe in `row-status.test.ts`:

```ts
  test('a reviewer who submitted a review with no threads reads commented', () => {
    expect(
      statusPhrase(
        settled({
          reviews: {
            isApproved: false, required: 2, given: 0, remaining: 2,
            reviewers: [{ username: 'sam', reviewState: 'REVIEWED' }],
          },
          threadSummary: { awaiting: 0, replied: 0, resolved: 0 },
        })
      )
    ).toEqual({ text: 'commented', hue: 'accent' });
  });

  test('a submitted review whose threads are all resolved still reads comments resolved', () => {
    expect(
      statusPhrase(
        settled({
          reviews: {
            isApproved: false, required: 2, given: 0, remaining: 2,
            reviewers: [{ username: 'sam', reviewState: 'REVIEWED' }],
          },
          reviewerComments: 0,
          threadSummary: { awaiting: 0, replied: 0, resolved: 3 },
        })
      )
    ).toEqual({ text: 'comments resolved', hue: 'purple' });
  });

  test("a member's plain note or an armed latch reads commented on an MR GitLab never marked", () => {
    expect(
      statusPhrase(
        settled({
          ...unapproved(0, 2),
          quietReview: true,
          threadSummary: { awaiting: 0, replied: 0, resolved: 0 },
        })
      )
    ).toEqual({ text: 'commented', hue: 'accent' });
  });

  test('approval still outranks a submitted review', () => {
    expect(statusPhrase(settled({ quietReview: true }))).toEqual({ text: 'approved', hue: 'green' });
  });
```

Append to `apps/board/src/__tests__/discussions.test.ts` (read its existing fixture helpers first and reuse its note/discussion builders; the shapes below show the facts each case needs). Import the real armed marker from `../latch/markers.ts` rather than writing the marker text by hand: read that file for the exported builder or constant that produces an armed latch body, and use it for `ARMED_BODY`.

```ts
describe('hasQuietReview', () => {
  const members = new Set(['sam', 'pat']);
  const note = (username: string, body = 'x') => ({ id: 1, name: username, username, at: '2026-09-01T00:00:00Z', body });
  const detail = (discussions: unknown[]) => ({ discussions }) as never;

  test("a roster member's plain note on someone else's MR counts", () => {
    expect(hasQuietReview(detail([]), [note('sam')], 'pat', members)).toBe(true);
  });
  test("the author's own plain note does not", () => {
    expect(hasQuietReview(detail([]), [note('pat')], 'pat', members)).toBe(false);
  });
  test("an outsider's plain note does not", () => {
    expect(hasQuietReview(detail([]), [note('kit')], 'pat', members)).toBe(false);
  });
  test('an armed latch that is not resolved counts', () => {
    const d = { id: 'L', resolved: false, notes: [{ id: 9, body: ARMED_BODY, createdAt: 'x' }] };
    expect(hasQuietReview(detail([d]), [], 'pat', members)).toBe(true);
  });
  test('a resolved or spent latch does not', () => {
    const d = { id: 'L', resolved: true, notes: [{ id: 9, body: ARMED_BODY, createdAt: 'x' }] };
    expect(hasQuietReview(detail([d]), [], 'pat', members)).toBe(false);
  });
});
```

Run (from `apps/board`): `bun test src/__tests__/discussions.test.ts src/client/board/__tests__/row-status.test.ts`
Expected: FAIL, `hasQuietReview` is not exported; the three new pill cases read "needs review".

- [ ] **Step 2: Implement**

`apps/board/src/discussions.ts`, after `threadsOpenedBy`:

```ts
/** A review GitLab's reviewer state never recorded: a roster member other
    than the author left a plain note, or the board's own latch is armed and
    waiting on the author. Reviews posted before the board submitted them as
    reviews look like this. */
export function hasQuietReview(
  detail: MRDetail,
  comments: GeneralComment[],
  author: string | null,
  members: ReadonlySet<string>
): boolean {
  if (
    comments.some(
      c => c.username !== null && c.username !== author && members.has(c.username)
    )
  )
    return true;
  return detail.discussions.some(d => {
    const root = d.notes[0];
    return !!root && latchKindOf(root.body ?? '') === 'armed' && !d.resolved;
  });
}
```

`apps/board/src/data.ts`, after `generalComments?: number;`:

```ts
  /** A member reviewed without GitLab recording a reviewer state: their
      plain note, or an armed latch. Set by the discussions fetch. */
  quietReview?: boolean;
```

`apps/board/src/view.ts`, above `statusBucket`:

```ts
/** Some reviewer submitted a review without approving. */
function anyReviewerReviewed(mr: BoardMR): boolean {
  return (mr.reviews.reviewers ?? []).some(r => r.reviewState === 'REVIEWED');
}
```

and in `statusBucket`, replace the final `return { label: 'needs review', order: 2 };` with:

```ts
  if (anyReviewerReviewed(mr) || mr.quietReview)
    return { label: 'commented', order: 1 };
  return { label: 'needs review', order: 2 };
```

`apps/board/src/server.ts`, in `enrichReviewerComments`: add `hasQuietReview` to the `./discussions.ts` import, build the roster once at the top of the function, and set the field after `m.generalComments`:

```ts
  const roster = new Set(config.members.map(member => member.username));
```

```ts
          m.quietReview = hasQuietReview(
            detail,
            comments,
            m.author.username,
            roster
          );
```

- [ ] **Step 3: Run tests and the board gates**

Run (from `apps/board`): `bun test src/__tests__/discussions.test.ts src/client/board/__tests__/row-status.test.ts src/__tests__/view.test.ts` then `bun run typecheck`.
Expected: PASS, typecheck clean.

- [ ] **Step 4: Look at it**

The pill has no new markup, only a new path to an existing label, so no new screenshot baseline. Confirm with the existing row story: run Storybook (`bunx storybook dev -p 6006 --no-open --ci` from the repo root, in the background) and check a `RowView` story still renders "commented" in accent in both schemes. Say in the report what was looked at.

- [ ] **Step 5: Commit**

```bash
git add :/apps/board/src/discussions.ts :/apps/board/src/data.ts :/apps/board/src/view.ts :/apps/board/src/server.ts :/apps/board/src/__tests__/discussions.test.ts :/apps/board/src/client/board/__tests__/row-status.test.ts
git commit -m "board: the pill reads a submitted review, a member's note, and an armed latch as commented"
```

**Phase 1 gate:** from the repo root `bun run typecheck` and `bun test lib/daemon/__tests__ lib/mcp/__tests__`; from `apps/board` `bun test`; from `packages/glance` `bun test`. All green before Phase 2.

---

# Phase 2: rounds 2 to N

Ships alone: a re-review checks the reviewer's earlier threads, replies in and resolves them through the one submit, and reports only new findings.

### Task 8: the round record (board state db v4)

**Files:**
- Modify: `apps/board/src/state/db.ts` (`SCHEMA_VERSION`, a `V4_SCHEMA` constant, one `MIGRATIONS` entry)
- Create: `apps/board/src/review-rounds.ts`
- Modify: `apps/board/src/review-state.ts` (`dropPrunedReviewState`)
- Test: `apps/board/src/__tests__/state-db.test.ts`, create `apps/board/src/__tests__/review-rounds.test.ts`

**Interfaces:**
- Produces:

```ts
// apps/board/src/review-rounds.ts
export type SkippedSeverity = 'critical' | 'important' | 'minor';
export interface SkippedFinding {
  /** Round-qualified: `r<round>-<finding id>`. */
  id: string;
  title: string;
  severity: SkippedSeverity;
  file?: string;
  line?: number;
  excerpt: string;
  snippet: string;
}
export interface ReviewRound {
  mrUrl: string; round: number; reviewedSha: string; outcome: ReviewOutcome;
  skipped: SkippedFinding[]; restored: string[]; confirmed: string[]; recordedAt: number;
}
export interface LedgerView {
  /** The last recorded round; 0 when the MR has none. */
  round: number;
  reviewedSha: string | null;
  rounds: Array<{ round: number; reviewedSha: string; recordedAt: number }>;
  skipped: Array<SkippedFinding & { round: number }>;
  confirmed: string[];
}
export function qualifySkippedId(round: number, id: string): string
export function recordRound(row: ReviewRound, db?: Database): void
export function readRounds(mrUrl: string, db?: Database): ReviewRound[]
export function ledgerView(rounds: ReviewRound[]): LedgerView
export function dropRounds(mrUrl: string, db?: Database): void
```

- [ ] **Step 1: Announce the version**

Before writing code, post in rt chat (the room the estate uses for coordination; `rt chat rooms` lists them): "Taking board state db v4 (apps/board/src/state/db.ts) on branch review-rounds for a review_rounds table. Shout if you hold v4." If another lane answers that it holds v4, stop and report; the controller renumbers.

- [ ] **Step 2: Write the failing tests**

In `state-db.test.ts`, add:

```ts
  test('v4 adds review_rounds, and a v3 db upgrades in place with its rows intact', () => {
    const p = join(dir, 'state.db');
    const db = openStateDb(p);
    db.run(
      "INSERT INTO agent_states (lane, mr_url, state, handle, updated_at) VALUES ('review', 'u', '{}', 'h', 1)"
    );
    db.run('DROP TABLE review_rounds');
    db.run('PRAGMA user_version = 3');
    db.close();
    closeStateDb();
    const again = openStateDb(p);
    expect(
      again.query("SELECT name FROM sqlite_master WHERE name = 'review_rounds'").get()
    ).not.toBeNull();
    expect(again.query('SELECT COUNT(*) AS n FROM agent_states').get()).toEqual({ n: 1 });
    expect(SCHEMA_VERSION).toBe(4);
  });
```

Match the file's existing setup (`dir`, imports of `openStateDb`, `closeStateDb`, `SCHEMA_VERSION`); read lines 1-60 first and reuse its names.

Create `apps/board/src/__tests__/review-rounds.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  dropRounds,
  ledgerView,
  qualifySkippedId,
  readRounds,
  recordRound,
  type ReviewRound,
  type SkippedFinding,
} from '../review-rounds.ts';
import { openStateDb } from '../state/db.ts';

const URL_A = 'https://gitlab.example.com/acme/webapp/-/merge_requests/41';
let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rr-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const skip = (id: string, title: string): SkippedFinding => ({
  id, title, severity: 'minor', file: 'src/cart.ts', line: 12, excerpt: 'why', snippet: 'const a = 1;',
});
const round = (n: number, over: Partial<ReviewRound> = {}): ReviewRound => ({
  mrUrl: URL_A, round: n, reviewedSha: `sha${n}`, outcome: 'comment',
  skipped: [], restored: [], confirmed: [], recordedAt: n * 1000, ...over,
});

describe('review rounds', () => {
  test('an MR with no rounds reads as round 0', () => {
    expect(ledgerView(readRounds(URL_A, db))).toEqual({
      round: 0, reviewedSha: null, rounds: [], skipped: [], confirmed: [],
    });
  });

  test('rounds read back in order with their json columns parsed', () => {
    recordRound(round(2, { confirmed: ['d2'] }), db);
    recordRound(round(1, { skipped: [skip('r1-f1', 'first')], confirmed: ['d1'] }), db);
    const rows = readRounds(URL_A, db);
    expect(rows.map(r => r.round)).toEqual([1, 2]);
    expect(rows[0]!.skipped[0]!.title).toBe('first');
    const view = ledgerView(rows);
    expect(view.round).toBe(2);
    expect(view.reviewedSha).toBe('sha2');
    expect(view.rounds).toEqual([
      { round: 1, reviewedSha: 'sha1', recordedAt: 1000 },
      { round: 2, reviewedSha: 'sha2', recordedAt: 2000 },
    ]);
    expect(view.confirmed).toEqual(['d1', 'd2']);
  });

  test('recording a round again replaces it', () => {
    recordRound(round(1, { outcome: 'comment' }), db);
    recordRound(round(1, { outcome: 'approve' }), db);
    expect(readRounds(URL_A, db).map(r => r.outcome)).toEqual(['approve']);
  });

  test('a restored finding leaves the skipped list; its namesake from another round stays', () => {
    recordRound(round(1, { skipped: [skip('r1-f1', 'round one f1'), skip('r1-f2', 'round one f2')] }), db);
    recordRound(round(2, { skipped: [skip('r2-f1', 'round two f1')], restored: ['r1-f1'] }), db);
    const view = ledgerView(readRounds(URL_A, db));
    expect(view.skipped.map(s => [s.id, s.round])).toEqual([['r1-f2', 1], ['r2-f1', 2]]);
  });

  test('qualifySkippedId prefixes a bare id and leaves a qualified one alone', () => {
    expect(qualifySkippedId(2, 'f3')).toBe('r2-f3');
    expect(qualifySkippedId(2, 'r1-f3')).toBe('r1-f3');
  });

  test('rounds are per MR, and dropRounds removes only that MR', () => {
    recordRound(round(1), db);
    recordRound(round(1, { mrUrl: `${URL_A}0` }), db);
    dropRounds(URL_A, db);
    expect(readRounds(URL_A, db)).toEqual([]);
    expect(readRounds(`${URL_A}0`, db)).toHaveLength(1);
  });

  test('a row whose json column is corrupt reads as empty lists, not a throw', () => {
    recordRound(round(1), db);
    db.run("UPDATE review_rounds SET skipped = 'not json' WHERE round = 1");
    expect(readRounds(URL_A, db)[0]!.skipped).toEqual([]);
  });
});
```

Run (from `apps/board`): `bun test src/__tests__/state-db.test.ts src/__tests__/review-rounds.test.ts`
Expected: FAIL, cannot find `../review-rounds.ts`; `SCHEMA_VERSION` is 3.

- [ ] **Step 3: Implement the migration**

`apps/board/src/state/db.ts`: set `export const SCHEMA_VERSION = 4;`. After `V1_SCHEMA`:

```ts
const V4_SCHEMA = `
CREATE TABLE IF NOT EXISTS review_rounds (
  mr_url       TEXT NOT NULL,
  round        INTEGER NOT NULL,
  reviewed_sha TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  skipped      TEXT NOT NULL,
  restored     TEXT NOT NULL,
  confirmed    TEXT NOT NULL,
  recorded_at  INTEGER NOT NULL,
  PRIMARY KEY (mr_url, round)
);
`;
```

Append to `MIGRATIONS`:

```ts
  // v4: one row per review round, for what GitLab cannot hold: the findings
  // the reviewer chose not to post, the commit reviewed, and the threads
  // confirmed fixed but left for the author to resolve.
  db => db.run(V4_SCHEMA),
```

- [ ] **Step 4: Implement `apps/board/src/review-rounds.ts`**

```ts
import { Database } from 'bun:sqlite';

import type { ReviewOutcome } from './review-state.ts';
import { getStateDb } from './state/index.ts';

export type SkippedSeverity = 'critical' | 'important' | 'minor';

export interface SkippedFinding {
  /** Round-qualified (`r<round>-<finding id>`): finding ids restart every round. */
  id: string;
  title: string;
  severity: SkippedSeverity;
  file?: string;
  line?: number;
  excerpt: string;
  snippet: string;
}

export interface ReviewRound {
  mrUrl: string;
  round: number;
  reviewedSha: string;
  outcome: ReviewOutcome;
  skipped: SkippedFinding[];
  restored: string[];
  confirmed: string[];
  recordedAt: number;
}

export interface LedgerView {
  /** The last recorded round; 0 when the MR has none. */
  round: number;
  reviewedSha: string | null;
  rounds: Array<{ round: number; reviewedSha: string; recordedAt: number }>;
  skipped: Array<SkippedFinding & { round: number }>;
  confirmed: string[];
}

export function qualifySkippedId(round: number, id: string): string {
  return /^r\d+-/.test(id) ? id : `r${round}-${id}`;
}

function list<T>(json: string): T[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function recordRound(row: ReviewRound, db: Database = getStateDb()): void {
  db.run(
    `INSERT OR REPLACE INTO review_rounds
       (mr_url, round, reviewed_sha, outcome, skipped, restored, confirmed, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.mrUrl,
      row.round,
      row.reviewedSha,
      row.outcome,
      JSON.stringify(row.skipped),
      JSON.stringify(row.restored),
      JSON.stringify(row.confirmed),
      row.recordedAt,
    ]
  );
}

interface Row {
  mr_url: string;
  round: number;
  reviewed_sha: string;
  outcome: string;
  skipped: string;
  restored: string;
  confirmed: string;
  recorded_at: number;
}

export function readRounds(mrUrl: string, db: Database = getStateDb()): ReviewRound[] {
  const rows = db
    .query('SELECT * FROM review_rounds WHERE mr_url = ? ORDER BY round')
    .all(mrUrl) as Row[];
  return rows.map(r => ({
    mrUrl: r.mr_url,
    round: r.round,
    reviewedSha: r.reviewed_sha,
    outcome: r.outcome as ReviewOutcome,
    skipped: list<SkippedFinding>(r.skipped),
    restored: list<string>(r.restored),
    confirmed: list<string>(r.confirmed),
    recordedAt: r.recorded_at,
  }));
}

/** What a later round needs: every finding skipped so far that no round has
    brought back, and every thread confirmed fixed and left to the author. */
export function ledgerView(rounds: ReviewRound[]): LedgerView {
  const restored = new Set(rounds.flatMap(r => r.restored));
  const last = rounds.at(-1);
  return {
    round: last?.round ?? 0,
    reviewedSha: last?.reviewedSha ?? null,
    rounds: rounds.map(r => ({
      round: r.round,
      reviewedSha: r.reviewedSha,
      recordedAt: r.recordedAt,
    })),
    skipped: rounds.flatMap(r =>
      r.skipped.filter(s => !restored.has(s.id)).map(s => ({ ...s, round: r.round }))
    ),
    confirmed: [...new Set(rounds.flatMap(r => r.confirmed))],
  };
}

export function dropRounds(mrUrl: string, db: Database = getStateDb()): void {
  db.run('DELETE FROM review_rounds WHERE mr_url = ?', [mrUrl]);
}
```

In `apps/board/src/review-state.ts`, `dropPrunedReviewState` becomes:

```ts
export function dropPrunedReviewState(
  mrUrl: string,
  db: Database = getStateDb()
): void {
  dropPrunedState('review', mrUrl, db);
  dropRounds(mrUrl, db);
}
```

with `import { dropRounds } from './review-rounds.ts';`. `review-rounds.ts` imports only a type from `review-state.ts`, so there is no runtime cycle. Rounds go with the tombstone, not with the prune: a pruned review can still be resurrected by the latch pass and must find its rounds.

Add a test to `review-rounds.test.ts` for that wiring:

```ts
  test('dropping a pruned review drops its rounds', async () => {
    const { dropPrunedReviewState } = await import('../review-state.ts');
    recordRound(round(1), db);
    dropPrunedReviewState(URL_A, db);
    expect(readRounds(URL_A, db)).toEqual([]);
  });
```

- [ ] **Step 5: Run tests and gates**

Run (from `apps/board`): `bun test src/__tests__/state-db.test.ts src/__tests__/review-rounds.test.ts src/__tests__/review-state.test.ts src/__tests__/state-purity.test.ts` then `bun run typecheck`.
Expected: PASS (`state-purity.test.ts` scans for `'state'` path joins, which `review-rounds.ts` has none of).

- [ ] **Step 6: Commit**

```bash
git add :/apps/board/src/state/db.ts :/apps/board/src/review-rounds.ts :/apps/board/src/review-state.ts :/apps/board/src/__tests__/state-db.test.ts :/apps/board/src/__tests__/review-rounds.test.ts
git commit -m "board: review_rounds table (state db v4) and its reader"
```

### Task 9: the `review-ledger` verb

**Files:**
- Create: `apps/board/bin/review-ledger.ts`
- Modify: `apps/board/src/subcommands.ts` (one `VERBS` entry)
- Test: create `apps/board/src/__tests__/review-ledger.test.ts`

**Interfaces:**
- Consumes: Task 8's `recordRound`, `readRounds`, `ledgerView`, `qualifySkippedId`; `boardRootFromStatePath` (`src/agent-status/emit.ts`); `dbPathForRoot`, `openStateDb` (`src/state/index.ts`).
- Produces the CLI contract the skill calls:

```
<status-bin> review-ledger read <state>
  stdout: one line of JSON, the LedgerView
<status-bin> review-ledger record <state> --round <n> --sha <head sha> --outcome <comment|approve>
    [--skipped <json array>] [--restored <json array>] [--confirmed <json array>]
  stdout: {"ok":true,"round":<n>}
exit 1 with one line on stderr for: bad usage, no board db, no review row for <state>, invalid json, invalid values
```

`--skipped` entries arrive with bare finding ids (`f3`) and are stored round-qualified (`r2-f3`). `--restored` entries arrive already qualified (they come from `restore:r1-f3` options). A skipped entry's `excerpt` is the finding's body (what posts if it is brought back); `snippet` is the code at its anchor when the round recorded it, and is stored as `''` when absent (a round rebuilt from an old report has none).

- [ ] **Step 1: Write the failing tests**

Create `apps/board/src/__tests__/review-ledger.test.ts`, modelled on `review-status.test.ts` (same `dir`/`dbPath`/`env()`/`seed()` helpers; copy them from lines 1-46 of that file, with `CLI` pointing at `bin/review-ledger.ts`):

```ts
describe('review-ledger CLI', () => {
  async function run(args: string[]) {
    const proc = Bun.spawn(['bun', 'run', CLI, ...args], { env: env(), stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code, out: out.trim(), err: err.trim() };
  }

  test('read on an MR with no rounds answers round 0', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const r = await run(['read', handle]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ round: 0, reviewedSha: null, rounds: [], skipped: [], confirmed: [] });
  });

  test('record then read round-trips, qualifying skipped ids', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const skipped = JSON.stringify([{ id: 'f3', title: 'unused import', severity: 'minor', file: 'src/a.ts', line: 4, excerpt: 'e', snippet: 's' }]);
    const rec = await run(['record', handle, '--round', '1', '--sha', 'abc123', '--outcome', 'comment', '--skipped', skipped, '--confirmed', '["d9"]']);
    expect(rec.code).toBe(0);
    expect(JSON.parse(rec.out)).toEqual({ ok: true, round: 1 });
    const view = JSON.parse((await run(['read', handle])).out);
    expect(view.round).toBe(1);
    expect(view.reviewedSha).toBe('abc123');
    expect(view.skipped).toEqual([{ id: 'r1-f3', title: 'unused import', severity: 'minor', file: 'src/a.ts', line: 4, excerpt: 'e', snippet: 's', round: 1 }]);
    expect(view.confirmed).toEqual(['d9']);
  });

  test('a restore in a later round removes the finding from the read', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const skipped = JSON.stringify([{ id: 'f3', title: 't', severity: 'minor', excerpt: 'e', snippet: 's' }]);
    await run(['record', handle, '--round', '1', '--sha', 'a', '--outcome', 'comment', '--skipped', skipped]);
    await run(['record', handle, '--round', '2', '--sha', 'b', '--outcome', 'comment', '--restored', '["r1-f3"]']);
    expect(JSON.parse((await run(['read', handle])).out).skipped).toEqual([]);
  });

  test('bad input exits 1 with a reason and writes nothing', async () => {
    const handle = mintHandle('review', URL_A, dir);
    seed(handle, 4821);
    const cases: Array<[string[], RegExp]> = [
      [['record', handle, '--round', '0', '--sha', 'a', '--outcome', 'comment'], /--round must be a positive integer/],
      [['record', handle, '--round', '1', '--outcome', 'comment'], /--sha is required/],
      [['record', handle, '--round', '1', '--sha', 'a', '--outcome', 'request_changes'], /--outcome must be one of comment\|approve/],
      [['record', handle, '--round', '1', '--sha', 'a', '--outcome', 'comment', '--skipped', '{'], /--skipped must be a JSON array/],
      [['record', handle, '--round', '1', '--sha', 'a', '--outcome', 'comment', '--skipped', '[{"id":"f1"}]'], /--skipped\[0\]: id, title, severity and excerpt are required/],
      [['record', handle, '--round', '1', '--sha', 'a', '--outcome', 'comment', '--restored', '[1]'], /--restored must be a JSON array of strings/],
      [['frobnicate', handle], /usage: review-ledger/],
    ];
    for (const [args, want] of cases) {
      const r = await run(args);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(want);
    }
    expect(JSON.parse((await run(['read', handle])).out).round).toBe(0);
  });

  test('a handle with no review row exits 1', async () => {
    const r = await run(['read', mintHandle('review', URL_A, dir)]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no state row/);
  });
});
```

Run (from `apps/board`): `bun test src/__tests__/review-ledger.test.ts`
Expected: FAIL, the CLI file does not exist.

- [ ] **Step 2: Implement `apps/board/bin/review-ledger.ts`**

```ts
import { existsSync } from 'fs';

import { boardRootFromStatePath } from '../src/agent-status/emit.ts';
import {
  ledgerView,
  qualifySkippedId,
  readRounds,
  recordRound,
  type SkippedFinding,
  type SkippedSeverity,
} from '../src/review-rounds.ts';
import type { ReviewOutcome } from '../src/review-state.ts';
import { dbPathForRoot, openStateDb } from '../src/state/index.ts';

const VALID_OUTCOME: ReviewOutcome[] = ['comment', 'approve'];
const SEVERITIES: SkippedSeverity[] = ['critical', 'important', 'minor'];
const USAGE =
  'usage: review-ledger read <statePath> | review-ledger record <statePath> --round <n> --sha <sha> --outcome comment|approve [--skipped <json>] [--restored <json>] [--confirmed <json>]';

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function flags(argv: string[]): { rest: string[]; flag: Record<string, string> } {
  const rest: string[] = [];
  const flag: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) flag[a.slice(2, eq)] = a.slice(eq + 1);
    else flag[a.slice(2)] = argv[++i] ?? '';
  }
  return { rest, flag };
}

function jsonArray(name: string, raw: string | undefined): unknown[] {
  if (raw === undefined) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) return v;
  } catch {
    // falls through to the one message
  }
  return die(`--${name} must be a JSON array`);
}

function strings(name: string, raw: string | undefined): string[] {
  const v = jsonArray(name, raw);
  if (!v.every(x => typeof x === 'string' && x.length > 0))
    die(`--${name} must be a JSON array of strings`);
  return v as string[];
}

function skippedList(round: number, raw: string | undefined): SkippedFinding[] {
  return jsonArray('skipped', raw).map((x, i) => {
    const s = (x ?? {}) as Record<string, unknown>;
    const text = (k: string) => typeof s[k] === 'string' && (s[k] as string).length > 0;
    if (
      !text('id') || !text('title') || !text('excerpt') ||
      !SEVERITIES.includes(s.severity as SkippedSeverity) ||
      (s.snippet !== undefined && typeof s.snippet !== 'string')
    )
      die(`--skipped[${i}]: id, title, severity and excerpt are required`);
    return {
      id: qualifySkippedId(round, s.id as string),
      title: s.title as string,
      severity: s.severity as SkippedSeverity,
      ...(typeof s.file === 'string' && s.file ? { file: s.file } : {}),
      ...(typeof s.line === 'number' && Number.isInteger(s.line) && s.line > 0 ? { line: s.line } : {}),
      excerpt: s.excerpt as string,
      snippet: typeof s.snippet === 'string' ? s.snippet : '',
    };
  });
}

const { rest, flag } = flags(process.argv.slice(2));
const [verb, statePath] = rest;
if ((verb !== 'read' && verb !== 'record') || !statePath) die(USAGE);

const dbPath = dbPathForRoot(boardRootFromStatePath(statePath));
if (!existsSync(dbPath)) die(`no board db at ${dbPath}; stale pre-upgrade handle?`);
const db = openStateDb(dbPath, 'cli');
const row = db
  .query("SELECT mr_url FROM agent_states WHERE lane = 'review' AND handle = ?")
  .get(statePath) as { mr_url: string } | null;
if (!row)
  die(`no state row for ${statePath}; was this pane launched by a board on this machine?`);

if (verb === 'read') {
  console.log(JSON.stringify(ledgerView(readRounds(row.mr_url, db))));
} else {
  const round = Number(flag.round);
  if (!Number.isInteger(round) || round <= 0) die('--round must be a positive integer');
  if (!flag.sha) die('--sha is required');
  if (!VALID_OUTCOME.includes(flag.outcome as ReviewOutcome))
    die(`--outcome must be one of ${VALID_OUTCOME.join('|')}`);
  recordRound(
    {
      mrUrl: row.mr_url,
      round,
      reviewedSha: flag.sha,
      outcome: flag.outcome as ReviewOutcome,
      skipped: skippedList(round, flag.skipped),
      restored: strings('restored', flag.restored),
      confirmed: strings('confirmed', flag.confirmed),
      recordedAt: Date.now(),
    },
    db
  );
  console.log(JSON.stringify({ ok: true, round }));
}
```

The board app is not under the root CLI's no-raw-output rule (`lib/` and `commands/` only); `bin/review-status.ts` prints the same way.

In `apps/board/src/subcommands.ts` add to `VERBS`, after `'review-status'`:

```ts
  'review-ledger': () => import('../bin/review-ledger.ts'),
```

`review-ledger` is always called by name, so `legacyVerb` needs no entry.

- [ ] **Step 3: Run tests**

Run (from `apps/board`): `bun test src/__tests__/review-ledger.test.ts src/__tests__/status-bin.test.ts` then `bun run typecheck`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add :/apps/board/bin/review-ledger.ts :/apps/board/src/subcommands.ts :/apps/board/src/__tests__/review-ledger.test.ts
git commit -m "board: review-ledger record and read verbs"
```

### Task 10: the gate scripts build the earlier-thread questions

**Files:**
- Modify: `plugins/mattstack/attachments/review/review/scripts/review-source.sh`
- Modify: `plugins/mattstack/attachments/review/review/scripts/gate-ctx.sh` AND `plugins/mattstack/attachments/review/receive-review/scripts/gate-ctx.sh` (byte-identical; the test compares them)
- Create: `plugins/mattstack/attachments/review/review/tests/fixtures/findings-v3.json`
- Modify: `plugins/mattstack/attachments/review/review/tests/test-review-source.sh`, `plugins/mattstack/attachments/review/receive-review/tests/test-gate-ctx.sh`

**Interfaces:**
- Consumes: report json version 3 with `threads[]` (Task 11 writes the contract; the shape is fixed here):

```json
{"discussionId": "a1b2", "file": "src/cart.ts", "line": 12, "round": 1,
 "call": "fixed", "original": "...", "authorReply": "...", "note": "...", "reply": "..."}
```

`file`, `line`, `authorReply`, `note` optional; `call` one of `fixed`, `not-fixed`, `pushback-accepted`, `pushback-rejected`.
- Produces: one question per thread, before the findings questions:

```json
{"id": "thread-1", "label": "src/cart.ts:12", "multi": true,
 "context": {"gate-ctx": "carryover@1", "thread": "a1b2", "file": "src/cart.ts:12", "round": 1,
             "call": "fixed", "original": "...", "authorReply": "...", "note": "...", "reply": "..."},
 "options": [{"value": "post:a1b2", "label": "Post reply (recommended)"},
             {"value": "resolve:a1b2", "label": "Resolve thread (recommended)"}]}
```

`Resolve thread` carries ` (recommended)` only for `fixed` and `pushback-accepted`. A thread with no `file` is labelled `General thread`.

- [ ] **Step 1: Write the fixture and the failing tests**

Create `tests/fixtures/findings-v3.json` (invented content):

```json
{
  "version": 3,
  "summary": {"readiness": "with-fixes", "reasoning": "two earlier threads are settled; one new issue in the retry path."},
  "re_review": true,
  "prior": {"addressed": 2, "still_open": 1},
  "threads": [
    {"discussionId": "a1b2", "file": "queue/worker.ts", "line": 40, "round": 1, "call": "fixed",
     "original": "permanent failures re-enqueue forever", "authorReply": "dropped in the catch block now",
     "note": "worker.ts:40 returns before enqueue for non-retryable errors", "reply": "Confirmed, thanks."},
    {"discussionId": "c3d4", "file": "queue/enqueue.ts", "round": 1, "call": "pushback-accepted",
     "original": "move the retryable check", "authorReply": "the parity branch needs it first, see the ordering test",
     "reply": "Fair, the ordering test covers it."},
    {"discussionId": "e5f6", "round": 2, "call": "not-fixed",
     "original": "the README still says linear backoff", "reply": "This one is still as it was; the README says linear."}
  ],
  "findings": [
    {"id": "f1", "tier": "Important", "title": "retry count resets on requeue", "body": "the counter is rebuilt from zero when a job is requeued, so the cap never trips.", "file": "queue/retry.ts", "line": 18, "fix": "carry attempts on the job", "disposition": "new"}
  ]
}
```

Append to `test-review-source.sh` (before its final summary/exit lines; read the tail of the file for its exit convention):

```sh
# --- version 3: earlier threads become thread-N questions ---
V3="$DIR/fixtures/findings-v3.json"
run "$V3" "$X"
check "v3 exits 0" 0 "$RC"
check "thread questions lead, then findings, then extras" \
  '["thread-1","thread-2","thread-3","findings-1","outcome"]' \
  "$(q '[.questions[].id] | tojson')"
check "a thread question offers exactly post and resolve for its discussion" \
  '["post:a1b2","resolve:a1b2"]' "$(q '[.questions[0].options[].value] | tojson')"
check "fixed recommends both" '["Post reply (recommended)","Resolve thread (recommended)"]' \
  "$(q '[.questions[0].options[].label] | tojson')"
check "pushback-accepted recommends both" '["Post reply (recommended)","Resolve thread (recommended)"]' \
  "$(q '[.questions[1].options[].label] | tojson')"
check "not-fixed recommends the reply only" '["Post reply (recommended)","Resolve thread"]' \
  "$(q '[.questions[2].options[].label] | tojson')"
check "the label is file:line, the file alone, or General thread" \
  '["queue/worker.ts:40","queue/enqueue.ts","General thread"]' "$(q '[.questions[0,1,2].label] | tojson')"
check "the carryover context carries the whole card" \
  '{"authorReply":"dropped in the catch block now","call":"fixed","file":"queue/worker.ts:40","gate-ctx":"carryover@1","note":"worker.ts:40 returns before enqueue for non-retryable errors","original":"permanent failures re-enqueue forever","reply":"Confirmed, thanks.","round":1,"thread":"a1b2"}' \
  "$(q '.questions[0].context | to_entries | sort_by(.key) | from_entries | tojson')"
check "a thread with no author reply and no file omits both keys" \
  '["call","gate-ctx","original","reply","round","thread"]' "$(q '.questions[2].context | keys | tojson')"
check "thread questions are multi" true "$(q '.questions[0].multi')"

# fit keeps the thread questions structured
FIT=$(printf '%s' "$OUT" | sh "$GC" fit); FRC=$?
check "fit accepts carryover@1" 0 "$FRC"
check "fit stays structured with thread questions" structured "$(printf '%s' "$FIT" | jq -r .mode)"
check "a fitted carryover context is still JSON" carryover@1 \
  "$(printf '%s' "$FIT" | jq -r '.questions[0].context | fromjson | .["gate-ctx"]')"
check "prose flattens a thread to its call, the reply and both sides" \
  'queue/worker.ts:40 · round 1 · fixed by author
You wrote: permanent failures re-enqueue forever
Author replied: dropped in the catch block now
Checked: worker.ts:40 returns before enqueue for non-retryable errors
Will post as reply: Confirmed, thanks.' \
  "$(printf '%s' "$OUT" | sh "$GC" prose | jq -r '.questions[0].context')"

# contract violations
m=$(mutate '.threads[0].call = "still-open"' "$V3"); run "$m" "$X"
check "an unknown call exits 1" 1 "$RC"
check "and names the field" 'findings file: threads[0].call: fixed|not-fixed|pushback-accepted|pushback-rejected' "$ERR"
m=$(mutate '.threads[1].discussionId = "a1b2"' "$V3"); run "$m" "$X"
check "a repeated discussion exits 1" 'findings file: threads: discussion a1b2 appears more than once' "$ERR"
m=$(mutate 'del(.threads[0].reply)' "$V3"); run "$m" "$X"
check "a thread needs its reply" 'findings file: threads[0].reply: required non-empty string' "$ERR"
m=$(mutate 'del(.threads)' "$V3"); run "$m" "$X"
check "a v3 file with no threads is a first-round review" '["findings-1","outcome"]' "$(q '[.questions[].id] | tojson')"
```

In `receive-review/tests/test-gate-ctx.sh`, add one case in that file's own harness style (read it first) asserting that a question whose context is `carryover@1` with options other than exactly `post:<thread>` and `resolve:<thread>` fails with `options: exactly post:<t> and resolve:<t>`.

Run: `sh plugins/mattstack/attachments/review/review/tests/test-review-source.sh`
Expected: the new checks FAIL (`version: 2 when present`), the old ones pass.

- [ ] **Step 2: Implement `review-source.sh`**

In `LIB`:

1. Add after `def entries`:

```jq
def threads: if (.threads | type) == "array" then .threads else [] end;
def structured: .version == 2 or .version == 3;
def pos: type == "number" and . == floor and . >= 1;
```

2. In `file_errs`, replace the `version` check with
   `chk(optional("version"; . == 2 or . == 3); "version: 2 or 3 when present (absent is a legacy file)"),`
   replace `(.version == 2) as $v2` with `structured as $v2`, and add before the duplicate-id line:

```jq
  chk(optional("threads"; type == "array"); "threads: array when present"),
  (threads | to_entries[] | .key as $i | .value | (
      chk(.discussionId | str; "threads[\($i)].discussionId: required non-empty string"),
      chk(.round | pos; "threads[\($i)].round: integer of at least 1"),
      chk(.call | among(["fixed","not-fixed","pushback-accepted","pushback-rejected"]); "threads[\($i)].call: fixed|not-fixed|pushback-accepted|pushback-rejected"),
      chk(.original | str; "threads[\($i)].original: required non-empty string"),
      chk(.reply | str; "threads[\($i)].reply: required non-empty string"),
      chk(optional("file"; str); "threads[\($i)].file: non-empty string when present"),
      chk(optional("line"; pos); "threads[\($i)].line: integer of at least 1 when present"),
      chk(optional("authorReply"; str); "threads[\($i)].authorReply: non-empty string when present"),
      chk(optional("note"; str); "threads[\($i)].note: non-empty string when present")
    )),
  ([threads[] | .discussionId?] | group_by(.) | map(select(length > 1) | .[0])[] | "threads: discussion \(.) appears more than once"),
```

3. In `extras_errs`, extend the reserved-id check:

```jq
  chk(all(.questions[]; .id | (startswith("findings-") or startswith("thread-") or startswith("skipped-")) | not); "questions: findings-*, thread-* and skipped-* ids are built from the findings file")
```

(update the existing v2 test's expected message if it asserts the old wording).

4. Add before `def build`:

```jq
def thread_anchor: if has("file") and has("line") then "\(.file):\(.line)" elif has("file") then .file else null end;
def settled: .call == "fixed" or .call == "pushback-accepted";
def thread_question($n):
  thread_anchor as $a
  | {id: "thread-\($n)", label: ($a // "General thread"), multi: true,
     context: ({"gate-ctx": "carryover@1", thread: .discussionId, round, call, original, reply}
       + (if $a then {file: $a} else {} end)
       + with_entries(select(.key == "authorReply" or .key == "note"))),
     options: [{value: "post:\(.discussionId)", label: "Post reply (recommended)"},
               {value: "resolve:\(.discussionId)", label: (if settled then "Resolve thread (recommended)" else "Resolve thread" end)}]};
```

5. In `build`, replace `(.version == 2) as $v2` with `structured as $v2`, and make `questions:` start with the thread questions:

```jq
     questions: ((threads | to_entries | map(.key as $i | .value | thread_question($i + 1)))
       + ([range(0; $ordered | length; 4) as $i | $ordered[$i:$i + 4]] | to_entries
       | map({id: "findings-\(.key + 1)", label: "Post which findings to \($x.target)?", multi: true}
           + (if $v2 then {context: {"gate-ctx": "findings@1", findings: (.value | map(entry))}} else {} end)
           + {options: (.value | map(option))}))
       + $x.questions)};
```

Update the header comment's stdout line to say `[thread-1.., findings-1.., extras questions]` and the legacy line to "A findings file without `version` 2 or 3 is legacy".

- [ ] **Step 3: Implement `gate-ctx.sh` (both copies, identical)**

1. Add after `reply_errs`:

```jq
def carryover_errs($values): [
  chk(.thread | str; "thread: required non-empty string"),
  chk(.round | type == "number" and . == floor and . >= 1; "round: integer of at least 1"),
  chk(.call | among(["fixed","not-fixed","pushback-accepted","pushback-rejected"]); "call: fixed|not-fixed|pushback-accepted|pushback-rejected"),
  chk(.original | str; "original: required non-empty string"),
  chk(.reply | str; "reply: required non-empty string"),
  chk(optional("file"; str); "file: non-empty string when present"),
  chk(optional("authorReply"; str); "authorReply: non-empty string when present"),
  chk(optional("note"; str); "note: non-empty string when present"),
  (if .thread | str then .thread as $t
     | chk(($values | sort) == ["post:\($t)", "resolve:\($t)"]; "options: exactly post:\($t) and resolve:\($t)")
   else empty end)
];
```

2. In `shape_errs`, add a branch before the final `else`:
   `elif .["gate-ctx"] == "carryover@1" then carryover_errs($values)`
3. In `errors`, the per-question allowed list becomes `["thread@1","reply@1","findings@1","carryover@1"]`, and the two `reply@1` rules (multi, one question per thread) widen to both shapes: replace each `.context["gate-ctx"]? == "reply@1"` in those two rules with `(.context["gate-ctx"]? | among(["reply@1","carryover@1"]))` and the message `"\(.id): multi: a reply@1 question is multi"` with `"\(.id): multi: a per-thread question is multi"`. Check `test-gate-ctx.sh` for an assertion on the old message and update it.
4. In `prose`, add before the `thread@1` branch:

```jq
  elif .["gate-ctx"] == "carryover@1" then
    ([([(if has("file") then .file else "General thread" end), "round \(.round)",
        {"fixed":"fixed by author","not-fixed":"waiting on author","pushback-accepted":"author pushed back, accept","pushback-rejected":"author pushed back, hold firm"}[.call]]
       | join(" · ")),
      "You wrote: \(.original)"]
     + (if has("authorReply") then ["Author replied: \(.authorReply)"] else ["The author has not replied in this thread."] end)
     + (if has("note") then ["Checked: \(.note)"] else [] end)
     + ["Will post as reply: \(.reply)"]) | join("\n")
```

5. `structurable` is unchanged: carryover questions are not `findings-*`.
6. Update the header comment: per-question shapes now include `carryover@1`.

Copy the edited file over the other copy: `cp plugins/mattstack/attachments/review/receive-review/scripts/gate-ctx.sh plugins/mattstack/attachments/review/review/scripts/gate-ctx.sh` (edit the receive-review copy first; it is the source the test names).

- [ ] **Step 4: Run both script suites**

Run: `sh plugins/mattstack/attachments/review/review/tests/test-review-source.sh` and `sh plugins/mattstack/attachments/review/receive-review/tests/test-gate-ctx.sh`.
Expected: every line `ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add :/plugins/mattstack/attachments/review
git commit -m "review gate scripts: earlier threads become thread-N questions (carryover@1)"
```

### Task 11: the skills run a round

**Files:**
- Modify: `plugins/mattstack/attachments/review-core-body-tail/SKILL.md` ("Structured findings file")
- Modify: `plugins/mattstack/attachments/review/review/SKILL.md` (re-review inputs, "Compose the submitted review", "What the graph cannot show", the extras table's `round` row)
- Modify: `plugins/mattstack/attachments/review-posting/SKILL.md` (caller inputs gain `replies`)
- Modify: `plugins/mattstack/attachments/gate-protocol/SKILL.md` (the per-thread question shape)
- Modify: `apps/board/skills-src/review/SKILL.md` ("Re-review mode", "Record the verdict answer in --report", "Hand the answer to the domain skill to post", the generic path's re-review read, "Building the review-post questions")
- Regenerate: `apps/board/skills/`
- Modify: `plugins/mattstack/.claude-plugin/plugin.json` (patch bump)

**Interfaces:**
- Consumes: Task 9's CLI contract, Task 10's `threads[]` shape, Task 4's `replies[]`.
- Produces: report json version 3; the board wrapper's ledger calls.

**REQUIRED SUB-SKILLS:** `mattstack:editing-skills`, `superpowers:writing-skills`, `mattstack:process-digraphs`.

- [ ] **Step 1: RED baseline**

Fresh agent, current compiled board review skill, scenario (record its answer verbatim):

> You are a re-review pane for `https://gitlab.example.com/acme/webapp/-/merge_requests/41`, launched with `--re-review`. `mr_threads` shows three unresolved threads you opened: T1 at `src/cart.ts:12` ("total ignores the discount"), where the author replied "fixed in 4f2a" and the new diff does apply the discount; T2 at `src/cart.ts:40` ("this loop is quadratic"), no author reply and the code is unchanged; T3 ("rename `x`"), where the author replied "x matches the upstream API name" and that is true. You also found one new issue at `src/tax.ts:8`. (a) What goes in the report json? (b) What questions does the review-post gate carry? (c) The human keeps every default. What exactly do you post, call by call?

Expected baseline (the failure): T2 re-raised as a `still-open` finding, T1 as `addressed-check`, T3 dropped or re-raised; no reply in any thread; nothing resolved; no ledger call.

- [ ] **Step 2: Edit `review-core-body-tail/SKILL.md`**

In "Structured findings file": change "It is version 2 of this file" to "It is version 3 of this file", `version` (`2`) to (`3`), and replace the "Re-review passes only" bullet with:

```markdown
- Re-review passes only (the caller framed the review as a re-review):
  `re_review: true`, and `threads`: one entry per earlier thread the
  caller handed in, in the order given, never one the caller did not
  hand in:
  `{discussionId, file, line, round, call, original, authorReply, note,
  reply}`. `discussionId`, `round` and `original` (the reviewer's own
  first note, verbatim) come from the caller unchanged; `file` and `line`
  are the thread's anchor when it has one; `authorReply` is the author's
  latest note in the thread, verbatim, omitted when they wrote none.
  `call` is this pass's verdict on the thread, one of four:
  `fixed` (the code now does what the thread asked), `not-fixed` (it does
  not, and the author gave no reason that holds), `pushback-accepted`
  (the author declined and their reason holds), `pushback-rejected` (the
  author declined and their reason does not hold). `note` is one line
  saying what was checked to reach the call. `reply` is the reply to post
  in that thread, written in the writing style, never empty.
  `prior` is counted from the calls: `addressed` is `fixed` plus
  `pushback-accepted`, `still_open` is the other two.
- On a re-review, `findings` holds only what is new: an issue an earlier
  thread already raises lives on its thread and is never a finding. Each
  finding's `disposition` is `new` or absent.
```

In the last bullet and the Quick reference row, change "version 2" to "version 3". Leave the sentence "a field whose meaning changes bumps `version`, and those readers change with it."

- [ ] **Step 3: Edit the engine (`review/review/SKILL.md`)**

1. Find where the engine takes its inputs for a re-review (search the file for `re-review` and `prior review`; the caller's framing arrives with the review target). Add this section and reference it from the node that gathers re-review inputs (add a node `"Take the earlier threads the caller handed in"` [shape=box] on the re-review path before the depth block, with an edge in from the re-review branch and out to the node that branch reached before; if the engine has no separate re-review branch, add a diamond `"Caller framed a re-review?"` after the target is recorded):

```markdown
### Take the earlier threads the caller handed in

A re-review judges two things, in this order: what became of the
reviewer's earlier threads, then what is new. The caller hands in the
earlier threads (each with its `discussionId`, anchor, `round`, the
reviewer's first note and the author's replies), the commit the last
round reviewed, and the round number. For each thread, read the code at
the MR head and make one of the four calls the structured findings file
names, with a one-line note of what was checked and a reply to post.
Then hunt for new issues, weighting the diff since the last reviewed
commit (`git diff <last reviewed sha>..HEAD`) while still reading the
whole change. With no earlier threads handed in, the pass is a full
review framed as a re-review, and `threads` is empty.
```

2. In "### Compose the submitted review: comments, summary, outcome" replace the last sentence with:

```markdown
`replies` is built from the gate's `thread-<n>` answers, one entry per
thread whose answer picked anything: `discussionId` from the option value
after `post:` or `resolve:`; `resolve` true when `resolve:<id>` was
picked; `body` present only when `post:<id>` was picked, and then the
answer's `text` when it carries one (the human edited the reply), else
the report json's `reply` for that thread. A thread whose answer picked
neither option gets no entry.
```

3. In "## What the graph cannot show", extend the selection bullets: a caller's decided selection may also carry `replies` (already in the submit's shape); posting hands them through unchanged.
4. In the extras table, the `reviewer`, `round` row gains: "On a re-review the caller supplies `round`."

- [ ] **Step 4: Edit `review-posting/SKILL.md`**

In "## Caller inputs", after the decided-selection bullet add:

```markdown
- On a re-review, `replies`: one `{discussionId, body, resolve}` per
  earlier thread the human chose to act on, already decided. `body` is
  absent when the human held the reply and only resolves. They post in
  the same submitted review as the findings; never as separate replies.
```

In "## No side door" add: "An earlier thread the human left alone gets no reply and is not resolved."

- [ ] **Step 5: Edit `gate-protocol/SKILL.md`**

Read the file for where question and context shapes are documented (search `gate-ctx` and `reply@1`). Add, in that section's own format:

```markdown
**`carryover@1`** (a `review-post` gate's per-thread question, one per
earlier thread): `{thread, file?, round, call, original, authorReply?,
note?, reply}`. The question is a multi with exactly two options,
`post:<thread>` and `resolve:<thread>`; an option label ending
` (recommended)` is a default. An answer is the picked values, or
`{value: [...], text}` when the human edited the reply; `text` replaces
`reply`. `thread-<n>` ids are separate questions, never chunks of one.
```

That section ("Structured context (gate-ctx@1)") documents the shapes as a table: add `carryover@1` as a ROW of that table carrying the same facts, not as prose under it. Then `bun run skills:expand:board` (required for any gate-protocol edit).

- [ ] **Step 6: Edit the board wrapper (`apps/board/skills-src/review/SKILL.md`)**

1. Replace "## Re-review mode" steps 1-4 with:

```markdown
1. **Read the round record.** Run `<status-bin> review-ledger read
   <state>`. It prints one line of JSON: `round` (the last round the
   board recorded; this pass is `round + 1`), `reviewedSha` (the commit
   that round reviewed, null when there is none), `rounds` (each round's
   `recordedAt`), `skipped` and `confirmed`. `round: 0` means the board
   has no record of an earlier round: this pass is round 2 when a file
   exists at `--report`, since a prior review is in hand, else round 1.
2. **Collect your earlier threads.** From the `mr_threads {mrUrl,
   refresh: true} (re-review)` result (the domain skill reads them
   itself), keep every unresolved thread whose first note this pane's
   account wrote. Leave out the board's own latch thread, other
   reviewers' threads, and any thread whose id is in `confirmed`. Each
   thread's `round` is the highest `rounds` entry whose `recordedAt` is
   at or before the thread's first note; 1 when none is.
3. **Hand the round to the review.** Give the review (the domain skill,
   or `Review the MR yourself`) the earlier threads, `reviewedSha` and
   the round number, with the framing: judge each earlier thread, then
   find what is new. With no earlier threads, say so explicitly in the
   report's summary line; the pass is then a full review.
```

Keep the paragraph about the resumed pane's scrollback and the closing "Everything else ... is the same" sentence. Update the Flow digraph: add `"<status-bin> review-ledger read <state>" [shape=plaintext]` on the `--re-review` path before the thread read, with a fix-once pair if this wrapper gives every CLI call one (mirror how the `review-status` call is drawn), and rename nothing else.

2. In "### Record the verdict answer in --report", append:

```markdown
Then record the round, before anything posts:

`<status-bin> review-ledger record <state> --round <n> --sha <the MR
head sha this pass reviewed> --outcome <comment|approve> --skipped '[]'
--restored '[]' --confirmed '<json array>'`

`<n>` is 1 on a first review and the re-review's round otherwise.
`--confirmed` lists the `discussionId` of every thread whose call is
`fixed` or `pushback-accepted` where the answer picked `post:<id>` and
not `resolve:<id>`: the reviewer said so and left resolving to the
author, and no later round asks about it again. A resumed pane that
finds the round already recorded records it again; the write replaces.
The MR head sha is `mr_view`'s `mr.sha` (the source branch head as
GitLab reports it; the field is on glance's `PullRequest`), read in the
same pass as the review; never a guess.
```

3. In "### Hand the answer to the domain skill to post", extend the per-finding path: the handed selection is `{findings: [ids], outcome, replies}` where `replies` follows the engine's "Compose the submitted review" rule from the `thread-N` answers.
4. In "## Building the review-post questions": under "The json sibling", add that a report json with a non-empty `threads` array always goes through the fitted open file (`review-source.sh` then `gate-ctx.sh fit`), on the generic path too, with `round` in the extras; the hand-built recipe below it covers first reviews only. State the `thread-<n>` shape by pointing at the gate protocol's `carryover@1`.
5. In the generic path's "Review the MR yourself" section, add the re-review duty in the same words as the engine's "Take the earlier threads the caller handed in".

- [ ] **Step 7: Expand, compile, GREEN**

Run `bun run skills:expand:board`, compile per editing-skills. Re-run the Step 1 scenario with a fresh agent on the new text. Expected: (a) `threads` with T1 `fixed`, T2 `not-fixed`, T3 `pushback-accepted`, each with `note` and `reply`; `findings` holds only the `src/tax.ts:8` issue with `disposition: new`; `prior: {addressed: 2, still_open: 1}`. (b) `thread-1..3` (two options each; T1 and T3 both recommended, T2 reply only), `findings-1`, `outcome`. (c) one `review-ledger record` with `--round 2`, then ONE `mr_review_submit` whose `comments` has the tax finding and whose `replies` are `[{T1, body, resolve: true}, {T2, body, resolve: false}, {T3, body, resolve: true}]`; no `mr_reply_thread`, no `mr_resolve_thread`.

Add a second GREEN scenario: "the human unticked Post reply on T2 and Resolve thread on T1, and edited T3's reply to 'ok'". Expected: T2 has no entry; T1 is `{body, resolve: false}` and its id is in `--confirmed`; T3's body is `ok`.

- [ ] **Step 8: Certify, bump, verify, commit**

Certify each edited skill dir; `bun cli.ts skills check --strict`; `bun test scripts/__tests__`; from `apps/board`: `bun test src/__tests__/skills-review-open-gate.test.ts src/__tests__/skills-resolve.test.ts`. Bump `plugin.json`.

```bash
git add :/plugins/mattstack :/apps/board/skills-src :/apps/board/skills
git commit -m "review skills: a re-review judges earlier threads, replies and resolves in the one submit"
```

### Task 12: the sheet against real questions

**Files:**
- Create: `apps/board/src/client/board/__tests__/review-source-contract.test.ts`
- Modify: `apps/board/src/client/board/__tests__/review-gate-sheet-dom.test.tsx`
- Modify (only if a test exposes a mismatch): `apps/board/src/client/board/review-gate.ts`, `gate-ctx.ts`

**Interfaces:**
- Consumes: Task 10's script output; the built sheet (`ReviewGateSheet.tsx`, `ReviewRoundParts.tsx`, `SheetParts.tsx`).
- Produces: proof the script's questions and the sheet agree, so neither side can drift alone.

- [ ] **Step 1: Write the contract test**

```ts
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import { readReviewGate } from '../review-gate.ts';

const ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..');
const REVIEW = join(ROOT, 'plugins/mattstack/attachments/review/review');

/** The questions a real re-review opens: the engine's own scripts run over
    its own fixture. */
function fittedGate(fixture: string) {
  const source = Bun.spawnSync([
    'sh',
    join(REVIEW, 'scripts/review-source.sh'),
    join(REVIEW, 'tests/fixtures', fixture),
    join(REVIEW, 'tests/fixtures/extras.json'),
  ]);
  expect(source.exitCode).toBe(0);
  const fit = Bun.spawnSync(['sh', join(REVIEW, 'scripts/gate-ctx.sh'), 'fit'], {
    stdin: source.stdout,
  });
  expect(fit.exitCode).toBe(0);
  const open = JSON.parse(fit.stdout.toString()) as {
    context: string;
    questions: never[];
  };
  return { kind: 'review-post', context: open.context, meta: null, questions: open.questions };
}

describe('the review scripts and the review sheet agree', () => {
  test('a v3 re-review opens as a sheet with one card per earlier thread', () => {
    const gate = readReviewGate(fittedGate('findings-v3.json') as never);
    expect(gate).not.toBeNull();
    expect(gate!.carryovers.map(c => [c.name, c.threadId, c.carry.call])).toEqual([
      ['thread-1', 'a1b2', 'fixed'],
      ['thread-2', 'c3d4', 'pushback-accepted'],
      ['thread-3', 'e5f6', 'not-fixed'],
    ]);
    expect(gate!.carryovers[0]!.defaults).toEqual(['post:a1b2', 'resolve:a1b2']);
    expect(gate!.carryovers[2]!.defaults).toEqual(['post:e5f6']);
    expect(gate!.carryovers[2]!.carry.authorReply).toBeUndefined();
    expect([...gate!.findings.keys()]).toEqual(['f1']);
  });

  test('a v2 first review still opens with no earlier threads', () => {
    const gate = readReviewGate(fittedGate('findings-v2.json') as never);
    expect(gate).not.toBeNull();
    expect(gate!.carryovers).toEqual([]);
  });
});
```

`gateContext` (`src/gates/wait-meta.ts`) reads `gate.context` first, so the object above is enough. The fixture `extras.json` carries exactly one single-choice question (`outcome`), which is what `readReviewGate` requires; if a later change adds a `next` question to that fixture, write a board-shaped extras file (outcome only) into a temp dir inside the test and pass that instead.

Run (from `apps/board`): `bun test src/client/board/__tests__/review-source-contract.test.ts`
Expected: PASS if Task 10 matches the sheet. A failure here is a real contract mismatch: fix the side that deviates from the spec's wire-format table, not the test.

- [ ] **Step 2: DOM tests for the round UI**

Read `review-gate-sheet-dom.test.tsx` for its render helper and gate builder, and `ReviewGateSheet.stories.tsx` for the `RoundThree` fixture (reuse its gate object by importing the story's exported args if the test file already imports from stories; otherwise build the gate with the test's own builder). Add:

```tsx
describe('a later round', () => {
  test('the main column opens with the round and what it holds', () => {
    const { container } = renderSheet(roundThreeGate());
    const heading = container.querySelector('.tui-sheet-round')!;
    expect(heading.querySelector('.tui-sheet-round-n')!.textContent).toBe('Round 3');
    expect(heading.querySelector('.tui-sheet-round-summary')!.textContent).toMatch(/earlier threads? · \d+ new finding/);
  });

  test('each earlier thread is a card naming who acts', () => {
    const { container } = renderSheet(roundThreeGate());
    const cards = [...container.querySelectorAll('[data-step="carryover"]')];
    expect(cards.length).toBeGreaterThan(0);
    const chips = cards.map(c => c.querySelector('.tui-thread-outcome')!.textContent);
    for (const chip of chips) expect(chip).not.toMatch(/open|unresolved/i);
    expect(chips).toContain('fixed by author');
    expect(chips).toContain('waiting on author');
  });

  test('a thread the author never answered says so', () => {
    const { container } = renderSheet(roundThreeGate({ dropAuthorReplyOn: 0 }));
    expect(container.querySelector('.tui-thread-nothing')!.textContent).toBe(
      "The author hasn't replied in this thread."
    );
  });

  test('a fixed thread starts with post and resolve ticked; a waiting one with post only', () => {
    const { container } = renderSheet(roundThreeGate());
    const ticks = (call: string) => {
      const card = container.querySelector(`[data-call="${call}"]`)!.closest('[data-step="carryover"]')!;
      return [...card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(i => [i.value, i.checked]);
    };
    expect(ticks('fixed')).toEqual([['post', true], ['resolve', true]]);
    expect(ticks('not-fixed')).toEqual([['post', true], ['resolve', false]]);
  });

  test('submitting sends each thread its picked values, and an edited reply as text', async () => {
    const { container, submitted } = renderSheet(roundThreeGate());
    // untick resolve on the fixed thread, edit its reply, submit
    await untick(container, 'fixed', 'resolve');
    await editReply(container, 'fixed', 'Looks right now.');
    await submit(container);
    const answer = submitted().answers;
    const fixed = answer[threadNameFor('fixed')];
    expect(fixed).toEqual({ value: [postValueFor('fixed')], text: 'Looks right now.' });
    const waiting = answer[threadNameFor('not-fixed')];
    expect(waiting).toEqual([postValueFor('not-fixed')]);
  });
});
```

`renderSheet`, `roundThreeGate`, `untick`, `editReply`, `submit`, `submitted`, `threadNameFor` and `postValueFor` are this test file's helpers: use the file's existing render-and-submit helpers where they exist (the respond sheet's DOM test has a `holdReply` helper that shows the pattern for toggling a card checkbox and editing a reply; copy its approach), and add the missing ones at the top of the describe as plain functions over the fixture. Every assertion above must stay as written.

Run (from `apps/board`): `bun test src/client/board/__tests__/review-gate-sheet-dom.test.tsx src/client/board/__tests__/review-gate.test.ts`
Expected: PASS without touching the components. A failure means the built sheet and the spec's section 4 disagree: fix the component and say so in the report.

- [ ] **Step 3: Board gates and a look**

Run (from `apps/board`): `bun test` then `bun run typecheck`. Then start Storybook and capture `Gates/Board/ReviewGateSheet` RoundThree in light and dark with the board's Playwright scripts in `apps/board/.superpowers/` (Fast Browser when its MCP server is connected). Compare against the signed-off look: nothing should have moved. Report plainly anything that reads wrong.

- [ ] **Step 4: Commit**

```bash
git add :/apps/board/src/client/board
git commit -m "board: the review sheet is tested against the questions the review scripts build"
```

**Phase 2 gate:** root `bun run typecheck`; `apps/board` `bun test`; both script suites; `bun cli.ts skills check --strict`.

---

# Phase 3: skipped findings

Ships alone: a finding the reviewer left off the MR is remembered, stays out of later rounds' findings, and can be brought back from the collapsed "Skipped earlier" row.

### Task 13: the gate scripts build the skipped questions

**Files:**
- Modify: `plugins/mattstack/attachments/review/review/scripts/review-source.sh`
- Modify: both `gate-ctx.sh` copies (edit `receive-review/scripts/gate-ctx.sh`, then copy over `review/scripts/gate-ctx.sh`)
- Modify: `plugins/mattstack/attachments/review/review/tests/fixtures/findings-v3.json`, `tests/test-review-source.sh`, `receive-review/tests/test-gate-ctx.sh`

**Interfaces:**
- Consumes: report json `skipped[]` (Task 14 writes the contract; fixed here):

```json
{"id": "r1-f3", "round": 1, "tier": "Minor", "title": "unused import in the retry module",
 "file": "queue/retry.ts", "line": 3, "changed": true}
```

`file` and `line` optional; `changed` a boolean; `id` round-qualified.
- Produces: after the findings questions and before the extras, `skipped-<n>` questions chunked at four:

```json
{"id": "skipped-1", "label": "Bring back a finding you skipped earlier?", "multi": true,
 "context": {"gate-ctx": "skipped@1", "skipped": [
   {"id": "r1-f3", "round": 1, "severity": "minor", "title": "unused import in the retry module", "file": "queue/retry.ts:3", "changed": true}]},
 "options": [{"value": "restore:r1-f3", "label": "[Minor] unused import in the retry module",
              "description": "queue/retry.ts:3 · skipped in round 1 · code changed since"}]}
```

No option is ever recommended.

- [ ] **Step 1: Extend the fixture and write the failing tests**

Add to `findings-v3.json`, after `threads`:

```json
  "skipped": [
    {"id": "r1-f3", "round": 1, "tier": "Minor", "title": "unused import in the retry module", "file": "queue/retry.ts", "line": 3, "changed": true},
    {"id": "r1-f5", "round": 1, "tier": "Important", "title": "the lease renewal has no test", "changed": false},
    {"id": "r2-f1", "round": 2, "tier": "Minor", "title": "log line says attempt, means retry", "file": "queue/worker.ts", "changed": false},
    {"id": "r2-f2", "round": 2, "tier": "Minor", "title": "magic number 250", "file": "queue/retry.ts", "line": 9, "changed": false},
    {"id": "r2-f4", "round": 2, "tier": "Minor", "title": "comment restates the code", "file": "queue/retry.ts", "line": 21, "changed": false}
  ],
```

Task 10's test asserting `'["thread-1","thread-2","thread-3","findings-1","outcome"]'` now expects `'["thread-1","thread-2","thread-3","findings-1","skipped-1","skipped-2","outcome"]'`; update it. Append:

```sh
# --- skipped findings: restore:<id> options, none recommended ---
run "$V3" "$X"
check "skipped chunks at four, in the order given" \
  '[["skipped-1",["restore:r1-f3","restore:r1-f5","restore:r2-f1","restore:r2-f2"]],["skipped-2",["restore:r2-f4"]]]' \
  "$(q '[.questions[] | select(.id | startswith("skipped-")) | [.id, [.options[].value]]] | tojson')"
check "no skipped option is recommended" 0 \
  "$(q '[.questions[] | select(.id | startswith("skipped-")) | .options[].label | select(test("recommended"))] | length')"
check "the option reads without a card: anchor, round, changed" \
  'queue/retry.ts:3 · skipped in round 1 · code changed since' "$(q '.questions[4].options[0].description')"
check "an unanchored, unchanged one says only its round" 'skipped in round 1' "$(q '.questions[4].options[1].description')"
check "the context entry lowercases severity and joins file:line" \
  '{"id":"r1-f3","round":1,"severity":"minor","title":"unused import in the retry module","file":"queue/retry.ts:3","changed":true}' \
  "$(q '.questions[4].context.skipped[0] | tojson')"
FIT=$(printf '%s' "$OUT" | sh "$GC" fit); FRC=$?
check "fit accepts skipped@1" 0 "$FRC"
check "fit stays structured with skipped questions" structured "$(printf '%s' "$FIT" | jq -r .mode)"
check "prose lists each skipped finding on a line" \
  '[MINOR] unused import in the retry module (queue/retry.ts:3) · skipped in round 1 · code changed since' \
  "$(printf '%s' "$OUT" | sh "$GC" prose | jq -r '.questions[4].context' | head -1)"
m=$(mutate '.skipped[1].id = "r1-f3"' "$V3"); run "$m" "$X"
check "a repeated skipped id exits 1" 'findings file: skipped: id r1-f3 appears more than once' "$ERR"
m=$(mutate 'del(.skipped[0].changed)' "$V3"); run "$m" "$X"
check "changed is required" 'findings file: skipped[0].changed: required boolean' "$ERR"
m=$(mutate '.skipped = []' "$V3"); run "$m" "$X"
check "an empty skipped list builds no question" 0 "$(q '[.questions[] | select(.id | startswith("skipped-"))] | length')"
```

`head -1` in a test pipe is safe here: the script sets `-u` only, not `pipefail`.

Run: `sh plugins/mattstack/attachments/review/review/tests/test-review-source.sh`
Expected: the new checks FAIL.

- [ ] **Step 2: Implement `review-source.sh`**

Add to `LIB`:

```jq
def skips: if (.skipped | type) == "array" then .skipped else [] end;
```

In `file_errs`, before the findings duplicate-id line:

```jq
  chk(optional("skipped"; type == "array"); "skipped: array when present"),
  (skips | to_entries[] | .key as $i | .value | (
      chk(.id | str; "skipped[\($i)].id: required non-empty string"),
      chk(.round | pos; "skipped[\($i)].round: integer of at least 1"),
      chk(.tier | among(["Critical","Important","Minor"]); "skipped[\($i)].tier: Critical|Important|Minor"),
      chk(.title | str; "skipped[\($i)].title: required non-empty string"),
      chk(.changed | type == "boolean"; "skipped[\($i)].changed: required boolean"),
      chk(optional("file"; str); "skipped[\($i)].file: non-empty string when present"),
      chk(optional("line"; pos); "skipped[\($i)].line: integer of at least 1 when present")
    )),
  ([skips[] | .id?] | group_by(.) | map(select(length > 1) | .[0])[] | "skipped: id \(.) appears more than once"),
```

Before `def build`:

```jq
def skip_option:
  thread_anchor as $a
  | {value: "restore:\(.id)", label: opt_label,
     description: ([$a, "skipped in round \(.round)", (if .changed then "code changed since" else null end)] | map(select(. != null)) | join(" · "))};
def skip_entry:
  thread_anchor as $a
  | {id, round, severity: (.tier | ascii_downcase), title}
    + (if $a then {file: $a} else {} end)
    + {changed};
```

(`thread_anchor` and `opt_label` already read only `file`, `line`, `tier` and `title`, which a skipped entry has.) In `build`, insert between the findings questions and `$x.questions`:

```jq
       + ([range(0; skips | length; 4) as $i | skips[$i:$i + 4]] | to_entries
          | map({id: "skipped-\(.key + 1)", label: "Bring back a finding you skipped earlier?", multi: true,
                 context: {"gate-ctx": "skipped@1", skipped: (.value | map(skip_entry))},
                 options: (.value | map(skip_option))}))
```

`skips` inside `build` must read the top-level file: bind it first (`skips as $skips` at the top of `build`, then use `$skips`), since `build` rebinds `.` inside the pipes.

- [ ] **Step 3: Implement `gate-ctx.sh` (both copies)**

```jq
def skipped_errs($values): [
  chk(.skipped | type == "array" and length > 0; "skipped: required non-empty array"),
  (entries("skipped") | to_entries[] | .key as $i | .value | (
    chk(.id | str; "skipped[\($i)].id: required non-empty string"),
    chk(.round | type == "number" and . == floor and . >= 1; "skipped[\($i)].round: integer of at least 1"),
    chk(.severity | among(["critical","important","minor"]); "skipped[\($i)].severity: critical|important|minor"),
    chk(.title | str; "skipped[\($i)].title: required non-empty string"),
    chk(.changed | type == "boolean"; "skipped[\($i)].changed: required boolean"),
    chk(optional("file"; str); "skipped[\($i)].file: non-empty string when present"),
    chk("restore:\(.id)" as $v | $values | index([$v]) != null; "skipped[\($i)].id: matches no option value of this question")
  )),
  ([entries("skipped")[] | .id?] as $ids
    | ($values[] | select(. as $v | ($ids | map("restore:\(.)")) | index([$v]) == null) | "option \(.): no skipped entry carries its value"))
];
```

Add the `shape_errs` branch `elif .["gate-ctx"] == "skipped@1" then skipped_errs($values)`, add `"skipped@1"` to the per-question allowed list, and add a `prose` branch before `thread@1`:

```jq
  elif .["gate-ctx"] == "skipped@1" then
    [.skipped[]
     | "[\(.severity | ascii_upcase)] \(.title)" + (if has("file") then " (\(.file))" else "" end)
       + " · skipped in round \(.round)" + (if .changed then " · code changed since" else "" end)]
    | join("\n")
```

Add to `test-gate-ctx.sh` one case: a `skipped@1` context whose entry id has no `restore:` option fails with `matches no option value of this question`. Copy the receive-review file over the review copy.

- [ ] **Step 4: Run both suites, commit**

Run both script suites; expected every line `ok`.

```bash
git add :/plugins/mattstack/attachments/review
git commit -m "review gate scripts: skipped findings become skipped-N questions (skipped@1)"
```

### Task 14: the skills remember and restore skipped findings

**Files:**
- Modify: `plugins/mattstack/attachments/review-core-body-tail/SKILL.md`
- Modify: `plugins/mattstack/attachments/review/review/SKILL.md`
- Modify: `plugins/mattstack/attachments/gate-protocol/SKILL.md`
- Modify: `apps/board/skills-src/review/SKILL.md`
- Regenerate: `apps/board/skills/`; bump `plugin.json`

**REQUIRED SUB-SKILLS:** `mattstack:editing-skills`, `superpowers:writing-skills`, `mattstack:process-digraphs`.

- [ ] **Step 1: RED baseline**

Fresh agent, current compiled board review skill:

> Round 1 of your review of MR 41 found f1 (Important, `src/cart.ts:12`), f2 (Minor, `src/cart.ts:40`) and f3 (Minor, no anchor). The human ticked only f1 and chose comment. (a) After the gate answer, what do you record and where? Now it is round 2: `review-ledger read` returned `skipped: [{id: "r1-f2", round: 1, severity: "minor", title: "loop is quadratic", file: "src/cart.ts", line: 40, excerpt: "...", snippet: "for (const a of items) for (const b of items)"}, {id: "r1-f3", ...}]`. Reading the diff you notice the same quadratic loop is still there, and lines 38-44 changed since round 1. (b) Does the quadratic loop appear in this round's findings? (c) What does the gate show for it? (d) The human ticks `restore:r1-f2`. What posts, and what do you record?

Expected baseline: (a) no `--skipped`; (b) re-raised as a new or still-open finding; (c)/(d) undefined.

- [ ] **Step 2: Edit `review-core-body-tail/SKILL.md`**

Add to the re-review bullets of "Structured findings file":

```markdown
- `skipped`, when the caller handed in findings the reviewer chose not to
  raise in earlier rounds: every one of them back, in the order given, as
  `{id, round, tier, title, file, line, changed}`. `id`, `round`, `title`,
  `file` and `line` are the caller's, unchanged; `tier` is the caller's
  severity capitalised (`Critical` | `Important` | `Minor`). `changed` is
  true when the code the finding pointed at has moved since the round
  that skipped it: `git diff <that round's sha>..HEAD -- <file>` touches
  its line, or its recorded snippet is no longer in the file; false when
  it has no anchor or that round's sha is `unknown`.
- A would-be finding that says what a skipped one says, about the same
  code, is that skipped finding: it stays out of `findings` and is
  reported only under `skipped`. The reviewer already decided not to
  raise it; whether the code changed is what `changed` is for.
```

- [ ] **Step 3: Edit the engine (`review/review/SKILL.md`)**

1. Extend "### Take the earlier threads the caller handed in": the caller also hands in the skipped list (each entry with its round's sha); the pass reports each back per the structured findings file and never re-raises one as a finding.
2. Extend "### Compose the submitted review: comments, summary, outcome":

```markdown
A skipped finding the human brought back (`restore:<id>` picked in a
`skipped-<n>` answer) posts like a selected finding: a comment at its
recorded `file` and `line` with its recorded text as the body, or in the
summary's issue list when it has no anchor. Its text is the caller's
record of it, never rewritten.
```

3. In "## What the graph cannot show": the caller's selection may carry `restored: [{id, title, body, file, line}]`, handed in by the caller from its own record.

- [ ] **Step 4: Edit `gate-protocol/SKILL.md`**

```markdown
**`skipped@1`** (a `review-post` gate's `skipped-<n>` questions, chunked
at four): `{skipped: [{id, round, severity, title, file?, changed}]}`,
one entry per option, option value `restore:<id>`. Nothing is
recommended: a skipped finding comes back only when the human ticks it.
Answers read back as one union across the chunks.
```

As in Task 11, this goes in as a ROW of the "Structured context (gate-ctx@1)" table, not prose under it. Run `bun run skills:expand:board`.

- [ ] **Step 5: Edit the board wrapper (`apps/board/skills-src/review/SKILL.md`)**

1. "## Re-review mode", step 1: the read's `skipped` is handed to the review with each entry's round sha (from `rounds`). Add a step:

```markdown
4. **An MR reviewed before the board kept rounds.** When the read says
   `round: 0` and `--report` holds a prior review that ends in a
   `review-post-answer:` line, rebuild round 1 before reviewing: its
   skipped findings are the prior report json's `findings` whose ids are
   not in that answer's `findings-N` values (all of them when the answer
   carried `tiers` instead: nothing can be told apart, so record none).
   Record it with `<status-bin> review-ledger record <state> --round 1
   --sha unknown --outcome <the answer's outcome> --skipped '<json>'`,
   each entry `{id, title, severity, file, line, excerpt}` from the json
   (`severity` the tier lowercased, `excerpt` the finding's `body`), then
   read the ledger again. With no json sibling, record nothing: there is
   no list to rebuild.
```

2. "### Record the verdict answer in --report": the `review-ledger record` call's `--skipped` is now every finding in this round's report json whose id no `findings-N` answer picked, each `{id, title, severity, file, line, excerpt, snippet}` (`severity` the tier lowercased; `excerpt` the finding's `body`; `snippet` the code at its anchor, up to five lines, omitted when it has no anchor). `--restored` is every `skipped-N` answer value with its `restore:` prefix removed. On the tier fallback path `--skipped` is `[]`.
3. "### Hand the answer to the domain skill to post": the handed selection gains `restored`, one `{id, title, body, file, line}` per restored id, taken from the ledger read (`body` is the entry's `excerpt`).
4. "## Building the review-post questions": a report json with a non-empty `skipped` array goes through the fitted open file like one with `threads`.

- [ ] **Step 6: Expand, compile, GREEN**

Re-run Step 1's scenario fresh. Expected: (a) `review-ledger record ... --round 1 --skipped '[{"id":"f2",...},{"id":"f3",...}]' --restored '[]'`; (b) no; (c) it is in `skipped` with `changed: true`, shown in the collapsed row, unticked; (d) `mr_review_submit` carries a comment at `src/cart.ts:40` with the recorded text, and the round-2 record has `--restored '["r1-f2"]'`.

Second GREEN scenario for the old-review path: "`review-ledger read` returned `round: 0`; `--report` ends with `review-post-answer: {"answers":{"findings-1":["f1"],"outcome":"comment"},...}` and its json has f1, f2, f3." Expected: a round-1 record with `--sha unknown` and f2, f3 skipped, before the review starts.

- [ ] **Step 7: Certify, bump, verify, commit**

As Task 11 Step 8.

```bash
git add :/plugins/mattstack :/apps/board/skills-src :/apps/board/skills
git commit -m "review skills: skipped findings are recorded, kept out of later rounds, and restorable"
```

### Task 15: the skipped row against real questions

**Files:**
- Modify: `apps/board/src/client/board/__tests__/review-source-contract.test.ts`, `review-gate-sheet-dom.test.tsx`

- [ ] **Step 1: Extend the contract test**

Update the v3 case's expectations for the fixture's new `skipped` and add:

```ts
  test('skipped findings join their restore options across chunks', () => {
    const gate = readReviewGate(fittedGate('findings-v3.json') as never);
    expect([...gate!.skipped.keys()]).toEqual([
      'restore:r1-f3', 'restore:r1-f5', 'restore:r2-f1', 'restore:r2-f2', 'restore:r2-f4',
    ]);
    expect(gate!.skipped.get('restore:r1-f3')).toEqual({
      id: 'r1-f3', round: 1, severity: 'minor', title: 'unused import in the retry module',
      file: 'queue/retry.ts:3', changed: true,
    });
  });
```

- [ ] **Step 2: DOM tests for the skipped row**

```tsx
describe('skipped earlier', () => {
  test('the row is closed, counts its findings, and ticks nothing', () => {
    const { container } = renderSheet(roundThreeGate());
    const row = container.querySelector('.tui-review-skipped')!;
    expect(row.querySelector('.tui-review-skipped-count')!.textContent).toBe('3');
    expect(row.querySelector('.tui-review-skipped-hint')!.textContent).toBe(
      'you chose not to raise these · tick one to bring it back'
    );
    expect([...row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].some(i => i.checked)).toBe(false);
  });

  test('a finding whose code moved says so', () => {
    const { container } = renderSheet(roundThreeGate());
    expect(container.querySelector('.tui-review-skipped-changed')!.textContent).toBe('code changed since');
  });

  test('ticking one marks it coming back and sends its restore value', async () => {
    const { container, submitted } = renderSheet(roundThreeGate());
    await openSkipped(container);
    await tickSkipped(container, 0);
    expect(container.querySelector('.tui-review-skipped-restoring')!.textContent).toBe('coming back this round');
    expect(container.querySelector('.tui-review-skipped-hint')!.textContent).toBe('1 coming back this round');
    await submit(container);
    const answers = submitted().answers;
    const restored = Object.entries(answers).filter(([k]) => k.startsWith('skipped')).flatMap(([, v]) => v as string[]);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatch(/^restore:/);
  });

  test('a skipped finding never appears among the new findings', () => {
    const { container } = renderSheet(roundThreeGate());
    const newTitles = [...container.querySelectorAll('[data-step="findings"] .tui-review-finding-title')].map(n => n.textContent);
    const skippedTitles = [...container.querySelectorAll('.tui-review-skipped .tui-review-finding-title')].map(n => n.textContent);
    for (const t of skippedTitles) expect(newTitles).not.toContain(t);
  });
});
```

`openSkipped` and `tickSkipped` are helpers to add beside Task 12's (click the `DisclosureHead`, then the nth row's checkbox). The count `'3'` matches the `RoundThree` story fixture; if the test builds its own gate, assert that gate's count. Check the selector for the new-findings container against `ReviewGateSheet.tsx` and use the class it actually renders.

Run (from `apps/board`): `bun test src/client/board/__tests__` then `bun run typecheck`.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add :/apps/board/src/client/board/__tests__
git commit -m "board: the skipped-earlier row is tested against the review scripts' questions"
```

---

# Close-out

### Task 16: whole-branch verification and the PR

- [ ] **Step 1: Every suite**

From the repo root: `bun run typecheck`, `bun run test`, `bun run check`. From `apps/board`: `bun test`, `bun run typecheck`. From `packages/glance`: `bun test`, `bun run check-types`, `bun run check:node`. Both script suites. `bun cli.ts skills check --strict`. `bun run docs:gen` only if a command description changed (none should).
Expected: all green. Report any failure with its output; do not call a flaky failure "pre-existing" without running that test alone on `origin/main`.

- [ ] **Step 2: UI check**

Storybook `Gates/Board/ReviewGateSheet` (RoundThree, RoundThreeBringingOneBack, RoundTwoAllSettled) and one `RowView` story, light and dark, rendered and looked at. Regenerate `capture:compare` baselines only for intended changes (none are expected in Phases 2 and 3). Say plainly what looks wrong, if anything.

- [ ] **Step 3: Purity and the public repo**

Search the diff for employer names, real MR numbers and ticket ids: `git diff origin/main...HEAD | grep -niE 'assured|claimview|RT-[0-9]|SKILLS-[0-9]|![0-9]{4,}'`. Expected: no hits anywhere except the claimview pack named as a consumer in the spec and this plan, and the invented `!87` in fixtures.

- [ ] **Step 4: Confirm the v4 claim still stands**

Re-read the rt chat thread from Task 8 Step 1. If another lane took v4 meanwhile, renumber before pushing.

- [ ] **Step 5: Push and open the PR**

`git_push {tree: <this worktree>, setUpstream: true}`, then `gh pr create` against `main` in `m4ttstack/mattstack`. Body per the repo's PR template: what changed by phase, the deviation noted at the top of this plan, the test counts, the Storybook captures. Wait for CodeRabbit and green CI; address actionable findings; merge only with Matt's confirmation.

- [ ] **Step 6: Rollout, after merge (Matt confirms each)**

Sync the shared checkout (check `git branch --show-current` is `main` first), restart the daemon, `/reload-plugins`, `rt skills sync` (recompiles and bumps the claimview pack), `deck restart board` with the frontend deploy. Then one real review from the board on a test MR, checked on GitLab: the summary note, a "left review comments" system note, and the reviewer in the reviewed state.

---

## Self-review notes

- Spec section 1 (submit tool): Tasks 1-5. Section 2 (rounds): Tasks 10-12. Section 3 (round record): Tasks 8, 9, 14. Section 4 (gate): built; Tasks 12 and 15 pin it to real questions. Section 5 (pill and latch): Task 7; the latch's arm and spend are unchanged and need no task.
- Spec "Each submit adds a system note" and "reviewer limit" are GitLab behaviour, exercised in Task 5 and Task 16 Step 6, not code.
- The summary posts as a plain note that cannot be resolved (GitLab's behaviour), so an unanchored finding in the summary is no longer a resolvable thread. The spec accepts this ("rides in the summary, as today").

