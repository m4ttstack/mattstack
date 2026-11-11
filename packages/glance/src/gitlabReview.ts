import type { DiffRefs, NoteMutator, TextPosition } from './NoteMutator.ts';
import { pendingPreview } from './reviewPreview.ts';
import type { CommentAnchor, ReviewSubmission, ReviewSubmitResult } from './types.ts';

export function buildTextPosition(anchor: CommentAnchor, refs: DiffRefs): TextPosition {
  const old_path = anchor.oldPath ?? anchor.path;
  if (anchor.line === undefined) {
    if (anchor.oldLine === undefined) throw new Error('a comment anchor needs line or oldLine');
    return { ...refs, position_type: 'text', new_path: anchor.path, old_path, old_line: anchor.oldLine };
  }
  if (typeof anchor.oldLine === 'number') {
    return {
      ...refs,
      position_type: 'text',
      new_path: anchor.path,
      new_line: anchor.line,
      old_path,
      old_line: anchor.oldLine
    };
  }
  return { ...refs, position_type: 'text', new_path: anchor.path, new_line: anchor.line, old_path };
}

export interface GitLabReviewDeps {
  mutator: Pick<
    NoteMutator,
    'fetchDiffRefs' | 'listDraftNotes' | 'createDraftNote' | 'deleteDraftNote' | 'publishDraftNotes'
  >;
  project: number | string;
  iid: number;
  approve(): Promise<void>;
  resolve(discussionId: string): Promise<void>;
}

/** Must not exceed listDraftNotes' page size: the pending check and the rollback each read one page. */
const MAX_ITEMS = 100;

/** Statuses GitLab answers before it acts on a request. */
const REFUSED_BEFORE_ACTING = new Set([400, 401, 403, 404, 422]);

function refusedBeforeActing(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && REFUSED_BEFORE_ACTING.has(status);
}

interface Rollback {
  left: number;
  firstError?: string;
}

function leftover({ left, firstError }: Rollback): string {
  const cause = firstError === undefined ? '' : ` (first error: ${firstError})`;
  if (left > 0) {
    return `; ${left} pending comment${left === 1 ? '' : 's'} could not be deleted and ${left === 1 ? 'is' : 'are'} still on the MR${cause}`;
  }
  return firstError === undefined ? '' : `; pending comments could not be listed, so one may still be on the MR${cause}`;
}

/**
 * One GitLab review as one sequence: refuse on the caller's own pending
 * comments, create every comment and reply as a pending comment, publish
 * once, then approve and resolve.
 */
export async function submitGitLabReview(deps: GitLabReviewDeps, review: ReviewSubmission): Promise<ReviewSubmitResult> {
  const { mutator, project, iid } = deps;
  const items = review.comments.length + review.replies.length;
  if (items > MAX_ITEMS) {
    throw new Error(`review not posted: ${items} comments and replies exceed the limit of ${MAX_ITEMS}`);
  }

  const before = await mutator.listDraftNotes(project, iid);
  if (before.length > 0) {
    return {
      published: false,
      reason: 'pending-drafts',
      pending: { count: before.length, firstLines: pendingPreview(before.map((d) => d.note)) }
    };
  }

  const created: number[] = [];
  const deleteAll = async (ids: number[], firstError?: string): Promise<Rollback> => {
    let left = 0;
    for (const id of ids) {
      try {
        await mutator.deleteDraftNote(project, iid, id);
      } catch (err) {
        left++;
        firstError ??= String(err);
      }
    }
    return { left, firstError };
  };
  /**
   * The check above proved the caller had no pending comments, so every one
   * listed now is this call's, including a create that landed and then threw
   * before its id reached `created`.
   */
  const rollback = async (): Promise<Rollback> => {
    let ids: number[];
    try {
      ids = (await mutator.listDraftNotes(project, iid)).map((d) => d.id);
    } catch (err) {
      return deleteAll(created, String(err));
    }
    return deleteAll(ids);
  };

  const badAnchors: Array<{ index: number; path: string; line: number }> = [];
  try {
    if (review.comments.length > 0) {
      const refs = await mutator.fetchDiffRefs(project, iid);
      for (const [index, c] of review.comments.entries()) {
        const d = await mutator.createDraftNote(project, iid, c.body, { position: buildTextPosition(c, refs) });
        created.push(d.id);
        if (d.line_code === null) badAnchors.push({ index, path: c.path, line: (c.line ?? c.oldLine) as number });
      }
    }
    if (badAnchors.length === 0) {
      for (const r of review.replies) {
        if (r.body === undefined) continue;
        const d = await mutator.createDraftNote(project, iid, r.body, {
          inReplyToDiscussionId: r.discussionId,
          resolveDiscussion: r.resolve
        });
        created.push(d.id);
      }
    }
  } catch (err) {
    throw new Error(`review not posted: ${String(err)}${leftover(await rollback())}`);
  }
  if (badAnchors.length > 0) {
    const rb = await rollback();
    if (rb.left > 0) throw new Error(`review not posted: ${badAnchors.length} comment anchors are outside the diff${leftover(rb)}`);
    return { published: false, reason: 'bad-anchors', badAnchors };
  }

  /**
   * GitLab's bulk publish creates every note first and deletes the drafts in
   * one step at the end, so drafts still pending after a failure do not prove
   * nothing posted. Only a refusal GitLab gives before acting proves that.
   */
  const reviewerState = review.outcome === 'request_changes' ? 'requested_changes' : 'reviewed';
  try {
    await mutator.publishDraftNotes(project, iid, { note: review.summary, reviewerState });
  } catch (err) {
    if (refusedBeforeActing(err)) {
      const rb = created.length > 0 ? await rollback() : { left: 0 };
      throw new Error(`publish failed, nothing was posted: ${String(err)}${leftover(rb)}`);
    }
    if (created.length === 0) {
      throw new Error(`publish failed and its outcome is unknown: ${String(err)}; look for the summary on the MR before retrying`);
    }
    let remaining;
    try {
      remaining = await mutator.listDraftNotes(project, iid);
    } catch (listErr) {
      throw new Error(`publish failed and its outcome is unknown: ${String(err)}; listing pending comments failed too: ${String(listErr)}; look for the summary on the MR before retrying`);
    }
    const pendingIds = new Set(remaining.map((d) => d.id));
    const stillPending = created.filter((id) => pendingIds.has(id));
    if (stillPending.length > 0) {
      const rb = await deleteAll(stillPending);
      if (stillPending.length === created.length) {
        throw new Error(`publish failed and its outcome is unknown: ${String(err)}; GitLab may have posted some or all of this review; look at the MR before retrying${leftover(rb)}`);
      }
      throw new Error(`publish failed and only partly landed: ${created.length - stillPending.length} of ${created.length} pending comments were posted: ${String(err)}${leftover(rb)}; look at the MR before retrying`);
    }
  }

  let approved = false;
  let approveError: string | undefined;
  if (review.outcome === 'approve') {
    try {
      await deps.approve();
      approved = true;
    } catch (err) {
      approveError = String(err);
    }
  }

  const resolved: string[] = [];
  const resolveErrors: Array<{ discussionId: string; error: string }> = [];
  for (const r of review.replies) {
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

  const posted = review.replies.filter((r) => r.body !== undefined);
  return {
    published: true,
    comments: review.comments.length,
    replies: posted.length,
    repliedTo: posted.map((r) => r.discussionId),
    resolved,
    approved,
    ...(approveError !== undefined ? { approveError } : {}),
    resolveErrors,
    reviewId: null,
    reviewerState: null
  };
}
