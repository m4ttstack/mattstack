/**
 * REST API helpers for GitLab note mutations.
 *
 * Uses numeric projectId + mrIid so callers don't need the project full path.
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

import { type OnRequestHook, safeEmit } from './instrumentation.ts';

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

/** Above GitLab's own request limit, so a publish GitLab is still running is never abandoned. */
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
   * Create a note on an MR, optionally within an existing discussion thread.
   * If `discussionId` is provided the note is posted as a reply to that thread.
   */
  async createNote(
    projectId: number,
    mrIid: number,
    body: string,
    discussionId?: string,
  ): Promise<CreatedNote> {
    const path = discussionId
      ? `/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}/notes`
      : `/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.createNote',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
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
    projectId: number,
    mrIid: number,
    body: string,
  ): Promise<CreatedDiscussion> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.createDiscussion',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
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
    projectId: number,
    mrIid: number,
    body: string,
    position: TextPosition,
  ): Promise<CreatedDiscussion> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/discussions`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body, position }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.createPositionedDiscussion',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
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
  async fetchDiffRefs(projectId: number, mrIid: number): Promise<DiffRefs> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const res = await fetch(url, {
      method: "GET",
      headers: { "PRIVATE-TOKEN": this.token },
      signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.fetchDiffRefs',
      transport: 'rest',
      method: 'GET',
      path,
      durationMs: performance.now() - started,
      status: res.status,
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
        `fetchDiffRefs: merge request !${mrIid} in project ${projectId} has no diff_refs yet`,
      );
    }
    return data.diff_refs;
  }

  /** Edit the body of an existing note. */
  async updateNote(
    projectId: number,
    mrIid: number,
    noteId: number,
    body: string,
  ): Promise<void> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": this.token,
      },
      body: JSON.stringify({ body }),
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.updateNote',
      transport: 'rest',
      method: 'PUT',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `updateNote failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }
  }

  /** Permanently delete a note. */
  async deleteNote(projectId: number, mrIid: number, noteId: number): Promise<void> {
    const path = `/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes/${noteId}`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();
    const res = await fetch(url, {
      method: "DELETE",
      headers: { "PRIVATE-TOKEN": this.token },
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.deleteNote',
      transport: 'rest',
      method: 'DELETE',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

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
  ): Promise<Response> {
    const started = performance.now();
    const res = await fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'PRIVATE-TOKEN': this.token,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
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

  /**
   * Upload a file to a project's markdown uploads store. The returned `url` is
   * project-relative and only renders inside that project's markdown, so an
   * upload cannot be shared across projects.
   *
   * Content-Type is deliberately unset: fetch derives the multipart boundary
   * from the FormData body, and setting the header by hand strips it.
   */
  async uploadFile(
    projectId: number,
    filename: string,
    bytes: Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<UploadedFile> {
    const path = `/api/v4/projects/${projectId}/uploads`;
    const url = `${this.baseURL}${path}`;
    const started = performance.now();

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

    const res = await fetch(url, {
      method: "POST",
      headers: { "PRIVATE-TOKEN": this.token },
      body: form,
    });

    safeEmit(this.onRequest, {
      op: 'noteMutator.uploadFile',
      transport: 'rest',
      method: 'POST',
      path,
      durationMs: performance.now() - started,
      status: res.status,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `uploadFile failed: ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
      );
    }
    return (await res.json()) as UploadedFile;
  }
}
