/**
 * REST API helpers for GitLab note mutations.
 *
 * A project is a numeric id or a path; a path is sent URL-encoded.
 * Mirrors the GitLab REST API:
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/notes
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/discussions/:discussionId/notes
 *   PUT    /api/v4/projects/:id/merge_requests/:mrIid/notes/:noteId
 *   DELETE /api/v4/projects/:id/merge_requests/:mrIid/notes/:noteId
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/discussions
 *   POST   /api/v4/projects/:id/uploads
 *   GET    /api/v4/projects/:id/merge_requests/:mrIid
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/draft_notes
 *   GET    /api/v4/projects/:id/merge_requests/:mrIid/draft_notes
 *   DELETE /api/v4/projects/:id/merge_requests/:mrIid/draft_notes/:draftId
 *   POST   /api/v4/projects/:id/merge_requests/:mrIid/draft_notes/bulk_publish
 *   GET    /api/v4/projects/:id/merge_requests/:mrIid/reviewers
 */

import { throwIfGitLabRateLimited, withGitLabRateLimit } from './gitlabRateLimit.ts';
import { type OnRequestHook, safeEmit } from './instrumentation.ts';
import { fetchSameOrigin } from './sameOriginFetch.ts';

/** GitLab omits `type` on a general note; every CreatedNote producer must still return `null`, not `undefined`. */
function normalizeNoteType(note: CreatedNote): CreatedNote {
  return { ...note, type: note.type ?? null };
}

export interface CreatedNote {
  id: number;
  body: string;
  author: {
    id: number;
    username: string;
    name: string;
    avatar_url: string | null;
  };
  created_at: string;
  resolvable: boolean | null;
  resolved: boolean | null;
  /** "DiffNote" for a positioned note; null for a general note (or absent from the response). */
  type: string | null;
}

export interface CreatedDiscussion {
  id: string;
  notes: CreatedNote[];
}

export interface DiffRefs {
  base_sha: string;
  start_sha: string;
  head_sha: string;
}

export type TextPosition = DiffRefs & {
  position_type: "text";
  new_path: string;
  old_path: string;
} & (
    | { new_line: number; old_line?: never }
    | { old_line: number; new_line?: never }
    | { old_line: number; new_line: number }
  );

export interface UploadedFile {
  alt: string;
  url: string;
  full_path: string;
  /** Ready-to-paste markdown, e.g. `![latch](/uploads/<hash>/latch.png)`. */
  markdown: string;
}

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

/** GitLab reads a project path only as one URL-encoded segment. */
function projectSegment(project: number | string): string {
  return typeof project === 'number' ? String(project) : encodeURIComponent(project);
}

/** GitLab stops serving a request after this long. */
const GITLAB_REQUEST_LIMIT_MS = 60_000;
/**
 * Above GitLab's own request limit, so a publish GitLab is still running is
 * never abandoned. It also bounds the publish's 429 waits, which may use only
 * what is left after reserving that limit for the send.
 */
const PUBLISH_TIMEOUT_MS = 90_000;
/** Every other request a review submit makes (drafts, reviewer states, diff refs). */
const DRAFT_TIMEOUT_MS = 15_000;

/** A GitLab refusal: the message names the op and status, `status` carries it for callers. */
export type HttpStatusError = Error & { status: number };

export class NoteMutator {
  private readonly baseURL: string;
  private readonly token: string;
  private readonly onRequest?: OnRequestHook;

  constructor(baseURL: string, token: string, options: { onRequest?: OnRequestHook } = {}) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.token = token;
    this.onRequest = options.onRequest;
  }

  /**
   * One request, sent again after GitLab's reset for as long as it answers
   * 429. Each attempt gets its own `timeoutMs`, so time spent waiting for the
   * reset never counts against the next send; with `shareBudget`, `timeoutMs`
   * instead bounds the waits and every send together, so a caller timing the
   * whole call is never outlasted.
   */
  private async send(
    op: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    init: { headers: Record<string, string>; body?: string | FormData; timeoutMs?: number; shareBudget?: boolean },
  ): Promise<Response> {
    const budgetEnd = init.shareBudget && init.timeoutMs !== undefined ? Date.now() + init.timeoutMs : undefined;
    const limits = budgetEnd !== undefined ? { retryBy: budgetEnd - GITLAB_REQUEST_LIMIT_MS } : {};
    return withGitLabRateLimit(`${method} ${path}`, method === 'GET' ? 'read' : 'write', async () => {
      const timeoutMs = budgetEnd !== undefined ? Math.max(1, budgetEnd - Date.now()) : init.timeoutMs;
      const started = performance.now();
      const res = await fetchSameOrigin(`${this.baseURL}${path}`, {
        method,
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
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
      throwIfGitLabRateLimited(res);
      return res;
    }, limits);
  }

  /**
   * Create a note on an MR, optionally within an existing discussion thread.
   * If `discussionId` is provided the note is posted as a reply to that thread.
   */
  async createNote(
    project: number | string,
    mrIid: number,
    body: string,
    discussionId?: string,
  ): Promise<CreatedNote> {
    const path = discussionId
      ? `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/discussions/${discussionId}/notes`
      : `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/notes`;
    const res = await this.send('createNote', 'POST', path, {
      headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": this.token },
      body: JSON.stringify({ body }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `createNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }

    return normalizeNoteType((await res.json()) as CreatedNote);
  }

  /**
   * Create a NEW discussion thread on an MR. Unlike createNote's /notes
   * endpoint, a discussion created this way is resolvable, which is the whole
   * reason to prefer it: callers that need a thread a human can resolve cannot
   * get one from /notes.
   */
  async createDiscussion(
    project: number | string,
    mrIid: number,
    body: string,
  ): Promise<CreatedDiscussion> {
    const path = `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/discussions`;
    const res = await this.send('createDiscussion', 'POST', path, {
      headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": this.token },
      body: JSON.stringify({ body }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `createDiscussion failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }
    const discussion = (await res.json()) as CreatedDiscussion;
    return { ...discussion, notes: discussion.notes.map(normalizeNoteType) };
  }

  /**
   * Create a positioned (inline) discussion anchored to a line in the diff.
   * `position` must be sent as a nested JSON object, not bracketed form
   * fields: GitLab silently drops the position (and degrades to a general
   * note) when the nesting isn't JSON.
   */
  async createPositionedDiscussion(
    project: number | string,
    mrIid: number,
    body: string,
    position: TextPosition,
  ): Promise<CreatedDiscussion> {
    const path = `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/discussions`;
    const res = await this.send('createPositionedDiscussion', 'POST', path, {
      headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": this.token },
      body: JSON.stringify({ body, position }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `createPositionedDiscussion failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }
    const discussion = (await res.json()) as CreatedDiscussion;
    return { ...discussion, notes: discussion.notes.map(normalizeNoteType) };
  }

  /**
   * Fetch the MR's current `diff_refs`, needed to anchor a positioned
   * discussion (see `createPositionedDiscussion`). GitLab omits `diff_refs`
   * until the MR has a diff to anchor against.
   */
  async fetchDiffRefs(project: number | string, mrIid: number): Promise<DiffRefs> {
    const path = `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}`;
    const res = await this.send('fetchDiffRefs', 'GET', path, {
      headers: { "PRIVATE-TOKEN": this.token },
      timeoutMs: DRAFT_TIMEOUT_MS,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `fetchDiffRefs failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }

    const data = (await res.json()) as { diff_refs: DiffRefs | null };
    if (!data.diff_refs) {
      throw new Error(
        `fetchDiffRefs: merge request !${mrIid} in project ${project} has no diff_refs yet`,
      );
    }
    return data.diff_refs;
  }

  /** Edit the body of an existing note. */
  async updateNote(
    project: number | string,
    mrIid: number,
    noteId: number,
    body: string,
  ): Promise<void> {
    const path = `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/notes/${noteId}`;
    const res = await this.send('updateNote', 'PUT', path, {
      headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": this.token },
      body: JSON.stringify({ body }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `updateNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }
  }

  /** Permanently delete a note. */
  async deleteNote(project: number | string, mrIid: number, noteId: number): Promise<void> {
    const path = `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/notes/${noteId}`;
    const res = await this.send('deleteNote', 'DELETE', path, { headers: { "PRIVATE-TOKEN": this.token } });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `deleteNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }
  }

  private async draftRequest(
    op: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = DRAFT_TIMEOUT_MS,
    shareBudget = false,
  ): Promise<Response> {
    const res = await this.send(op, method, path, {
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'PRIVATE-TOKEN': this.token,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      timeoutMs,
      shareBudget,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`${op} failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ''}`) as HttpStatusError;
      err.status = res.status;
      throw err;
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
    project: number | string,
    mrIid: number,
    body: string,
    opts: { position?: TextPosition; inReplyToDiscussionId?: string; resolveDiscussion?: boolean } = {},
  ): Promise<DraftNote> {
    const res = await this.draftRequest(
      'createDraftNote',
      'POST',
      `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/draft_notes`,
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
  async listDraftNotes(project: number | string, mrIid: number): Promise<DraftNote[]> {
    const res = await this.draftRequest(
      'listDraftNotes',
      'GET',
      `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/draft_notes?per_page=100`,
    );
    return (await res.json()) as DraftNote[];
  }

  async deleteDraftNote(project: number | string, mrIid: number, draftId: number): Promise<void> {
    await this.draftRequest(
      'deleteDraftNote',
      'DELETE',
      `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/draft_notes/${draftId}`,
    );
  }

  /**
   * Submit the review: publishes EVERY pending comment the token's user has
   * on the MR, posts `note` as a plain summary note, and sets the reviewer
   * state. Works with no pending comments.
   */
  async publishDraftNotes(
    project: number | string,
    mrIid: number,
    opts: { note: string; reviewerState: 'reviewed' | 'requested_changes'; timeoutMs?: number },
  ): Promise<void> {
    await this.draftRequest(
      'publishDraftNotes',
      'POST',
      `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/draft_notes/bulk_publish`,
      { note: opts.note, reviewer_state: opts.reviewerState },
      opts.timeoutMs ?? PUBLISH_TIMEOUT_MS,
      true,
    );
  }

  async fetchReviewerStates(project: number | string, mrIid: number): Promise<ReviewerState[]> {
    const res = await this.draftRequest(
      'fetchReviewerStates',
      'GET',
      `/api/v4/projects/${projectSegment(project)}/merge_requests/${mrIid}/reviewers`,
    );
    const rows = (await res.json()) as Array<{ user: { username: string }; state: string }>;
    return rows.map(r => ({ username: r.user.username, state: r.state }));
  }

  /**
   * Upload a file to a project's markdown uploads store. The returned `url` is
   * project-relative and only renders inside that project's markdown, so an
   * upload cannot be shared across projects.
   *
   * Content-Type is deliberately unset: fetch derives the multipart boundary
   * from the FormData body, and setting the header by hand strips it.
   */
  async uploadFile(
    project: number | string,
    filename: string,
    bytes: Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<UploadedFile> {
    const path = `/api/v4/projects/${projectSegment(project)}/uploads`;
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

    const res = await this.send('uploadFile', 'POST', path, { headers: { "PRIVATE-TOKEN": this.token }, body: form });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `uploadFile failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }
    return (await res.json()) as UploadedFile;
  }
}
